/**
 * Pure in-memory proof of concept for algebraic formula selection with a fixed-time short label.
 *
 * No database, network, strategy registry, paper ledger, account, Crucible, or order dependency is
 * reachable from this module. Callers provide already materialized points. The production contract
 * remains synthetic-only until a separate live-data experiment is preregistered.
 */
import { FORMULAIC_FIXED_HORIZON_POC } from "./formulaic-fixed-horizon-contract.ts";

export type FormulaFeature =
  (typeof FORMULAIC_FIXED_HORIZON_POC.features)[number];

export type FormulaNode =
  | { op: "feature"; feature: FormulaFeature }
  | { op: "constant"; value: number }
  | { op: "neg" | "abs" | "tanh"; child: FormulaNode }
  | {
      op: "add" | "sub" | "mul" | "protectedDiv";
      left: FormulaNode;
      right: FormulaNode;
    };

export type FormulaCandidate = {
  id: string;
  expression: FormulaNode;
  thresholdZ: number;
};

export type FormulaPoint = {
  pair: string;
  atMs: number;
  labelEndAtMs: number;
  entryUnderlyingPrice: number;
  exitUnderlyingPrice: number;
  features: Record<FormulaFeature, number>;
};

export type FormulaAssessmentConfig = {
  holdMs: number;
  folds: number;
  testPointsPerFold: number;
  minimumTrainPoints: number;
  minimumTrainTrades: number;
  minimumTestTrades: number;
  roundTripCostBps: number;
  complexityPenaltyBps: number;
};

type Moments = { mean: number; std: number };
type FeatureMoments = Record<FormulaFeature, Moments>;

export type FormulaMetrics = {
  trades: number;
  meanNetBps: number | null;
  hitRate: number | null;
  standardDeviationBps: number | null;
  standardErrorBps: number | null;
  lowerConfidenceBoundBps: number | null;
};

export type FormulaFoldResult = {
  fold: number;
  trainPoints: number;
  testPoints: number;
  testStartAtMs: number;
  trainLastLabelEndAtMs: number | null;
  selectedCandidateId: string;
  selectedFormula: string;
  selectedComplexity: number;
  trainingMetrics: FormulaMetrics;
  testMetrics: FormulaMetrics;
};

const finite = (value: number) => Number.isFinite(value);
const safe = (value: number): number | null =>
  finite(value)
  && Math.abs(value) <= FORMULAIC_FIXED_HORIZON_POC.grammar.maximumAbsoluteIntermediate
    ? value
    : null;

export function formulaComplexity(node: FormulaNode): number {
  switch (node.op) {
    case "feature":
    case "constant":
      return 1;
    case "neg":
    case "abs":
    case "tanh":
      return 1 + formulaComplexity(node.child);
    case "add":
    case "sub":
    case "mul":
    case "protectedDiv":
      return 1 + formulaComplexity(node.left) + formulaComplexity(node.right);
  }
}

export function formulaDepth(node: FormulaNode): number {
  switch (node.op) {
    case "feature":
    case "constant":
      return 1;
    case "neg":
    case "abs":
    case "tanh":
      return 1 + formulaDepth(node.child);
    case "add":
    case "sub":
    case "mul":
    case "protectedDiv":
      return 1 + Math.max(formulaDepth(node.left), formulaDepth(node.right));
  }
}

export function renderFormula(node: FormulaNode): string {
  switch (node.op) {
    case "feature":
      return node.feature;
    case "constant":
      return String(node.value);
    case "neg":
      return `-(${renderFormula(node.child)})`;
    case "abs":
      return `abs(${renderFormula(node.child)})`;
    case "tanh":
      return `tanh(${renderFormula(node.child)})`;
    case "add":
      return `(${renderFormula(node.left)} + ${renderFormula(node.right)})`;
    case "sub":
      return `(${renderFormula(node.left)} − ${renderFormula(node.right)})`;
    case "mul":
      return `(${renderFormula(node.left)} × ${renderFormula(node.right)})`;
    case "protectedDiv":
      return `(${renderFormula(node.left)} ÷ ${renderFormula(node.right)})`;
  }
}

