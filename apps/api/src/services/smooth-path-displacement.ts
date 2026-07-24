/**
 * Pure, outcome-free decision contract for KB
 * `updown-smooth-path-displacement-v1`.
 *
 * The paper engine supplies the Chainlink resolution-source path, immutable minute-1 fills, and one
 * current paired-book observation. This module has no network, database, grading, wallet, order, or
 * execution dependency.
 */

export const SMOOTH_PATH_DISPLACEMENT = {
  version: "updown-smooth-path-displacement-v1",
  evalStartMs: Date.UTC(2026, 6, 23, 16, 45, 0),
  pairs: ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD", "BNB-USD"],
  horizonMin: 5,
  previousSampleMinute: 1,
  decisionSampleMinute: 2,
  minTicks: 90,
  maxStartCoverageSec: 5,
  maxIntertickGapSec: 5,
  maxSourceAgeSec: 20,
  maxReceiveAgeSec: 20,
  freshLookbackSec: 10,
  freshToleranceSec: 2,
  minAbsDisplacementLog: 0.0008,
  minPathR2: 0.60,
  minPathEfficiency: 0.55,
  minSignedFreshReturnLog: 0.0001,
  eventSideProbability: 0.70,
  askEdge: 0.05,
  maxAskDrift: 0.08,
  minFill: 0.02,
  maxFill: 0.98,
  maxBatchRequestMs: 1_000,
} as const;

/**
 * Prospective causal-delivery child. Every numerical gate is inherited unchanged from v1; the only
 * difference is that a tick must have reached this worker no later than the paired-book timestamp.
 */
export const SMOOTH_PATH_CAUSAL_DISPLACEMENT = {
  ...SMOOTH_PATH_DISPLACEMENT,
  version: "updown-smooth-path-causal-displacement-v2",
  evalStartMs: Date.UTC(2026, 6, 23, 22, 0, 0),
} as const;

export interface SmoothPathTick {
  sourceAtMs: number;
  price: number;
  receivedAtMs: number;
}

export type SmoothPathRejectionReason =
  | "tick-count"
  | "start-coverage"
  | "intertick-gap"
  | "source-stale"
  | "receive-after-observation"
  | "receive-stale"
  | "flat-at-strike"
  | "displacement"
  | "path-r2"
  | "path-efficiency"
  | "slope-reversal"
  | "fresh-return";

export interface SmoothPathInput {
  windowStartMs: number;
  observedAtMs: number;
  strike: number;
  ticks: ReadonlyArray<SmoothPathTick>;
}

export interface SmoothPathObservation {
  causalDeliveriesOnly: boolean;
  side: "up" | "down" | null;
  pup: number | null;
  currentPrice: number;
  currentDisplacementLog: number;
  slopePerSec: number;
  signedSlopePerSec: number;
  pathR2: number;
  pathEfficiency: number;
  freshReturnLog: number;
  signedFreshReturnLog: number;
  tickCount: number;
  firstAtMs: number;
  sourceAtMs: number;
  receivedAtMs: number;
  startCoverageSec: number;
  maxIntertickGapSec: number;
  sourceAgeSec: number;
  receiveAgeSec: number;
  rejectionReasons: SmoothPathRejectionReason[];
}

export interface SmoothPathPaperDecision {
  side: "up" | "down";
  pup: number;
  selectedAsk: number;
  controlAsk: number;
  previousSelectedAsk: number;
  askDrift: number;
  edgeAsk: number;
}

export function smoothPathEligible(
  pair: string,
  horizonMin: number,
  sampleMinute: number,
): boolean {
  return SMOOTH_PATH_DISPLACEMENT.pairs.includes(
    pair as typeof SMOOTH_PATH_DISPLACEMENT.pairs[number],
  )
    && horizonMin === SMOOTH_PATH_DISPLACEMENT.horizonMin
    && sampleMinute === SMOOTH_PATH_DISPLACEMENT.decisionSampleMinute;
}

export function smoothPathCausalEligible(
  pair: string,
  horizonMin: number,
  sampleMinute: number,
): boolean {
  return SMOOTH_PATH_CAUSAL_DISPLACEMENT.pairs.includes(
    pair as typeof SMOOTH_PATH_CAUSAL_DISPLACEMENT.pairs[number],
  )
    && horizonMin === SMOOTH_PATH_CAUSAL_DISPLACEMENT.horizonMin
    && sampleMinute === SMOOTH_PATH_CAUSAL_DISPLACEMENT.decisionSampleMinute;
}

