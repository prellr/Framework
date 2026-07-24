/**
 * Prospective, readiness-locked audit for KB
 * `updown-microstructure-absorption-audit-v1`.
 *
 * This module is read-only and is never imported by the paper engine. Before
 * every frozen readiness floor passes, it may load quote/size inputs to count
 * deterministic absorption events, but it cannot select outcome values.
 */
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, polymarketStateSnapshots } from "@framework/db";
import { ukTradingSessionAt, type UkTradingSession } from "./cobra-session-pricer.ts";
import {
  canonicalOrderFlowImbalance,
  normalizedOrderFlowImbalance,
  type TouchState,
} from "./polymarket-microstructure.ts";
import { clusterBootstrap, contractNet } from "./paper-floor-gate.ts";

export const MICROSTRUCTURE_ABSORPTION_AUDIT = {
  version: "updown-microstructure-absorption-audit-v1",
  evalStartMs: Date.UTC(2026, 6, 23, 13, 0, 0),
  pairs: ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD", "BNB-USD"],
  horizonMin: 5,
  previousSampleMinute: 1,
  currentSampleMinute: 2,
  minEffort: 1,
  maxSameDirectionResponse: 0.01,
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

export interface OutcomeBookTouch {
  bid: number;
  bidSize: number;
  ask: number;
  askSize: number;
}

export interface AbsorptionFeatureInput {
  previousCapturedAtMs: number;
  currentCapturedAtMs: number;
  previousUp: OutcomeBookTouch;
  previousDown: OutcomeBookTouch;
  currentUp: OutcomeBookTouch;
  currentDown: OutcomeBookTouch;
  upFill: number;
  downFill: number;
}

export interface AbsorptionObservation {
  canonicalOfi: number;
  effort: number;
  response: number;
  signedResponse: number;
  side: "up" | "down" | null;
  ask: number | null;
  controlAsk: number;
}

export interface AbsorptionCandidatePoint {
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

function validBook(touch: OutcomeBookTouch): boolean {
  return Number.isFinite(touch.bid)
    && Number.isFinite(touch.ask)
    && Number.isFinite(touch.bidSize)
    && Number.isFinite(touch.askSize)
    && touch.bid >= 0
    && touch.ask <= 1
    && touch.bid <= touch.ask
    && touch.bidSize >= 0
    && touch.askSize >= 0;
}

function touchAt(capturedAtMs: number, touch: OutcomeBookTouch): TouchState {
  return {
    capturedAtMs,
    bid: touch.bid,
    bidSize: touch.bidSize,
    ask: touch.ask,
    askSize: touch.askSize,
  };
}

function canonicalMid(up: OutcomeBookTouch, down: OutcomeBookTouch): number | null {
  if (!validBook(up) || !validBook(down)) return null;
  const upMid = (up.bid + up.ask) / 2;
  const downMid = (down.bid + down.ask) / 2;
  const value = (upMid + 1 - downMid) / 2;
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function validFill(value: number): boolean {
  return Number.isFinite(value)
    && value > MICROSTRUCTURE_ABSORPTION_AUDIT.minFill
    && value < MICROSTRUCTURE_ABSORPTION_AUDIT.maxFill;
}

/**
 * Frozen effort-versus-response transform. A valid observation may abstain;
 * `side=null` means the registered absorption conditions were not both met.
 */
export function microstructureAbsorptionObservation(
  input: AbsorptionFeatureInput,
): AbsorptionObservation | null {
  if (!validFill(input.upFill) || !validFill(input.downFill)) return null;
  const previousMid = canonicalMid(input.previousUp, input.previousDown);
  const currentMid = canonicalMid(input.currentUp, input.currentDown);
  if (previousMid == null || currentMid == null) return null;

  const upOfi = normalizedOrderFlowImbalance(
    touchAt(input.previousCapturedAtMs, input.previousUp),
    touchAt(input.currentCapturedAtMs, input.currentUp),
  );
  const downOfi = normalizedOrderFlowImbalance(
    touchAt(input.previousCapturedAtMs, input.previousDown),
    touchAt(input.currentCapturedAtMs, input.currentDown),
  );
  const canonicalOfi = canonicalOrderFlowImbalance(upOfi, downOfi);
  if (canonicalOfi == null) return null;

  const effort = Math.abs(canonicalOfi);
  const response = currentMid - previousMid;
  const signedResponse = Math.sign(canonicalOfi) * response;
  const qualifies =
    effort >= MICROSTRUCTURE_ABSORPTION_AUDIT.minEffort
    && signedResponse <= MICROSTRUCTURE_ABSORPTION_AUDIT.maxSameDirectionResponse;
  const side = qualifies ? (canonicalOfi > 0 ? "down" : "up") : null;
  return {
    canonicalOfi,
    effort,
    response,
    signedResponse,
    side,
    ask: side == null ? null : side === "up" ? input.upFill : input.downFill,
    controlAsk: input.downFill,
  };
}

export function microstructureAbsorptionReady(
  markets: number,
  spanDays: number,
  bets: number,
  clusters: number,
  qualifyingSessions: number,
): boolean {
  return markets >= MICROSTRUCTURE_ABSORPTION_AUDIT.minMarkets
    && spanDays >= MICROSTRUCTURE_ABSORPTION_AUDIT.minSpanDays
    && bets >= MICROSTRUCTURE_ABSORPTION_AUDIT.minBets
    && clusters >= MICROSTRUCTURE_ABSORPTION_AUDIT.minClusters
    && qualifyingSessions >= MICROSTRUCTURE_ABSORPTION_AUDIT.sessionsNeeded;
}

export function microstructureAbsorptionClusterCount(
  points: readonly { windowStartMs: number }[],
): number {
  return new Set(
    points.map((point) =>
      Math.floor(point.windowStartMs / MICROSTRUCTURE_ABSORPTION_AUDIT.clusterMs)),
  ).size;
}

export function computeMicrostructureAbsorptionReport(
  points: AbsorptionCandidatePoint[],
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
      cluster: Math.floor(point.windowStartMs / MICROSTRUCTURE_ABSORPTION_AUDIT.clusterMs),
      session: ukTradingSessionAt(point.decidedAtMs),
    }];
  });
  const average = (values: number[]) =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const residual = clusterBootstrap(
    scored.map((point) => ({ value: point.residual, cluster: point.cluster })),
    MICROSTRUCTURE_ABSORPTION_AUDIT.bootstrapIterations,
    `${MICROSTRUCTURE_ABSORPTION_AUDIT.version}|${scored.length}|${scored.at(-1)?.id ?? 0}`,
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
      qualifies: values.length >= MICROSTRUCTURE_ABSORPTION_AUDIT.sessionMinBets,
      positive: values.length >= MICROSTRUCTURE_ABSORPTION_AUDIT.sessionMinBets
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
      && residual.mean >= MICROSTRUCTURE_ABSORPTION_AUDIT.minResidual
      && residual.lo > 0
      && positiveQualifyingSessions >= MICROSTRUCTURE_ABSORPTION_AUDIT.sessionsNeeded,
  };
}

