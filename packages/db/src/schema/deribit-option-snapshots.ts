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
 * Prospective BTC/ETH Deribit short-dated options tape.
 *
 * Observational only: these rows preserve frozen 25-delta-proxy skew, ATM IV, liquidity, and OI
 * inputs for later hypothesis generation. No current strategy reads this table.
 */
export const deribitOptionSnapshots = pgTable(
  "deribit_option_snapshot",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    currency: text("currency").notNull(),
    pair: text("pair").notNull(),
    sampleBucket: timestamp("sample_bucket").notNull(),
    capturedAt: timestamp("captured_at").notNull().defaultNow(),
    expirationAt: timestamp("expiration_at").notNull(),
    timeToExpiryHours: doublePrecision("time_to_expiry_hours").notNull(),
    underlyingPrice: doublePrecision("underlying_price").notNull(),
    interestRate: doublePrecision("interest_rate").notNull(),

    call25Instrument: text("call25_instrument").notNull(),
    call25Strike: doublePrecision("call25_strike").notNull(),
    call25DeltaProxy: doublePrecision("call25_delta_proxy").notNull(),
    call25MarkIv: doublePrecision("call25_mark_iv").notNull(),
    call25Bid: doublePrecision("call25_bid").notNull(),
    call25Ask: doublePrecision("call25_ask").notNull(),
    call25OpenInterest: doublePrecision("call25_open_interest").notNull(),

    put25Instrument: text("put25_instrument").notNull(),
    put25Strike: doublePrecision("put25_strike").notNull(),
    put25DeltaProxy: doublePrecision("put25_delta_proxy").notNull(),
    put25MarkIv: doublePrecision("put25_mark_iv").notNull(),
    put25Bid: doublePrecision("put25_bid").notNull(),
    put25Ask: doublePrecision("put25_ask").notNull(),
    put25OpenInterest: doublePrecision("put25_open_interest").notNull(),

    rr25VolPoints: doublePrecision("rr25_vol_points").notNull(),
    atmStrike: doublePrecision("atm_strike"),
    atmMarkIv: doublePrecision("atm_mark_iv"),
    callOpenInterest: doublePrecision("call_open_interest").notNull(),
    putOpenInterest: doublePrecision("put_open_interest").notNull(),
    putCallOiRatio: doublePrecision("put_call_oi_ratio"),
    totalOpenInterest: doublePrecision("total_open_interest").notNull(),
    optionCount: integer("option_count").notNull(),
    twoSidedCount: integer("two_sided_count").notNull(),
  },
  (t) => [
    uniqueIndex("deribit_option_currency_bucket_idx").on(t.currency, t.sampleBucket),
    index("deribit_option_captured_at_idx").on(t.capturedAt),
  ],
);
