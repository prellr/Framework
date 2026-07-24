import { bigserial, doublePrecision, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Cached robustness verdict per (strategy, pair, timeframe, param set) — Roadmap Phase 2.2.
 *
 * Computing robustness (Phase 2.1) costs several backtests, so once evaluated we persist the verdict
 * here. The leaderboard then overlays it without recomputing, and a validated cell keeps its verdict
 * until re-validated. One row per cell+param set (latest wins on re-evaluation).
 */
export const robustnessResults = pgTable(
  "robustness_result",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    strategyId: text("strategy_id").notNull(),
    pair: text("pair").notNull(),
    timeframe: text("timeframe").notNull(),
    paramHash: text("param_hash").notNull().default("default"),
    verdict: text("verdict").notNull(), // robust | mixed | fragile | insufficient-data
    score: integer("score").notNull(),
    widestTrades: integer("widest_trades"),
    minProfitFactor: doublePrecision("min_profit_factor"),
    widestReturn: doublePrecision("widest_return"),
    positiveHorizons: integer("positive_horizons"),
    totalHorizons: integer("total_horizons"),
    oosProxyReturn: doublePrecision("oos_proxy_return"),
    // Trajectory axis (Phase 2.1 refinement) — short-term direction, independent of durability.
    trajectory: text("trajectory"), // improving | decaying | stable | insufficient
    outlook: text("outlook"), // durable | fading | recovering | weak | unclear
    recentReturn: doublePrecision("recent_return"),
    evaluatedAt: timestamp("evaluated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("robustness_cell_idx").on(t.strategyId, t.pair, t.timeframe, t.paramHash)],
);
