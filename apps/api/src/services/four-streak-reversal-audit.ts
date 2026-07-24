/**
 * Prospective, readiness-locked audit for KB
 * `updown-four-streak-reversal-audit-v1`.
 *
 * The four completed outcomes are signal inputs from windows ending before
 * the target starts. The target outcome value is selected only after every
 * frozen readiness floor passes. This module is read-only and is never
 * imported by the paper engine.
 */
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, polymarketStateSnapshots } from "@framework/db";
import { ukTradingSessionAt, type UkTradingSession } from "./cobra-session-pricer.ts";
import { clusterBootstrap, contractNet } from "./paper-floor-gate.ts";

export const FOUR_STREAK_REVERSAL_AUDIT = {
  version: "updown-four-streak-reversal-audit-v1",
  evalStartMs: Date.UTC(2026, 6, 23, 14, 0, 0),
  pairs: ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD", "BNB-USD"],
  horizonMin: 5,
  sampleMinute: 0,
  streakLength: 4,
  minFill: 0.02,
  maxFill: 0.98,
  minMarkets: 1_500,
  minSpanDays: 5,
  minBets: 200,
  minClusters: 500,
  minResidual: 0.015,
  clusterMs: 5 * 60_000,
  bootstrapIterations: 1_000,
  sessionMinBets: 50,
  sessionsNeeded: 2,
} as const;

export interface FourStreakObservation {
  priorDirection: "up" | "down" | null;
  side: "up" | "down" | null;
  ask: number | null;
  controlAsk: number;
}

export interface FourStreakCandidatePoint {
  id: number;
  conditionId: string;
  pair: string;
  windowStartMs: number;
  decidedAtMs: number;
  side: "up" | "down";
  ask: number;
  controlAsk: number;
  resolvedUp: boolean;
}

const UK_SESSIONS: readonly UkTradingSession[] = [
  "night23-07",
  "day07-19",
  "eve19-23",
];

function validFill(value: number): boolean {
  return Number.isFinite(value)
    && value > FOUR_STREAK_REVERSAL_AUDIT.minFill
    && value < FOUR_STREAK_REVERSAL_AUDIT.maxFill;
}

/** Frozen four-result reversal rule. Mixed or incomplete history abstains. */
export function fourStreakReversalObservation(
  priorResolvedUp: readonly boolean[],
  upFill: number,
  downFill: number,
): FourStreakObservation | null {
  if (
    priorResolvedUp.length !== FOUR_STREAK_REVERSAL_AUDIT.streakLength
    || !validFill(upFill)
    || !validFill(downFill)
  ) return null;
  const allUp = priorResolvedUp.every(Boolean);
  const allDown = priorResolvedUp.every((up) => !up);
  const priorDirection = allUp ? "up" : allDown ? "down" : null;
  const side = priorDirection === "up"
    ? "down"
    : priorDirection === "down"
      ? "up"
      : null;
  return {
    priorDirection,
    side,
    ask: side == null ? null : side === "up" ? upFill : downFill,
    controlAsk: downFill,
  };
}

export function fourStreakReversalReady(
  markets: number,
  spanDays: number,
  bets: number,
  clusters: number,
  qualifyingSessions: number,
): boolean {
  return markets >= FOUR_STREAK_REVERSAL_AUDIT.minMarkets
    && spanDays >= FOUR_STREAK_REVERSAL_AUDIT.minSpanDays
    && bets >= FOUR_STREAK_REVERSAL_AUDIT.minBets
    && clusters >= FOUR_STREAK_REVERSAL_AUDIT.minClusters
    && qualifyingSessions >= FOUR_STREAK_REVERSAL_AUDIT.sessionsNeeded;
}

export function fourStreakReversalClusterCount(
  points: readonly { windowStartMs: number }[],
): number {
  return new Set(
    points.map((point) =>
      Math.floor(point.windowStartMs / FOUR_STREAK_REVERSAL_AUDIT.clusterMs)),
  ).size;
}

