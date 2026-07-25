/**
 * Outcome-blind Polymarket executed-flow collector.
 *
 * The public market WebSocket provides low-latency trade facts. Each fact is then reconciled against
 * the explicit taker-side OrdersMatched event from the official V2 Polygon contracts. This module
 * cannot place, cancel, sign, or submit an order and never reads market outcomes or paper results.
 *
 * KB: polymarket-authoritative-taker-flow-tape-v1
 */
import { createHash } from "node:crypto";
import { availableParallelism, loadavg } from "node:os";
import { db, polymarketTradeFlowEvents } from "@framework/db";
import { and, asc, eq, gte, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import {
  downTokenId,
  fetchCurrentCryptoUpDown,
  type GammaMarket,
  updownHorizonMinutes,
  upTokenId,
} from "./polymarket.ts";
import { getSetting } from "./config.ts";
import {
  clobEventOfiInitializationStats,
  clobEventOfiRuntimeStatus,
  observeClobEventOfi,
  retainClobEventOfiTokens,
  setClobEventOfiConnected,
} from "./clob-event-ofi.ts";

let clobEventOfiStreamLogged = false;

export const AUTHORITATIVE_TRADE_FLOW_TAPE = {
  version: "polymarket-authoritative-taker-flow-tape-v1",
  evalStartMs: 1_784_836_800_000, // 2026-07-23 20:00:00 UTC
  marketWs: "wss://ws-subscriptions-clob.polymarket.com/ws/market",
  dataApiTrades: "https://data-api.polymarket.com/trades",
  polygonRpc: "https://polygon-bor-rpc.publicnode.com",
  ordersMatchedTopic: "0x174b3811690657c217184f89418266767c87e4805d09680c39fc9c031c0cab7c",
  exchangeAddresses: [
    "0xe111180000d2663c0091e4f400237545b87b996b",
    "0xe2222d279d744050d28e00520010520000310f59",
  ],
  targetPairs: ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD", "BNB-USD"],
  targetHorizonsMin: [5, 15],
  marketLookaheadHours: 3,
  marketRefreshMs: 30_000,
  // Keep discovery metadata broad, but subscribe only to live markets plus the next handoff.
  // Future books cannot emit an eligible frozen-universe event before their window starts, and
  // repeatedly initializing every discovered future book amplified public-socket reconnect debt.
  subscriptionLeadMs: 60_000,
  heartbeatMs: 10_000,
  staleSocketMs: 45_000,
  // PONG proves only that the transport is alive. The public market channel can remain responsive
  // to heartbeats while silently delivering no book/trade frames, so independently reconnect when
  // the entire active-token subscription has produced no actual market event for this long.
  staleMarketDataMs: 90_000,
  // A connection that streams only a subset of subscribed book snapshots is not healthy enough for
  // the paired event-OFI tape. Snapshot receipt is deliberately distinct from a two-sided quote:
  // an empty/one-sided book is real liquidity evidence and must stay null without causing retries.
  currentBookInitGraceMs: 15_000,
  // Do not erase exponential backoff merely because TCP opened. A connection must remain open for
  // this long before the next abnormal close is treated as an isolated failure.
  reconnectStableMs: 60_000,
  flushMs: 1_000,
  verifyMs: 10_000,
  // Operational capacity only: 200 / 10s = 20 receipt rows/s, above the observed outcome-blind
  // stream rate (~9.8/s) and below Bor's default JSON-RPC batch-request limit. This does not alter
  // finality, reconciliation, readiness, or any directional field.
  verifyBatch: 200,
  // Wait through the frozen 20-confirmation horizon before a first lookup. A public market-stream
  // hash that is still unavailable then enters durable exponential backoff, yielding to fresh rows
  // instead of monopolizing the oldest-first queue. Receipt status, reconciliation tolerances, and
  // research floors remain unchanged.
  verifyInitialDelayMs: 60_000,
  verifyRetryBaseMs: 10 * 60_000,
  verifyRetryMaxMs: 6 * 60 * 60_000,
  // MATCHED trades can enter Polymarket's documented RETRYING lifecycle and later mine under a
  // replacement hash. Recovery starts only after the original receipt has already failed one
  // finalized lookup, and only an exact, unique public execution match can reach reconciliation.
  replacementLookupDelayMs: 10 * 60_000,
  replacementWindowSec: 60,
  // Full-market Data API responses can be large. Four conditions per cycle bounds JSON/network
  // work far below the 200-row direct receipt lane and lets recovery drain gradually.
  replacementConditionBatch: 4,
  replacementCacheMs: 60_000,
  replacementCacheMaxMarkets: 16,
  // Yield an entire receipt cycle under broad host pressure. Queue age remains visible in the
  // fail-closed health report, so deferral cannot silently pass readiness.
  verifyMaxLoadPerCpu: 0.75,
  verifyTelemetryMs: 5 * 60_000,
  maxPendingRows: 5_000,
  minConfirmations: 20,
  // Market `last_trade_price` is quantized to the $0.01 CLOB tick while V2 OrdersMatched carries
  // the taker's aggregate 6-decimal amounts. The two representations can therefore differ by one
  // half-tick even when transaction, token, side, and shares match exactly.
  priceTolerance: 0.005000001,
  shareTolerance: 1e-6,
  minRawEvents: 10_000,
  minVerifiedEvents: 5_000,
  minMarkets: 500,
  minSpanDays: 7,
  minMarketsPerPair: 50,
  minHashCoverage: 0.99,
  minChainVerificationRate: 0.995,
} as const;

const ENABLED_KEY = "authoritative_trade_flow_tape_enabled";
const VALID_SIDE = new Set(["BUY", "SELL"]);
const EXCHANGES = new Set<string>(AUTHORITATIVE_TRADE_FLOW_TAPE.exchangeAddresses);
const TARGET_PAIRS = new Set<string>(AUTHORITATIVE_TRADE_FLOW_TAPE.targetPairs);
const TARGET_HORIZONS = new Set<number>(AUTHORITATIVE_TRADE_FLOW_TAPE.targetHorizonsMin);
const MARKET_DATA_EVENT_TYPES = new Set([
  "book",
  "price_change",
  "last_trade_price",
  "tick_size_change",
  "best_bid_ask",
  "new_market",
  "market_resolved",
]);

export interface TradeFlowMarketMeta {
  conditionId: string;
  tokenId: string;
  pair: string;
  horizonMin: number;
  windowStartMs: number;
  endDateMs: number;
  outcomeSide: "up" | "down";
}

/** Operational subscription scope only; the frozen event universe remains unchanged. */
export function tradeFlowSubscriptionEligible(
  row: TradeFlowMarketMeta,
  nowMs: number,
): boolean {
  if (
    !Number.isFinite(nowMs)
    || !Number.isFinite(row.windowStartMs)
    || !Number.isFinite(row.endDateMs)
  ) return false;
  return (
    row.endDateMs > nowMs
    && row.windowStartMs <= nowMs + AUTHORITATIVE_TRADE_FLOW_TAPE.subscriptionLeadMs
  );
}

/**
 * Gamma discovery pages can be temporarily partial even when the request succeeds. Keep previously
 * discovered metadata until its immutable market end instead of treating one partial page as an
 * instruction to unsubscribe a still-live book. Newly discovered rows always replace the same
 * token, and expired rows are removed deterministically.
 */
export function mergeTradeFlowMarketMetadata(
  previous: ReadonlyMap<string, TradeFlowMarketMeta>,
  discovered: Iterable<TradeFlowMarketMeta>,
  nowMs: number,
): Map<string, TradeFlowMarketMeta> {
  const next = new Map<string, TradeFlowMarketMeta>();
  if (!Number.isFinite(nowMs)) return next;
  for (const [tokenId, row] of previous) {
    if (row.endDateMs > nowMs) next.set(tokenId, row);
  }
  for (const row of discovered) {
    if (row.endDateMs > nowMs) next.set(row.tokenId, row);
  }
  return next;
}

export interface ParsedTradeFlowEvent {
  conditionId: string;
  tokenId: string;
  pair: string;
  horizonMin: number;
  windowStart: Date;
  endDate: Date;
  outcomeSide: "up" | "down";
  reportedSide: "buy" | "sell";
  price: number;
  shares: number;
  notionalUsd: number;
  feeRateBps: number | null;
  eventAt: Date;
  receivedAt: Date;
  ingestionLatencyMs: number;
  transactionHash: string | null;
  chainStatus: "pending" | "missing_hash";
}

/** Outcome-blind host-pressure ratio used only to defer receipt-verification work. */
export function tradeFlowVerifierLoadPerCpu(load1: number, parallelism: number): number {
  if (!Number.isFinite(load1) || load1 < 0 || !Number.isFinite(parallelism) || parallelism < 1) {
    return Number.POSITIVE_INFINITY;
  }
  return load1 / Math.max(1, Math.floor(parallelism));
}

/** Durable exponential receipt retry delay; the attempt counter contains no market evidence. */
export function tradeFlowVerificationRetryDelayMs(verificationAttempts: number): number {
  const attempts = Number.isFinite(verificationAttempts)
    ? Math.max(1, Math.floor(verificationAttempts))
    : 1;
  return Math.min(
    AUTHORITATIVE_TRADE_FLOW_TAPE.verifyRetryMaxMs,
    AUTHORITATIVE_TRADE_FLOW_TAPE.verifyRetryBaseMs * 2 ** Math.min(attempts - 1, 16),
  );
}

/** Pure operational clock used by tests and status explanations; no market value is inspected. */
export function tradeFlowVerificationDue(
  input: {
    eventAt: Date | string;
    verificationAttemptedAt: Date | string | null;
    verificationAttempts: number;
  },
  nowMs: number,
): boolean {
  if (!Number.isFinite(nowMs)) return false;
  if (input.verificationAttemptedAt == null) {
    const eventAtMs = input.eventAt instanceof Date
      ? input.eventAt.getTime()
      : new Date(input.eventAt).getTime();
    return Number.isFinite(eventAtMs)
      && nowMs - eventAtMs >= AUTHORITATIVE_TRADE_FLOW_TAPE.verifyInitialDelayMs;
  }
  const attemptedAtMs = input.verificationAttemptedAt instanceof Date
    ? input.verificationAttemptedAt.getTime()
    : new Date(input.verificationAttemptedAt).getTime();
  return Number.isFinite(attemptedAtMs)
    && nowMs - attemptedAtMs >= tradeFlowVerificationRetryDelayMs(
      input.verificationAttempts,
    );
}

/**
 * Minimal public market-stream frame. The collector needs standard `last_trade_price` events only;
 * enabling custom market-lifecycle/top-of-book events adds traffic that is never consumed.
 */
export function tradeFlowSubscriptionFrame(
  ids: readonly string[],
  operation?: "subscribe" | "unsubscribe",
): { assets_ids: string[]; operation: "subscribe" | "unsubscribe" } | {
  assets_ids: string[];
  type: "market";
} {
  const assets_ids = [...ids];
  return operation ? { assets_ids, operation } : { assets_ids, type: "market" };
}

/** Distinguish real public market events from PONGs, empty snapshots, and error envelopes. */
export function isTradeFlowMarketDataFrame(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const root = value as Record<string, unknown>;
  const payload =
    root.topic === "market"
    && root.payload
    && typeof root.payload === "object"
    && !Array.isArray(root.payload)
      ? root.payload as Record<string, unknown>
      : root;
  const eventType = payload.event_type ?? payload.type;
  return typeof eventType === "string" && MARKET_DATA_EVENT_TYPES.has(eventType);
}

export function tradeFlowSocketStaleness(
  nowMs: number,
  lastTransportAtMs: number,
  lastMarketDataAtMs: number,
): "transport" | "market_data" | null {
  if (
    !Number.isFinite(nowMs)
    || !Number.isFinite(lastTransportAtMs)
    || !Number.isFinite(lastMarketDataAtMs)
    || nowMs < lastTransportAtMs
    || nowMs < lastMarketDataAtMs
  ) return "transport";
  if (nowMs - lastTransportAtMs > AUTHORITATIVE_TRADE_FLOW_TAPE.staleSocketMs) {
    return "transport";
  }
  if (nowMs - lastMarketDataAtMs > AUTHORITATIVE_TRADE_FLOW_TAPE.staleMarketDataMs) {
    return "market_data";
  }
  return null;
}

/** Outcome-blind partial-subscription guard for the currently trading token set. */
export function tradeFlowCurrentSnapshotsIncomplete(
  nowMs: number,
  socketOpenedAtMs: number,
  expectedTokens: number,
  snapshotTokens: number,
): boolean {
  if (
    !Number.isFinite(nowMs)
    || !Number.isFinite(socketOpenedAtMs)
    || nowMs < socketOpenedAtMs
    || !Number.isInteger(expectedTokens)
    || expectedTokens < 0
    || !Number.isInteger(snapshotTokens)
    || snapshotTokens < 0
    || snapshotTokens > expectedTokens
  ) return true;
  if (expectedTokens === 0 || snapshotTokens === expectedTokens) return false;
  return nowMs - socketOpenedAtMs >= AUTHORITATIVE_TRADE_FLOW_TAPE.currentBookInitGraceMs;
}

/**
 * A full current-book baseline is stronger recovery evidence than elapsed socket lifetime.
 *
 * The public endpoint routinely closes otherwise healthy connections with code 1006. Once every
 * currently trading token has delivered its full `book` frame, carrying exponential reconnect
 * debt only lengthens an unrelated future outage and creates avoidable null tape rows.
 */
export function tradeFlowCurrentSnapshotsReady(
  expectedTokens: number,
  snapshotTokens: number,
): boolean {
  return (
    Number.isInteger(expectedTokens)
    && expectedTokens > 0
    && Number.isInteger(snapshotTokens)
    && snapshotTokens === expectedTokens
  );
}

export interface OrdersMatchedLog {
  exchange: string;
  side: "buy" | "sell";
  tokenId: string;
  makerAmount: string;
  takerAmount: string;
  price: number;
  shares: number;
}

interface RpcLog {
  address?: unknown;
  topics?: unknown;
  data?: unknown;
}

export interface PolygonReceipt {
  status?: unknown;
  blockNumber?: unknown;
  logs?: unknown;
}

export type TradeFlowReconciliation = {
  chainStatus: "pending" | "verified" | "mismatch" | "reverted";
  chainBlockNumber: number | null;
  chainConfirmations: number | null;
  chainExchange: string | null;
  chainSide: "buy" | "sell" | null;
  chainTokenId: string | null;
  chainMakerAmount: string | null;
  chainTakerAmount: string | null;
  chainPrice: number | null;
  chainShares: number | null;
  verifiedAt: Date | null;
  verificationError: string | null;
};

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedHash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const lower = value.toLowerCase();
  return /^0x[0-9a-f]{64}$/.test(lower) ? lower : null;
}

