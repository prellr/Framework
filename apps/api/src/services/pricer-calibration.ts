/**
 * Forward-only probability-calibration audit (KB: updown-pricer-calibration-audit-v1).
 *
 * This compares the existing digital BSM probability with the contemporaneous UP-book midpoint
 * at one prespecified midpoint sample per resolved market. It is an audit, not a strategy: before
 * every frozen readiness floor is met, the public surface returns collection counts only. No paper
 * bot imports this module and this module has no execution path.
 */
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db, polymarketStateSnapshots } from "@framework/db";
import { digitalPupBSM } from "./pricer.ts";

export const PRICER_CALIBRATION_AUDIT = {
  version: "updown-pricer-calibration-audit-v1",
  evalStartMs: 1_784_788_200_000, // 2026-07-23 06:30:00 UTC
  minObservations: 1_000,
  minSpanDays: 5,
  minClusters: 500,
  clusterMs: 5 * 60_000,
  bootstrapIterations: 1_000,
  logClampLo: 0.005,
  logClampHi: 0.995,
  bins: 10,
} as const;

export interface CalibrationPoint {
  id: string;
  windowStartMs: number;
  pModel: number;
  pBook: number;
  resolvedUp: boolean;
}

interface ScorePair {
  model: number;
  book: number;
  difference: number;
}

/** Exact elapsed-minute sample fixed before collection: 5m→2, 15m→7, 60m→30. */
export function calibrationSampleMinute(horizonMin: number): number {
  return Math.floor(horizonMin / 2);
}

export function brierLoss(probability: number, outcome: boolean): number {
  const error = probability - (outcome ? 1 : 0);
  return error * error;
}

export function logLoss(probability: number, outcome: boolean): number {
  const p = Math.min(
    PRICER_CALIBRATION_AUDIT.logClampHi,
    Math.max(PRICER_CALIBRATION_AUDIT.logClampLo, probability),
  );
  return outcome ? -Math.log(p) : -Math.log(1 - p);
}

