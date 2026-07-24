/**
 * Prospective, read-only nested-strike bundle tape.
 *
 * KB: cross-horizon-nested-strike-audit-v1. For two contracts on the same asset and exact
 * settlement timestamp, K_low < K_high implies UP(K_low) + DOWN(K_high) pays at least $1 per
 * equal-share pair. This module only observes synchronized public books; it cannot place orders.
 */
import { gte, sql } from "drizzle-orm";
import { db, polymarketBundleSnapshots } from "@framework/db";
import {
  downTokenId,
  fetchClobBook,
  fetchClobMarketInfo,
  fetchCurrentCryptoUpDown,
  updownHorizonMinutes,
  upTokenId,
  type ClobBook,
  type GammaMarket,
} from "./polymarket.ts";
import { surfaceSampleMinute } from "./polymarket-state-features.ts";
import { chainlinkAt, chainlinkNow, RTDS_FRESH_SEC } from "./rtds.ts";
import { getSetting } from "./config.ts";

export const CROSS_HORIZON_BUNDLE_AUDIT = {
  version: "cross-horizon-nested-strike-audit-v1",
  evalStartMs: 1_784_788_800_000, // 2026-07-23 06:40:00 UTC
  sharesPerLeg: 5,
  maxFetchSpanMs: 1_000,
  minRemainingSec: 60,
  minRows: 500,
  minCommonCloses: 100,
  minSpanDays: 3,
  bootstrapIterations: 1_000,
  conservativeEdge: 0.02,
} as const;

export interface FeeCurve {
  rate: number;
  exponent: number;
}

export interface AskWalk {
  shares: number;
  vwap: number;
  grossCost: number;
  feeUsd: number;
  effectiveCost: number;
}

/**
 * Exact equal-share ask walk. Fee parameters are captured from CLOB-v2 market info immediately
 * before the paired books; the official curve is C × r × (p × (1-p))^e at every consumed level.
 */
export function walkAskShares(book: ClobBook, targetShares: number, fee: FeeCurve): AskWalk | null {
  if (
    !Number.isFinite(targetShares)
    || targetShares <= 0
    || !Number.isFinite(fee.rate)
    || fee.rate < 0
    || !Number.isFinite(fee.exponent)
    || fee.exponent <= 0
  ) return null;
  const asks = (book.asks ?? [])
    .map((level) => ({ price: Number(level.price), shares: Number(level.size) }))
    .filter((level) => (
      Number.isFinite(level.price)
      && level.price > 0
      && level.price < 1
      && Number.isFinite(level.shares)
      && level.shares > 0
    ))
    .sort((a, b) => a.price - b.price);

  let shares = 0;
  let grossCost = 0;
  let feeUsd = 0;
  for (const level of asks) {
    const take = Math.min(level.shares, targetShares - shares);
    if (take <= 0) break;
    shares += take;
    grossCost += take * level.price;
    feeUsd += take * fee.rate * Math.pow(level.price * (1 - level.price), fee.exponent);
    if (shares >= targetShares - 1e-9) break;
  }
  if (shares < targetShares - 1e-9) return null;
  return {
    shares: targetShares,
    vwap: grossCost / targetShares,
    grossCost,
    feeUsd,
    effectiveCost: grossCost + feeUsd,
  };
}

function pairOf(question: string): string | null {
  const value = question.toLowerCase();
  if (/bitcoin|\bbtc\b/.test(value)) return "BTC-USD";
  if (/ethereum|\beth\b/.test(value)) return "ETH-USD";
  if (/solana|\bsol\b/.test(value)) return "SOL-USD";
  if (/\bxrp\b/.test(value)) return "XRP-USD";
  if (/dogecoin|\bdoge\b/.test(value)) return "DOGE-USD";
  if (/\bbnb\b/.test(value)) return "BNB-USD";
  return null;
}

interface LiveContract {
  market: GammaMarket;
  pair: string;
  horizonMin: 5 | 15;
  startMs: number;
  endMs: number;
}

function liveContract(market: GammaMarket, now: number): LiveContract | null {
  const pair = pairOf(market.question);
  const horizon = updownHorizonMinutes(market.question);
  const endMs = market.endDate ? new Date(market.endDate).getTime() : NaN;
  if (!pair || (horizon !== 5 && horizon !== 15) || !Number.isFinite(endMs)) return null;
  const startMs = endMs - horizon * 60_000;
  if (now < startMs || endMs - now < CROSS_HORIZON_BUNDLE_AUDIT.minRemainingSec * 1_000) return null;
  return { market, pair, horizonMin: horizon, startMs, endMs };
}

