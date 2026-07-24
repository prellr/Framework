import type {
  PaperGateBotResult,
  PaperGateConfig,
} from "./paper-floor-gate.ts";

/**
 * Prospective correction for the expanded strategy tournament.
 *
 * The earlier pooled and split gates remain immutable historical contracts. This gate starts a new
 * cohort and adds strong family-wise error control across the exact 57 strategy × timeframe verdict
 * units that existed at preregistration. A later strategy cannot borrow this alpha budget: it must
 * enter a new frozen family/version.
 */
export const PAPER_FAMILYWISE_GATE = {
  version: "updown-familywise-verdict-gate-v1",
  evalStartMs: Date.parse("2026-07-25T00:00:00.000Z"),
  minMarkets: 1500,
  minSpanDays: 5,
  minBets: 200,
  minResidual: 0.015,
  clusterMs: 5 * 60_000,
  bootIters: 1000,
  sessionMinBets: 50,
  sessionsNeeded: 2,
  alpha: 0.05,
  correction: "Holm",
  pValueMethod: "one-sided cluster-robust t",
  minClusters: 100,
} as const satisfies PaperGateConfig & {
  alpha: number;
  correction: "Holm";
  pValueMethod: string;
  minClusters: number;
};

/** Frozen in lexicographic-independent roster order; do not derive this dynamically at runtime. */
export const PAPER_FAMILYWISE_HYPOTHESES = [
  "fade:5",
  "fade:15",
  "fadeStrong:5",
  "fadeStrong:15",
  "fadeRegime:5",
  "fadeRegime:15",
  "fadeTessCmoChop:5",
  "fadeTessCmoChop:15",
  "follow:5",
  "follow:15",
  "gaugeFade:5",
  "gaugeFade:15",
  "gaugeFollow:5",
  "gaugeFollow:15",
  "fadeV1:5",
  "fadeV1:15",
  "followV1:5",
  "followV1:15",
  "sweepReclaim:5",
  "sweepReclaim:15",
  "rocPivot:5",
  "rocPivot:15",
  "rocPivotCmoTrend:5",
  "rocPivotCmoTrend:15",
  "bollingerMfi:5",
  "bollingerMfi:15",
  "td9Exhaustion:5",
  "td9Exhaustion:15",
  "stochAdxSnapback:5",
  "stochAdxSnapback:15",
  "idNr4Breakout:5",
  "pairedBookOfiContinuation:5",
  "smoothPathDisplacement:5",
  "smoothPathCausalDisplacement:5",
  "pricerMC:5",
  "pricerMC:15",
  "pricerMC5mTrend:5",
  "pricerMC5mCobraNight:5",
  "pricerBSM:5",
  "pricerBSM:15",
  "pricerBSMWindowProfile:5",
  "pricerBSMPeakRetention:5",
  "pricerBSMOffHours15:15",
  "pricerEmpirical:5",
  "pricerEmpirical:15",
  "alwaysUp:5",
  "alwaysUp:15",
  "macroUpOnly:5",
  "macroUpOnly:15",
  "macroDownOnly:5",
  "macroDownOnly:15",
  "macroTrendSleeve:5",
  "macroTrendSleeve:15",
  "macroRangeFade:5",
  "macroRangeFade:15",
  "macroRegimeRouter:5",
  "macroRegimeRouter:15",
] as const;

/** Frozen comparator exceptions; every other family member uses same-tick Always Down. */
export const PAPER_FAMILYWISE_OPPOSITE_KEYS = [
  "macroUpOnly:5",
  "macroUpOnly:15",
  "macroDownOnly:5",
  "macroDownOnly:15",
] as const;

const MACRO_OPPOSITE_KEYS = new Set<string>(PAPER_FAMILYWISE_OPPOSITE_KEYS);

export interface HolmInput {
  key: string;
  p: number;
}

export interface HolmResult extends HolmInput {
  rank: number;
  threshold: number;
  adjustedP: number;
}

/** Deterministic Holm adjusted p-values. Ties are ordered by frozen key only for display rank. */
export function holmAdjust(
  inputs: HolmInput[],
  alpha = PAPER_FAMILYWISE_GATE.alpha,
): HolmResult[] {
  const sorted = inputs
    .map((input) => ({
      key: input.key,
      p: Number.isFinite(input.p) ? Math.min(1, Math.max(0, input.p)) : 1,
    }))
    .sort((a, b) => a.p - b.p || a.key.localeCompare(b.key));
  let runningAdjusted = 0;
  return sorted.map((input, index) => {
    const remaining = sorted.length - index;
    runningAdjusted = Math.max(runningAdjusted, Math.min(1, input.p * remaining));
    return {
      ...input,
      rank: index + 1,
      threshold: alpha / remaining,
      adjustedP: runningAdjusted,
    };
  });
}

