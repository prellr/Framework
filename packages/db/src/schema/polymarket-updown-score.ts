import { bigserial, boolean, doublePrecision, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Forward-collected scoring of resolved Polymarket crypto Up/Down markets vs our Tesseract signal
 * (Phase 1). One row per resolved market: the Tesseract-implied P(up) at the window start, the
 * market's implied Up price then, and the resolution. The scoreboard aggregates these into
 * follow-vs-fade-vs-drift as the sample accrues across up + down regimes. Read-only research — no
 * orders. See POLYMARKET_UPDOWN_PLAN.md + the KB article `polymarket-updown-tesseract-fade`.
 */
export const polymarketUpdownScores = pgTable(
  "polymarket_updown_score",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    conditionId: text("condition_id").notNull(), // Polymarket market id — the dedup key
    slug: text("slug"),
    pair: text("pair").notNull(), // BTC-USD | ETH-USD | …
    horizonMin: integer("horizon_min").notNull(), // 5 | 15 | …
    windowStart: timestamp("window_start").notNull(),
    impliedPup: doublePrecision("implied_pup"), // market's Up price at window start (mid, from price history)
    upAsk: doublePrecision("up_ask"), // real best-ask to BUY Up at window start (from a live book snapshot; null pre-capture)
    downAsk: doublePrecision("down_ask"), // real best-ask to BUY Down at window start (null pre-capture)
    tessPup: doublePrecision("tess_pup"), // Tesseract signal P(up) (gauge/100)
    gaugePup: doublePrecision("gauge_pup"), // Trade composite gauge P(up) at window start (bot #2; null pre-logger)
    gauge: doublePrecision("gauge"),
    edge: doublePrecision("edge"), // tessPup − impliedPup
    resolvedUp: boolean("resolved_up").notNull(),
    signalAgeSec: doublePrecision("signal_age_sec"), // Tesseract snapshot distance from window start
    source: text("source").notNull().default("forward"), // forward | retrospective
    scoredAt: timestamp("scored_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pm_updown_condition_idx").on(t.conditionId)],
);
