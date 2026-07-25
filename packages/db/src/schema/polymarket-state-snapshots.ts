import {
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Minute-by-minute state tape for live crypto Up/Down markets.
 *
 * This is research instrumentation, not a strategy or execution path. It preserves the inputs needed
 * to develop independent hypotheses without reconstructing unavailable history later:
 *   1. empirical P(up) as a function of normalized distance-to-strike and time remaining;
 *   2. Hyperliquid <-> Chainlink basis/lead-lag around Polymarket's resolution feed.
 *   3. touch microprice / temporal order-flow imbalance from prospective book depth.
 *
 * Rows are immutable apart from their eventual resolution label. A unique market+elapsed-minute key
 * makes the 60s collector idempotent across retries and worker restarts.
 */
export const polymarketStateSnapshots = pgTable(
  "polymarket_state_snapshot",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    conditionId: text("condition_id").notNull(),
    slug: text("slug"),
    pair: text("pair").notNull(),
    horizonMin: integer("horizon_min").notNull(),
    windowStart: timestamp("window_start").notNull(),
    endDate: timestamp("end_date").notNull(),
    capturedAt: timestamp("captured_at").notNull().defaultNow(),
    sampleMinute: integer("sample_minute").notNull(),
    remainingSec: integer("remaining_sec").notNull(),

    // Resolution-source state (Chainlink RTDS) plus the independent Hyperliquid reference.
    referenceSource: text("reference_source").notNull(), // chainlink | hyperliquid
    chainlinkSpot: doublePrecision("chainlink_spot"),
    chainlinkStrike: doublePrecision("chainlink_strike"),
    chainlinkAgeSec: doublePrecision("chainlink_age_sec"),
    hlSpot: doublePrecision("hl_spot"),
    hlStrike: doublePrecision("hl_strike"),
    hlAgeSec: doublePrecision("hl_age_sec"),
    basisBps: doublePrecision("basis_bps"), // 10_000 * ln(HL / Chainlink)

    // Model-neutral state coordinates. sigma is per minute; z scales moneyness by remaining vol.
    sigmaPerMin: doublePrecision("sigma_per_min"),
    logMoneyness: doublePrecision("log_moneyness"),
    zDistance: doublePrecision("z_distance"),

    // Observable book plus the $5 book-walk VWAP for either outcome. Before
    // 2026-07-23 12:00 UTC these fields use legacy gross-budget semantics; at/after that registered
    // boundary they use fee-adjusted total-outlay v2. Never mix the cohorts in execution analysis.
    upBid: doublePrecision("up_bid"),
    upAsk: doublePrecision("up_ask"),
    downBid: doublePrecision("down_bid"),
    downAsk: doublePrecision("down_ask"),
    upFill5: doublePrecision("up_fill_5"),
    downFill5: doublePrecision("down_fill_5"),

    // Prospective multi-stake capacity tape v1. These are fee-adjusted effective VWAPs from walking
    // the exact same public books already fetched for the $5 state-tape fill; no extra API request is
    // made. Null means the registered boundary has not begun or that side lacked sufficient depth.
    capacityVersion: text("capacity_version"),
    upFill10: doublePrecision("up_fill_10"),
    downFill10: doublePrecision("down_fill_10"),
    upFill20: doublePrecision("up_fill_20"),
    downFill20: doublePrecision("down_fill_20"),

    // Prospective microstructure tape v1 (KB polymarket-microstructure-tape-v1). These remain null
    // before its registered boundary and are raw observations only — no current bot reads them.
    upBidSize: doublePrecision("up_bid_size"),
    upAskSize: doublePrecision("up_ask_size"),
    downBidSize: doublePrecision("down_bid_size"),
    downAskSize: doublePrecision("down_ask_size"),
    upMicroprice: doublePrecision("up_microprice"),
    downMicroprice: doublePrecision("down_microprice"),
    upTouchImbalance: doublePrecision("up_touch_imbalance"),
    downTouchImbalance: doublePrecision("down_touch_imbalance"),
    upBookImbalanceShares: doublePrecision("up_book_imbalance_shares"),
    downBookImbalanceShares: doublePrecision("down_book_imbalance_shares"),
    upBookImbalanceUsd: doublePrecision("up_book_imbalance_usd"),
    downBookImbalanceUsd: doublePrecision("down_book_imbalance_usd"),
    upDepthShares: doublePrecision("up_depth_shares"),
    downDepthShares: doublePrecision("down_depth_shares"),
    upDepthUsd: doublePrecision("up_depth_usd"),
    downDepthUsd: doublePrecision("down_depth_usd"),

    // Prospective Hyperliquid aggressor-flow tapes. The worker folds the public trade stream into
    // short rolling windows in memory, then stores only compact outcome-blind aggregates on rows the
    // state tape already writes. A null 5s/30s imbalance is an explicit quiet subwindow; v2 requires
    // a complete 60s aggregate. No raw trade, account, position, order, or execution data is kept.
    hlFlowVersion: text("hl_flow_version"),
    hlFlowImbalance5s: doublePrecision("hl_flow_imbalance_5s"),
    hlFlowImbalance30s: doublePrecision("hl_flow_imbalance_30s"),
    hlFlowImbalance60s: doublePrecision("hl_flow_imbalance_60s"),
    hlFlowNotional60s: doublePrecision("hl_flow_notional_60s"),
    hlFlowTradeCount60s: integer("hl_flow_trade_count_60s"),
    hlFlowMaxTradeShare60s: doublePrecision("hl_flow_max_trade_share_60s"),
    hlFlowSourceAgeSec: doublePrecision("hl_flow_source_age_sec"),
    hlFlowReceiveAgeSec: doublePrecision("hl_flow_receive_age_sec"),
    hlFlowMaxTransportLagMs60s: doublePrecision("hl_flow_max_transport_lag_ms_60s"),

    // Prospective public CLOB event-OFI tape. Standard book/price-change frames are folded in
    // memory on the existing market socket; only paired rolling aggregates land on state rows.
    // A zero value is a valid quiet window, while null means the causal transport/book checks failed.
    clobEventOfiVersion: text("clob_event_ofi_version"),
    clobEventOfiCanonical5s: doublePrecision("clob_event_ofi_canonical_5s"),
    clobEventOfiCanonical30s: doublePrecision("clob_event_ofi_canonical_30s"),
    clobEventOfiCanonical60s: doublePrecision("clob_event_ofi_canonical_60s"),
    clobEventOfiUpEvents60s: integer("clob_event_ofi_up_events_60s"),
    clobEventOfiDownEvents60s: integer("clob_event_ofi_down_events_60s"),
    clobEventOfiSourceAgeSec: doublePrecision("clob_event_ofi_source_age_sec"),
    clobEventOfiReceiveAgeSec: doublePrecision("clob_event_ofi_receive_age_sec"),
    clobEventOfiMaxTransportLagMs60s: doublePrecision("clob_event_ofi_max_transport_lag_ms_60s"),

    labelStatus: text("label_status").notNull().default("open"), // open | resolved | void
    resolvedUp: boolean("resolved_up"),
    labeledAt: timestamp("labeled_at"),
  },
  (t) => [
    uniqueIndex("pm_state_market_minute_idx").on(t.conditionId, t.sampleMinute),
    index("pm_state_label_idx").on(t.labelStatus, t.endDate),
    index("pm_state_feature_idx").on(t.horizonMin, t.remainingSec, t.zDistance),
    index("pm_state_pair_time_idx").on(t.pair, t.capturedAt),
  ],
);
