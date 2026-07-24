import { bigserial, doublePrecision, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * One-second paired observations of the Chainlink resolution feed and Hyperliquid BBO midpoint.
 * Research-only: this table supports forward lead/lag measurement and contains no trading state.
 */
export const venuePriceSnapshots = pgTable(
  "venue_price_snapshot",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    pair: text("pair").notNull(),
    sampledAt: timestamp("sampled_at").notNull(),
    chainlinkPrice: doublePrecision("chainlink_price").notNull(),
    chainlinkSourceAt: timestamp("chainlink_source_at").notNull(),
    chainlinkReceivedAt: timestamp("chainlink_received_at").notNull(),
    chainlinkAgeMs: doublePrecision("chainlink_age_ms").notNull(),
    hlMid: doublePrecision("hl_mid").notNull(),
    hlSourceAt: timestamp("hl_source_at").notNull(),
    hlReceivedAt: timestamp("hl_received_at").notNull(),
    hlAgeMs: doublePrecision("hl_age_ms").notNull(),
    basisBps: doublePrecision("basis_bps").notNull(),
  },
  (t) => [
    uniqueIndex("venue_price_pair_second_idx").on(t.pair, t.sampledAt),
    index("venue_price_sampled_at_idx").on(t.sampledAt),
  ],
);
