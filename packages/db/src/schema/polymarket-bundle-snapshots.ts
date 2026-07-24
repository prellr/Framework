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
 * Synchronized, paper-only observations of nested 5m/15m Up/Down contracts.
 *
 * For a shared asset/end time and lower strike K1 < K2, equal shares of UP(K1) and DOWN(K2)
 * pay at least $1 at resolution. Rows store exact five-share ask walks and the fee curve observed
 * before those two books were fetched back-to-back. Nothing in this table can place an order.
 */
export const polymarketBundleSnapshots = pgTable(
  "polymarket_bundle_snapshot",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    pair: text("pair").notNull(),
    endDate: timestamp("end_date").notNull(),
    capturedAt: timestamp("captured_at").notNull(),
    fetchStartedAt: timestamp("fetch_started_at").notNull(),
    lowerLegFetchedAt: timestamp("lower_leg_fetched_at").notNull(),
    higherLegFetchedAt: timestamp("higher_leg_fetched_at").notNull(),
    fetchSpanMs: integer("fetch_span_ms").notNull(),
    sampleMinute: integer("sample_minute").notNull(),
    remainingSec: integer("remaining_sec").notNull(),

    lowerConditionId: text("lower_condition_id").notNull(),
    higherConditionId: text("higher_condition_id").notNull(),
    lowerHorizonMin: integer("lower_horizon_min").notNull(),
    higherHorizonMin: integer("higher_horizon_min").notNull(),
    lowerStrike: doublePrecision("lower_strike").notNull(),
    higherStrike: doublePrecision("higher_strike").notNull(),
    lowerUpTokenId: text("lower_up_token_id").notNull(),
    higherDownTokenId: text("higher_down_token_id").notNull(),

    sharesPerLeg: doublePrecision("shares_per_leg").notNull(),
    lowerUpVwap: doublePrecision("lower_up_vwap").notNull(),
    higherDownVwap: doublePrecision("higher_down_vwap").notNull(),
    lowerUpGrossCost: doublePrecision("lower_up_gross_cost").notNull(),
    higherDownGrossCost: doublePrecision("higher_down_gross_cost").notNull(),
    lowerFeeRate: doublePrecision("lower_fee_rate").notNull(),
    lowerFeeExponent: doublePrecision("lower_fee_exponent").notNull(),
    higherFeeRate: doublePrecision("higher_fee_rate").notNull(),
    higherFeeExponent: doublePrecision("higher_fee_exponent").notNull(),
    lowerFeeUsd: doublePrecision("lower_fee_usd").notNull(),
    higherFeeUsd: doublePrecision("higher_fee_usd").notNull(),
    grossBundleCostPerShare: doublePrecision("gross_bundle_cost_per_share").notNull(),
    effectiveBundleCostPerShare: doublePrecision("effective_bundle_cost_per_share").notNull(),
    bundleEdge: doublePrecision("bundle_edge").notNull(),
  },
  (t) => [
    uniqueIndex("pm_bundle_lower_market_minute_idx").on(t.lowerConditionId, t.sampleMinute),
    index("pm_bundle_capture_idx").on(t.capturedAt),
    index("pm_bundle_common_close_idx").on(t.pair, t.endDate),
  ],
);
