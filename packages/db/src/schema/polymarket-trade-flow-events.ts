import {
  bigint,
  bigserial,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Prospectively captured Polymarket crypto Up/Down trade events.
 *
 * Rows contain public market-stream facts and an independent Polygon receipt reconciliation. They
 * deliberately contain no market outcome, paper result, P&L, wallet, credential, order, or position
 * data. A later directional hypothesis must be preregistered at its own future boundary.
 */
export const polymarketTradeFlowEvents = pgTable(
  "polymarket_trade_flow_event",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    fingerprint: text("fingerprint").notNull(),
    version: text("version").notNull(),

    conditionId: text("condition_id").notNull(),
    tokenId: text("token_id").notNull(),
    pair: text("pair").notNull(),
    horizonMin: integer("horizon_min").notNull(),
    windowStart: timestamp("window_start").notNull(),
    endDate: timestamp("end_date").notNull(),
    outcomeSide: text("outcome_side").notNull(), // up | down

    reportedSide: text("reported_side").notNull(), // buy | sell (reported taker side)
    price: doublePrecision("price").notNull(),
    shares: doublePrecision("shares").notNull(),
    notionalUsd: doublePrecision("notional_usd").notNull(),
    feeRateBps: doublePrecision("fee_rate_bps"),
    eventAt: timestamp("event_at").notNull(),
    receivedAt: timestamp("received_at").notNull(),
    ingestionLatencyMs: doublePrecision("ingestion_latency_ms").notNull(),
    transactionHash: text("transaction_hash"),

    // pending | missing_hash | verified | mismatch | reverted | ambiguous_hash
    chainStatus: text("chain_status").notNull().default("pending"),
    // Immutable public-stream hash stays in transactionHash. This records the exact receipt hash
    // that was independently reconciled when Polymarket's retry lifecycle supersedes that source.
    chainTransactionHash: text("chain_transaction_hash"),
    // source_hash | data_api_replacement
    verificationMethod: text("verification_method"),
    chainBlockNumber: bigint("chain_block_number", { mode: "number" }),
    chainConfirmations: integer("chain_confirmations"),
    chainExchange: text("chain_exchange"),
    chainSide: text("chain_side"),
    chainTokenId: text("chain_token_id"),
    chainMakerAmount: text("chain_maker_amount"),
    chainTakerAmount: text("chain_taker_amount"),
    chainPrice: doublePrecision("chain_price"),
    chainShares: doublePrecision("chain_shares"),
    verifiedAt: timestamp("verified_at"),
    verificationError: text("verification_error"),
    // Receipt lookup state is operational only. It prevents a permanently unavailable public
    // source hash from monopolizing the oldest-first verifier queue; it cannot affect a strategy,
    // direction, outcome, or readiness floor.
    verificationAttempts: integer("verification_attempts").notNull().default(0),
    verificationAttemptedAt: timestamp("verification_attempted_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("pm_trade_flow_fingerprint_idx").on(table.fingerprint),
    index("pm_trade_flow_event_at_idx").on(table.eventAt),
    index("pm_trade_flow_market_time_idx").on(table.conditionId, table.eventAt),
    index("pm_trade_flow_pair_window_idx").on(table.pair, table.windowStart),
    index("pm_trade_flow_chain_status_idx").on(table.chainStatus, table.eventAt),
    index("pm_trade_flow_transaction_idx").on(table.transactionHash),
    check("pm_trade_flow_pair_chk", sql`${table.pair} in ('BTC-USD','ETH-USD','SOL-USD','XRP-USD','DOGE-USD','BNB-USD')`),
    check("pm_trade_flow_horizon_chk", sql`${table.horizonMin} in (5,15)`),
    check("pm_trade_flow_outcome_side_chk", sql`${table.outcomeSide} in ('up','down')`),
    check("pm_trade_flow_reported_side_chk", sql`${table.reportedSide} in ('buy','sell')`),
    check("pm_trade_flow_price_chk", sql`${table.price} > 0 and ${table.price} < 1`),
    check("pm_trade_flow_shares_chk", sql`${table.shares} > 0`),
    check("pm_trade_flow_notional_chk", sql`${table.notionalUsd} > 0`),
    check(
      "pm_trade_flow_boundary_chk",
      sql`${table.eventAt} >= timestamp '2026-07-23 20:00:00'
        and ${table.windowStart} >= timestamp '2026-07-23 20:00:00'`,
    ),
    check(
      "pm_trade_flow_window_chk",
      sql`${table.endDate} = ${table.windowStart} + (${table.horizonMin} * interval '1 minute')`,
    ),
    check(
      "pm_trade_flow_chain_status_chk",
      sql`${table.chainStatus} in ('pending','missing_hash','verified','mismatch','reverted','ambiguous_hash')`,
    ),
    check(
      "pm_trade_flow_verification_method_chk",
      sql`${table.verificationMethod} is null
        or ${table.verificationMethod} in ('source_hash','data_api_replacement')`,
    ),
    check("pm_trade_flow_chain_side_chk", sql`${table.chainSide} is null or ${table.chainSide} in ('buy','sell')`),
  ],
);
