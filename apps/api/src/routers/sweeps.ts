import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { t } from "../trpc/context.ts";
import { protectedProcedure, operatorProcedure } from "../trpc/middleware.ts";
import { db, sweeps, sweepCells, backtestRuns } from "@framework/db";
import { audit } from "../services/audit.ts";
import { sweepQueue, cellQueue } from "../jobs/queue.ts";
import {
  fetchOptimizedCombos,
  buildGridCombos,
  buildCombosFromGrid,
  getStrategyParams,
  probeHasEffect,
} from "../services/optimize.ts";
import { getGuidedCombos, getGuidedInfo } from "../services/optimize-recipes.ts";

const matrixInput = z.object({
  name: z.string().optional(),
  strategies: z.array(z.string()).min(1),
  assets: z.array(z.string()).min(1),
  timeframes: z.array(z.string()).min(1),
  windows: z.array(z.union([z.number().int().positive(), z.literal("max")])).min(1),
});

export const sweepsRouter = t.router({
  /** Launch a sweep. Operator+ (spends Jester rate budget on cache misses). */
  create: operatorProcedure.input(matrixInput).mutation(async ({ input, ctx }) => {
    const { name, ...matrix } = input;
    const total =
      matrix.strategies.length * matrix.assets.length * matrix.timeframes.length * matrix.windows.length;
    const [sweep] = await db
      .insert(sweeps)
      .values({ userId: ctx.user.id, name: name ?? null, matrix, status: "queued", totalCells: total })
      .returning();
    await sweepQueue.add("run", { sweepId: sweep.id });
    await audit(ctx, "sweeps.create", {
      resourceType: "sweep",
      resourceId: sweep.id,
      newValue: { ...matrix, total },
    });
    return sweep;
  }),

  /**
   * Optimize: pull Jester's optimized parameter combos for a strategy/cell and backtest each in
   * our warehouse (one cell per combo). Reuses the sweep engine + SweepDetail live view.
   */
  /**
   * Inspect a strategy for optimization: its tunable numeric params (with suggested grids) and a
   * pre-probe of whether Jester actually honors parameter overrides for it. Powers the picker UI.
   */
  inspect: operatorProcedure
    .input(
      z.object({
        strategyId: z.string(),
        pair: z.string().default("BTC-USD"),
        timeframe: z.string().default("15m"),
        days: z.number().int().positive().default(30),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { defaults, numeric } = await getStrategyParams(ctx.user.id, input.strategyId, input.pair, input.timeframe);
      if (numeric.length === 0) {
        return { params: [], tunable: false, testedParam: null as string | null, guided: null };
      }
      // Probe the SAME lever the guided run will flip (plan.probeParam), so the dialog's tunability
      // verdict matches what "Run guided" actually does — otherwise we'd recommend guided on a param
      // that works while the guided run fails on a different one. Fall back to the top param.
      const plan = getGuidedCombos(input.strategyId, defaults, numeric);
      const probeName = plan?.probeParam ?? numeric[0].name;
      const probeVal = typeof defaults[probeName] === "number" ? (defaults[probeName] as number) : numeric[0].value;
      const tunable = await probeHasEffect(
        ctx.user.id,
        input.strategyId,
        input.pair,
        input.timeframe,
        input.days,
        probeName,
        probeVal,
      );
      // The guided plan (hand recipe or auto-derived) — powers the one-click "Run guided" option.
      const guided = getGuidedInfo(input.strategyId, numeric);
      return { params: numeric, tunable, testedParam: probeName, guided };
    }),

  optimize: operatorProcedure
    .input(
      z.object({
        strategyId: z.string(),
        pair: z.string().default("BTC-USD"),
        timeframe: z.string().default("15m"),
        days: z.number().int().positive().default(30),
        // "auto" = Jester's combos if any, else auto grid-search. "grid" = always auto grid-search.
        // "guided" = logic-driven recipe (services/optimize-recipes.ts) for understood strategies.
        mode: z.enum(["auto", "grid", "guided"]).default("auto"),
        // Explicit user-selected grid: {paramName: [values...]}. Overrides mode when present.
        grid: z.record(z.array(z.number())).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      let combos: Awaited<ReturnType<typeof buildGridCombos>>;
      let source: "jester" | "grid" | "guided";

      if (input.mode === "guided") {
        // Logic-driven plan: hand recipe if we have one, else auto-derived from param roles.
        const { defaults, numeric } = await getStrategyParams(ctx.user.id, input.strategyId, input.pair, input.timeframe);
        const plan = getGuidedCombos(input.strategyId, defaults, numeric);
        if (!plan) {
          throw new Error(`${input.strategyId} exposes no tunable numeric parameters to guide-optimize.`);
        }
        // Tunability pre-probe: confirm Jester actually honors overrides for this strategy before
        // spending the whole grid (some strategies silently ignore them).
        const probeVal = defaults[plan.probeParam];
        if (typeof probeVal === "number") {
          const tunable = await probeHasEffect(
            ctx.user.id, input.strategyId, input.pair, input.timeframe, input.days, plan.probeParam, probeVal,
          );
          if (!tunable) {
            throw new Error(
              `${input.strategyId} ignores parameter overrides via the delegated API — guided optimize can't tune it. Try Jester's published combos instead.`,
            );
          }
        }
        combos = plan.combos;
        source = "guided";
      } else if (input.grid && Object.keys(input.grid).length > 0) {
        // User-selected parameter grid.
        const { defaults } = await getStrategyParams(ctx.user.id, input.strategyId, input.pair, input.timeframe);
        combos = buildCombosFromGrid(defaults, input.grid);
        source = "grid";
      } else {
        combos =
          input.mode === "grid"
            ? []
            : await fetchOptimizedCombos(ctx.user.id, input.strategyId, input.pair, input.timeframe, input.days);
        source = "jester";
        if (combos.length === 0) {
          combos = await buildGridCombos(ctx.user.id, input.strategyId, input.pair, input.timeframe);
          source = "grid";
        }
      }
      if (combos.length === 0) {
        throw new Error(
          `Can't optimize ${input.strategyId}: Jester has no published combos and the strategy exposes no tunable numeric parameters to grid-search.`,
        );
      }

      const win = input.days >= 100000 ? "max" : `${input.days}d`;
      const tag = source === "grid" ? "grid-search" : source === "guided" ? "guided" : "Jester combos";
      const [sweep] = await db
        .insert(sweeps)
        .values({
          userId: ctx.user.id,
          name: `Optimize (${tag}) ${input.strategyId} · ${input.pair}/${input.timeframe}/${win}`,
          kind: "optimize",
          matrix: { ...input, source },
          status: "running",
          totalCells: combos.length,
        })
        .returning();

      const cells = await db
        .insert(sweepCells)
        .values(
          combos.map((c) => ({
            sweepId: sweep.id,
            strategyId: input.strategyId,
            pair: input.pair,
            timeframe: input.timeframe,
            days: input.days,
            parameters: c.parameters,
            paramLabel: c.label,
            status: "pending" as const,
          })),
        )
        .returning({ id: sweepCells.id });

      for (let i = 0; i < cells.length; i++) {
        await cellQueue.add("cell", {
          sweepId: sweep.id,
          cellId: cells[i].id,
          userId: ctx.user.id,
          strategyId: input.strategyId,
          pair: input.pair,
          timeframe: input.timeframe,
          days: input.days,
          parameters: combos[i].parameters,
          paramLabel: combos[i].label,
        });
      }

      await audit(ctx, "sweeps.optimize", {
        resourceType: "sweep",
        resourceId: sweep.id,
        newValue: { ...input, combos: combos.length },
      });
      return sweep;
    }),

  /** Re-enqueue just the failed cells of a sweep (e.g. after transient Jester failures). */
  retryFailed: operatorProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
    const [sweep] = await db.select().from(sweeps).where(eq(sweeps.id, input.id)).limit(1);
    if (!sweep) return { retried: 0 };
    const failed = await db
      .select()
      .from(sweepCells)
      .where(and(eq(sweepCells.sweepId, input.id), eq(sweepCells.status, "failed")));
    if (failed.length === 0) return { retried: 0 };

    await db
      .update(sweepCells)
      .set({ status: "pending", error: null })
      .where(and(eq(sweepCells.sweepId, input.id), eq(sweepCells.status, "failed")));
    await db
      .update(sweeps)
      .set({ status: "running", doneCells: sql`greatest(0, ${sweeps.doneCells} - ${failed.length})` })
      .where(eq(sweeps.id, input.id));

    for (const c of failed) {
      await cellQueue.add("cell", {
        sweepId: input.id,
        cellId: c.id,
        userId: sweep.userId,
        strategyId: c.strategyId,
        pair: c.pair,
        timeframe: c.timeframe,
        days: c.days,
        parameters: (c.parameters as Record<string, unknown>) ?? undefined,
        paramLabel: c.paramLabel ?? undefined,
      });
    }
    await audit(ctx, "sweeps.retryFailed", { resourceType: "sweep", resourceId: input.id, newValue: { retried: failed.length } });
    return { retried: failed.length };
  }),

  /** A sweep with its cells joined to their backtest_run metrics. */
  get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    const [sweep] = await db.select().from(sweeps).where(eq(sweeps.id, input.id)).limit(1);
    if (!sweep) return null;
    const cells = await db
      .select({
        id: sweepCells.id,
        strategyId: sweepCells.strategyId,
        pair: sweepCells.pair,
        timeframe: sweepCells.timeframe,
        days: sweepCells.days,
        paramLabel: sweepCells.paramLabel,
        parameters: sweepCells.parameters,
        status: sweepCells.status,
        error: sweepCells.error,
        backtestRunId: sweepCells.backtestRunId,
        totalReturn: backtestRuns.totalReturn,
        totalTrades: backtestRuns.totalTrades,
        winRate: backtestRuns.winRate,
        maxDrawdown: backtestRuns.maxDrawdown,
        profitFactor: backtestRuns.profitFactor,
        spanDays: backtestRuns.spanDays,
        jesterParamCode: backtestRuns.jesterParamCode,
      })
      .from(sweepCells)
      .leftJoin(backtestRuns, eq(sweepCells.backtestRunId, backtestRuns.id))
      .where(eq(sweepCells.sweepId, input.id));
    return { sweep, cells };
  }),

  /** Recent sweeps (most recent first). */
  list: protectedProcedure.query(async () => {
    return db.select().from(sweeps).orderBy(desc(sweeps.createdAt)).limit(50);
  }),

  cancel: operatorProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
    await db.update(sweeps).set({ status: "canceled" }).where(eq(sweeps.id, input.id));
    await audit(ctx, "sweeps.cancel", { resourceType: "sweep", resourceId: input.id });
    return { success: true };
  }),
});