export interface TradeFlowDataApiTrade {
  asset?: unknown;
  side?: unknown;
  size?: unknown;
  price?: unknown;
  timestamp?: unknown;
  transactionHash?: unknown;
}

export type TradeFlowReplacementSelection = {
  status: "source_present" | "unique" | "ambiguous" | "missing";
  transactionHash: string | null;
};

/**
 * Identify a superseding public trade hash without reading an outcome or inferring direction.
 *
 * The original stream hash always wins when it is present. Otherwise a replacement must be unique
 * after exact market/token/side/share matching, the frozen half-tick price tolerance, and a
 * forward-only one-minute retry window. Ambiguity remains unresolved by construction.
 */
export function selectTradeFlowReplacementHash(
  row: {
    tokenId: string;
    reportedSide: "buy" | "sell";
    price: number;
    shares: number;
    eventAt: Date | string;
    transactionHash: string;
  },
  trades: readonly TradeFlowDataApiTrade[],
): TradeFlowReplacementSelection {
  const sourceHash = normalizedHash(row.transactionHash);
  const eventAtMs = row.eventAt instanceof Date
    ? row.eventAt.getTime()
    : new Date(row.eventAt).getTime();
  if (!sourceHash || !Number.isFinite(eventAtMs)) {
    return { status: "missing", transactionHash: null };
  }
  if (
    trades.some((trade) => normalizedHash(trade.transactionHash) === sourceHash)
  ) {
    return { status: "source_present", transactionHash: null };
  }
  const eventSec = Math.floor(eventAtMs / 1_000);
  const hashes = new Set<string>();
  for (const trade of trades) {
    const hash = normalizedHash(trade.transactionHash);
    const side = typeof trade.side === "string" ? trade.side.toLowerCase() : "";
    const size = finiteNumber(trade.size);
    const price = finiteNumber(trade.price);
    const timestamp = finiteNumber(trade.timestamp);
    if (
      !hash
      || hash === sourceHash
      || String(trade.asset ?? "") !== row.tokenId
      || side !== row.reportedSide
      || size == null
      || Math.abs(size - row.shares) > AUTHORITATIVE_TRADE_FLOW_TAPE.shareTolerance
      || price == null
      || Math.abs(price - row.price) > AUTHORITATIVE_TRADE_FLOW_TAPE.priceTolerance
      || timestamp == null
      || timestamp < eventSec
      || timestamp > eventSec + AUTHORITATIVE_TRADE_FLOW_TAPE.replacementWindowSec
    ) continue;
    hashes.add(hash);
  }
  if (hashes.size === 1) {
    return { status: "unique", transactionHash: [...hashes][0]! };
  }
  return {
    status: hashes.size > 1 ? "ambiguous" : "missing",
    transactionHash: null,
  };
}