export function computeFourStreakReversalReport(
  points: FourStreakCandidatePoint[],
) {
  const ordered = [...points].sort((a, b) =>
    a.windowStartMs - b.windowStartMs || a.id - b.id);
  const scored = ordered.flatMap((point) => {
    const won = point.side === "up" ? point.resolvedUp : !point.resolvedUp;
    const candidateNet = contractNet(won ? "won" : "lost", point.ask);
    const controlNet = contractNet(point.resolvedUp ? "lost" : "won", point.controlAsk);
    if (candidateNet == null || controlNet == null) return [];
    return [{
      ...point,
      won,
      candidateNet,
      controlNet,
      residual: candidateNet - controlNet,
      cluster: Math.floor(point.windowStartMs / FOUR_STREAK_REVERSAL_AUDIT.clusterMs),
      session: ukTradingSessionAt(point.decidedAtMs),
    }];
  });
  const average = (values: number[]) =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const residual = clusterBootstrap(
    scored.map((point) => ({ value: point.residual, cluster: point.cluster })),
    FOUR_STREAK_REVERSAL_AUDIT.bootstrapIterations,
    `${FOUR_STREAK_REVERSAL_AUDIT.version}|${scored.length}|${scored.at(-1)?.id ?? 0}`,
  );
  const sessions = UK_SESSIONS.map((session) => {
    const values = scored
      .filter((point) => point.session === session)
      .map((point) => point.residual);
    const mean = average(values);
    return {
      session,
      bets: values.length,
      residualMean: mean,
      qualifies: values.length >= FOUR_STREAK_REVERSAL_AUDIT.sessionMinBets,
      positive: values.length >= FOUR_STREAK_REVERSAL_AUDIT.sessionMinBets
        && mean != null
        && mean > 0,
    };
  });
  const positiveQualifyingSessions = sessions.filter((session) => session.positive).length;
  return {
    bets: scored.length,
    pairedMarkets: new Set(scored.map((point) => point.conditionId)).size,
    wins: scored.filter((point) => point.won).length,
    losses: scored.filter((point) => !point.won).length,
    candidateMeanNet: average(scored.map((point) => point.candidateNet)),
    controlMeanNet: average(scored.map((point) => point.controlNet)),
    residual,
    sessions,
    positiveQualifyingSessions,
    supported:
      residual?.lo != null
      && residual.mean >= FOUR_STREAK_REVERSAL_AUDIT.minResidual
      && residual.lo > 0
      && positiveQualifyingSessions >= FOUR_STREAK_REVERSAL_AUDIT.sessionsNeeded,
  };
}

const target = alias(polymarketStateSnapshots, "four_streak_target");
const prior1 = alias(polymarketStateSnapshots, "four_streak_prior_1");
const prior2 = alias(polymarketStateSnapshots, "four_streak_prior_2");
const prior3 = alias(polymarketStateSnapshots, "four_streak_prior_3");
const prior4 = alias(polymarketStateSnapshots, "four_streak_prior_4");

const targetEligibility = and(
  gte(target.windowStart, new Date(FOUR_STREAK_REVERSAL_AUDIT.evalStartMs)),
  eq(target.horizonMin, FOUR_STREAK_REVERSAL_AUDIT.horizonMin),
  eq(target.sampleMinute, FOUR_STREAK_REVERSAL_AUDIT.sampleMinute),
  inArray(target.pair, [...FOUR_STREAK_REVERSAL_AUDIT.pairs]),
  eq(target.labelStatus, "resolved"),
  isNotNull(target.resolvedUp),
  eq(target.referenceSource, "chainlink"),
  isNotNull(target.upFill5),
  isNotNull(target.downFill5),
);

const prior1Eligibility = and(
  eq(prior1.pair, target.pair),
  eq(prior1.horizonMin, target.horizonMin),
  eq(prior1.sampleMinute, FOUR_STREAK_REVERSAL_AUDIT.sampleMinute),
  eq(prior1.labelStatus, "resolved"),
  isNotNull(prior1.resolvedUp),
  eq(prior1.referenceSource, "chainlink"),
  eq(prior1.windowStart, sql`${target.windowStart} - interval '5 minutes'`),
);
const prior2Eligibility = and(
  eq(prior2.pair, target.pair),
  eq(prior2.horizonMin, target.horizonMin),
  eq(prior2.sampleMinute, FOUR_STREAK_REVERSAL_AUDIT.sampleMinute),
  eq(prior2.labelStatus, "resolved"),
  isNotNull(prior2.resolvedUp),
  eq(prior2.referenceSource, "chainlink"),
  eq(prior2.windowStart, sql`${target.windowStart} - interval '10 minutes'`),
);
const prior3Eligibility = and(
  eq(prior3.pair, target.pair),
  eq(prior3.horizonMin, target.horizonMin),
  eq(prior3.sampleMinute, FOUR_STREAK_REVERSAL_AUDIT.sampleMinute),
  eq(prior3.labelStatus, "resolved"),
  isNotNull(prior3.resolvedUp),
  eq(prior3.referenceSource, "chainlink"),
  eq(prior3.windowStart, sql`${target.windowStart} - interval '15 minutes'`),
);
const prior4Eligibility = and(
  eq(prior4.pair, target.pair),
  eq(prior4.horizonMin, target.horizonMin),
  eq(prior4.sampleMinute, FOUR_STREAK_REVERSAL_AUDIT.sampleMinute),
  eq(prior4.labelStatus, "resolved"),
  isNotNull(prior4.resolvedUp),
  eq(prior4.referenceSource, "chainlink"),
  eq(prior4.windowStart, sql`${target.windowStart} - interval '20 minutes'`),
);

