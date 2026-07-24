import {
  bigserial,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Synchronized, paper-only complete-set observations for one binary Up/Down condition.
 *
 * Equal shares of UP and DOWN can be merged back into one unit of collateral. Rows store an exact
 * five-share ask walk for both outcomes returned by one public batch-book request, including the
 * current taker fee curve. This table is observational and cannot place or merge orders.
 */
export const polymarketCompleteSetSnapshots = pgTable(
  "polymarket_complete_set_snapshot",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    conditionId: text("condition_id").notNull(),
    slug: text("slug"),
    pair: text("pair").notNull(),
    horizonMin: integer("horizon_min").notNull(),
    windowStart: timestamp("window_start").notNull(),
    endDate: timestamp("end_date").notNull(),
    capturedAt: timestamp("captured_at").notNull(),
    requestStartedAt: timestamp("request_started_at").notNull(),
    requestDurationMs: integer("request_duration_ms").notNull(),
    sampleMinute: integer("sample_minute").notNull(),
    remainingSec: integer("remaining_sec").notNull(),

    upTokenId: text("up_token_id").notNull(),
    downTokenId: text("down_token_id").notNull(),
    sharesPerLeg: doublePrecision("shares_per_leg").notNull(),
    upVwap: doublePrecision("up_vwap").notNull(),
    downVwap: doublePrecision("down_vwap").notNull(),
    upGrossCost: doublePrecision("up_gross_cost").notNull(),
    downGrossCost: doublePrecision("down_gross_cost").notNull(),
    feeRate: doublePrecision("fee_rate").notNull(),
    feeExponent: doublePrecision("fee_exponent").notNull(),
    upFeeUsd: doublePrecision("up_fee_usd").notNull(),
    downFeeUsd: doublePrecision("down_fee_usd").notNull(),
    grossCostPerShare: doublePrecision("gross_cost_per_share").notNull(),
    effectiveCostPerShare: doublePrecision("effective_cost_per_share").notNull(),
    preGasMergeEdge: doublePrecision("pre_gas_merge_edge").notNull(),
  },
  (table) => [
    uniqueIndex("pm_complete_set_market_minute_idx").on(table.conditionId, table.sampleMinute),
    index("pm_complete_set_capture_idx").on(table.capturedAt),
    index("pm_complete_set_condition_idx").on(table.conditionId),
  ],
);
