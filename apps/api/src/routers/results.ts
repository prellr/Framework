import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { t } from "../trpc/context.ts";
import { protectedProcedure, operatorProcedure } from "../trpc/middleware.ts";
import { db, backtestRuns } from "@framework/db";
import { audit } from "../services/audit.ts";
import { runCell, backfillParamCode } from "../services/backtest.ts";
import { dedupedRuns } from "../services/warehouse.ts";

/**
 * The backtest warehouse API. Reads are open to any user (shared, deduplicated data);
 * running a backtest spends Jester rate budget and requires operator role.
 */
export const resultsRouter = t.router({
  /** Query the warehouse with optional filters. */
  query: protectedProcedure
    .input(
      z
        .object({
          strategyId: z.string().optional(),
          pair: z.string().optional(),
          timeframe: z.string().optional(),
          minTrades: z.number().optional(),
          limit: z.number().min(1).max(10000).default(100),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const conds = [];
      if (input?.strategyId) conds.push(eq(backtestRuns.strategyId, input.strategyId));
      if (input?.pair) conds.push(eq(backtestRuns.pair, input.pair));
      if (input?.timeframe) conds.push(eq(backtestRuns.timeframe, input.timeframe));

      // Deduplicated on the result signature (see services/warehouse.ts) — shared with catalog.detail
      // so every warehouse view collapses identical results the same way.
      const rows = await dedupedRuns(conds.length ? and(...conds) : undefined, input?.limit ?? 100);

      return input?.minTrades != null
        ? rows.filter((r) => (r.totalTrades ?? 0) >= input.minTrades!)
        : rows;
    }),

  /**
   * The stored default-param result for EACH strategy on one exact cell (pair · timeframe ·
   * window), most-recent per strategy. Powers the catalog's inline results: it queries the DB
   * directly with the exact key (no client-side row-limit truncation) and filters to
   * paramHash="default", so what shows on load matches what a plain "Backtest" click would find.
   * Returns a map keyed by strategyId.
   */
  cellResults: protectedProcedure
    .input(z.object({ pair: z.string(), timeframe: z.string(), days: z.number() }))
    .query(async ({ input }) => {
      const rows = await db
        .select()
        .from(backtestRuns)
        .where(
          and(
            eq(backtestRuns.pair, input.pair),
            eq(backtestRuns.timeframe, input.timeframe),
            eq(backtestRuns.daysRequested, input.days),
            eq(backtestRuns.paramHash, "default"),
          ),
        )
        .orderBy(desc(backtestRuns.ranAt));
      const byStrategy: Record<string, (typeof rows)[number]> = {};
      for (const r of rows) if (!byStrategy[r.strategyId]) byStrategy[r.strategyId] = r;
      return byStrategy;
    }),

  /** All warehouse rows for one strategy (across pairs/timeframes/windows). */
  byStrategy: protectedProcedure
    .input(z.object({ strategyId: z.string() }))
    .query(async ({ input }) => {
      return db
        .select()
        .from(backtestRuns)
        .where(eq(backtestRuns.strategyId, input.strategyId))
        .orderBy(desc(backtestRuns.ranAt));
    }),

  /**
   * Run (or reuse a fresh) single backtest cell. Returns whether it came from cache.
   * Operator role — this can spend the user's Jester rate budget.
   */
  runOne: operatorProcedure
    .input(
      z.object({
        strategyId: z.string(),
        pair: z.string().default("BTC-USD"),
        timeframe: z.string().default("15m"),
        days: z.number().min(1).max(100000).default(30),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Use the async /backtests queue ("fast"), not the synchronous jester_run_backtest tool —
      // the sync tool is aggressively rate-limited (429s under any load). The Jester param code
      // is then fetched on demand (results.fetchCode) rather than inline.
      const { source, run } = await runCell(input, { userId: ctx.user.id, mode: "fast" });
      await audit(ctx, "results.runOne", {
        resourceType: "backtest_run",
        resourceId: run.id,
        newValue: { ...input, source },
      });
      return { source, run };
    }),

  /**
   * Fetch Jester's own parameter code for a warehouse row on demand. Sweep cells run on the
   * fast async queue (no code), so this backfills it by re-running that exact cell through the
   * synchronous tool. Operator role — it spends a Jester call.
   */
  fetchCode: operatorProcedure
    .input(z.object({ runId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const code = await backfillParamCode(input.runId, ctx.user.id);
      await audit(ctx, "results.fetchCode", {
        resourceType: "backtest_run",
        resourceId: input.runId,
        newValue: { code },
      });
      return { code };
    }),
});
