/**
 * Prospective complete-set taker audit (KB `updown-complete-set-taker-audit-v1`).
 *
 * Equal quantities of both binary outcomes can be merged into one unit of collateral. This service
 * observes exact, fee-adjusted five-share ask walks returned by one public batch-book request. It
 * stores no outcomes and has no order, wallet, merge, or execution path.
 */
import { gte, sql } from "drizzle-orm";
import { db, polymarketCompleteSetSnapshots } from "@framework/db";
import { walkAskShares, type FeeCurve } from "./cross-horizon-bundle.ts";
import { getSetting } from "./config.ts";
import {
  downTokenId,
  fetchClobBooks,
  fetchClobMarketInfo,
  fetchCurrentCryptoUpDown,
  updownHorizonMinutes,
  upTokenId,
  type GammaMarket,
} from "./polymarket.ts";
import { surfaceSampleMinute } from "./polymarket-state-features.ts";
import { createAsyncTtlCache } from "./async-ttl-cache.ts";

export const COMPLETE_SET_TAKER_AUDIT = {
  version: "updown-complete-set-taker-audit-v1",
  evalStartMs: Date.UTC(2026, 6, 23, 15, 0, 0),
  pairs: ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD", "BNB-USD"],
  horizonsMin: [5, 15],
  sharesPerLeg: 5,
  maxRequestDurationMs: 1_000,
  minRemainingSec: 60,
  minRows: 1_500,
  minMarkets: 500,
  minSpanDays: 3,
  bootstrapIterations: 1_000,
  conservativePreGasEdge: 0.02,
  readinessCacheMs: 60_000,
  reportCacheMs: 15 * 60_000,
} as const;

/**
 * Frozen before the audit's result surface unlocked. These are descriptive execution-feasibility
 * cuts, not strategy parameters: every registered asset × horizon × causal minute is retained,
 * including empty buckets, and persistence never substitutes for atomic execution or a gas quote.
 */
export const COMPLETE_SET_SEGMENTATION = {
  version: "updown-complete-set-segmentation-plan-v1",
  pairs: COMPLETE_SET_TAKER_AUDIT.pairs,
  horizonsMin: COMPLETE_SET_TAKER_AUDIT.horizonsMin,
  requiredBuckets: COMPLETE_SET_TAKER_AUDIT.pairs.reduce(
    (total, _pair) =>
      total + COMPLETE_SET_TAKER_AUDIT.horizonsMin.reduce(
        (horizonTotal, horizonMin) => horizonTotal + horizonMin,
        0,
      ),
    0,
  ),
  persistenceRuns: [2, 3] as const,
  thresholds: {
    belowOne: 0,
    conservativePreGas: COMPLETE_SET_TAKER_AUDIT.conservativePreGasEdge,
  },
} as const;

interface LiveCompleteSetMarket {
  market: GammaMarket;
  pair: string;
  horizonMin: 5 | 15;
  startMs: number;
  endMs: number;
}

