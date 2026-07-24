import { bigserial, doublePrecision, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Generic forward-logged directional signal — the substrate for the Up/Down "multi-model tournament".
 * Tesseract has its own rich table; every OTHER signal source we bridge to a P(up) (the Trade composite
 * gauge, ML forecast, order-flow imbalance, …) lands here uniformly: one row = "source X said P(up)=p
 * for pair at time t". The Polymarket scorer aligns the row nearest a market's window start, so a new
 * signal source becomes a competing bot with just a logger — no scoring rewrite. Read-only research.
 */
export const signalSnapshots = pgTable(
  "signal_snapshot",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    source: text("source").notNull(), // "trade_gauge" | "ml_forecast" | …
    pair: text("pair").notNull(),
    capturedAt: timestamp("captured_at").notNull().defaultNow(),
    pup: doublePrecision("pup").notNull(), // bridged P(up), clamped off the 0/1 rails
    score: doublePrecision("score"), // raw signal score (e.g. gauge 0–100) before bridging
    category: text("category"), // optional label (strong_buy / buy / neutral / …)
    meta: jsonb("meta"),
  },
  (t) => [index("signal_snapshot_src_pair_idx").on(t.source, t.pair, t.capturedAt)],
);
