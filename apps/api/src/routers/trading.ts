import { z } from "zod";
import { and, desc, eq, like } from "drizzle-orm";
import { db, auditLogs } from "@framework/db";
import { t } from "../trpc/context.ts";
import { protectedProcedure, tradeProcedure } from "../trpc/middleware.ts";
import { audit } from "../services/audit.ts";
import * as trading from "../services/trading.ts";
import { paramPeriodPerformance, paramPeriodTrades, attributionCoverage } from "../services/param-tracking.ts";
import { startOptimize, optimizeStatus, listCombos } from "../services/observatory.ts";

/**
 * Trading router (Phase 2 — strategy activation). Every mutation is a LIVE action on the funded
 * account, gated by `tradeProcedure` (human manager+ session only — never the agent/API/jobs). The
 * risk-increasing actions require an explicit `confirm: true` (sent after the UI's dry-run + Confirm
 * step). Everything is audited before it happens.
 */
export const tradingRouter = t.router({
  /** Configured risk caps (percent of portfolio). Read-only. */
  caps: protectedProcedure.query(() => trading.getRiskCaps()),

  /** Live automations currently running on the account. */
  center: tradeProcedure.query(({ ctx }) => trading.automationCenter(ctx.user.id)),

  /** Rich per-strategy live view: active param code + live PnL per subscribed pair. */
  myStrategies: tradeProcedure.query(({ ctx }) => trading.liveStrategies(ctx.user.id)),

  /**
   * Per-PARAMETER-SET live performance — the "which params actually did best?" view. Jester's own
   * per-strategy numbers span parameter changes, so we track when each param set was live and
   * attribute Hyperliquid fills to that window. Only covers time since tracking began; periods where
   * another strategy traded the same coin concurrently are flagged `ambiguous`.
   */
  paramPerformance: tradeProcedure
    .input(z.object({ strategyId: z.string().optional() }).optional())
    .query(({ input, ctx }) => paramPeriodPerformance(ctx.user.id, input?.strategyId)),

  /** The individual live trades attributed to one parameter period (drill-down from the scorecard). */
  paramTrades: tradeProcedure
    .input(z.object({ periodId: z.number() }))
    .query(({ input, ctx }) => paramPeriodTrades(ctx.user.id, input.periodId)),

  /** How much of the live ledger is attributable to a param set: attributed / contested / untracked. */
  attributionCoverage: tradeProcedure.query(({ ctx }) => attributionCoverage(ctx.user.id)),

  /**
   * Jester Observatory optimizer. Compute-only (no trades, no funds) but it is the ONLY way to
   * produce the ranked combos activation requires, so it's gated to manager+ like the rest of the
   * trading surface and audited.
   */
  observatoryStart: tradeProcedure
    .input(z.object({ strategyId: z.string(), pair: z.string(), timeframe: z.string(), days: z.number().default(30) }))
    .mutation(async ({ input, ctx }) => {
      const r = await startOptimize(ctx.user.id, input);
      await audit(ctx, "trading.observatoryStart", { resourceType: "optimizer", resourceId: input.strategyId, newValue: { ...input, optRunId: r.optRunId } });
      return r;
    }),

  observatoryStatus: tradeProcedure
    .input(z.object({ optRunId: z.string(), strategyId: z.string() }))
    .query(({ input, ctx }) => optimizeStatus(ctx.user.id, input)),

  /** Ranked combos Jester has cached for a cell — what activation would actually deploy. */
  observatoryCombos: tradeProcedure
    .input(z.object({ strategyId: z.string(), pair: z.string(), timeframe: z.string() }))
    .query(({ input, ctx }) => listCombos(ctx.user.id, input)),

  /**
   * Live status of ONE strategy for the detail page: is it currently subscribed/trading (and on which
   * pairs/params), and was it activated FROM THIS APP (audit record exists) or elsewhere (Jester's own
   * pick-for-me). `activatedHere` is the most recent activation audit entry for this strategy, or null.
   */
  liveStatus: tradeProcedure.input(z.object({ strategyId: z.string() })).query(async ({ input, ctx }) => {
    const all = await trading.liveStrategies(ctx.user.id);
    const live = ((all?.strategies ?? []) as any[]).find((s) => s.id === input.strategyId) ?? null;
    const rows = await db
      .select({ action: auditLogs.action, at: auditLogs.createdAt, userId: auditLogs.userId })
      .from(auditLogs)
      .where(and(eq(auditLogs.resourceId, input.strategyId), like(auditLogs.action, "trading.activate%")))
      .orderBy(desc(auditLogs.createdAt))
      .limit(1);
    const activatedHere = rows[0] ? { at: rows[0].at, userId: rows[0].userId, action: rows[0].action } : null;
    return { live, activatedHere };
  }),

  /** Current allocation config. */
  allocation: tradeProcedure.query(({ ctx }) => trading.allocationGet(ctx.user.id)),

  /** Preview a subscription (dry-run, no live action). */
  previewActivate: tradeProcedure
    .input(z.object({ strategyId: z.string().optional(), pair: z.string().optional(), timeframe: z.string().optional() }))
    .query(({ input, ctx }) => trading.previewActivate(ctx.user.id, input)),

  /** LIVE: subscribe/activate a strategy with a param code, capped to the risk percent. */
  activate: tradeProcedure
    .input(
      z.object({
        strategyId: z.string(),
        pair: z.string(),
        timeframe: z.string().optional(),
        paramHash: z.string().optional(),
        riskPercent: z.number().positive(),
        confirm: z.literal(true),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await audit(ctx, "trading.activate.intent", { resourceType: "automation", resourceId: input.strategyId, newValue: input });
      const result = await trading.activate(ctx.user.id, input);
      await audit(ctx, "trading.activate.done", { resourceType: "automation", resourceId: input.strategyId, newValue: result });
      return result;
    }),

  pauseAll: tradeProcedure.mutation(async ({ ctx }) => {
    const r = await trading.pauseAll(ctx.user.id);
    await audit(ctx, "trading.pauseAll", { resourceType: "automation" });
    return r;
  }),

  resumeAll: tradeProcedure
    .input(z.object({ confirm: z.literal(true) }))
    .mutation(async ({ ctx }) => {
      const r = await trading.resumeAll(ctx.user.id);
      await audit(ctx, "trading.resumeAll", { resourceType: "automation" });
      return r;
    }),

  toggleStrategy: tradeProcedure
    .input(z.object({ strategyId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const r = await trading.toggleStrategy(ctx.user.id, input.strategyId);
      await audit(ctx, "trading.toggleStrategy", { resourceType: "automation", resourceId: input.strategyId });
      return r;
    }),

  // Read current per-strategy risk (lazy — only fetched when the risk control is opened).
  riskSettings: tradeProcedure
    .input(z.object({ strategyId: z.string() }))
    .query(({ input, ctx }) => trading.getRiskSettings(ctx.user.id, input.strategyId)),

  // Adjust per-trade risk. Human-gated (manager+); read-modify-write so only riskPerTrade changes.
  setRisk: tradeProcedure
    .input(z.object({ strategyId: z.string(), riskPerTrade: z.number().min(0.1).max(5), confirm: z.literal(true) }))
    .mutation(async ({ input, ctx }) => {
      await audit(ctx, "trading.setRisk.intent", { resourceType: "automation", resourceId: input.strategyId, newValue: { riskPerTrade: input.riskPerTrade } });
      const r = await trading.setRiskPerTrade(ctx.user.id, input.strategyId, input.riskPerTrade);
      await audit(ctx, "trading.setRisk.done", { resourceType: "automation", resourceId: input.strategyId, newValue: r });
      return r;
    }),

  removeStrategy: tradeProcedure
    .input(z.object({ strategyId: z.string(), confirm: z.literal(true) }))
    .mutation(async ({ input, ctx }) => {
      const r = await trading.removeStrategy(ctx.user.id, input.strategyId);
      await audit(ctx, "trading.removeStrategy", { resourceType: "automation", resourceId: input.strategyId });
      return r;
    }),

  setAllocation: tradeProcedure
    .input(z.object({ percent: z.number().positive(), confirm: z.literal(true) }))
    .mutation(async ({ input, ctx }) => {
      await audit(ctx, "trading.setAllocation.intent", { newValue: input });
      const r = await trading.setAllocation(ctx.user.id, input.percent);
      await audit(ctx, "trading.setAllocation.done", { newValue: r });
      return r;
    }),

  /** KILL SWITCH: halt all automations + flatten all positions. */
  killSwitch: tradeProcedure
    .input(z.object({ confirm: z.literal(true) }))
    .mutation(async ({ ctx }) => {
      await audit(ctx, "trading.killSwitch.intent", {});
      const r = await trading.killSwitch(ctx.user.id);
      await audit(ctx, "trading.killSwitch.done", { newValue: r });
      return r;
    }),

  emergencyRelease: tradeProcedure
    .input(z.object({ confirm: z.literal(true) }))
    .mutation(async ({ ctx }) => {
      const r = await trading.emergencyRelease(ctx.user.id);
      await audit(ctx, "trading.emergencyRelease", {});
      return r;
    }),
});