const feeCache = new Map<string, FeeCurve>();

async function feeFor(conditionId: string): Promise<FeeCurve | null> {
  if (!feeCache.has(conditionId)) {
    const info = await fetchClobMarketInfo(conditionId).catch(() => null);
    const rate = Number(info?.fd?.r);
    const exponent = Number(info?.fd?.e);
    if (Number.isFinite(rate) && rate >= 0 && Number.isFinite(exponent) && exponent > 0) {
      feeCache.set(conditionId, { rate, exponent });
    } else {
      return null;
    }
  }
  return feeCache.get(conditionId) ?? null;
}

/**
 * Capture eligible 5m/15m pairs. Fee metadata is fetched first; only the two decision books are
 * inside the measured back-to-back span. Excessive span, stale Chainlink, thin depth, or any missing
 * input fails closed and produces no row.
 */
export async function captureCrossHorizonBundleTick(): Promise<{ captured: number; considered: number }> {
  const now = Date.now();
  if (now < CROSS_HORIZON_BUNDLE_AUDIT.evalStartMs) return { captured: 0, considered: 0 };
  const enabled = await getSetting("polymarket_bundle_tape_enabled");
  if (enabled === "false") return { captured: 0, considered: 0 };
  const live = (await fetchCurrentCryptoUpDown().catch(() => []))
    .map((market) => liveContract(market, now))
    .filter((item): item is LiveContract => item != null);

  const groups = new Map<string, { five?: LiveContract; fifteen?: LiveContract }>();
  for (const contract of live) {
    const key = `${contract.pair}|${contract.endMs}`;
    const group = groups.get(key) ?? {};
    if (contract.horizonMin === 5) group.five = contract;
    else group.fifteen = contract;
    groups.set(key, group);
  }
  const aligned = [...groups.values()].filter(
    (group): group is { five: LiveContract; fifteen: LiveContract } => !!group.five && !!group.fifteen,
  );

  let captured = 0;
  for (const group of aligned) {
    const pair = group.five.pair;
    const current = chainlinkNow(pair);
    if (!current || current.ageSec >= RTDS_FRESH_SEC) continue;
    const fiveStrike = chainlinkAt(pair, group.five.startMs);
    const fifteenStrike = chainlinkAt(pair, group.fifteen.startMs);
    if (fiveStrike == null || fifteenStrike == null || fiveStrike === fifteenStrike) continue;

    const lower = fiveStrike < fifteenStrike ? group.five : group.fifteen;
    const higher = fiveStrike < fifteenStrike ? group.fifteen : group.five;
    const lowerStrike = Math.min(fiveStrike, fifteenStrike);
    const higherStrike = Math.max(fiveStrike, fifteenStrike);
    const lowerToken = upTokenId(lower.market);
    const higherToken = downTokenId(higher.market);
    if (!lowerToken || !higherToken) continue;

    const lowerFee = await feeFor(lower.market.conditionId);
    const higherFee = await feeFor(higher.market.conditionId);
    if (!lowerFee || !higherFee) continue;

    const fetchStartedMs = Date.now();
    const lowerBook = await fetchClobBook(lowerToken).catch(() => null);
    const lowerFetchedMs = Date.now();
    if (!lowerBook) continue;
    const higherBook = await fetchClobBook(higherToken).catch(() => null);
    const higherFetchedMs = Date.now();
    if (!higherBook || higherFetchedMs - fetchStartedMs > CROSS_HORIZON_BUNDLE_AUDIT.maxFetchSpanMs) continue;

    const lowerWalk = walkAskShares(lowerBook, CROSS_HORIZON_BUNDLE_AUDIT.sharesPerLeg, lowerFee);
    const higherWalk = walkAskShares(higherBook, CROSS_HORIZON_BUNDLE_AUDIT.sharesPerLeg, higherFee);
    if (!lowerWalk || !higherWalk) continue;

    const grossPerShare = (lowerWalk.grossCost + higherWalk.grossCost)
      / CROSS_HORIZON_BUNDLE_AUDIT.sharesPerLeg;
    const effectivePerShare = (lowerWalk.effectiveCost + higherWalk.effectiveCost)
      / CROSS_HORIZON_BUNDLE_AUDIT.sharesPerLeg;
    const sampleMinute = surfaceSampleMinute(group.five.startMs, fetchStartedMs);
    if (sampleMinute < 0) continue;

    const inserted = await db
      .insert(polymarketBundleSnapshots)
      .values({
        pair,
        endDate: new Date(group.five.endMs),
        capturedAt: new Date(higherFetchedMs),
        fetchStartedAt: new Date(fetchStartedMs),
        lowerLegFetchedAt: new Date(lowerFetchedMs),
        higherLegFetchedAt: new Date(higherFetchedMs),
        fetchSpanMs: higherFetchedMs - fetchStartedMs,
        sampleMinute,
        remainingSec: Math.max(0, Math.floor((group.five.endMs - higherFetchedMs) / 1_000)),
        lowerConditionId: lower.market.conditionId,
        higherConditionId: higher.market.conditionId,
        lowerHorizonMin: lower.horizonMin,
        higherHorizonMin: higher.horizonMin,
        lowerStrike,
        higherStrike,
        lowerUpTokenId: lowerToken,
        higherDownTokenId: higherToken,
        sharesPerLeg: CROSS_HORIZON_BUNDLE_AUDIT.sharesPerLeg,
        lowerUpVwap: lowerWalk.vwap,
        higherDownVwap: higherWalk.vwap,
        lowerUpGrossCost: lowerWalk.grossCost,
        higherDownGrossCost: higherWalk.grossCost,
        lowerFeeRate: lowerFee.rate,
        lowerFeeExponent: lowerFee.exponent,
        higherFeeRate: higherFee.rate,
        higherFeeExponent: higherFee.exponent,
        lowerFeeUsd: lowerWalk.feeUsd,
        higherFeeUsd: higherWalk.feeUsd,
        grossBundleCostPerShare: grossPerShare,
        effectiveBundleCostPerShare: effectivePerShare,
        bundleEdge: 1 - effectivePerShare,
      })
      .onConflictDoNothing()
      .returning({ id: polymarketBundleSnapshots.id });
    captured += inserted.length;
  }
  return { captured, considered: aligned.length };
}