export function validateFormula(node: FormulaNode): void {
  const complexity = formulaComplexity(node);
  const depth = formulaDepth(node);
  if (complexity > FORMULAIC_FIXED_HORIZON_POC.grammar.maximumNodes) {
    throw new Error(`formula has ${complexity} nodes; maximum is ${FORMULAIC_FIXED_HORIZON_POC.grammar.maximumNodes}`);
  }
  if (depth > FORMULAIC_FIXED_HORIZON_POC.grammar.maximumDepth) {
    throw new Error(`formula has depth ${depth}; maximum is ${FORMULAIC_FIXED_HORIZON_POC.grammar.maximumDepth}`);
  }
  const visit = (current: FormulaNode) => {
    if (current.op === "constant" && !finite(current.value)) {
      throw new Error("formula constant must be finite");
    }
    if (current.op === "neg" || current.op === "abs" || current.op === "tanh") {
      visit(current.child);
    } else if (
      current.op === "add"
      || current.op === "sub"
      || current.op === "mul"
      || current.op === "protectedDiv"
    ) {
      visit(current.left);
      visit(current.right);
    }
  };
  visit(node);
}

export function evaluateFormula(
  node: FormulaNode,
  features: Record<FormulaFeature, number>,
): number | null {
  switch (node.op) {
    case "feature":
      return safe(features[node.feature]);
    case "constant":
      return safe(node.value);
    case "neg":
    case "abs":
    case "tanh": {
      const child = evaluateFormula(node.child, features);
      if (child == null) return null;
      return safe(
        node.op === "neg"
          ? -child
          : node.op === "abs"
            ? Math.abs(child)
            : Math.tanh(child),
      );
    }
    case "add":
    case "sub":
    case "mul":
    case "protectedDiv": {
      const left = evaluateFormula(node.left, features);
      const right = evaluateFormula(node.right, features);
      if (left == null || right == null) return null;
      if (
        node.op === "protectedDiv"
        && Math.abs(right)
          < FORMULAIC_FIXED_HORIZON_POC.grammar.protectedDivisionMinimumDenominator
      ) {
        return null;
      }
      return safe(
        node.op === "add"
          ? left + right
          : node.op === "sub"
            ? left - right
            : node.op === "mul"
              ? left * right
              : left / right,
      );
    }
  }
}

const feature = (name: FormulaFeature): FormulaNode => ({ op: "feature", feature: name });
const neg = (child: FormulaNode): FormulaNode => ({ op: "neg", child });
const binary = (
  op: "add" | "sub" | "mul",
  left: FormulaNode,
  right: FormulaNode,
): FormulaNode => ({ op, left, right });

const SEED_FORMULAS: ReadonlyArray<{ id: string; expression: FormulaNode }> = [
  { id: "cl-1m-momentum-short", expression: neg(feature("chainlinkReturn60s")) },
  { id: "hl-1m-momentum-short", expression: neg(feature("hlReturn60s")) },
  {
    id: "dual-1m-momentum-short",
    expression: neg(binary("add", feature("chainlinkReturn60s"), feature("hlReturn60s"))),
  },
  { id: "cl-1m-reversal-short", expression: feature("chainlinkReturn60s") },
  { id: "hl-1m-reversal-short", expression: feature("hlReturn60s") },
  { id: "positive-basis-short", expression: feature("basisBps") },
  { id: "negative-basis-short", expression: neg(feature("basisBps")) },
  { id: "basis-widening-short", expression: feature("basisChange60sBps") },
  {
    id: "cross-source-disagreement-short",
    expression: binary("sub", feature("chainlinkReturn60s"), feature("hlReturn60s")),
  },
  {
    id: "basis-hl-interaction-short",
    expression: binary("mul", feature("basisBps"), feature("hlReturn60s")),
  },
  {
    id: "persistent-basis-short",
    expression: binary("mul", feature("basisBps"), feature("basisPersistence5s")),
  },
];

export function fixedFormulaCandidates(): FormulaCandidate[] {
  return SEED_FORMULAS.flatMap((seed) =>
    FORMULAIC_FIXED_HORIZON_POC.search.scoreThresholdsZ.map((thresholdZ) => ({
      id: `${seed.id}:z${thresholdZ}`,
      expression: seed.expression,
      thresholdZ,
    })));
}

function moments(values: number[]): Moments | null {
  if (!values.length) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.length > 1
    ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
    : 0;
  const std = Math.sqrt(Math.max(0, variance));
  return finite(mean) && finite(std) ? { mean, std } : null;
}

function trainingFeatureMoments(points: FormulaPoint[]): FeatureMoments {
  return Object.fromEntries(
    FORMULAIC_FIXED_HORIZON_POC.features.map((name) => {
      const result = moments(points.map((point) => point.features[name]).filter(finite));
      if (!result) throw new Error(`training fold has no finite ${name}`);
      return [name, result];
    }),
  ) as FeatureMoments;
}

