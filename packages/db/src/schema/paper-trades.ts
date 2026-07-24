import { bigserial, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Paper-trading ledger — the Cobra-style live harness. Each registered bot decides FORWARD at a
 * market's window start against the REAL order book (ask recorded at decision time), and the trade is
 * graded when the market resolves. This is the honest counterpart to the retrospective scorer: no
 * alignment tolerance, no modeled ask — what you'd actually have paid, when you'd actually have paid it.
 *
 * PAPER ONLY. This ledger and the Polymarket floor have no order placement, fund, key, or trade-channel
 * path. The UI's "live" slot is a locked placeholder — any future Polymarket execution would require
 * a verdict-gate PASS and a separate, human-initiated build. See KB updown-verdict-gate-v1.
 */
export const paperTrades = pgTable(
  "paper_trade",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    botKey: text("bot_key").notNull(), // registry key (fade, gaugeFade, drift, …)
    conditionId: text("condition_id").notNull(),
    slug: text("slug"),
    pair: text("pair").notNull(),
    horizonMin: integer("horizon_min").notNull(),
    windowStart: timestamp("window_start").notNull(),
    endDate: timestamp("end_date").notNull(), // resolution time — the grader polls after this
    decidedAt: timestamp("decided_at").notNull().defaultNow(),
    side: text("side").notNull(), // up | down
    pSignal: doublePrecision("p_signal"), // the bot's P(up) at decision time (null for the drift control)
    impliedMid: doublePrecision("implied_mid"), // mid at decision time (decision edge is vs this, matching the Lab bots)
    askPaid: doublePrecision("ask_paid").notNull(), // REAL best ask for the taken side at decision time
    // Gate-v2 control: the $5 DOWN book-walk fill from the exact same fetched book/tick as askPaid.
    // Nullable because a taken side can be fillable while the DOWN control side is not; such a row
    // remains valid descriptive paper P&L but is ineligible for a paired verdict observation.
    controlAskPaid: doublePrecision("control_ask_paid"),
    edgeMid: doublePrecision("edge_mid"), // pSide − mid (the registered decision rule's edge)
    edgeAsk: doublePrecision("edge_ask"), // pSide − askPaid (Cobra's edge; recorded for analysis)
    sizeUsd: doublePrecision("size_usd").notNull(),
    signalAgeSec: doublePrecision("signal_age_sec"),
    modelMeta: jsonb("model_meta").$type<Record<string, unknown>>(), // model/version inputs captured at decision time
    status: text("status").notNull().default("open"), // open | won | lost | void
    pnlUsd: doublePrecision("pnl_usd"),
    gradedAt: timestamp("graded_at"),
  },
  (t) => [
    uniqueIndex("paper_trade_bot_market_idx").on(t.botKey, t.conditionId),
    index("paper_trade_status_idx").on(t.status, t.endDate),
    index("paper_trade_window_idx").on(t.windowStart),
    // Scoreboard performance lenses always select one strategy × timeframe over a window.
    // Keep those diagnostic reads off the grader's status index and bounded as history grows.
    index("paper_trade_performance_idx").on(t.botKey, t.horizonMin, t.windowStart),
  ],
);
