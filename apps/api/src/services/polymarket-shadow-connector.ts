/**
 * Paper-safe Polymarket connector hot path.
 *
 * This module stops before authentication, signing, or submission. It turns an already-received
 * public CLOB book into a deterministic FOK BUY simulation and records local preparation latency.
 * The intended production data source is the existing shared market WebSocket accumulator, so the
 * hot path performs no REST call, database read, socket creation, or JSON parsing.
 */
import { performance } from "node:perf_hooks";
import type { ClobBook } from "./polymarket.ts";
import {
  fillAskTotalUsd,
  type FeeAdjustedAskFill,
  type TakerFeeDescriptor,
} from "./polymarket-fees.ts";
import {
  clobLiveBookSnapshot,
  type ClobLiveBookSnapshot,
} from "./clob-event-ofi.ts";

export const POLYMARKET_SHADOW_CONNECTOR = {
  version: "polymarket-shadow-connector-v1",
  mode: "shadow",
  orderType: "FOK",
  orderSide: "BUY",
  maxBookAgeMs: 20_000,
  maxBudgetUsd: 25,
  authenticationEnabled: false,
  signingEnabled: false,
  submissionEnabled: false,
} as const;

export type ShadowRejectReason =
  | "invalid-intent"
  | "stale-book"
  | "book-mismatch"
  | "insufficient-depth"
  | "minimum-size"
  | "slippage-limit";

export interface ShadowMarketBuyIntent {
  conditionId: string;
  tokenId: string;
  totalBudgetUsd: number;
  tickSize: number;
  minOrderShares: number;
  maxEffectiveVwap?: number;
}

export interface ShadowBookInput {
  book: ClobBook;
  sourceAtMs: number;
  receivedAtMs: number;
  observedAtMs: number;
}

export interface ShadowOrderPlan {
  version: typeof POLYMARKET_SHADOW_CONNECTOR.version;
  mode: typeof POLYMARKET_SHADOW_CONNECTOR.mode;
  intentId: string;
  conditionId: string;
  tokenId: string;
  side: typeof POLYMARKET_SHADOW_CONNECTOR.orderSide;
  orderType: typeof POLYMARKET_SHADOW_CONNECTOR.orderType;
  amountUsd: number;
  worstPrice: number;
  tickSize: number;
  minOrderShares: number;
  quote: FeeAdjustedAskFill;
  sourceAtMs: number;
  receivedAtMs: number;
  observedAtMs: number;
  marketDataAgeMs: number;
  preparationMicros: number;
}

export type ShadowPreparation =
  | { accepted: true; plan: ShadowOrderPlan }
  | {
      accepted: false;
      reason: ShadowRejectReason;
      preparationMicros: number;
      marketDataAgeMs: number | null;
    };

type HighResolutionClock = () => number;
type LiveBookReader = (
  tokenId: string,
  conditionId: string,
  observedAtMs?: number,
  maxAgeMs?: number,
) => ClobLiveBookSnapshot | null;

const finitePositive = (value: number) => Number.isFinite(value) && value > 0;
const finitePrice = (value: number) => Number.isFinite(value) && value > 0 && value < 1;

function decimalPlaces(value: number): number {
  const text = value.toString().toLowerCase();
  if (text.includes("e-")) return Number(text.split("e-")[1]);
  return text.includes(".") ? text.length - text.indexOf(".") - 1 : 0;
}

/** Round a BUY ceiling upward so it cannot accidentally be less protective after tick quantization. */
export function ceilToTick(price: number, tickSize: number): number | null {
  if (!finitePrice(price) || !finitePositive(tickSize) || tickSize >= 1) return null;
  const places = Math.min(12, decimalPlaces(tickSize));
  const rounded = Math.ceil((price - 1e-12) / tickSize) * tickSize;
  const normalized = Number(rounded.toFixed(places));
  return finitePrice(normalized) ? normalized : null;
}

function consumedWorstPrice(book: ClobBook, levelsConsumed: number): number | null {
  if (!Number.isInteger(levelsConsumed) || levelsConsumed < 1) return null;
  const asks = (book.asks ?? [])
    .map((level) => ({ price: Number(level.price), size: Number(level.size) }))
    .filter((level) => finitePrice(level.price) && finitePositive(level.size))
    .sort((left, right) => left.price - right.price);
  return asks[levelsConsumed - 1]?.price ?? null;
}

function intentValid(intent: ShadowMarketBuyIntent): boolean {
  return Boolean(
    intent.conditionId
    && intent.tokenId
    && finitePositive(intent.totalBudgetUsd)
    && intent.totalBudgetUsd <= POLYMARKET_SHADOW_CONNECTOR.maxBudgetUsd
    && finitePositive(intent.tickSize)
    && intent.tickSize < 1
    && Number.isFinite(intent.minOrderShares)
    && intent.minOrderShares >= 0
    && (intent.maxEffectiveVwap == null || finitePrice(intent.maxEffectiveVwap)),
  );
}