export interface PaperFamilywiseHypothesis extends PaperGateBotResult {
  sourceKey: string;
  horizonMin: 5 | 15;
  comparator: "same-tick Always Down" | "same-tick opposite side";
  rawP: number | null;
  holmAdjustedP: number | null;
  holmRank: number | null;
  holmThreshold: number | null;
  nominalCiPass: boolean;
  requirements: PaperGateBotResult["requirements"] & { clusters: boolean };
}

export interface PaperFamilywiseGate {
  version: typeof PAPER_FAMILYWISE_GATE.version;
  constants: typeof PAPER_FAMILYWISE_GATE;
  familySize: number;
  frozenHypotheses: readonly string[];
  hypotheses: PaperFamilywiseHypothesis[];
}

/**
 * Replace the four asymmetric legacy macro rows with their same-tick opposite-side versions, then
 * apply one Holm family across all 57 frozen units. Missing/unready p-values enter Holm as 1, keeping
 * the family size fixed and preventing low-frequency hypotheses from silently disappearing.
 */
export function applyPaperFamilywiseGate(
  ordinary: PaperGateBotResult[],
  macroOpposite: PaperGateBotResult[],
  nowMs = Date.now(),
): PaperFamilywiseGate {
  const macroByKey = new Map(macroOpposite.map((row) => [row.key, row]));
  const ordinaryByKey = new Map(ordinary.map((row) => [row.key, row]));
  const baseRows = PAPER_FAMILYWISE_HYPOTHESES.map((key) => {
    const row = MACRO_OPPOSITE_KEYS.has(key)
      ? macroByKey.get(key)
      : ordinaryByKey.get(key);
    if (!row) throw new Error(`familywise gate missing frozen hypothesis ${key}`);
    return row;
  });
  const allowed = new Set<string>(PAPER_FAMILYWISE_HYPOTHESES);
  const unexpectedOrdinary = ordinary
    .filter((row) => !MACRO_OPPOSITE_KEYS.has(row.key) && !allowed.has(row.key))
    .map((row) => row.key);
  const unexpectedMacro = macroOpposite
    .filter((row) => !allowed.has(row.key))
    .map((row) => row.key);
  if (unexpectedOrdinary.length || unexpectedMacro.length) {
    throw new Error(
      `familywise gate received unregistered hypotheses: ${[...unexpectedOrdinary, ...unexpectedMacro].join(", ")}`,
    );
  }

  const readiness = new Map(baseRows.map((row) => {
    const clustersReady = (row.residual?.clusters ?? 0) >= PAPER_FAMILYWISE_GATE.minClusters;
    const sampleReady = Object.values(row.requirements).every(Boolean) && clustersReady;
    const rawP = sampleReady ? (row.residual?.pOneSided ?? 1) : null;
    return [row.key, { clustersReady, sampleReady, rawP }] as const;
  }));
  const holm = new Map(holmAdjust(baseRows.map((row) => ({
    key: row.key,
    p: readiness.get(row.key)?.rawP ?? 1,
  }))).map((row) => [row.key, row]));

  const hypotheses: PaperFamilywiseHypothesis[] = baseRows.map((row) => {
    const ready = readiness.get(row.key)!;
    const adjusted = holm.get(row.key)!;
    const nominalCiPass = row.residual?.lo != null && row.residual.lo > 0;
    const effectPass = row.residual != null && row.residual.mean >= PAPER_FAMILYWISE_GATE.minResidual;
    const sessionsPass = row.positiveQualifyingSessions >= PAPER_FAMILYWISE_GATE.sessionsNeeded;
    const holmPass = ready.rawP != null && adjusted.adjustedP <= PAPER_FAMILYWISE_GATE.alpha;
    const passes = ready.sampleReady && nominalCiPass && effectPass && sessionsPass && holmPass;
    const state: PaperGateBotResult["state"] = nowMs < PAPER_FAMILYWISE_GATE.evalStartMs
      ? "waiting"
      : !ready.sampleReady
        ? "collecting"
        : passes
          ? "passing"
          : "failing";
    const [sourceKey, horizonText] = row.key.split(":");
    const horizonMin = Number(horizonText);
    if (horizonMin !== 5 && horizonMin !== 15) {
      throw new Error(`familywise gate invalid horizon in ${row.key}`);
    }
    return {
      ...row,
      sourceKey,
      horizonMin,
      comparator: MACRO_OPPOSITE_KEYS.has(row.key)
        ? "same-tick opposite side"
        : "same-tick Always Down",
      rawP: ready.rawP,
      holmAdjustedP: ready.rawP == null ? null : adjusted.adjustedP,
      holmRank: ready.rawP == null ? null : adjusted.rank,
      holmThreshold: ready.rawP == null ? null : adjusted.threshold,
      nominalCiPass,
      requirements: {
        ...row.requirements,
        clusters: ready.clustersReady,
      },
      state,
    };
  });

  return {
    version: PAPER_FAMILYWISE_GATE.version,
    constants: PAPER_FAMILYWISE_GATE,
    familySize: PAPER_FAMILYWISE_HYPOTHESES.length,
    frozenHypotheses: PAPER_FAMILYWISE_HYPOTHESES,
    hypotheses,
  };
}
