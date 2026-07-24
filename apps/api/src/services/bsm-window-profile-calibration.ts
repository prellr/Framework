/**
 * Prospective, readiness-locked paired proper-score audit for the BTC 5m BSM
 * window-profile child (KB updown-bsm-window-profile-calibration-v1).
 *
 * This module is read-only and is never imported by the paper engine. Before
 * all frozen readiness floors pass, its public surface executes only the
 * aggregate count/timing query and cannot select outcomes or probabilities.
 */
import { and, asc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db, polymarketStateSnapshots } from "@framework/db";
import { digitalPupBSM } from "./pricer.ts";
import { bsmProfileRemainingVarianceMin } from "./bsm-window-profile.ts";

export const BSM_WINDOW_PROFILE_CALIBRATION = {
  version: "updown-bsm-window-profile-calibration-v1",
  evalStartMs: Date.UTC(2026, 6, 23, 11, 30, 0),
  pair: "BTC-USD",
  horizonMin: 5,
  sampleMinute: 2,
  minObservations: 1_000,
  minSpanDays: 5,
  minClusters: 500,
  clusterMs: 5 * 60_000,
  bootstrapIterations: 1_000,
  logClampLo: 0.005,
  logClampHi: 0.995,
} as const;

export interface BsmProfileCalibrationPoint {
  id: string;
  windowStartMs: number;
  parent: number;
  profile: number;
  book: number;
  resolvedUp: boolean;
}

export interface PairedScoreCi {
  mean: number;
  lo: number | null;
  hi: number | null;
  clusters: number;
}

export function bsmWindowProfileCalibrationReady(
  observations: number,
  spanDays: number,
  clusters: number,
): boolean {
  return observations >= BSM_WINDOW_PROFILE_CALIBRATION.minObservations
    && spanDays >= BSM_WINDOW_PROFILE_CALIBRATION.minSpanDays
    && clusters >= BSM_WINDOW_PROFILE_CALIBRATION.minClusters;
}

export function binaryBrierLoss(probability: number, outcome: boolean): number {
  const error = probability - (outcome ? 1 : 0);
  return error * error;
}

export function binaryLogLoss(probability: number, outcome: boolean): number {
  const p = Math.min(
    BSM_WINDOW_PROFILE_CALIBRATION.logClampHi,
    Math.max(BSM_WINDOW_PROFILE_CALIBRATION.logClampLo, probability),
  );
  return outcome ? -Math.log(p) : -Math.log(1 - p);
}

function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function pairedBootstrap(
  points: BsmProfileCalibrationPoint[],
  loss: (probability: number, outcome: boolean) => number,
  metric: string,
): PairedScoreCi | null {
  if (!points.length) return null;
  const ordered = [...points].sort((a, b) =>
    a.windowStartMs - b.windowStartMs || a.id.localeCompare(b.id));
  const grouped = new Map<number, number[]>();
  for (const point of ordered) {
    const cluster = Math.floor(point.windowStartMs / BSM_WINDOW_PROFILE_CALIBRATION.clusterMs);
    const values = grouped.get(cluster) ?? [];
    values.push(loss(point.profile, point.resolvedUp) - loss(point.parent, point.resolvedUp));
    grouped.set(cluster, values);
  }
  const clusters = [...grouped.values()];
  const differences = clusters.flat();
  const pointMean = mean(differences)!;
  if (clusters.length < 3) return { mean: pointMean, lo: null, hi: null, clusters: clusters.length };

  const random = mulberry32(hashSeed(
    `${BSM_WINDOW_PROFILE_CALIBRATION.version}|${metric}|${ordered.length}|${ordered.at(-1)!.id}`,
  ));
  const boot: number[] = [];
  for (let iteration = 0; iteration < BSM_WINDOW_PROFILE_CALIBRATION.bootstrapIterations; iteration++) {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < clusters.length; i++) {
      const picked = clusters[Math.floor(random() * clusters.length)];
      for (const value of picked) {
        sum += value;
        n++;
      }
    }
    boot.push(n ? sum / n : 0);
  }
  boot.sort((a, b) => a - b);
  return {
    mean: pointMean,
    lo: boot[Math.floor(0.025 * (boot.length - 1))],
    hi: boot[Math.floor(0.975 * (boot.length - 1))],
    clusters: clusters.length,
  };
}