/** Canonical six-asset mapping used only for the frozen trade-flow universe. */
export function tradeFlowPairOfQuestion(question: string): string | null {
  const q = question.toLowerCase();
  if (/bitcoin|\bbtc\b/.test(q)) return "BTC-USD";
  if (/ethereum|\beth\b/.test(q)) return "ETH-USD";
  if (/solana|\bsol\b/.test(q)) return "SOL-USD";
  if (/\bxrp\b/.test(q)) return "XRP-USD";
  if (/dogecoin|\bdoge\b/.test(q)) return "DOGE-USD";
  if (/\bbnb\b/.test(q)) return "BNB-USD";
  return null;
}

/** Convert one Gamma market into its two unambiguous, prospectively eligible token mappings. */
export function tradeFlowMarketMetadata(market: GammaMarket): TradeFlowMarketMeta[] {
  const pair = tradeFlowPairOfQuestion(market.question ?? "");
  const horizonMin = updownHorizonMinutes(market.question ?? "");
  const endDateMs = market.endDate ? new Date(market.endDate).getTime() : NaN;
  if (
    !pair
    || !TARGET_PAIRS.has(pair)
    || horizonMin == null
    || !TARGET_HORIZONS.has(horizonMin)
    || !Number.isFinite(endDateMs)
  ) return [];
  const windowStartMs = endDateMs - horizonMin * 60_000;
  if (windowStartMs < AUTHORITATIVE_TRADE_FLOW_TAPE.evalStartMs) return [];
  const up = upTokenId(market), down = downTokenId(market);
  if (!up || !down || up === down) return [];
  return [
    {
      conditionId: market.conditionId.toLowerCase(),
      tokenId: up,
      pair,
      horizonMin,
      windowStartMs,
      endDateMs,
      outcomeSide: "up",
    },
    {
      conditionId: market.conditionId.toLowerCase(),
      tokenId: down,
      pair,
      horizonMin,
      windowStartMs,
      endDateMs,
      outcomeSide: "down",
    },
  ];
}