function standardizedFeatures(
  point: FormulaPoint,
  stats: FeatureMoments,
): Record<FormulaFeature, number> {
  return Object.fromEntries(
    FORMULAIC_FIXED_HORIZON_POC.features.map((name) => {
      const raw = point.features[name];
      const { mean, std } = stats[name];
      return [name, finite(raw) ? (std > 1e-12 ? (raw - mean) / std : 0) : Number.NaN];
    }),
  ) as Record<FormulaFeature, number>;
}

function formulaOutputMoments(
  points: FormulaPoint[],
  candidate: FormulaCandidate,
  featureStats: FeatureMoments,
): Moments | null {
  return moments(
    points
      .map((point) => evaluateFormula(candidate.expression, standardizedFeatures(point, featureStats)))
      .filter((value): value is number => value != null),
  );
}

function metrics(netBps: number[]): FormulaMetrics {
  if (!netBps.length) {
    return {
      trades: 0,
      meanNetBps: null,
      hitRate: null,
      standardDeviationBps: null,
      standardErrorBps: null,
      lowerConfidenceBoundBps: null,
    };
  }
  const result = moments(netBps);
  if (!result) throw new Error("invalid formula return distribution");
  const standardError = result.std / Math.sqrt(netBps.length);
  return {
    trades: netBps.length,
    meanNetBps: result.mean,
    hitRate: netBps.filter((value) => value > 0).length / netBps.length,
    standardDeviationBps: result.std,
    standardErrorBps: standardError,
    lowerConfidenceBoundBps: result.mean - 1.645 * standardError,
  };
}

function assessCandidate(
  points: FormulaPoint[],
  candidate: FormulaCandidate,
  featureStats: FeatureMoments,
  outputStats: Moments,
  config: FormulaAssessmentConfig,
): FormulaMetrics {
  const netBps: number[] = [];
  let nextEligibleAtMs = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (point.atMs < nextEligibleAtMs) continue;
    const raw = evaluateFormula(
      candidate.expression,
      standardizedFeatures(point, featureStats),
    );
    if (raw == null || outputStats.std <= 1e-12) continue;
    const scoreZ = (raw - outputStats.mean) / outputStats.std;
    if (!finite(scoreZ) || scoreZ < candidate.thresholdZ) continue;
    if (
      point.labelEndAtMs !== point.atMs + config.holdMs
      || point.entryUnderlyingPrice <= 0
      || point.exitUnderlyingPrice <= 0
    ) {
      continue;
    }
    const shortGrossBps =
      10_000 * Math.log(point.entryUnderlyingPrice / point.exitUnderlyingPrice);
    if (!finite(shortGrossBps)) continue;
    netBps.push(shortGrossBps - config.roundTripCostBps);
    nextEligibleAtMs = point.labelEndAtMs;
  }
  return metrics(netBps);
}

function validateInputs(
  points: FormulaPoint[],
  candidates: FormulaCandidate[],
  config: FormulaAssessmentConfig,
) {
  if (
    !Number.isSafeInteger(config.holdMs)
    || config.holdMs <= 0
    || !Number.isSafeInteger(config.folds)
    || config.folds < 1
    || !Number.isSafeInteger(config.testPointsPerFold)
    || config.testPointsPerFold < 1
    || !Number.isSafeInteger(config.minimumTrainPoints)
    || config.minimumTrainPoints < 2
    || !Number.isSafeInteger(config.minimumTrainTrades)
    || config.minimumTrainTrades < 1
    || !Number.isSafeInteger(config.minimumTestTrades)
    || config.minimumTestTrades < 1
    || !finite(config.roundTripCostBps)
    || config.roundTripCostBps < 0
    || !finite(config.complexityPenaltyBps)
    || config.complexityPenaltyBps < 0
  ) {
    throw new Error("invalid formula assessment config");
  }
  if (!candidates.length) throw new Error("formula assessment requires candidates");
  const ids = new Set<string>();
  for (const candidate of candidates) {
    validateFormula(candidate.expression);
    if (!candidate.id || ids.has(candidate.id)) {
      throw new Error("formula candidate ids must be non-empty and unique");
    }
    if (!finite(candidate.thresholdZ) || candidate.thresholdZ < 0) {
      throw new Error("formula threshold must be finite and non-negative");
    }
    ids.add(candidate.id);
  }
  const pairs = new Set(points.map((point) => point.pair));
  if (pairs.size !== 1) throw new Error("one formula assessment may contain exactly one pair");
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    if (
      !Number.isSafeInteger(point.atMs)
      || !Number.isSafeInteger(point.labelEndAtMs)
      || point.entryUnderlyingPrice <= 0
      || point.exitUnderlyingPrice <= 0
      || (index > 0 && point.atMs <= points[index - 1].atMs)
    ) {
      throw new Error("formula points must be valid, strictly chronological, and positive-priced");
    }
  }
}

