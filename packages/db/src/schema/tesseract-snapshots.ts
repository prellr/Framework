import { bigserial, boolean, doublePrecision, integer, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Tesseract Field logger (Tesseract build #1) — the forward-collected research dataset.
 *
 * Tesseract is live-only: it has no history, so the ONLY honest way to learn whether its
 * microstructure Field predicts anything is to snapshot it on a schedule and later score each
 * snapshot against the price that actually followed. A background job writes one row per (user, pair)
 * per cycle from `jester_tesseract_analyze` — read-only, no trades. A separate labeling pass fills the
 * forward-return columns by reading the SAME pair's later snapshots' `currentPrice` (no extra feed).
 *
 * Columns are named for the generic "signal snapshot" idea, not Tesseract specifics, so the #2
 * predictiveness scoreboard can score any future signal source without a schema rewrite. `raw` keeps
 * the full plan for anything we didn't columnise.
 */
export const tesseractSnapshots = pgTable(
  "tesseract_snapshot",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id").notNull(),
    pair: text("pair").notNull(),
    // Capture time — from plan.analyzedAt when present, else insert time. The clock the forward
    // horizons are measured from.
    capturedAt: timestamp("captured_at").notNull(),
    currentPrice: doublePrecision("current_price"), // mark at capture — the base for forward returns

    // Decision fields (what #2 scores: "if you'd taken every analyze plan…").
    direction: text("direction"), // long | short | null (no-trade)
    signalSide: text("signal_side"),
    sideConflict: boolean("side_conflict"),
    gaugeScore: doublePrecision("gauge_score"),
    gaugeLabel: text("gauge_label"),
    rr: doublePrecision("rr"),
    atrValue: doublePrecision("atr_value"),
    entry: doublePrecision("entry"),
    sl: doublePrecision("sl"),
    tp1: doublePrecision("tp1"),
    tp2: doublePrecision("tp2"),

    // Field dimensions (z-scores vs rolling baseline). Book is null until we also log the Field
    // endpoint (analyze exposes Drive/Heat/Mass/Flow but not liquidity-pressure).
    drive: doublePrecision("drive"),
    heat: doublePrecision("heat"),
    mass: doublePrecision("mass"),
    flow: doublePrecision("flow"), // analyze.fieldScores.aggressionZ
    book: doublePrecision("book"),
    acceptanceDirection: text("acceptance_direction"),
    fieldState: text("field_state"),

    // Regime context.
    trend: text("trend"),
    volatility: text("volatility"),
    volume: text("volume"),
    trendStrength: doublePrecision("trend_strength"),
    volatilityPercentile: doublePrecision("volatility_percentile"),
    isChoppy: boolean("is_choppy"),
    inSqueeze: boolean("in_squeeze"),
    candleCount: integer("candle_count"), // data-quality guard

    raw: jsonb("raw"), // full analyze plan

    // Outcome labels (filled by the labeling pass; signed % price change from currentPrice).
    fwd15m: doublePrecision("fwd_15m"),
    fwd30m: doublePrecision("fwd_30m"),
    fwd60m: doublePrecision("fwd_60m"),
    fwd240m: doublePrecision("fwd_240m"),
    labeledAt: timestamp("labeled_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("tesseract_snapshot_pair_time_idx").on(t.pair, t.capturedAt),
    index("tesseract_snapshot_unlabeled_idx").on(t.labeledAt, t.capturedAt),
  ],
);