function marketEventPayload(message: unknown): Record<string, unknown> | null {
  if (!message || typeof message !== "object") return null;
  const root = message as Record<string, unknown>;
  if (root.event_type === "last_trade_price") return root;
  if (root.topic === "market" && root.type === "last_trade_price" && root.payload && typeof root.payload === "object") {
    const payload = root.payload as Record<string, unknown>;
    return {
      event_type: "last_trade_price",
      market: payload.market,
      asset_id: payload.tokenId ?? payload.token_id,
      price: payload.price,
      size: payload.size,
      side: payload.side,
      fee_rate_bps: payload.feeRateBps ?? payload.fee_rate_bps,
      timestamp: payload.timestamp,
      transaction_hash: payload.transactionHash ?? payload.transaction_hash,
    };
  }
  return null;
}

/** Parse a public trade event without consulting an outcome, account, order, or paper ledger. */
export function parseTradeFlowEvent(
  message: unknown,
  receivedAtMs: number,
  metadataByToken: ReadonlyMap<string, TradeFlowMarketMeta>,
): ParsedTradeFlowEvent | null {
  const event = marketEventPayload(message);
  if (!event) return null;
  const tokenId = typeof event.asset_id === "string" ? event.asset_id : null;
  const conditionId = typeof event.market === "string" ? event.market.toLowerCase() : null;
  const side = typeof event.side === "string" ? event.side.toUpperCase() : "";
  const price = finiteNumber(event.price);
  const shares = finiteNumber(event.size);
  const eventAtMs = finiteNumber(event.timestamp);
  if (
    !tokenId
    || !conditionId
    || !VALID_SIDE.has(side)
    || price == null
    || price <= 0
    || price >= 1
    || shares == null
    || shares <= 0
    || eventAtMs == null
    || eventAtMs < AUTHORITATIVE_TRADE_FLOW_TAPE.evalStartMs
  ) return null;
  const meta = metadataByToken.get(tokenId);
  if (!meta || meta.conditionId !== conditionId || meta.windowStartMs < AUTHORITATIVE_TRADE_FLOW_TAPE.evalStartMs) {
    return null;
  }
  const transactionHash = normalizedHash(event.transaction_hash);
  const feeRateBps = event.fee_rate_bps == null ? null : finiteNumber(event.fee_rate_bps);
  return {
    conditionId: meta.conditionId,
    tokenId,
    pair: meta.pair,
    horizonMin: meta.horizonMin,
    windowStart: new Date(meta.windowStartMs),
    endDate: new Date(meta.endDateMs),
    outcomeSide: meta.outcomeSide,
    reportedSide: side === "BUY" ? "buy" : "sell",
    price,
    shares,
    notionalUsd: price * shares,
    feeRateBps: feeRateBps != null && feeRateBps >= 0 ? feeRateBps : null,
    eventAt: new Date(eventAtMs),
    receivedAt: new Date(receivedAtMs),
    ingestionLatencyMs: receivedAtMs - eventAtMs,
    transactionHash,
    chainStatus: transactionHash ? "pending" : "missing_hash",
  };
}

function parseHexWord(word: string | undefined): bigint | null {
  if (!word || !/^[0-9a-fA-F]{64}$/.test(word)) return null;
  try { return BigInt(`0x${word}`); } catch { return null; }
}

/** Decode only official V2 OrdersMatched logs; unrelated or malformed logs fail closed. */
export function decodeOrdersMatchedLog(log: RpcLog): OrdersMatchedLog | null {
  const address = typeof log.address === "string" ? log.address.toLowerCase() : "";
  const topics = Array.isArray(log.topics) ? log.topics : [];
  const topic0 = typeof topics[0] === "string" ? topics[0].toLowerCase() : "";
  const data = typeof log.data === "string" ? log.data : "";
  if (
    !EXCHANGES.has(address)
    || topic0 !== AUTHORITATIVE_TRADE_FLOW_TAPE.ordersMatchedTopic
    || !/^0x[0-9a-fA-F]{256}$/.test(data)
  ) return null;
  const words = data.slice(2).match(/.{64}/g) ?? [];
  const sideRaw = parseHexWord(words[0]);
  const tokenId = parseHexWord(words[1]);
  const makerAmount = parseHexWord(words[2]);
  const takerAmount = parseHexWord(words[3]);
  if (
    sideRaw == null
    || (sideRaw !== 0n && sideRaw !== 1n)
    || tokenId == null
    || makerAmount == null
    || takerAmount == null
    || makerAmount <= 0n
    || takerAmount <= 0n
  ) return null;
  const side = sideRaw === 0n ? "buy" : "sell";
  const sharesRaw = side === "buy" ? takerAmount : makerAmount;
  const notionalRaw = side === "buy" ? makerAmount : takerAmount;
  const shares = Number(sharesRaw) / 1_000_000;
  const notional = Number(notionalRaw) / 1_000_000;
  const price = notional / shares;
  if (!(shares > 0) || !(price > 0) || !(price < 1) || !Number.isFinite(price)) return null;
  return {
    exchange: address,
    side,
    tokenId: tokenId.toString(),
    makerAmount: makerAmount.toString(),
    takerAmount: takerAmount.toString(),
    price,
    shares,
  };
}

const emptyReconciliation = (
  chainStatus: TradeFlowReconciliation["chainStatus"],
  error: string | null,
): TradeFlowReconciliation => ({
  chainStatus,
  chainBlockNumber: null,
  chainConfirmations: null,
  chainExchange: null,
  chainSide: null,
  chainTokenId: null,
  chainMakerAmount: null,
  chainTakerAmount: null,
  chainPrice: null,
  chainShares: null,
  verifiedAt: null,
  verificationError: error,
});