export function walkForwardFormulaAssessment(
  points: FormulaPoint[],
  candidates: FormulaCandidate[],
  config: FormulaAssessmentConfig,
) {
  validateInputs(points, candidates, config);
  const firstTestIndex = points.length - config.folds * config.testPointsPerFold;
  if (firstTestIndex < config.minimumTrainPoints) {
    throw new Error("insufficient points for the requested formula walk-forward");
  }

  const folds: FormulaFoldResult[] = [];
  const aggregateTestValues: number[] = [];
  for (let fold = 0; fold < config.folds; fold++) {
    const testStartIndex = firstTestIndex + fold * config.testPointsPerFold;
    const testEndIndex = testStartIndex + config.testPointsPerFold;
    const test = points.slice(testStartIndex, testEndIndex);
    const testStartAtMs = test[0].atMs;
    const train = points
      .slice(0, testStartIndex)
      .filter((point) => point.labelEndAtMs <= testStartAtMs);
    if (train.length < config.minimumTrainPoints) {
      throw new Error(`fold ${fold} has insufficient purged training points`);
    }
    const featureStats = trainingFeatureMoments(train);
    const ranked = candidates
      .map((candidate) => {
        const outputStats = formulaOutputMoments(train, candidate, featureStats);
        if (!outputStats || outputStats.std <= 1e-12) return null;
        const trainingMetrics = assessCandidate(
          train,
          candidate,
          featureStats,
          outputStats,
          config,
        );
        if (
          trainingMetrics.trades < config.minimumTrainTrades
          || trainingMetrics.lowerConfidenceBoundBps == null
        ) {
          return null;
        }
        return {
          candidate,
          outputStats,
          trainingMetrics,
          selectionScore:
            trainingMetrics.lowerConfidenceBoundBps
            - config.complexityPenaltyBps * formulaComplexity(candidate.expression),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item != null)
      .sort((left, right) =>
        right.selectionScore - left.selectionScore
        || formulaComplexity(left.candidate.expression)
          - formulaComplexity(right.candidate.expression)
        || left.candidate.id.localeCompare(right.candidate.id));
    const selected = ranked[0];
    if (!selected) throw new Error(`fold ${fold} has no eligible training formula`);
    const testMetrics = assessCandidate(
      test,
      selected.candidate,
      featureStats,
      selected.outputStats,
      config,
    );
    if (testMetrics.trades < config.minimumTestTrades) {
      throw new Error(`fold ${fold} selected formula has insufficient test trades`);
    }

    // Reconstruct only aggregate moments from fold-level observations is not exact, so the POC
    // reports fold metrics and a trade-weighted mean rather than inventing a pooled variance.
    if (testMetrics.meanNetBps != null) {
      for (let i = 0; i < testMetrics.trades; i++) {
        aggregateTestValues.push(testMetrics.meanNetBps);
      }
    }
    folds.push({
      fold,
      trainPoints: train.length,
      testPoints: test.length,
      testStartAtMs,
      trainLastLabelEndAtMs: train.at(-1)?.labelEndAtMs ?? null,
      selectedCandidateId: selected.candidate.id,
      selectedFormula: renderFormula(selected.candidate.expression),
      selectedComplexity: formulaComplexity(selected.candidate.expression),
      trainingMetrics: selected.trainingMetrics,
      testMetrics,
    });
  }

  return {
    version: FORMULAIC_FIXED_HORIZON_POC.version,
    pair: points[0].pair,
    holdMs: config.holdMs,
    candidatesEvaluated: candidates.length,
    folds,
    aggregate: {
      folds: folds.length,
      trades: folds.reduce((sum, fold) => sum + fold.testMetrics.trades, 0),
      tradeWeightedMeanNetBps:
        aggregateTestValues.length
          ? aggregateTestValues.reduce((sum, value) => sum + value, 0)
            / aggregateTestValues.length
          : null,
      positiveFolds: folds.filter(
        (fold) => (fold.testMetrics.meanNetBps ?? Number.NEGATIVE_INFINITY) > 0,
      ).length,
    },
    disposition:
      "synthetic proof only; any selected expression remains a hypothesis requiring a new forward paper boundary",
  };
}