export function computeBsmWindowProfileCalibrationReport(points: BsmProfileCalibrationPoint[]) {
  const ordered = [...points].sort((a, b) =>
    a.windowStartMs - b.windowStartMs || a.id.localeCompare(b.id));
  const averageLoss = (
    forecast: "parent" | "profile" | "book",
    loss: (probability: number, outcome: boolean) => number,
  ) => mean(ordered.map((point) => loss(point[forecast], point.resolvedUp)));
  const brierDifference = pairedBootstrap(ordered, binaryBrierLoss, "brier");
  const logLossDifference = pairedBootstrap(ordered, binaryLogLoss, "log-loss");
  return {
    observations: ordered.length,
    scoringConvention: "profile-minus-parent; negative is better" as const,
    brier: {
      parent: averageLoss("parent", binaryBrierLoss),
      profile: averageLoss("profile", binaryBrierLoss),
      book: averageLoss("book", binaryBrierLoss),
      difference: brierDifference,
    },
    logarithmic: {
      parent: averageLoss("parent", binaryLogLoss),
      profile: averageLoss("profile", binaryLogLoss),
      book: averageLoss("book", binaryLogLoss),
      difference: logLossDifference,
    },
    supported:
      brierDifference?.hi != null
      && brierDifference.hi < 0
      && logLossDifference?.hi != null
      && logLossDifference.hi < 0,
  };
}

const eligible = and(
  gte(
    polymarketStateSnapshots.windowStart,
    new Date(BSM_WINDOW_PROFILE_CALIBRATION.evalStartMs),
  ),
  eq(polymarketStateSnapshots.labelStatus, "resolved"),
  eq(polymarketStateSnapshots.referenceSource, "chainlink"),
  eq(polymarketStateSnapshots.pair, BSM_WINDOW_PROFILE_CALIBRATION.pair),
  eq(polymarketStateSnapshots.horizonMin, BSM_WINDOW_PROFILE_CALIBRATION.horizonMin),
  eq(polymarketStateSnapshots.sampleMinute, BSM_WINDOW_PROFILE_CALIBRATION.sampleMinute),
  isNotNull(polymarketStateSnapshots.resolvedUp),
  sql`${polymarketStateSnapshots.chainlinkSpot} > 0`,
  sql`${polymarketStateSnapshots.chainlinkStrike} > 0`,
  sql`${polymarketStateSnapshots.sigmaPerMin} > 0`,
  sql`${polymarketStateSnapshots.remainingSec} > 0`,
  sql`${polymarketStateSnapshots.remainingSec} <= 300`,
  sql`${polymarketStateSnapshots.upBid} > 0`,
  sql`${polymarketStateSnapshots.upAsk} < 1`,
  sql`${polymarketStateSnapshots.upBid} <= ${polymarketStateSnapshots.upAsk}`,
);

export async function bsmWindowProfileCalibrationAudit() {
  // This query deliberately selects no outcome value or forecast input.
  const [aggregate] = await db
    .select({
      observations: sql<number>`count(*)::int`,
      markets: sql<number>`count(distinct ${polymarketStateSnapshots.conditionId})::int`,
      clusters: sql<number>`count(distinct floor(
        extract(epoch from ${polymarketStateSnapshots.windowStart}) * 1000
        / ${BSM_WINDOW_PROFILE_CALIBRATION.clusterMs}
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
  const ready = bsmWindowProfileCalibrationReady(observations, spanDays, clusters);
  const status = {
    version: BSM_WINDOW_PROFILE_CALIBRATION.version,
    evalStartMs: BSM_WINDOW_PROFILE_CALIBRATION.evalStartMs,
    minObservations: BSM_WINDOW_PROFILE_CALIBRATION.minObservations,
    minSpanDays: BSM_WINDOW_PROFILE_CALIBRATION.minSpanDays,
    minClusters: BSM_WINDOW_PROFILE_CALIBRATION.minClusters,
    observations,
    markets,
    clusters,
    spanDays,
    firstWindowMs,
    lastWindowMs,
    ready,
    resultsLocked: !ready,
  };
  if (!ready) return { ...status, report: null };

  const rows = await db
    .select({
      id: polymarketStateSnapshots.id,
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
    .where(eligible)
    .orderBy(asc(polymarketStateSnapshots.windowStart), asc(polymarketStateSnapshots.id));
  const points = rows.flatMap((row): BsmProfileCalibrationPoint[] => {
    const tauMin = Number(row.remainingSec) / 60;
    const profileVarianceMin = bsmProfileRemainingVarianceMin(tauMin);
    if (profileVarianceMin == null) return [];
    const spot = Number(row.chainlinkSpot);
    const strike = Number(row.chainlinkStrike);
    const sigma = Number(row.sigmaPerMin);
    return [{
      id: `${row.conditionId}|${row.id}`,
      windowStartMs: new Date(row.windowStart).getTime(),
      parent: digitalPupBSM(spot, strike, sigma, tauMin),
      profile: digitalPupBSM(spot, strike, sigma, profileVarianceMin),
      book: (Number(row.upBid) + Number(row.upAsk)) / 2,
      resolvedUp: Boolean(row.resolvedUp),
    }];
  });
  return { ...status, report: computeBsmWindowProfileCalibrationReport(points) };
}
