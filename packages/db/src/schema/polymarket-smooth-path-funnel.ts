import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Outcome-blind decision-funnel tape for the independently scored Smooth Path v1/v2 pair.
 *
 * There is intentionally no direction, price, market result, grade, return, P&L, account, order,
 * wallet, or credential field. This table preserves only prospective coverage and rejection facts
 * that would otherwise disappear whenever the worker container restarts.
 */
export const polymarketSmoothPathFunnel = pgTable(
  "polymarket_smooth_path_funnel",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    version: text("version").notNull(),
    botKey: text("bot_key").notNull(),
    conditionId: text("condition_id").notNull(),
    pair: text("pair").notNull(),
    windowStart: timestamp("window_start").notNull(),
    observedAt: timestamp("observed_at"),
    bookRequestDurationMs: integer("book_request_duration_ms"),

    observed: boolean("observed").notNull().default(false),
    pathQualified: boolean("path_qualified").notNull().default(false),
    bookQualified: boolean("book_qualified").notNull().default(false),
    placed: boolean("placed").notNull().default(false),
    rejectionReasons: text("rejection_reasons")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    tickCount: integer("tick_count"),
    startCoverageSec: doublePrecision("start_coverage_sec"),
    maxIntertickGapSec: doublePrecision("max_intertick_gap_sec"),
    sourceAgeSec: doublePrecision("source_age_sec"),
    receiveAgeSec: doublePrecision("receive_age_sec"),

    // Direction-invariant quality telemetry for prospective threshold design. These fields reveal
    // magnitude, fit, efficiency, and continuation relative to the already-observed displacement;
    // they cannot reveal UP/DOWN, a market result, or strategy performance.
    absDisplacementLog: doublePrecision("abs_displacement_log"),
    pathR2: doublePrecision("path_r2"),
    pathEfficiency: doublePrecision("path_efficiency"),
    continuationSlopePerSec: doublePrecision("continuation_slope_per_sec"),
    continuationFreshLog: doublePrecision("continuation_fresh_log"),
    capturedAt: timestamp("captured_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pm_smooth_funnel_version_market_idx").on(t.version, t.conditionId),
    index("pm_smooth_funnel_version_window_idx").on(t.version, t.windowStart),
    index("pm_smooth_funnel_pair_window_idx").on(t.pair, t.windowStart),
    check(
      "pm_smooth_funnel_version_chk",
      sql`${t.version} in ('updown-smooth-path-displacement-v1','updown-smooth-path-causal-displacement-v2')`,
    ),
    check(
      "pm_smooth_funnel_bot_chk",
      sql`${t.botKey} in ('smoothPathDisplacement','smoothPathCausalDisplacement')`,
    ),
    check(
      "pm_smooth_funnel_pair_chk",
      sql`${t.pair} in ('BTC-USD','ETH-USD','SOL-USD','XRP-USD','DOGE-USD','BNB-USD')`,
    ),
    check(
      "pm_smooth_funnel_boundary_chk",
      sql`${t.windowStart} >= timestamp '2026-07-23 22:00:00'`,
    ),
    check(
      "pm_smooth_funnel_stage_chk",
      sql`(not ${t.pathQualified} or ${t.observed})
        and (not ${t.bookQualified} or ${t.pathQualified})
        and (not ${t.placed} or ${t.bookQualified})`,
    ),
    check(
      "pm_smooth_funnel_tick_count_chk",
      sql`${t.tickCount} is null or ${t.tickCount} >= 0`,
    ),
    check(
      "pm_smooth_funnel_request_duration_chk",
      sql`${t.bookRequestDurationMs} is null or ${t.bookRequestDurationMs} >= 0`,
    ),
  ],
);