function pathWithinWindow(
  input: SmoothPathInput,
  causalDeliveriesOnly: boolean,
): SmoothPathTick[] | null {
  if (
    !Number.isFinite(input.windowStartMs)
    || !Number.isFinite(input.observedAtMs)
    || input.observedAtMs < input.windowStartMs
    || !Number.isFinite(input.strike)
    || input.strike <= 0
  ) return null;

  const bySourceTime = new Map<number, SmoothPathTick>();
  for (const tick of input.ticks) {
    if (
      !Number.isFinite(tick.sourceAtMs)
      || !Number.isFinite(tick.receivedAtMs)
      || !Number.isFinite(tick.price)
      || tick.price <= 0
      || tick.sourceAtMs < input.windowStartMs
      || tick.sourceAtMs > input.observedAtMs
      || (causalDeliveriesOnly && tick.receivedAtMs > input.observedAtMs)
    ) continue;
    const previous = bySourceTime.get(tick.sourceAtMs);
    if (!previous || tick.receivedAtMs >= previous.receivedAtMs) {
      bySourceTime.set(tick.sourceAtMs, tick);
    }
  }
  const path = [...bySourceTime.values()].sort((a, b) => a.sourceAtMs - b.sourceAtMs);
  return path.length ? path : null;
}

function nearestTick(path: SmoothPathTick[], targetMs: number): SmoothPathTick | null {
  let nearest: SmoothPathTick | null = null;
  let distanceMs = Infinity;
  for (const tick of path) {
    const distance = Math.abs(tick.sourceAtMs - targetMs);
    if (distance < distanceMs) {
      nearest = tick;
      distanceMs = distance;
    }
  }
  return nearest && distanceMs <= SMOOTH_PATH_DISPLACEMENT.freshToleranceSec * 1_000
    ? nearest
    : null;
}

function computeSmoothPathObservation(
  input: SmoothPathInput,
  causalDeliveriesOnly: boolean,
): SmoothPathObservation | null {
  const path = pathWithinWindow(input, causalDeliveriesOnly);
  if (!path || path.length < 2) return null;

  const first = path[0];
  const current = path[path.length - 1];
  const startCoverageSec = (first.sourceAtMs - input.windowStartMs) / 1_000;
  const sourceAgeSec = (input.observedAtMs - current.sourceAtMs) / 1_000;
  const receiveAgeSec = (input.observedAtMs - current.receivedAtMs) / 1_000;
  let maxIntertickGapSec = 0;
  let totalVariationLog = 0;
  for (let index = 1; index < path.length; index++) {
    maxIntertickGapSec = Math.max(
      maxIntertickGapSec,
      (path[index].sourceAtMs - path[index - 1].sourceAtMs) / 1_000,
    );
    totalVariationLog += Math.abs(Math.log(path[index].price / path[index - 1].price));
  }

  const coordinates = path.map((tick) => ({
    x: (tick.sourceAtMs - input.windowStartMs) / 1_000,
    y: Math.log(tick.price / input.strike),
  }));
  if (coordinates.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y))) return null;
  const meanX = coordinates.reduce((sum, point) => sum + point.x, 0) / coordinates.length;
  const meanY = coordinates.reduce((sum, point) => sum + point.y, 0) / coordinates.length;
  const sxx = coordinates.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
  const sxy = coordinates.reduce(
    (sum, point) => sum + (point.x - meanX) * (point.y - meanY),
    0,
  );
  if (!(sxx > 0)) return null;
  const slopePerSec = sxy / sxx;
  const intercept = meanY - slopePerSec * meanX;
  const totalSquared = coordinates.reduce((sum, point) => sum + (point.y - meanY) ** 2, 0);
  const residualSquared = coordinates.reduce(
    (sum, point) => sum + (point.y - (intercept + slopePerSec * point.x)) ** 2,
    0,
  );
  if (!(totalSquared > 0) || !(totalVariationLog > 0)) return null;
  const pathR2 = Math.max(0, Math.min(1, 1 - residualSquared / totalSquared));
  const currentDisplacementLog = Math.log(current.price / input.strike);
  const pathEfficiency = Math.abs(currentDisplacementLog) / totalVariationLog;
  const freshReference = nearestTick(
    path,
    current.sourceAtMs - SMOOTH_PATH_DISPLACEMENT.freshLookbackSec * 1_000,
  );
  if (!freshReference) return null;
  const freshReturnLog = Math.log(current.price / freshReference.price);
  const direction = Math.sign(currentDisplacementLog);
  const signedSlopePerSec = direction * slopePerSec;
  const signedFreshReturnLog = direction * freshReturnLog;
  if (
    !Number.isFinite(pathR2)
    || !Number.isFinite(pathEfficiency)
    || !Number.isFinite(currentDisplacementLog)
    || !Number.isFinite(freshReturnLog)
    || !Number.isFinite(sourceAgeSec)
    || !Number.isFinite(receiveAgeSec)
  ) return null;

  const rejectionReasons: SmoothPathRejectionReason[] = [];
  if (path.length < SMOOTH_PATH_DISPLACEMENT.minTicks) {
    rejectionReasons.push("tick-count");
  }
  if (
    startCoverageSec < 0
    || startCoverageSec > SMOOTH_PATH_DISPLACEMENT.maxStartCoverageSec
  ) {
    rejectionReasons.push("start-coverage");
  }
  if (maxIntertickGapSec > SMOOTH_PATH_DISPLACEMENT.maxIntertickGapSec) {
    rejectionReasons.push("intertick-gap");
  }
  if (
    sourceAgeSec < 0
    || sourceAgeSec > SMOOTH_PATH_DISPLACEMENT.maxSourceAgeSec
  ) {
    rejectionReasons.push("source-stale");
  }
  if (receiveAgeSec < 0) {
    rejectionReasons.push("receive-after-observation");
  } else if (receiveAgeSec > SMOOTH_PATH_DISPLACEMENT.maxReceiveAgeSec) {
    rejectionReasons.push("receive-stale");
  }
  if (direction === 0) rejectionReasons.push("flat-at-strike");
  if (
    Math.abs(currentDisplacementLog)
      < SMOOTH_PATH_DISPLACEMENT.minAbsDisplacementLog
  ) {
    rejectionReasons.push("displacement");
  }
  if (pathR2 < SMOOTH_PATH_DISPLACEMENT.minPathR2) {
    rejectionReasons.push("path-r2");
  }
  if (pathEfficiency < SMOOTH_PATH_DISPLACEMENT.minPathEfficiency) {
    rejectionReasons.push("path-efficiency");
  }
  if (!(signedSlopePerSec > 0)) rejectionReasons.push("slope-reversal");
  if (
    signedFreshReturnLog
      < SMOOTH_PATH_DISPLACEMENT.minSignedFreshReturnLog
  ) {
    rejectionReasons.push("fresh-return");
  }
  const qualifies = rejectionReasons.length === 0;
  const side = qualifies ? (direction > 0 ? "up" : "down") : null;

  return {
    causalDeliveriesOnly,
    side,
    pup: side == null
      ? null
      : side === "up"
        ? SMOOTH_PATH_DISPLACEMENT.eventSideProbability
        : 1 - SMOOTH_PATH_DISPLACEMENT.eventSideProbability,
    currentPrice: current.price,
    currentDisplacementLog,
    slopePerSec,
    signedSlopePerSec,
    pathR2,
    pathEfficiency,
    freshReturnLog,
    signedFreshReturnLog,
    tickCount: path.length,
    firstAtMs: first.sourceAtMs,
    sourceAtMs: current.sourceAtMs,
    receivedAtMs: current.receivedAtMs,
    startCoverageSec,
    maxIntertickGapSec,
    sourceAgeSec,
    receiveAgeSec,
    rejectionReasons,
  };
}

