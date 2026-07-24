import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { t } from "../trpc/context.ts";
import { protectedProcedure, managerProcedure } from "../trpc/middleware.ts";
import { db, strategies, strategyDocs, backtestRuns } from "@framework/db";
import { audit } from "../services/audit.ts";
import { refreshCatalog } from "../services/catalog.ts";
import { getStrategyParams } from "../services/optimize.ts";
import { dedupedRuns } from "../services/warehouse.ts";

/** Strategy catalog: read the mirror (any user), refresh it from Jester (manager). */
export const catalogRouter = t.router({
  list: protectedProcedure
    .input(z.object({ tier: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const rows = await db.select().from(strategies).orderBy(desc(strategies.refreshedAt));
      return input?.tier ? rows.filter((r) => r.tier === input.tier) : rows;
    }),

  get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    const [row] = await db.select().from(strategies).where(eq(strategies.id, input.id)).limit(1);
    return row ?? null;
  }),

  /**
   * Knowledge-base detail for one strategy: its Jester metadata + authored deep-dive + every
   * warehouse result for it (across cells). Powers the strategy detail page.
   */
  detail: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    const [strategy] = await db
      .select()
      .from(strategies)
      .where(eq(strategies.id, input.id))
      .limit(1);
    if (!strategy) return null;
    const [doc] = await db
      .select()
      .from(strategyDocs)
      .where(eq(strategyDocs.strategyId, input.id))
      .limit(1);
    // Deduplicated on the result signature — a param grid against a strategy that ignores overrides
    // would otherwise repeat one identical result dozens of times on the detail page.
    const results = await dedupedRuns(eq(backtestRuns.strategyId, input.id));
    return { strategy, doc: doc ?? null, results };
  }),

  /**
   * Live default parameters for a strategy (jester_backtest_params). Fetched on demand for the
   * detail page — this tool isn't backtest-rate-limited. Defaults to a canonical cell.
   */
  params: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        pair: z.string().default("BTC-USD"),
        timeframe: z.string().default("15m"),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { defaults, numeric } = await getStrategyParams(
        ctx.user.id,
        input.id,
        input.pair,
        input.timeframe,
      );
      return { defaults, tunable: numeric.map((n) => n.name) };
    }),

  /** Pull the latest catalog from Jester using the caller's key. */
  refresh: managerProcedure.mutation(async ({ ctx }) => {
    const { count } = await refreshCatalog(ctx.user.id);
    await audit(ctx, "catalog.refresh", { resourceType: "strategy", newValue: { count } });
    return { count };
  }),
});
