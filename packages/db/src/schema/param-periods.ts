import { bigserial, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Slowly-changing record of WHICH PARAMETER SET was live for a strategy/pair, and WHEN.
 *
 * Jester's per-strategy live performance is cumulative — it spans parameter and timeframe changes,
 * so it can't answer "which params actually did best?". Hyperliquid's fill ledger has exact
 * timestamps but no strategy/param attribution. This table is the missing link: a tracker job
 * snapshots the live config every few minutes and opens/closes a period whenever the active
 * paramHash8 (or timeframe) changes. Attributing fills that fall inside a period's window then
 * gives per-parameter-set live performance.
 *
 * Caveats (inherent, documented so results are read honestly):
 *  - Only covers time since tracking started — past param changes were never recorded.
 *  - If two strategies trade the SAME coin concurrently, fills can't be uniquely attributed;
 *    such periods are flagged as ambiguous rather than silently mis-credited.
 */
export const strategyParamPeriods = pgTable(
  "strategy_param_period",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    strategyId: text("strategy_id").notNull(),
    pair: text("pair").notNull(), // e.g. "SOL-USD"
    timeframe: text("timeframe").notNull(),
    paramHash8: text("param_hash8"), // the live combo code; null if Jester didn't report one
    startedAt: timestamp("started_at").notNull().defaultNow(),
    endedAt: timestamp("ended_at"), // null = still active
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  },
  (t) => [
    index("param_period_strategy_idx").on(t.strategyId),
    index("param_period_open_idx").on(t.endedAt),
    index("param_period_pair_idx").on(t.pair),
  ],
);