const currentSnapshot = alias(polymarketStateSnapshots, "absorption_current");
const previousSnapshot = alias(polymarketStateSnapshots, "absorption_previous");

const currentEligibility = and(
  gte(
    currentSnapshot.windowStart,
    new Date(MICROSTRUCTURE_ABSORPTION_AUDIT.evalStartMs),
  ),
  eq(currentSnapshot.horizonMin, MICROSTRUCTURE_ABSORPTION_AUDIT.horizonMin),
  eq(currentSnapshot.sampleMinute, MICROSTRUCTURE_ABSORPTION_AUDIT.currentSampleMinute),
  inArray(currentSnapshot.pair, [...MICROSTRUCTURE_ABSORPTION_AUDIT.pairs]),
  eq(currentSnapshot.labelStatus, "resolved"),
  isNotNull(currentSnapshot.resolvedUp),
  eq(currentSnapshot.referenceSource, "chainlink"),
  isNotNull(currentSnapshot.upFill5),
  isNotNull(currentSnapshot.downFill5),
  isNotNull(currentSnapshot.upBid),
  isNotNull(currentSnapshot.upAsk),
  isNotNull(currentSnapshot.downBid),
  isNotNull(currentSnapshot.downAsk),
  isNotNull(currentSnapshot.upBidSize),
  isNotNull(currentSnapshot.upAskSize),
  isNotNull(currentSnapshot.downBidSize),
  isNotNull(currentSnapshot.downAskSize),
);