function finishReject(
  reason: ShadowRejectReason,
  started: number,
  clock: HighResolutionClock,
  marketDataAgeMs: number | null,
): ShadowPreparation {
  return {
    accepted: false,
    reason,
    preparationMicros: Math.max(0, (clock() - started) * 1_000),
    marketDataAgeMs,
  };
}

/**
 * Build a deterministic shadow FOK plan from a public book already resident in memory.
 *
 * The returned shape is simulation metadata, not a signed CLOB wire order. In particular it has no
 * maker, signer, signature, API headers, wallet address, nonce, or submission method.
 */
export function prepareShadowMarketBuy(
  intent: ShadowMarketBuyIntent,
  snapshot: ShadowBookInput,
  fee: TakerFeeDescriptor,
  clock: HighResolutionClock = () => performance.now(),
): ShadowPreparation {
  const started = clock();
  if (!intentValid(intent)) return finishReject("invalid-intent", started, clock, null);
  const ageMs = snapshot.observedAtMs - snapshot.receivedAtMs;
  if (
    !Number.isFinite(snapshot.sourceAtMs)
    || !Number.isFinite(snapshot.receivedAtMs)
    || !Number.isFinite(snapshot.observedAtMs)
    || ageMs < 0
    || ageMs > POLYMARKET_SHADOW_CONNECTOR.maxBookAgeMs
  ) return finishReject("stale-book", started, clock, Number.isFinite(ageMs) ? ageMs : null);
  if (
    snapshot.book.market !== intent.conditionId
    || snapshot.book.asset_id !== intent.tokenId
  ) return finishReject("book-mismatch", started, clock, ageMs);

  const quote = fillAskTotalUsd(snapshot.book, intent.totalBudgetUsd, fee);
  if (!quote) return finishReject("insufficient-depth", started, clock, ageMs);
  if (quote.shares + 1e-9 < intent.minOrderShares) {
    return finishReject("minimum-size", started, clock, ageMs);
  }
  if (
    intent.maxEffectiveVwap != null
    && quote.effectiveVwap > intent.maxEffectiveVwap + 1e-12
  ) return finishReject("slippage-limit", started, clock, ageMs);

  const lastAsk = consumedWorstPrice(snapshot.book, quote.levelsConsumed);
  const worstPrice = lastAsk == null ? null : ceilToTick(lastAsk, intent.tickSize);
  if (worstPrice == null) return finishReject("invalid-intent", started, clock, ageMs);
  const preparationMicros = Math.max(0, (clock() - started) * 1_000);
  const intentId = [
    intent.conditionId,
    intent.tokenId,
    snapshot.receivedAtMs,
    intent.totalBudgetUsd.toFixed(6),
  ].join(":");
  return {
    accepted: true,
    plan: {
      version: POLYMARKET_SHADOW_CONNECTOR.version,
      mode: POLYMARKET_SHADOW_CONNECTOR.mode,
      intentId,
      conditionId: intent.conditionId,
      tokenId: intent.tokenId,
      side: POLYMARKET_SHADOW_CONNECTOR.orderSide,
      orderType: POLYMARKET_SHADOW_CONNECTOR.orderType,
      amountUsd: intent.totalBudgetUsd,
      worstPrice,
      tickSize: intent.tickSize,
      minOrderShares: intent.minOrderShares,
      quote,
      sourceAtMs: snapshot.sourceAtMs,
      receivedAtMs: snapshot.receivedAtMs,
      observedAtMs: snapshot.observedAtMs,
      marketDataAgeMs: ageMs,
      preparationMicros,
    },
  };
}

/**
 * Worker hot-path adapter: read the already-maintained public WebSocket book and prepare a shadow
 * plan without a network round trip. The injectable reader exists for deterministic tests only.
 */
export function prepareLiveShadowMarketBuy(
  intent: ShadowMarketBuyIntent,
  fee: TakerFeeDescriptor,
  observedAtMs = Date.now(),
  readBook: LiveBookReader = clobLiveBookSnapshot,
  clock: HighResolutionClock = () => performance.now(),
): ShadowPreparation {
  const started = clock();
  const live = readBook(
    intent.tokenId,
    intent.conditionId,
    observedAtMs,
    POLYMARKET_SHADOW_CONNECTOR.maxBookAgeMs,
  );
  if (!live) return finishReject("stale-book", started, clock, null);
  const prepared = prepareShadowMarketBuy(
    intent,
    {
      book: {
        market: live.market,
        asset_id: live.assetId,
        bids: live.bids,
        asks: live.asks,
      },
      sourceAtMs: live.sourceAtMs,
      receivedAtMs: live.receivedAtMs,
      observedAtMs,
    },
    fee,
    clock,
  );
  const preparationMicros = Math.max(0, (clock() - started) * 1_000);
  return prepared.accepted
    ? {
        accepted: true,
        plan: {
          ...prepared.plan,
          // The worker adapter's latency budget includes the in-memory snapshot lookup as well as
          // validation, fee-aware book walk, and tick quantization.
          preparationMicros,
        },
      }
    : {
        ...prepared,
        preparationMicros,
      };
}
