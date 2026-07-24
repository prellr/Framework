import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users.ts";
import { strategies } from "./strategies.ts";

/**
 * The backtest warehouse — the heart of the system. Each row is an immutable fact:
 * (strategy, pair, timeframe, span, params, as-of) → metrics. SHARED across all users
 * and DEDUPLICATED: identical cells within a freshness bucket collapse to one row that
 * everyone reuses (so a run on one user's key benefits the whole org).
 *
 * `spanDays` is the ACTUAL window Jester returned (never the requested `days` — Jester
 * clamps to available history). `paramHash` is "default" for {} params; grid-search
 * (Phase 2) hashes each parameter set into the dedup key.
 */
export const backtestRuns = pgTable(
  "backtest_run",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    strategyId: text("strategy_id")
      .notNull()
      .references(() => strategies.id),
    pair: text("pair").notNull(),
    timeframe: text("timeframe").notNull(),
    daysRequested: integer("days_requested").notNull(),

    // Actual window returned by Jester.
    actualStart: date("actual_start"),
    actualEnd: date("actual_end"),
    spanDays: integer("span_days").notNull(),

    // Metrics.
    totalReturn: numeric("total_return"),
    totalTrades: integer("total_trades"),
    winRate: numeric("win_rate"),
    maxDrawdown: numeric("max_drawdown"),
    sharpe: numeric("sharpe"),
    profitFactor: numeric("profit_factor"),
    parameters: jsonb("parameters"),
    paramHash: text("param_hash").notNull().default("default"), // our hash (dedup key)
    jesterParamCode: text("jester_param_code"), // Jester's own parameter code (sharedResult.paramHash)
    rawResult: jsonb("raw_result"),

    // Dedup + provenance.
    asOfBucket: date("as_of_bucket").notNull(),
    ranWithKeyUserId: text("ran_with_key_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    requestedByUserId: text("requested_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    ranAt: timestamp("ran_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqCell: uniqueIndex("uniq_cell").on(
      t.strategyId,
      t.pair,
      t.timeframe,
      t.spanDays,
      t.paramHash,
      t.asOfBucket,
    ),
    byStrategy: index("bt_by_strategy").on(t.strategyId),
    byPairTf: index("bt_by_pair_tf").on(t.pair, t.timeframe),
  }),
);

/**
 * Learned coverage per (pair, timeframe): the max span Jester has ever returned. Used
 * to ESTIMATE a cell's span before running, so the dedup lookup can hit the cache without
 * first spending an API call. Upserted on every completed run.
 */
export const pairTimeframeSpans = pgTable(
  "pair_timeframe_span",
  {
    pair: text("pair").notNull(),
    timeframe: text("timeframe").notNull(),
    maxSpanDays: integer("max_span_days").notNull(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    pk: uniqueIndex("pts_pk").on(t.pair, t.timeframe),
  }),
);