const previousEligibility = and(
  eq(previousSnapshot.conditionId, currentSnapshot.conditionId),
  eq(previousSnapshot.windowStart, currentSnapshot.windowStart),
  eq(previousSnapshot.pair, currentSnapshot.pair),
  eq(previousSnapshot.horizonMin, currentSnapshot.horizonMin),
  eq(previousSnapshot.sampleMinute, MICROSTRUCTURE_ABSORPTION_AUDIT.previousSampleMinute),
  eq(previousSnapshot.referenceSource, "chainlink"),
  isNotNull(previousSnapshot.upBid),
  isNotNull(previousSnapshot.upAsk),
  isNotNull(previousSnapshot.downBid),
  isNotNull(previousSnapshot.downAsk),
  isNotNull(previousSnapshot.upBidSize),
  isNotNull(previousSnapshot.upAskSize),
  isNotNull(previousSnapshot.downBidSize),
  isNotNull(previousSnapshot.downAskSize),
);

async function absorptionFeatureRows() {
  // Deliberately does not select resolvedUp. Before readiness, the outcome
  // value is inaccessible to this module even though presence is required.
  return db
    .select({
      id: currentSnapshot.id,
      conditionId: currentSnapshot.conditionId,
      pair: currentSnapshot.pair,
      windowStart: currentSnapshot.windowStart,
      currentCapturedAt: currentSnapshot.capturedAt,
      previousCapturedAt: previousSnapshot.capturedAt,
      upFill: currentSnapshot.upFill5,
      downFill: currentSnapshot.downFill5,
      currentUpBid: currentSnapshot.upBid,
      currentUpAsk: currentSnapshot.upAsk,
      currentUpBidSize: currentSnapshot.upBidSize,
      currentUpAskSize: currentSnapshot.upAskSize,
      currentDownBid: currentSnapshot.downBid,
      currentDownAsk: currentSnapshot.downAsk,
      currentDownBidSize: currentSnapshot.downBidSize,
      currentDownAskSize: currentSnapshot.downAskSize,
      previousUpBid: previousSnapshot.upBid,
      previousUpAsk: previousSnapshot.upAsk,
      previousUpBidSize: previousSnapshot.upBidSize,
      previousUpAskSize: previousSnapshot.upAskSize,
      previousDownBid: previousSnapshot.downBid,
      previousDownAsk: previousSnapshot.downAsk,
      previousDownBidSize: previousSnapshot.downBidSize,
      previousDownAskSize: previousSnapshot.downAskSize,
    })
    .from(currentSnapshot)
    .innerJoin(previousSnapshot, previousEligibility)
    .where(currentEligibility);
}