export interface CompleteSetAuditPoint {
  id: number;
  conditionId: string;
  pair: string;
  horizonMin: number;
  sampleMinute: number;
  capturedAtMs: number;
  grossCost: number;
  effectiveCost: number;
  preGasEdge: number;
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

function eligibleMarket(market: GammaMarket, nowMs: number): LiveCompleteSetMarket | null {
  const pair = pairOf(market.question);
  const horizon = updownHorizonMinutes(market.question);
  const endMs = market.endDate ? new Date(market.endDate).getTime() : NaN;
  if (
    !pair
    || !COMPLETE_SET_TAKER_AUDIT.pairs.includes(pair as typeof COMPLETE_SET_TAKER_AUDIT.pairs[number])
    || (horizon !== 5 && horizon !== 15)
    || !Number.isFinite(endMs)
  ) return null;
  const startMs = endMs - horizon * 60_000;
  if (
    nowMs < startMs
    || endMs - nowMs < COMPLETE_SET_TAKER_AUDIT.minRemainingSec * 1_000
  ) return null;
  return { market, pair, horizonMin: horizon, startMs, endMs };
}

const feeCache = new Map<string, FeeCurve>();

async function feeFor(conditionId: string): Promise<FeeCurve | null> {
  if (!feeCache.has(conditionId)) {
    const info = await fetchClobMarketInfo(conditionId).catch(() => null);
    const rate = Number(info?.fd?.r);
    const exponent = Number(info?.fd?.e);
    if (!Number.isFinite(rate) || rate < 0 || !Number.isFinite(exponent) || exponent <= 0) return null;
    feeCache.set(conditionId, { rate, exponent });
  }
  return feeCache.get(conditionId) ?? null;
}

/**
 * One public-data capture pass. The two outcome books are returned by one official batch request;
 * any missing orientation, excessive request duration, or thin side fails closed.
 */
export async function captureCompleteSetTakerTick(): Promise<{ captured: number; considered: number }> {
  const nowMs = Date.now();
  if (nowMs < COMPLETE_SET_TAKER_AUDIT.evalStartMs) return { captured: 0, considered: 0 };
  if (await getSetting("polymarket_complete_set_tape_enabled") === "false") {
    return { captured: 0, considered: 0 };
  }
  const live = (await fetchCurrentCryptoUpDown().catch(() => []))
    .map((market) => eligibleMarket(market, nowMs))
    .filter((market): market is LiveCompleteSetMarket => market != null);

  let captured = 0;
  for (const item of live) {
    const upToken = upTokenId(item.market);
    const downToken = downTokenId(item.market);
    if (!upToken || !downToken || upToken === downToken) continue;
    const fee = await feeFor(item.market.conditionId);
    if (!fee) continue;

    const requestStartedMs = Date.now();
    const books = await fetchClobBooks([upToken, downToken]).catch(() => []);
    const capturedAtMs = Date.now();
    const requestDurationMs = capturedAtMs - requestStartedMs;
    if (requestDurationMs > COMPLETE_SET_TAKER_AUDIT.maxRequestDurationMs) continue;
    const byToken = new Map(books.map((book) => [String(book.asset_id), book]));
    const upBook = byToken.get(upToken);
    const downBook = byToken.get(downToken);
    if (!upBook || !downBook) continue;

    const upWalk = walkAskShares(upBook, COMPLETE_SET_TAKER_AUDIT.sharesPerLeg, fee);
    const downWalk = walkAskShares(downBook, COMPLETE_SET_TAKER_AUDIT.sharesPerLeg, fee);
    if (!upWalk || !downWalk) continue;
    const sampleMinute = surfaceSampleMinute(item.startMs, requestStartedMs);
    if (sampleMinute < 0) continue;

    const grossCostPerShare = (
      upWalk.grossCost + downWalk.grossCost
    ) / COMPLETE_SET_TAKER_AUDIT.sharesPerLeg;
    const effectiveCostPerShare = (
      upWalk.effectiveCost + downWalk.effectiveCost
    ) / COMPLETE_SET_TAKER_AUDIT.sharesPerLeg;
    const inserted = await db
      .insert(polymarketCompleteSetSnapshots)
      .values({
        conditionId: item.market.conditionId,
        slug: item.market.slug,
        pair: item.pair,
        horizonMin: item.horizonMin,
        windowStart: new Date(item.startMs),
        endDate: new Date(item.endMs),
        capturedAt: new Date(capturedAtMs),
        requestStartedAt: new Date(requestStartedMs),
        requestDurationMs,
        sampleMinute,
        remainingSec: Math.max(0, Math.floor((item.endMs - capturedAtMs) / 1_000)),
        upTokenId: upToken,
        downTokenId: downToken,
        sharesPerLeg: COMPLETE_SET_TAKER_AUDIT.sharesPerLeg,
        upVwap: upWalk.vwap,
        downVwap: downWalk.vwap,
        upGrossCost: upWalk.grossCost,
        downGrossCost: downWalk.grossCost,
        feeRate: fee.rate,
        feeExponent: fee.exponent,
        upFeeUsd: upWalk.feeUsd,
        downFeeUsd: downWalk.feeUsd,
        grossCostPerShare,
        effectiveCostPerShare,
        preGasMergeEdge: 1 - effectiveCostPerShare,
      })
      .onConflictDoNothing()
      .returning({ id: polymarketCompleteSetSnapshots.id });
    captured += inserted.length;
  }
  return { captured, considered: live.length };
}

export function completeSetTakerReady(rows: number, markets: number, spanDays: number): boolean {
  return rows >= COMPLETE_SET_TAKER_AUDIT.minRows
    && markets >= COMPLETE_SET_TAKER_AUDIT.minMarkets
    && spanDays >= COMPLETE_SET_TAKER_AUDIT.minSpanDays;
}

function quantile(sorted: number[], probability: number): number | null {
  return sorted.length ? sorted[Math.floor(probability * (sorted.length - 1))] : null;
}

function summarize(values: number[]) {
  const ordered = [...values].sort((left, right) => left - right);
  return {
    min: ordered[0] ?? null,
    p05: quantile(ordered, 0.05),
    p25: quantile(ordered, 0.25),
    median: quantile(ordered, 0.5),
    p75: quantile(ordered, 0.75),
    p95: quantile(ordered, 0.95),
    max: ordered.at(-1) ?? null,
  };
}

function completeSetBucketPoints(points: CompleteSetAuditPoint[]) {
  const grouped = new Map<string, CompleteSetAuditPoint[]>();
  for (const point of points) {
    const key = `${point.pair}|${point.horizonMin}|${point.sampleMinute}`;
    const rows = grouped.get(key) ?? [];
    rows.push(point);
    grouped.set(key, rows);
  }
  return COMPLETE_SET_SEGMENTATION.pairs.flatMap((pair) =>
    COMPLETE_SET_SEGMENTATION.horizonsMin.flatMap((horizonMin) =>
      Array.from({ length: horizonMin }, (_, sampleMinute) => {
        const rows = grouped.get(`${pair}|${horizonMin}|${sampleMinute}`) ?? [];
        const belowOne = rows.filter(
          (point) => point.preGasEdge > COMPLETE_SET_SEGMENTATION.thresholds.belowOne,
        );
        const conservative = rows.filter(
          (point) =>
            point.preGasEdge >= COMPLETE_SET_SEGMENTATION.thresholds.conservativePreGas,
        );
        return {
          pair,
          horizonMin,
          sampleMinute,
          rows: rows.length,
          markets: new Set(rows.map((point) => point.conditionId)).size,
          effectiveCostPerShare: summarize(rows.map((point) => point.effectiveCost)),
          belowOne: {
            rows: belowOne.length,
            rate: rows.length ? belowOne.length / rows.length : null,
            markets: new Set(belowOne.map((point) => point.conditionId)).size,
          },
          atLeastTwoCentPreGasEdge: {
            rows: conservative.length,
            rate: rows.length ? conservative.length / rows.length : null,
            markets: new Set(conservative.map((point) => point.conditionId)).size,
          },
        };
      })
    )
  );
}

function maxConsecutiveQualifying(
  points: CompleteSetAuditPoint[],
  qualifies: (point: CompleteSetAuditPoint) => boolean,
): number {
  const byMinute = new Map<number, CompleteSetAuditPoint>();
  for (const point of points) byMinute.set(point.sampleMinute, point);
  const ordered = [...byMinute.values()].sort(
    (left, right) => left.sampleMinute - right.sampleMinute || left.id - right.id,
  );
  let current = 0;
  let maximum = 0;
  let previousMinute: number | null = null;
  for (const point of ordered) {
    if (!qualifies(point)) {
      current = 0;
      previousMinute = point.sampleMinute;
      continue;
    }
    current = previousMinute != null && point.sampleMinute === previousMinute + 1
      ? current + 1
      : 1;
    maximum = Math.max(maximum, current);
    previousMinute = point.sampleMinute;
  }
  return maximum;
}

function persistenceSummary(
  points: CompleteSetAuditPoint[],
  qualifies: (point: CompleteSetAuditPoint) => boolean,
) {
  const byMarket = new Map<string, CompleteSetAuditPoint[]>();
  for (const point of points) {
    const rows = byMarket.get(point.conditionId) ?? [];
    rows.push(point);
    byMarket.set(point.conditionId, rows);
  }
  const runs = [...byMarket.values()].map((rows) => maxConsecutiveQualifying(rows, qualifies));
  return {
    markets: runs.filter((run) => run >= 1).length,
    marketsWithTwoConsecutive: runs.filter(
      (run) => run >= COMPLETE_SET_SEGMENTATION.persistenceRuns[0],
    ).length,
    marketsWithThreeConsecutive: runs.filter(
      (run) => run >= COMPLETE_SET_SEGMENTATION.persistenceRuns[1],
    ).length,
    maxConsecutive: runs.length ? Math.max(...runs) : 0,
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

function opportunityRateCi(points: CompleteSetAuditPoint[]): readonly [number | null, number | null] {
  const clusters = new Map<string, CompleteSetAuditPoint[]>();
  for (const point of points) {
    const rows = clusters.get(point.conditionId) ?? [];
    rows.push(point);
    clusters.set(point.conditionId, rows);
  }
  const blocks = [...clusters.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([, rows]) => rows);
  if (blocks.length < 2) return [null, null];
  const random = mulberry32(hashSeed(
    `${COMPLETE_SET_TAKER_AUDIT.version}|${points.length}|${blocks.length}`,
  ));
  const estimates: number[] = [];
  for (let iteration = 0; iteration < COMPLETE_SET_TAKER_AUDIT.bootstrapIterations; iteration++) {
    let positive = 0;
    let total = 0;
    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[Math.floor(random() * blocks.length)]!;
      positive += block.filter((point) => point.preGasEdge > 0).length;
      total += block.length;
    }
    if (total) estimates.push(positive / total);
  }
  estimates.sort((left, right) => left - right);
  return [quantile(estimates, 0.025), quantile(estimates, 0.975)];
}

export function computeCompleteSetTakerReport(points: CompleteSetAuditPoint[]) {
  const valid = points
    .filter((point) => (
      point.conditionId
      && COMPLETE_SET_SEGMENTATION.pairs.includes(
        point.pair as (typeof COMPLETE_SET_SEGMENTATION.pairs)[number],
      )
      && COMPLETE_SET_SEGMENTATION.horizonsMin.includes(
        point.horizonMin as (typeof COMPLETE_SET_SEGMENTATION.horizonsMin)[number],
      )
      && Number.isInteger(point.sampleMinute)
      && point.sampleMinute >= 0
      && point.sampleMinute < point.horizonMin
      && Number.isFinite(point.capturedAtMs)
      && Number.isFinite(point.grossCost)
      && Number.isFinite(point.effectiveCost)
      && Number.isFinite(point.preGasEdge)
    ))
    .sort((left, right) => left.capturedAtMs - right.capturedAtMs || left.id - right.id);
  const belowOne = valid.filter((point) => point.preGasEdge > 0);
  const conservative = valid.filter(
    (point) => point.preGasEdge >= COMPLETE_SET_TAKER_AUDIT.conservativePreGasEdge,
  );
  const ticksByMarket = new Map<string, number>();
  for (const point of belowOne) {
    ticksByMarket.set(point.conditionId, (ticksByMarket.get(point.conditionId) ?? 0) + 1);
  }
  return {
    rows: valid.length,
    grossCostPerShare: summarize(valid.map((point) => point.grossCost)),
    effectiveCostPerShare: summarize(valid.map((point) => point.effectiveCost)),
    belowOne: {
      rows: belowOne.length,
      rate: valid.length ? belowOne.length / valid.length : null,
      markets: ticksByMarket.size,
      maxTicksPerMarket: ticksByMarket.size ? Math.max(...ticksByMarket.values()) : 0,
      rateCi95: opportunityRateCi(valid),
    },
    atLeastTwoCentPreGasEdge: {
      rows: conservative.length,
      rate: valid.length ? conservative.length / valid.length : null,
      markets: new Set(conservative.map((point) => point.conditionId)).size,
    },
    segmentation: {
      version: COMPLETE_SET_SEGMENTATION.version,
      requiredBuckets: COMPLETE_SET_SEGMENTATION.requiredBuckets,
      buckets: completeSetBucketPoints(valid),
    },
    persistence: {
      belowOne: persistenceSummary(
        valid,
        (point) => point.preGasEdge > COMPLETE_SET_SEGMENTATION.thresholds.belowOne,
      ),
      atLeastTwoCentPreGasEdge: persistenceSummary(
        valid,
        (point) =>
          point.preGasEdge >= COMPLETE_SET_SEGMENTATION.thresholds.conservativePreGas,
      ),
    },
  };
}

/** Count/time readiness only. This query cannot disclose any cost or edge value. */
async function loadCompleteSetTakerReadiness() {
  const boundary = new Date(COMPLETE_SET_TAKER_AUDIT.evalStartMs);
  const [aggregate] = await db
    .select({
      rows: sql<number>`count(*)::int`,
      markets: sql<number>`count(distinct ${polymarketCompleteSetSnapshots.conditionId})::int`,
      firstCapture: sql<Date | null>`min(${polymarketCompleteSetSnapshots.capturedAt})`,
      lastCapture: sql<Date | null>`max(${polymarketCompleteSetSnapshots.capturedAt})`,
    })
    .from(polymarketCompleteSetSnapshots)
    .where(gte(polymarketCompleteSetSnapshots.capturedAt, boundary));
  const rows = Number(aggregate?.rows ?? 0);
  const markets = Number(aggregate?.markets ?? 0);
  const firstCaptureMs = aggregate?.firstCapture ? new Date(aggregate.firstCapture).getTime() : null;
  const lastCaptureMs = aggregate?.lastCapture ? new Date(aggregate.lastCapture).getTime() : null;
  const spanDays = firstCaptureMs != null && lastCaptureMs != null
    ? (lastCaptureMs - firstCaptureMs) / 86_400_000
    : 0;
  const ready = completeSetTakerReady(rows, markets, spanDays);
  return {
    version: COMPLETE_SET_TAKER_AUDIT.version,
    evalStartMs: COMPLETE_SET_TAKER_AUDIT.evalStartMs,
    minimums: {
      rows: COMPLETE_SET_TAKER_AUDIT.minRows,
      markets: COMPLETE_SET_TAKER_AUDIT.minMarkets,
      spanDays: COMPLETE_SET_TAKER_AUDIT.minSpanDays,
    },
    sharesPerLeg: COMPLETE_SET_TAKER_AUDIT.sharesPerLeg,
    reportContract: {
      version: COMPLETE_SET_SEGMENTATION.version,
      requiredBuckets: COMPLETE_SET_SEGMENTATION.requiredBuckets,
      persistenceRuns: [...COMPLETE_SET_SEGMENTATION.persistenceRuns],
      thresholds: COMPLETE_SET_SEGMENTATION.thresholds,
    },
    rows,
    markets,
    spanDays,
    firstCaptureMs,
    lastCaptureMs,
    ready,
    resultsLocked: !ready,
  };
}

const readCompleteSetTakerReadiness = createAsyncTtlCache(
  COMPLETE_SET_TAKER_AUDIT.readinessCacheMs,
  loadCompleteSetTakerReadiness,
);

export async function completeSetTakerReadiness() {
  return readCompleteSetTakerReadiness();
}

async function loadCompleteSetTakerReport() {
  const boundary = new Date(COMPLETE_SET_TAKER_AUDIT.evalStartMs);
  const data = await db
    .select({
      id: polymarketCompleteSetSnapshots.id,
      conditionId: polymarketCompleteSetSnapshots.conditionId,
      pair: polymarketCompleteSetSnapshots.pair,
      horizonMin: polymarketCompleteSetSnapshots.horizonMin,
      sampleMinute: polymarketCompleteSetSnapshots.sampleMinute,
      capturedAt: polymarketCompleteSetSnapshots.capturedAt,
      grossCost: polymarketCompleteSetSnapshots.grossCostPerShare,
      effectiveCost: polymarketCompleteSetSnapshots.effectiveCostPerShare,
      preGasEdge: polymarketCompleteSetSnapshots.preGasMergeEdge,
    })
    .from(polymarketCompleteSetSnapshots)
    .where(gte(polymarketCompleteSetSnapshots.capturedAt, boundary));
  return computeCompleteSetTakerReport(data.map((row) => ({
    id: row.id,
    conditionId: row.conditionId,
    pair: row.pair,
    horizonMin: row.horizonMin,
    sampleMinute: row.sampleMinute,
    capturedAtMs: new Date(row.capturedAt).getTime(),
    grossCost: row.grossCost,
    effectiveCost: row.effectiveCost,
    preGasEdge: row.preGasEdge,
  })));
}

const readCompleteSetTakerReport = createAsyncTtlCache(
  COMPLETE_SET_TAKER_AUDIT.reportCacheMs,
  loadCompleteSetTakerReport,
);

/**
 * Disclosure-locked public status. Cost and edge columns are unreachable until every frozen floor
 * passes; the readiness query selects counts and time bounds only.
 */
export async function completeSetTakerAudit() {
  const status = await completeSetTakerReadiness();
  if (!status.ready) return { ...status, report: null };

  return {
    ...status,
    report: await readCompleteSetTakerReport(),
  };
}