export function crossHorizonBundleReady(rows: number, commonCloses: number, spanDays: number): boolean {
  return rows >= CROSS_HORIZON_BUNDLE_AUDIT.minRows
    && commonCloses >= CROSS_HORIZON_BUNDLE_AUDIT.minCommonCloses
    && spanDays >= CROSS_HORIZON_BUNDLE_AUDIT.minSpanDays;
}

export interface BundleAuditPoint {
  id: number;
  pair: string;
  endDateMs: number;
  capturedAtMs: number;
  grossCost: number;
  effectiveCost: number;
  edge: number;
}

function quantile(sorted: number[], probability: number): number | null {
  return sorted.length ? sorted[Math.floor(probability * (sorted.length - 1))] : null;
}

function summarize(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  return {
    min: ordered[0] ?? null,
    p05: quantile(ordered, 0.05),
    p25: quantile(ordered, 0.25),
    median: quantile(ordered, 0.5),
    p75: quantile(ordered, 0.75),
    p95: quantile(ordered, 0.95),
    max: ordered[ordered.length - 1] ?? null,
  };
}

function hashSeed(text: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function opportunityRateCi(points: BundleAuditPoint[]): readonly [number | null, number | null] {
  const clusters = new Map<string, BundleAuditPoint[]>();
  for (const point of points) {
    const key = `${point.pair}|${point.endDateMs}`;
    const rows = clusters.get(key) ?? [];
    rows.push(point);
    clusters.set(key, rows);
  }
  const blocks = [...clusters.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, rows]) => rows);
  if (blocks.length < 2) return [null, null];
  const random = mulberry32(hashSeed(
    `${CROSS_HORIZON_BUNDLE_AUDIT.version}|${points.length}|${blocks.length}`,
  ));
  const estimates: number[] = [];
  for (let iteration = 0; iteration < CROSS_HORIZON_BUNDLE_AUDIT.bootstrapIterations; iteration++) {
    let positive = 0;
    let total = 0;
    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[Math.floor(random() * blocks.length)];
      total += block.length;
      positive += block.filter((point) => point.edge > 0).length;
    }
    if (total) estimates.push(positive / total);
  }
  estimates.sort((a, b) => a - b);
  return [quantile(estimates, 0.025), quantile(estimates, 0.975)];
}