/** Reconcile one reported trade with a finalized successful Polygon receipt. */
export function reconcileTradeFlowReceipt(
  row: Pick<ParsedTradeFlowEvent, "tokenId" | "reportedSide" | "price" | "shares">,
  receipt: PolygonReceipt | null,
  headBlock: number,
  nowMs: number,
): TradeFlowReconciliation {
  if (!receipt) return emptyReconciliation("pending", null);
  const blockHex = typeof receipt.blockNumber === "string" ? receipt.blockNumber : "";
  const blockNumber = /^0x[0-9a-fA-F]+$/.test(blockHex) ? Number(BigInt(blockHex)) : NaN;
  if (!Number.isSafeInteger(blockNumber) || blockNumber < 0) {
    return emptyReconciliation("mismatch", "invalid_block");
  }
  const confirmations = Math.max(0, headBlock - blockNumber + 1);
  if (receipt.status === "0x0") {
    return {
      ...emptyReconciliation("reverted", "receipt_reverted"),
      chainBlockNumber: blockNumber,
      chainConfirmations: confirmations,
      verifiedAt: new Date(nowMs),
    };
  }
  if (receipt.status !== "0x1") {
    return {
      ...emptyReconciliation("pending", null),
      chainBlockNumber: blockNumber,
      chainConfirmations: confirmations,
    };
  }
  if (confirmations < AUTHORITATIVE_TRADE_FLOW_TAPE.minConfirmations) {
    return {
      ...emptyReconciliation("pending", null),
      chainBlockNumber: blockNumber,
      chainConfirmations: confirmations,
    };
  }
  const logs = Array.isArray(receipt.logs) ? receipt.logs : [];
  const decoded = logs.map((log) => decodeOrdersMatchedLog(log as RpcLog)).filter((log): log is OrdersMatchedLog => !!log);
  const tokenMatches = decoded.filter((log) => log.tokenId === row.tokenId);
  const sideMatches = tokenMatches.filter((log) => log.side === row.reportedSide);
  const match = sideMatches.find((log) =>
    Math.abs(log.shares - row.shares) <= AUTHORITATIVE_TRADE_FLOW_TAPE.shareTolerance
    && Math.abs(log.price - row.price) <= AUTHORITATIVE_TRADE_FLOW_TAPE.priceTolerance
  ) ?? sideMatches[0] ?? tokenMatches[0] ?? decoded[0] ?? null;
  const base = match ? {
    chainBlockNumber: blockNumber,
    chainConfirmations: confirmations,
    chainExchange: match.exchange,
    chainSide: match.side,
    chainTokenId: match.tokenId,
    chainMakerAmount: match.makerAmount,
    chainTakerAmount: match.takerAmount,
    chainPrice: match.price,
    chainShares: match.shares,
    verifiedAt: new Date(nowMs),
  } : {
    chainBlockNumber: blockNumber,
    chainConfirmations: confirmations,
    chainExchange: null,
    chainSide: null,
    chainTokenId: null,
    chainMakerAmount: null,
    chainTakerAmount: null,
    chainPrice: null,
    chainShares: null,
    verifiedAt: new Date(nowMs),
  };
  const mismatch = (error: string): TradeFlowReconciliation => ({
    chainStatus: "mismatch",
    verificationError: error,
    ...base,
  });
  if (!tokenMatches.length) return mismatch("token_not_found");
  if (!match || match.side !== row.reportedSide) return mismatch("side_mismatch");
  if (Math.abs(match.shares - row.shares) > AUTHORITATIVE_TRADE_FLOW_TAPE.shareTolerance) {
    return mismatch("share_mismatch");
  }
  if (Math.abs(match.price - row.price) > AUTHORITATIVE_TRADE_FLOW_TAPE.priceTolerance) {
    return mismatch("price_mismatch");
  }
  return {
    chainStatus: "verified",
    verificationError: null,
    ...base,
  };
}

type PendingInsert = typeof polymarketTradeFlowEvents.$inferInsert;
const pending: PendingInsert[] = [];
const metadataByToken = new Map<string, TradeFlowMarketMeta>();
let activeTokenIds = new Set<string>();
let socket: WebSocket | null = null;
let started = false;
let flushing = false;
let verifying = false;
let reconnectAttempt = 0;
let lastDataAt = 0;
let lastMarketDataAt = 0;
let socketOpenedAt = 0;
let socketCloseCount = 0;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let stableConnectionTimer: ReturnType<typeof setTimeout> | null = null;
let lastErrorLogAt = 0;
let lastRefreshErrorLogAt = 0;
let lastVerifierTelemetryAt = 0;
let lastLoadDeferralLogAt = 0;
let lastSocketCloseLogAt = 0;
const replacementTradeCache = new Map<
  string,
  { expiresAtMs: number; trades: TradeFlowDataApiTrade[] }
>();

function fingerprint(row: ParsedTradeFlowEvent): string {
  return createHash("sha256").update([
    row.conditionId,
    row.tokenId,
    row.reportedSide,
    row.price.toString(),
    row.shares.toString(),
    row.eventAt.getTime().toString(),
    row.transactionHash ?? "",
  ].join("|")).digest("hex");
}

function enqueue(message: unknown, receivedAtMs: number) {
  const parsed = parseTradeFlowEvent(message, receivedAtMs, metadataByToken);
  if (!parsed) return;
  pending.push({
    ...parsed,
    fingerprint: fingerprint(parsed),
    version: AUTHORITATIVE_TRADE_FLOW_TAPE.version,
  });
  if (pending.length > AUTHORITATIVE_TRADE_FLOW_TAPE.maxPendingRows) {
    const dropped = pending.length - AUTHORITATIVE_TRADE_FLOW_TAPE.maxPendingRows;
    pending.splice(0, dropped);
    console.error(`[trade-flow-tape] pending overflow; dropped=${dropped}`);
  }
}

async function flush() {
  if (flushing || !pending.length) return;
  flushing = true;
  const batch = pending.splice(0, pending.length);
  try {
    await db.insert(polymarketTradeFlowEvents).values(batch).onConflictDoNothing();
  } catch (error) {
    const now = Date.now();
    if (now - lastErrorLogAt >= 60_000) {
      console.error(`[trade-flow-tape] discarded=${batch.length}: ${error instanceof Error ? error.message : String(error)}`);
      lastErrorLogAt = now;
    }
  } finally {
    flushing = false;
  }
}

function sendSubscription(ids: readonly string[], operation?: "subscribe" | "unsubscribe") {
  if (!ids.length || socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(tradeFlowSubscriptionFrame(ids, operation)));
}