function featureInput(row: Awaited<ReturnType<typeof absorptionFeatureRows>>[number]) {
  const observation = microstructureAbsorptionObservation({
    previousCapturedAtMs: new Date(row.previousCapturedAt).getTime(),
    currentCapturedAtMs: new Date(row.currentCapturedAt).getTime(),
    previousUp: {
      bid: Number(row.previousUpBid),
      ask: Number(row.previousUpAsk),
      bidSize: Number(row.previousUpBidSize),
      askSize: Number(row.previousUpAskSize),
    },
    previousDown: {
      bid: Number(row.previousDownBid),
      ask: Number(row.previousDownAsk),
      bidSize: Number(row.previousDownBidSize),
      askSize: Number(row.previousDownAskSize),
    },
    currentUp: {
      bid: Number(row.currentUpBid),
      ask: Number(row.currentUpAsk),
      bidSize: Number(row.currentUpBidSize),
      askSize: Number(row.currentUpAskSize),
    },
    currentDown: {
      bid: Number(row.currentDownBid),
      ask: Number(row.currentDownAsk),
      bidSize: Number(row.currentDownBidSize),
      askSize: Number(row.currentDownAskSize),
    },
    upFill: Number(row.upFill),
    downFill: Number(row.downFill),
  });
  if (!observation) return null;
  return {
    id: row.id,
    conditionId: row.conditionId,
    pair: row.pair,
    windowStartMs: new Date(row.windowStart).getTime(),
    decidedAtMs: new Date(row.currentCapturedAt).getTime(),
    observation,
  };
}

export async function microstructureAbsorptionAudit() {
  const featureRows = await absorptionFeatureRows();
  const opportunities = featureRows.flatMap((row) => {
    const point = featureInput(row);
    return point ? [point] : [];
  });
  const candidates = opportunities.filter((point) => point.observation.side != null);
  const marketTimes = opportunities.map((point) => point.windowStartMs).sort((a, b) => a - b);
  const firstWindowMs = marketTimes[0] ?? null;
  const lastWindowMs = marketTimes.at(-1) ?? null;
  const spanDays = firstWindowMs != null && lastWindowMs != null
    ? (lastWindowMs - firstWindowMs) / 86_400_000
    : 0;
  // Independence floor applies to windows containing actual candidate bets,
  // not merely to observed markets in which the rule abstained.
  const clusters = microstructureAbsorptionClusterCount(candidates);
  const sessionBetCounts = Object.fromEntries(
    UK_SESSIONS.map((session) => [
      session,
      candidates.filter((point) => ukTradingSessionAt(point.decidedAtMs) === session).length,
    ]),
  ) as Record<UkTradingSession, number>;
  const qualifyingSessions = UK_SESSIONS.filter(
    (session) =>
      sessionBetCounts[session] >= MICROSTRUCTURE_ABSORPTION_AUDIT.sessionMinBets,
  ).length;
  const ready = microstructureAbsorptionReady(
    opportunities.length,
    spanDays,
    candidates.length,
    clusters,
    qualifyingSessions,
  );
  const status = {
    version: MICROSTRUCTURE_ABSORPTION_AUDIT.version,
    evalStartMs: MICROSTRUCTURE_ABSORPTION_AUDIT.evalStartMs,
    minimums: {
      markets: MICROSTRUCTURE_ABSORPTION_AUDIT.minMarkets,
      spanDays: MICROSTRUCTURE_ABSORPTION_AUDIT.minSpanDays,
      bets: MICROSTRUCTURE_ABSORPTION_AUDIT.minBets,
      clusters: MICROSTRUCTURE_ABSORPTION_AUDIT.minClusters,
      sessionBets: MICROSTRUCTURE_ABSORPTION_AUDIT.sessionMinBets,
      sessions: MICROSTRUCTURE_ABSORPTION_AUDIT.sessionsNeeded,
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

  // This is the only outcome-value query in the module and it is unreachable
  // until every preregistered count/span/session floor above has passed.
  const outcomeRows = await db
    .select({ id: currentSnapshot.id, resolvedUp: currentSnapshot.resolvedUp })
    .from(currentSnapshot)
    .where(inArray(currentSnapshot.id, candidates.map((point) => point.id)));
  const outcomes = new Map(
    outcomeRows.flatMap((row) =>
      row.resolvedUp == null ? [] : [[row.id, Boolean(row.resolvedUp)] as const]),
  );
  const points = candidates.flatMap((candidate): AbsorptionCandidatePoint[] => {
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
  return { ...status, report: computeMicrostructureAbsorptionReport(points) };
}