export function computeCrossHorizonBundleReport(points: BundleAuditPoint[]) {
  const valid = points
    .filter((point) => (
      Number.isFinite(point.endDateMs)
      && Number.isFinite(point.capturedAtMs)
      && Number.isFinite(point.grossCost)
      && Number.isFinite(point.effectiveCost)
      && Number.isFinite(point.edge)
    ))
    .sort((a, b) => a.capturedAtMs - b.capturedAtMs || a.id - b.id);
  const positive = valid.filter((point) => point.edge > 0);
  const conservative = valid.filter((point) => point.edge >= CROSS_HORIZON_BUNDLE_AUDIT.conservativeEdge);
  const positiveByClose = new Map<string, number>();
  for (const point of positive) {
    const key = `${point.pair}|${point.endDateMs}`;
    positiveByClose.set(key, (positiveByClose.get(key) ?? 0) + 1);
  }
  return {
    rows: valid.length,
    grossCostPerShare: summarize(valid.map((point) => point.grossCost)),
    effectiveCostPerShare: summarize(valid.map((point) => point.effectiveCost)),
    belowOne: {
      rows: positive.length,
      rate: valid.length ? positive.length / valid.length : null,
      commonCloses: positiveByClose.size,
      maxTicksPerClose: positiveByClose.size ? Math.max(...positiveByClose.values()) : 0,
      rateCi95: opportunityRateCi(valid),
    },
    atLeastTwoCentEdge: {
      rows: conservative.length,
      rate: valid.length ? conservative.length / valid.length : null,
    },
  };
}

/**
 * Disclosure-locked public audit. The first query selects only counts and time bounds; costs and
 * signs remain unreachable until every preregistered readiness floor passes.
 */
export async function crossHorizonBundleAudit() {
  const boundary = new Date(CROSS_HORIZON_BUNDLE_AUDIT.evalStartMs);
  const [aggregate] = await db
    .select({
      rows: sql<number>`count(*)::int`,
      commonCloses: sql<number>`count(distinct (
        ${polymarketBundleSnapshots.pair},
        ${polymarketBundleSnapshots.endDate}
      ))::int`,
      firstCapture: sql<Date | null>`min(${polymarketBundleSnapshots.capturedAt})`,
      lastCapture: sql<Date | null>`max(${polymarketBundleSnapshots.capturedAt})`,
    })
    .from(polymarketBundleSnapshots)
    .where(gte(polymarketBundleSnapshots.capturedAt, boundary));
  const rows = Number(aggregate?.rows ?? 0);
  const commonCloses = Number(aggregate?.commonCloses ?? 0);
  const firstCaptureMs = aggregate?.firstCapture ? new Date(aggregate.firstCapture).getTime() : null;
  const lastCaptureMs = aggregate?.lastCapture ? new Date(aggregate.lastCapture).getTime() : null;
  const spanDays = firstCaptureMs != null && lastCaptureMs != null
    ? (lastCaptureMs - firstCaptureMs) / 86_400_000
    : 0;
  const ready = crossHorizonBundleReady(rows, commonCloses, spanDays);
  const status = {
    version: CROSS_HORIZON_BUNDLE_AUDIT.version,
    evalStartMs: CROSS_HORIZON_BUNDLE_AUDIT.evalStartMs,
    minRows: CROSS_HORIZON_BUNDLE_AUDIT.minRows,
    minCommonCloses: CROSS_HORIZON_BUNDLE_AUDIT.minCommonCloses,
    minSpanDays: CROSS_HORIZON_BUNDLE_AUDIT.minSpanDays,
    rows,
    commonCloses,
    spanDays,
    firstCaptureMs,
    lastCaptureMs,
    ready,
  };
  if (!ready) return { ...status, report: null };

  const data = await db
    .select({
      id: polymarketBundleSnapshots.id,
      pair: polymarketBundleSnapshots.pair,
      endDate: polymarketBundleSnapshots.endDate,
      capturedAt: polymarketBundleSnapshots.capturedAt,
      grossCost: polymarketBundleSnapshots.grossBundleCostPerShare,
      effectiveCost: polymarketBundleSnapshots.effectiveBundleCostPerShare,
      edge: polymarketBundleSnapshots.bundleEdge,
    })
    .from(polymarketBundleSnapshots)
    .where(gte(polymarketBundleSnapshots.capturedAt, boundary));
  return {
    ...status,
    report: computeCrossHorizonBundleReport(data.map((row) => ({
      id: row.id,
      pair: row.pair,
      endDateMs: new Date(row.endDate).getTime(),
      capturedAtMs: new Date(row.capturedAt).getTime(),
      grossCost: row.grossCost,
      effectiveCost: row.effectiveCost,
      edge: row.edge,
    }))),
  };
}