async function fourStreakFeatureRows() {
  // Prior outcomes are completed signal inputs. The target outcome value is
  // deliberately absent from this selection; only its presence is tested.
  return db
    .select({
      id: target.id,
      conditionId: target.conditionId,
      pair: target.pair,
      windowStart: target.windowStart,
      capturedAt: target.capturedAt,
      upFill: target.upFill5,
      downFill: target.downFill5,
      prior1Up: prior1.resolvedUp,
      prior2Up: prior2.resolvedUp,
      prior3Up: prior3.resolvedUp,
      prior4Up: prior4.resolvedUp,
    })
    .from(target)
    .innerJoin(prior1, prior1Eligibility)
    .innerJoin(prior2, prior2Eligibility)
    .innerJoin(prior3, prior3Eligibility)
    .innerJoin(prior4, prior4Eligibility)
    .where(targetEligibility);
}

function featurePoint(
  row: Awaited<ReturnType<typeof fourStreakFeatureRows>>[number],
) {
  if (
    row.prior1Up == null
    || row.prior2Up == null
    || row.prior3Up == null
    || row.prior4Up == null
  ) return null;
  const observation = fourStreakReversalObservation(
    [
      Boolean(row.prior4Up),
      Boolean(row.prior3Up),
      Boolean(row.prior2Up),
      Boolean(row.prior1Up),
    ],
    Number(row.upFill),
    Number(row.downFill),
  );
  if (!observation) return null;
  return {
    id: row.id,
    conditionId: row.conditionId,
    pair: row.pair,
    windowStartMs: new Date(row.windowStart).getTime(),
    decidedAtMs: new Date(row.capturedAt).getTime(),
    observation,
  };
}

export async function fourStreakReversalAudit() {
  const featureRows = await fourStreakFeatureRows();
  const opportunities = featureRows.flatMap((row) => {
    const point = featurePoint(row);
    return point ? [point] : [];
  });
  const candidates = opportunities.filter((point) => point.observation.side != null);
  const marketTimes = opportunities.map((point) => point.windowStartMs).sort((a, b) => a - b);
  const firstWindowMs = marketTimes[0] ?? null;
  const lastWindowMs = marketTimes.at(-1) ?? null;
  const spanDays = firstWindowMs != null && lastWindowMs != null
    ? (lastWindowMs - firstWindowMs) / 86_400_000
    : 0;
  const clusters = fourStreakReversalClusterCount(candidates);
  const sessionBetCounts = Object.fromEntries(
    UK_SESSIONS.map((session) => [
      session,
      candidates.filter((point) => ukTradingSessionAt(point.decidedAtMs) === session).length,
    ]),
  ) as Record<UkTradingSession, number>;
  const qualifyingSessions = UK_SESSIONS.filter(
    (session) =>
      sessionBetCounts[session] >= FOUR_STREAK_REVERSAL_AUDIT.sessionMinBets,
  ).length;
  const ready = fourStreakReversalReady(
    opportunities.length,
    spanDays,
    candidates.length,
    clusters,
    qualifyingSessions,
  );
  const status = {
    version: FOUR_STREAK_REVERSAL_AUDIT.version,
    evalStartMs: FOUR_STREAK_REVERSAL_AUDIT.evalStartMs,
    minimums: {
      markets: FOUR_STREAK_REVERSAL_AUDIT.minMarkets,
      spanDays: FOUR_STREAK_REVERSAL_AUDIT.minSpanDays,
      bets: FOUR_STREAK_REVERSAL_AUDIT.minBets,
      clusters: FOUR_STREAK_REVERSAL_AUDIT.minClusters,
      sessionBets: FOUR_STREAK_REVERSAL_AUDIT.sessionMinBets,
      sessions: FOUR_STREAK_REVERSAL_AUDIT.sessionsNeeded,
    },
    markets: new Set(opportunities.map((point) => point.conditionId)).size,
    bets: candidates.length,
    clusters,
    sessionBetCounts,
    qualifyingSessions,
    spanDays,
    firstWindowMs,
    lastWindowMs,
    ready,
    resultsLocked: !ready,
  };
  if (!ready) return { ...status, report: null };

  // This is the only target-outcome-value query and is unreachable until all
  // preregistered count/span/cluster/session floors above have passed.
  const outcomeRows = await db
    .select({ id: target.id, resolvedUp: target.resolvedUp })
    .from(target)
    .where(inArray(target.id, candidates.map((point) => point.id)));
  const outcomes = new Map(
    outcomeRows.flatMap((row) =>
      row.resolvedUp == null ? [] : [[row.id, Boolean(row.resolvedUp)] as const]),
  );
  const points = candidates.flatMap((candidate): FourStreakCandidatePoint[] => {
    const resolvedUp = outcomes.get(candidate.id);
    const side = candidate.observation.side;
    const ask = candidate.observation.ask;
    if (resolvedUp == null || side == null || ask == null) return [];
    return [{
      id: candidate.id,
      conditionId: candidate.conditionId,
      pair: candidate.pair,
      windowStartMs: candidate.windowStartMs,
      decidedAtMs: candidate.decidedAtMs,
      side,
      ask,
      controlAsk: candidate.observation.controlAsk,
      resolvedUp,
    }];
  });
  return { ...status, report: computeFourStreakReversalReport(points) };
}