async function refreshMarkets() {
  try {
    const markets = await fetchCurrentCryptoUpDown();
    const discovered = markets.flatMap(tradeFlowMarketMetadata);
    const now = Date.now();
    const nextByToken = mergeTradeFlowMarketMetadata(metadataByToken, discovered, now);
    const metadata = [...nextByToken.values()];
    const nextIds = new Set(
      metadata
        .filter((row) => tradeFlowSubscriptionEligible(row, now))
        .map((row) => row.tokenId),
    );
    const added = [...nextIds].filter((id) => !activeTokenIds.has(id));
    const removed = [...activeTokenIds].filter((id) => !nextIds.has(id));
    metadataByToken.clear();
    for (const [tokenId, row] of nextByToken) metadataByToken.set(tokenId, row);
    activeTokenIds = nextIds;
    retainClobEventOfiTokens(nextIds);
    sendSubscription(added, "subscribe");
    sendSubscription(removed, "unsubscribe");
    if (!nextIds.size && socket) {
      socket.close();
    } else if (nextIds.size && !socket) {
      connect();
    }
  } catch (error) {
    const now = Date.now();
    if (now - lastRefreshErrorLogAt >= 60_000) {
      console.error(`[trade-flow-tape] market refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      lastRefreshErrorLogAt = now;
    }
  }
}

function clearSocketTimers() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (watchdogTimer) clearInterval(watchdogTimer);
  if (stableConnectionTimer) clearTimeout(stableConnectionTimer);
  heartbeatTimer = null;
  watchdogTimer = null;
  stableConnectionTimer = null;
}

function currentTokenIds(nowMs: number): string[] {
  return [...metadataByToken.values()]
    .filter((row) => row.windowStartMs <= nowMs && nowMs < row.endDateMs)
    .map((row) => row.tokenId);
}

function connect() {
  if (socket || !activeTokenIds.size) return;
  const ws = new WebSocket(AUTHORITATIVE_TRADE_FLOW_TAPE.marketWs);
  socket = ws;
  let snapshotRecoveryConfirmed = false;
  ws.addEventListener("open", () => {
    socketOpenedAt = Date.now();
    lastDataAt = socketOpenedAt;
    lastMarketDataAt = socketOpenedAt;
    setClobEventOfiConnected(true);
    sendSubscription([...activeTokenIds]);
    stableConnectionTimer = setTimeout(() => {
      if (socket === ws && ws.readyState === WebSocket.OPEN) reconnectAttempt = 0;
    }, AUTHORITATIVE_TRADE_FLOW_TAPE.reconnectStableMs);
    heartbeatTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send("PING");
    }, AUTHORITATIVE_TRADE_FLOW_TAPE.heartbeatMs);
    watchdogTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      const initialization = clobEventOfiInitializationStats(currentTokenIds(now));
      if (
        tradeFlowCurrentSnapshotsReady(
          initialization.expectedTokens,
          initialization.bookSnapshotTokens,
        )
      ) {
        // Reset only after the causal queue baseline is complete. TCP-open, PONG, partial books,
        // and empty subscriptions cannot erase backoff debt.
        reconnectAttempt = 0;
        snapshotRecoveryConfirmed = true;
      }
      if (
        tradeFlowCurrentSnapshotsIncomplete(
          now,
          socketOpenedAt,
          initialization.expectedTokens,
          initialization.bookSnapshotTokens,
        )
      ) {
        console.warn(
          `[trade-flow-tape] incomplete current snapshots`
          + ` snapshots=${initialization.bookSnapshotTokens}/${initialization.expectedTokens}`
          + ` initialized=${initialization.initializedTokens}/${initialization.expectedTokens}`
          + ` lifetimeMs=${now - socketOpenedAt}; reconnecting`,
        );
        ws.close();
        return;
      }
      const stale = tradeFlowSocketStaleness(now, lastDataAt, lastMarketDataAt);
      if (stale) {
        console.warn(
          `[trade-flow-tape] stale ${stale === "transport" ? "transport" : "market data"}; reconnecting`,
        );
        ws.close();
      }
    }, 5_000);
    console.log(`[trade-flow-tape] subscribed tokens=${activeTokenIds.size}`);
  });
  ws.addEventListener("message", (event: MessageEvent) => {
    if (event.data === "PONG") {
      lastDataAt = Date.now();
      return;
    }
    let decoded: unknown;
    try { decoded = JSON.parse(typeof event.data === "string" ? event.data : String(event.data)); }
    catch { return; }
    const receivedAtMs = Date.now();
    lastDataAt = receivedAtMs;
    const messages = Array.isArray(decoded) ? decoded : [decoded];
    if (messages.some(isTradeFlowMarketDataFrame)) lastMarketDataAt = receivedAtMs;
    for (const message of messages) {
      const observedClobEvent = observeClobEventOfi(message, receivedAtMs);
      if (observedClobEvent && !snapshotRecoveryConfirmed) {
        const initialization = clobEventOfiInitializationStats(
          currentTokenIds(receivedAtMs),
        );
        if (
          tradeFlowCurrentSnapshotsReady(
            initialization.expectedTokens,
            initialization.bookSnapshotTokens,
          )
        ) {
          // A complete baseline usually arrives in a few hundred milliseconds. Confirm recovery
          // here so a connection that later dies before the first watchdog tick cannot compound
          // otherwise healthy code-1006 closes into long reconnect debt.
          reconnectAttempt = 0;
          snapshotRecoveryConfirmed = true;
        }
      }
      if (observedClobEvent && !clobEventOfiStreamLogged) {
        const status = clobEventOfiRuntimeStatus();
        if (status.bookFrames > 0 && status.priceChangeFrames > 0) {
          clobEventOfiStreamLogged = true;
          console.log(
            `[clob-event-ofi] stream-ready books=${status.bookFrames}`
            + ` changes=${status.priceChangeFrames}`
            + ` initialized=${status.initializedTokens}/${status.trackedTokens}`
            + ` retained-events=${status.retainedEvents}`,
          );
        }
      }
      enqueue(message, receivedAtMs);
    }
  });
  ws.addEventListener("close", (event) => {
    const closedAt = Date.now();
    const close = event as Event & {
      code?: unknown;
      reason?: unknown;
      wasClean?: unknown;
    };
    const code = typeof close.code === "number" ? close.code : 0;
    const wasClean = close.wasClean === true;
    const rawReason = typeof close.reason === "string" ? close.reason : "";
    socketCloseCount++;
    if (closedAt - lastSocketCloseLogAt >= 60_000) {
      const reason = rawReason.trim().replace(/\s+/g, " ").slice(0, 120);
      console.warn(
        `[trade-flow-tape] socket closed count=${socketCloseCount}`
        + ` code=${code} clean=${wasClean}`
        + ` lifetimeMs=${socketOpenedAt ? closedAt - socketOpenedAt : 0}`
        + `${reason ? ` reason=${JSON.stringify(reason)}` : ""}`,
      );
      lastSocketCloseLogAt = closedAt;
    }
    clearSocketTimers();
    setClobEventOfiConnected(false);
    if (socket === ws) socket = null;
    reconnectAttempt++;
    if (activeTokenIds.size) {
      setTimeout(connect, Math.min(1_000 * 2 ** reconnectAttempt, 30_000));
    }
  });
  ws.addEventListener("error", () => {
    try { ws.close(); } catch { /* close handler reconnects */ }
  });
}

type RpcResponse<T> = { id?: string | number; result?: T; error?: { message?: string } };

async function rpcBatch(
  rpcUrl: string,
  hashes: readonly string[],
): Promise<{ headBlock: number; receipts: Map<string, PolygonReceipt | null> }> {
  const requests = [
    { jsonrpc: "2.0", id: "head", method: "eth_blockNumber", params: [] },
    ...hashes.map((hash) => ({
      jsonrpc: "2.0",
      id: hash,
      method: "eth_getTransactionReceipt",
      params: [hash],
    })),
  ];
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requests),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Polygon RPC ${response.status}`);
  const payload = await response.json() as RpcResponse<unknown>[];
  if (!Array.isArray(payload)) throw new Error("Polygon RPC batch response malformed");
  const byId = new Map(payload.map((row) => [String(row.id), row]));
  const headHex = byId.get("head")?.result;
  if (typeof headHex !== "string" || !/^0x[0-9a-fA-F]+$/.test(headHex)) {
    throw new Error("Polygon RPC head missing");
  }
  return {
    headBlock: Number(BigInt(headHex)),
    receipts: new Map(hashes.map((hash) => [
      hash,
      (byId.get(hash)?.result as PolygonReceipt | null | undefined) ?? null,
    ])),
  };
}

async function replacementTrades(
  conditionId: string,
  nowMs: number,
): Promise<TradeFlowDataApiTrade[]> {
  for (const [key, entry] of replacementTradeCache) {
    if (entry.expiresAtMs <= nowMs) replacementTradeCache.delete(key);
  }
  const cached = replacementTradeCache.get(conditionId);
  if (cached && cached.expiresAtMs > nowMs) return cached.trades;
  const url = new URL(AUTHORITATIVE_TRADE_FLOW_TAPE.dataApiTrades);
  url.searchParams.set("market", conditionId);
  url.searchParams.set("limit", "10000");
  url.searchParams.set("takerOnly", "false");
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Polymarket Data API ${response.status}`);
  const payload = await response.json() as unknown;
  if (!Array.isArray(payload)) throw new Error("Polymarket Data API trades malformed");
  const trades = payload as TradeFlowDataApiTrade[];
  replacementTradeCache.set(conditionId, {
    expiresAtMs: nowMs + AUTHORITATIVE_TRADE_FLOW_TAPE.replacementCacheMs,
    trades,
  });
  while (
    replacementTradeCache.size
    > AUTHORITATIVE_TRADE_FLOW_TAPE.replacementCacheMaxMarkets
  ) {
    const oldest = replacementTradeCache.keys().next().value;
    if (typeof oldest !== "string") break;
    replacementTradeCache.delete(oldest);
  }
  return trades;
}

async function verifyPending() {
  if (verifying || Date.now() < AUTHORITATIVE_TRADE_FLOW_TAPE.evalStartMs) return;
  const startedAt = Date.now();
  const loadPerCpu = tradeFlowVerifierLoadPerCpu(loadavg()[0] ?? Number.NaN, availableParallelism());
  if (loadPerCpu >= AUTHORITATIVE_TRADE_FLOW_TAPE.verifyMaxLoadPerCpu) {
    if (startedAt - lastLoadDeferralLogAt >= 60_000) {
      console.warn(
        `[trade-flow-tape] verifier deferred loadPerCpu=${loadPerCpu.toFixed(3)}`
        + ` limit=${AUTHORITATIVE_TRADE_FLOW_TAPE.verifyMaxLoadPerCpu}`,
      );
      lastLoadDeferralLogAt = startedAt;
    }
    return;
  }
  verifying = true;
  let batchRows = 0;
  let batchHashes = 0;
  let batchReplacementCandidates = 0;
  let batchReplacementVerified = 0;
  try {
    const firstAttemptBefore = new Date(
      startedAt - AUTHORITATIVE_TRADE_FLOW_TAPE.verifyInitialDelayMs,
    );
    const retryDelayMs = sql`least(
      ${AUTHORITATIVE_TRADE_FLOW_TAPE.verifyRetryMaxMs},
      ${AUTHORITATIVE_TRADE_FLOW_TAPE.verifyRetryBaseMs}
        * power(
          2,
          least(
            greatest(${polymarketTradeFlowEvents.verificationAttempts} - 1, 0),
            16
          )
        )
    )`;
    const rows = await db
      .select({
        id: polymarketTradeFlowEvents.id,
        conditionId: polymarketTradeFlowEvents.conditionId,
        tokenId: polymarketTradeFlowEvents.tokenId,
        reportedSide: polymarketTradeFlowEvents.reportedSide,
        price: polymarketTradeFlowEvents.price,
        shares: polymarketTradeFlowEvents.shares,
        eventAt: polymarketTradeFlowEvents.eventAt,
        transactionHash: polymarketTradeFlowEvents.transactionHash,
        verificationAttempts: polymarketTradeFlowEvents.verificationAttempts,
      })
      .from(polymarketTradeFlowEvents)
      .where(and(
        eq(polymarketTradeFlowEvents.version, AUTHORITATIVE_TRADE_FLOW_TAPE.version),
        eq(polymarketTradeFlowEvents.chainStatus, "pending"),
        gte(polymarketTradeFlowEvents.eventAt, new Date(AUTHORITATIVE_TRADE_FLOW_TAPE.evalStartMs)),
        or(
          and(
            isNull(polymarketTradeFlowEvents.verificationAttemptedAt),
            lt(polymarketTradeFlowEvents.eventAt, firstAttemptBefore),
          ),
          and(
            isNotNull(polymarketTradeFlowEvents.verificationAttemptedAt),
            sql`${polymarketTradeFlowEvents.verificationAttemptedAt}
              < statement_timestamp()::timestamp
                - ${retryDelayMs} * interval '1 millisecond'`,
          ),
        ),
      ))
      // Never-attempted rows are the live lane. Retriable rows rotate by their last lookup time,
      // so a durable null receipt cannot repeatedly block newly arriving evidence.
      .orderBy(
        asc(sql`${polymarketTradeFlowEvents.verificationAttemptedAt} is not null`),
        asc(sql`coalesce(
          ${polymarketTradeFlowEvents.verificationAttemptedAt},
          ${polymarketTradeFlowEvents.eventAt}
        )`),
        asc(polymarketTradeFlowEvents.id),
      )
      .limit(AUTHORITATIVE_TRADE_FLOW_TAPE.verifyBatch);
    const hashes = [...new Set(rows.map((row) => row.transactionHash).filter((hash): hash is string => !!hash))];
    batchRows = rows.length;
    batchHashes = hashes.length;
    if (!hashes.length) return;
    const configuredRpc = await getSetting("POLYGON_RPC_URL");
    const rpcUrl = configuredRpc || AUTHORITATIVE_TRADE_FLOW_TAPE.polygonRpc;
    const { headBlock, receipts } = await rpcBatch(rpcUrl, hashes);
    const nowMs = Date.now();
    const replacementEligible = rows.filter((row) =>
      row.transactionHash
      && !receipts.get(row.transactionHash)
      && row.verificationAttempts >= 1
      && nowMs - row.eventAt.getTime()
        >= AUTHORITATIVE_TRADE_FLOW_TAPE.replacementLookupDelayMs
    );
    const replacementConditions = [
      ...new Set(replacementEligible.map((row) => row.conditionId)),
    ].slice(0, AUTHORITATIVE_TRADE_FLOW_TAPE.replacementConditionBatch);
    const replacementTradesByCondition = new Map<
      string,
      TradeFlowDataApiTrade[] | null
    >();
    await Promise.all(replacementConditions.map(async (conditionId) => {
      try {
        replacementTradesByCondition.set(
          conditionId,
          await replacementTrades(conditionId, nowMs),
        );
      } catch {
        // The direct receipt lane must continue even if the secondary public index is unavailable.
        replacementTradesByCondition.set(conditionId, null);
      }
    }));
    const replacementHashByRow = new Map<number, string>();
    for (const row of replacementEligible) {
      const trades = replacementTradesByCondition.get(row.conditionId);
      if (!trades || !row.transactionHash) continue;
      const selection = selectTradeFlowReplacementHash({
        tokenId: row.tokenId,
        reportedSide: row.reportedSide === "buy" ? "buy" : "sell",
        price: row.price,
        shares: row.shares,
        eventAt: row.eventAt,
        transactionHash: row.transactionHash,
      }, trades);
      if (selection.status === "unique" && selection.transactionHash) {
        replacementHashByRow.set(row.id, selection.transactionHash);
      }
    }
    const replacementHashes = [...new Set(replacementHashByRow.values())];
    batchReplacementCandidates = replacementHashByRow.size;
    let replacementHeadBlock = headBlock;
    let replacementReceipts = new Map<string, PolygonReceipt | null>();
    if (replacementHashes.length) {
      try {
        const replacementBatch = await rpcBatch(rpcUrl, replacementHashes);
        replacementHeadBlock = replacementBatch.headBlock;
        replacementReceipts = replacementBatch.receipts;
      } catch {
        // A replacement is never accepted without its own finalized Polygon receipt.
        replacementReceipts = new Map();
      }
    }
    for (const row of rows) {
      if (!row.transactionHash) continue;
      const sourceReceipt = receipts.get(row.transactionHash) ?? null;
      let reconciliation = reconcileTradeFlowReceipt(
        {
          tokenId: row.tokenId,
          reportedSide: row.reportedSide === "buy" ? "buy" : "sell",
          price: row.price,
          shares: row.shares,
        },
        sourceReceipt,
        headBlock,
        nowMs,
      );
      let chainTransactionHash = sourceReceipt ? row.transactionHash : undefined;
      let verificationMethod = sourceReceipt ? "source_hash" : undefined;
      const replacementHash = replacementHashByRow.get(row.id);
      if (!sourceReceipt && replacementHash) {
        const replacementReconciliation = reconcileTradeFlowReceipt(
          {
            tokenId: row.tokenId,
            reportedSide: row.reportedSide === "buy" ? "buy" : "sell",
            price: row.price,
            shares: row.shares,
          },
          replacementReceipts.get(replacementHash) ?? null,
          replacementHeadBlock,
          nowMs,
        );
        // Selection is deliberately only a candidate generator. The official V2 receipt must
        // independently reconcile every frozen execution fact before the replacement is accepted.
        if (replacementReconciliation.chainStatus === "verified") {
          reconciliation = replacementReconciliation;
          chainTransactionHash = replacementHash;
          verificationMethod = "data_api_replacement";
          batchReplacementVerified++;
        }
      }
      await db
        .update(polymarketTradeFlowEvents)
        .set({
          ...reconciliation,
          chainTransactionHash,
          verificationMethod,
          verificationAttempts: sql`${polymarketTradeFlowEvents.verificationAttempts} + 1`,
          verificationAttemptedAt: new Date(nowMs),
        })
        .where(eq(polymarketTradeFlowEvents.id, row.id));
    }
  } catch (error) {
    const now = Date.now();
    if (now - lastErrorLogAt >= 60_000) {
      console.error(`[trade-flow-tape] verifier: ${error instanceof Error ? error.message : String(error)}`);
      lastErrorLogAt = now;
    }
  } finally {
    const finishedAt = Date.now();
    const durationMs = finishedAt - startedAt;
    if (
      durationMs >= AUTHORITATIVE_TRADE_FLOW_TAPE.verifyMs
      || finishedAt - lastVerifierTelemetryAt >= AUTHORITATIVE_TRADE_FLOW_TAPE.verifyTelemetryMs
    ) {
      console.log(
        `[trade-flow-tape] verifier rows=${batchRows} hashes=${batchHashes}`
        + ` replacement-candidates=${batchReplacementCandidates}`
        + ` replacement-verified=${batchReplacementVerified}`
        + ` durationMs=${durationMs} loadPerCpu=${loadPerCpu.toFixed(3)}`,
      );
      lastVerifierTelemetryAt = finishedAt;
    }
    verifying = false;
  }
}

/** Start the public feed, bounded persistence loop, and read-only receipt verifier once. */
export async function startAuthoritativeTradeFlowTape() {
  if (started) return;
  started = true;
  const enabled = await getSetting(ENABLED_KEY);
  if (enabled === "false") {
    console.log("[trade-flow-tape] disabled");
    return;
  }
  await refreshMarkets();
  connect();
  setInterval(() => { void refreshMarkets(); }, AUTHORITATIVE_TRADE_FLOW_TAPE.marketRefreshMs);
  setInterval(() => { void flush(); }, AUTHORITATIVE_TRADE_FLOW_TAPE.flushMs);
  setInterval(() => { void verifyPending(); }, AUTHORITATIVE_TRADE_FLOW_TAPE.verifyMs);
  console.log(
    `[trade-flow-tape] armed boundary=${new Date(AUTHORITATIVE_TRADE_FLOW_TAPE.evalStartMs).toISOString()} paper-only=true`,
  );
}

/** Read-only operational state; intentionally contains no buy/sell aggregate or outcome information. */
export function authoritativeTradeFlowRuntimeStatus() {
  return {
    started,
    connected: socket?.readyState === WebSocket.OPEN,
    mappedTokens: metadataByToken.size,
    pendingWrites: pending.length,
    lastMessageAgoSec: lastDataAt ? (Date.now() - lastDataAt) / 1_000 : null,
    lastMarketDataAgoSec:
      lastMarketDataAt ? (Date.now() - lastMarketDataAt) / 1_000 : null,
  };
}

/** Static source audit used by tests to prevent a trading-capable endpoint from entering this path. */
export function tradeFlowRpcMethodAllowed(method: string): boolean {
  return method === "eth_blockNumber" || method === "eth_getTransactionReceipt";
}