/** Frozen v1 Chainlink path transform. It returns data quality even when the rule abstains. */
export function smoothPathObservation(input: SmoothPathInput): SmoothPathObservation | null {
  return computeSmoothPathObservation(input, false);
}

/** Prospective v2 transform using only deliveries already available at the book observation time. */
export function smoothPathCausalObservation(input: SmoothPathInput): SmoothPathObservation | null {
  return computeSmoothPathObservation(input, true);
}

function validFill(value: number): boolean {
  return Number.isFinite(value)
    && value > SMOOTH_PATH_DISPLACEMENT.minFill
    && value < SMOOTH_PATH_DISPLACEMENT.maxFill;
}

/** Apply the frozen real-ask edge and minute-1 chase rules to a qualified path observation. */
export function smoothPathPaperDecision(
  observation: SmoothPathObservation,
  previousUpFill: number,
  previousDownFill: number,
  currentUpFill: number,
  currentDownFill: number,
): SmoothPathPaperDecision | null {
  if (
    !observation.side
    || observation.pup == null
    || !validFill(previousUpFill)
    || !validFill(previousDownFill)
    || !validFill(currentUpFill)
    || !validFill(currentDownFill)
  ) return null;

  const selectedAsk = observation.side === "up" ? currentUpFill : currentDownFill;
  const previousSelectedAsk = observation.side === "up" ? previousUpFill : previousDownFill;
  const askDrift = selectedAsk - previousSelectedAsk;
  const edgeAsk = SMOOTH_PATH_DISPLACEMENT.eventSideProbability - selectedAsk;
  if (askDrift > SMOOTH_PATH_DISPLACEMENT.maxAskDrift) return null;
  if (!(edgeAsk > SMOOTH_PATH_DISPLACEMENT.askEdge)) return null;

  return {
    side: observation.side,
    pup: observation.pup,
    selectedAsk,
    controlAsk: currentDownFill,
    previousSelectedAsk,
    askDrift,
    edgeAsk,
  };
}
