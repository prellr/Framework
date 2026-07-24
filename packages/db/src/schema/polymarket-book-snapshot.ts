import { bigserial, doublePrecision, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Live order-book snapshots of OPEN Polymarket crypto Up/Down markets — the missing piece for
 * ask-based edge scoring. Polymarket's CLOB exposes no historical book, only price history (the mid),
 * so the real ask you'd PAY to enter can only be captured while a market is live. A lightweight job
 * snapshots each open market's best bid/ask near its window start; when the market later resolves, the
 * scorer joins the snapshot nearest window start onto the score row (upAsk/downAsk). Read-only.
 *
 * One (or few) snapshots per market — capture inserts only when we don't yet have one for a market, so
 * the table stays small and the CLOB load stays negligible. See KB `competitor-cobra-capital-updown-mechanics`.
 */
export const polymarketBookSnapshots = pgTable(
  "polymarket_book_snapshot",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    conditionId: text("condition_id").notNull(),
    slug: text("slug"),
    pair: text("pair").notNull(),
    horizonMin: integer("horizon_min").notNull(),
    windowStart: timestamp("window_start").notNull(), // endDate − horizon; the moment we'd enter
    capturedAt: timestamp("captured_at").notNull().defaultNow(),
    upBid: doublePrecision("up_bid"),
    upAsk: doublePrecision("up_ask"),
    downBid: doublePrecision("down_bid"),
    downAsk: doublePrecision("down_ask"),
  },
  (t) => [index("pm_book_condition_idx").on(t.conditionId)],
);