export function pricerCalibrationReady(
  observations: number,
  spanDays: number,
  clusters: number,
): boolean {
  return observations >= PRICER_CALIBRATION_AUDIT.minObservations
    && spanDays >= PRICER_CALIBRATION_AUDIT.minSpanDays
    && clusters >= PRICER_CALIBRATION_AUDIT.minClusters;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function hashSeed(text: string): number {
  let hash = 2_166_136_261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
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

function quantile(sorted: number[], probability: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.floor(probability * (sorted.length - 1))];
}

function bootstrapPairedDifferences(
  points: CalibrationPoint[],
  score: (probability: number, outcome: boolean) => number,
  seedLabel: string,
): readonly [number | null, number | null] {
  const clusters = new Map<number, ScorePair[]>();
  for (const point of points) {
    const key = Math.floor(point.windowStartMs / PRICER_CALIBRATION_AUDIT.clusterMs);
    const rows = clusters.get(key) ?? [];
    const model = score(point.pModel, point.resolvedUp);
    const book = score(point.pBook, point.resolvedUp);
    rows.push({ model, book, difference: model - book });
    clusters.set(key, rows);
  }
  const blocks = [...clusters.entries()].sort(([a], [b]) => a - b).map(([, rows]) => rows);
  if (blocks.length < 2) return [null, null];

  const random = mulberry32(hashSeed(
    `${PRICER_CALIBRATION_AUDIT.version}|${seedLabel}|${points.length}|${blocks.length}`,
  ));
  const estimates: number[] = [];
  for (let iteration = 0; iteration < PRICER_CALIBRATION_AUDIT.bootstrapIterations; iteration++) {
    let total = 0;
    let count = 0;
    for (let i = 0; i < blocks.length; i++) {
      const picked = blocks[Math.floor(random() * blocks.length)];
      for (const row of picked) {
        total += row.difference;
        count++;
      }
    }
    if (count) estimates.push(total / count);
  }
  estimates.sort((a, b) => a - b);
  return [quantile(estimates, 0.025), quantile(estimates, 0.975)];
}

function reliability(points: CalibrationPoint[], field: "pModel" | "pBook") {
  const bins = Array.from({ length: PRICER_CALIBRATION_AUDIT.bins }, (_, index) => ({
    lower: index / PRICER_CALIBRATION_AUDIT.bins,
    upper: (index + 1) / PRICER_CALIBRATION_AUDIT.bins,
    observations: 0,
    meanForecast: 0,
    observedUpRate: 0,
  }));
  const upCounts = new Array(PRICER_CALIBRATION_AUDIT.bins).fill(0) as number[];
  for (const point of points) {
    const probability = Math.min(1, Math.max(0, point[field]));
    const index = Math.min(
      PRICER_CALIBRATION_AUDIT.bins - 1,
      Math.floor(probability * PRICER_CALIBRATION_AUDIT.bins),
    );
    bins[index].observations++;
    bins[index].meanForecast += probability;
    if (point.resolvedUp) upCounts[index]++;
  }
  return bins.map((bin, index) => ({
    ...bin,
    meanForecast: bin.observations ? bin.meanForecast / bin.observations : null,
    observedUpRate: bin.observations ? upCounts[index] / bin.observations : null,
  }));
}

/** Frozen pooled report. Negative paired differences mean BSM scores better than the book. */
export function computePricerCalibrationReport(points: CalibrationPoint[]) {
  const ordered = points
    .filter((point) => (
      Number.isFinite(point.windowStartMs)
      && Number.isFinite(point.pModel)
      && Number.isFinite(point.pBook)
      && point.pModel >= 0
      && point.pModel <= 1
      && point.pBook >= 0
      && point.pBook <= 1
    ))
    .sort((a, b) => a.windowStartMs - b.windowStartMs || a.id.localeCompare(b.id));
  const brier = ordered.map((point) => ({
    model: brierLoss(point.pModel, point.resolvedUp),
    book: brierLoss(point.pBook, point.resolvedUp),
  }));
  const logarithmic = ordered.map((point) => ({
    model: logLoss(point.pModel, point.resolvedUp),
    book: logLoss(point.pBook, point.resolvedUp),
  }));
  const modelBrier = mean(brier.map((row) => row.model));
  const bookBrier = mean(brier.map((row) => row.book));
  const modelLogLoss = mean(logarithmic.map((row) => row.model));
  const bookLogLoss = mean(logarithmic.map((row) => row.book));
  return {
    observations: ordered.length,
    scoringConvention: "model-minus-book; negative is better for BSM" as const,
    brier: {
      model: modelBrier,
      book: bookBrier,
      difference: modelBrier != null && bookBrier != null ? modelBrier - bookBrier : null,
      differenceCi95: bootstrapPairedDifferences(ordered, brierLoss, "brier"),
    },
    logarithmic: {
      model: modelLogLoss,
      book: bookLogLoss,
      difference: modelLogLoss != null && bookLogLoss != null ? modelLogLoss - bookLogLoss : null,
      differenceCi95: bootstrapPairedDifferences(ordered, logLoss, "logarithmic"),
    },
    modelReliability: reliability(ordered, "pModel"),
    bookReliability: reliability(ordered, "pBook"),
  };
}

const eligible = and(
  gte(polymarketStateSnapshots.windowStart, new Date(PRICER_CALIBRATION_AUDIT.evalStartMs)),
  eq(polymarketStateSnapshots.labelStatus, "resolved"),
  eq(polymarketStateSnapshots.referenceSource, "chainlink"),
  isNotNull(polymarketStateSnapshots.resolvedUp),
  sql`${polymarketStateSnapshots.pair} in ('BTC-USD','ETH-USD','SOL-USD','XRP-USD','DOGE-USD','BNB-USD')`,
  sql`${polymarketStateSnapshots.horizonMin} in (5,15,60)`,
  sql`${polymarketStateSnapshots.sampleMinute}
    = floor(${polymarketStateSnapshots.horizonMin}::numeric / 2)::int`,
  sql`${polymarketStateSnapshots.chainlinkSpot} > 0`,
  sql`${polymarketStateSnapshots.chainlinkStrike} > 0`,
  sql`${polymarketStateSnapshots.sigmaPerMin} > 0`,
  sql`${polymarketStateSnapshots.remainingSec} > 0`,
  sql`${polymarketStateSnapshots.upBid} > 0`,
  sql`${polymarketStateSnapshots.upAsk} < 1`,
  sql`${polymarketStateSnapshots.upBid} <= ${polymarketStateSnapshots.upAsk}`,
);

/**
 * Public readiness-locked audit. The first query never selects outcomes or probabilities. The
 * outcome-bearing query is unreachable until all three frozen floors pass.
 */
export async function pricerCalibrationAudit() {
  const [aggregate] = await db
    .select({
      observations: sql<number>`count(*)::int`,
      markets: sql<number>`count(distinct ${polymarketStateSnapshots.conditionId})::int`,
      clusters: sql<number>`count(distinct floor(
        extract(epoch from ${polymarketStateSnapshots.windowStart}) * 1000
        / ${PRICER_CALIBRATION_AUDIT.clusterMs}
      ))::int`,
      firstWindow: sql<Date | null>`min(${polymarketStateSnapshots.windowStart})`,
      lastWindow: sql<Date | null>`max(${polymarketStateSnapshots.windowStart})`,
    })
    .from(polymarketStateSnapshots)
    .where(eligible);
  const observations = Number(aggregate?.observations ?? 0);
  const markets = Number(aggregate?.markets ?? 0);
  const clusters = Number(aggregate?.clusters ?? 0);
  const firstWindowMs = aggregate?.firstWindow ? new Date(aggregate.firstWindow).getTime() : null;
  const lastWindowMs = aggregate?.lastWindow ? new Date(aggregate.lastWindow).getTime() : null;
  const spanDays = firstWindowMs != null && lastWindowMs != null
    ? (lastWindowMs - firstWindowMs) / 86_400_000
    : 0;
  const ready = pricerCalibrationReady(observations, spanDays, clusters);
  const status = {
    version: PRICER_CALIBRATION_AUDIT.version,
    evalStartMs: PRICER_CALIBRATION_AUDIT.evalStartMs,
    minObservations: PRICER_CALIBRATION_AUDIT.minObservations,
    minSpanDays: PRICER_CALIBRATION_AUDIT.minSpanDays,
    minClusters: PRICER_CALIBRATION_AUDIT.minClusters,
    observations,
    markets,
    clusters,
    spanDays,
    firstWindowMs,
    lastWindowMs,
    ready,
  };
  if (!ready) return { ...status, report: null };

  const rows = await db
    .select({
      conditionId: polymarketStateSnapshots.conditionId,
      windowStart: polymarketStateSnapshots.windowStart,
      remainingSec: polymarketStateSnapshots.remainingSec,
      chainlinkSpot: polymarketStateSnapshots.chainlinkSpot,
      chainlinkStrike: polymarketStateSnapshots.chainlinkStrike,
      sigmaPerMin: polymarketStateSnapshots.sigmaPerMin,
      upBid: polymarketStateSnapshots.upBid,
      upAsk: polymarketStateSnapshots.upAsk,
      resolvedUp: polymarketStateSnapshots.resolvedUp,
    })
    .from(polymarketStateSnapshots)
    .where(eligible);
  const points: CalibrationPoint[] = rows.map((row) => ({
    id: row.conditionId,
    windowStartMs: new Date(row.windowStart).getTime(),
    pModel: digitalPupBSM(
      Number(row.chainlinkSpot),
      Number(row.chainlinkStrike),
      Number(row.sigmaPerMin),
      Number(row.remainingSec) / 60,
    ),
    pBook: (Number(row.upBid) + Number(row.upAsk)) / 2,
    resolvedUp: Boolean(row.resolvedUp),
  }));
  return { ...status, report: computePricerCalibrationReport(points) };
}
