/**
 * Deterministic, in-memory mechanics for large Formula Lab experiments.
 *
 * This module deliberately has no database, queue, strategy registry, paper ledger, account,
 * Crucible, or execution dependency. A caller materializes one causal dataset once, generates an
 * immutable candidate manifest, evaluates bounded shards, and may freeze a small selection behind
 * a new untouched validation boundary. Discovery results never become a strategy verdict.
 */
import { createHash } from "node:crypto";
import { FORMULAIC_FIXED_HORIZON_POC } from "./formulaic-fixed-horizon-contract.ts";
import {
  formulaComplexity,
  formulaDepth,
  renderFormula,
  validateFormula,
  type FormulaCandidate,
  type FormulaFeature,
  type FormulaNode,
  type FormulaPoint,
} from "./formulaic-fixed-horizon-poc.ts";

export const FORMULAIC_SCALE_ENGINE = {
  version: "alchemy-formula-scale-engine-v1",
  generatorVersion: "bounded-enumeration-v1",
  maximumVariants: 50_000,
  defaultVariantCount: 10_000,
  defaultShardSize: 250,
  scoreThresholdsZ: [0, 0.5, 1, 1.5] as const,
  validation: {
    discoveryCanRank: true,
    discoveryCanAuthorizeStrategy: false,
    selectedVariantsRequireNewForwardBoundary: true,
    validationCorrection: "Holm",
    validationAlpha: 0.05,
  },
  invariants: {
    materializesSourceOncePerExperiment: true,
    oneCandidateDefinitionPerManifestEntry: true,
    oneResultPerCandidateTargetUnit: true,
    readsPaperOutcomes: false,
    createsStrategy: false,
    createsPaperBot: false,
    startsCrucibleRun: false,
    enablesExecution: false,
    preservesVerdictGate: true,
  },
} as const;

export type FormulaTargetUnit = {
  key: string;
  adapter: string;
  pair: string;
  holdSeconds: number;
  roundTripCostBps: number;
};

export type FormulaVariantManifest = {
  version: typeof FORMULAIC_SCALE_ENGINE.version;
  generatorVersion: typeof FORMULAIC_SCALE_ENGINE.generatorVersion;
  seed: string;
  variantCount: number;
  thresholdsZ: readonly number[];
  candidateManifestHash: string;
  candidates: FormulaCandidate[];
};

export type FormulaExperimentShard = {
  id: string;
  targetKey: string;
  index: number;
  candidateStart: number;
  candidateEndExclusive: number;
  candidateCount: number;
  candidateHash: string;
};

export type FormulaExperimentPlan = {
  version: typeof FORMULAIC_SCALE_ENGINE.version;
  experimentId: string;
  createdAtMs: number;
  dataEndExclusiveMs: number;
  candidateManifestHash: string;
  variantCount: number;
  targetCount: number;
  evaluationUnitCount: number;
  shardSize: number;
  shardCount: number;
  targets: FormulaTargetUnit[];
  shards: FormulaExperimentShard[];
  family: {
    discoveryTrials: number;
    expectedFalsePositivesAtNominalFivePercent: number;
    discoveryIsEvidence: false;
    validationRequiresNewBoundary: true;
  };
};

export type FormulaShardAssessmentConfig = {
  holdMs: number;
  roundTripCostBps: number;
  minimumTrades: number;
  complexityPenaltyBps: number;
  familySize: number;
};

export type FormulaMoments = {
  mean: number;
  std: number;
};

export type FormulaFeatureCalibration = Record<FormulaFeature, FormulaMoments>;

export type FormulaVariantResult = {
  candidateId: string;
  formula: string;
  thresholdZ: number;
  complexity: number;
  validOutputs: number;
  trades: number;
  meanGrossBps: number | null;
  meanNetBps: number | null;
  hitRate: number | null;
  standardErrorBps: number | null;
  lowerConfidenceBoundBps: number | null;
  selectionScore: number | null;
  eligible: boolean;
  outputCalibration: FormulaMoments | null;
};

export type FormulaShardResult = {
  version: typeof FORMULAIC_SCALE_ENGINE.version;
  targetKey: string;
  candidateHash: string;
  candidatesEvaluated: number;
  pointsEvaluated: number;
  formulaPointEvaluations: number;
  familySize: number;
  bonferroniAlpha: number;
  featureCalibration: FormulaFeatureCalibration;
  results: FormulaVariantResult[];
};

export type FormulaValidationSelection = {
  version: "alchemy-formula-validation-selection-v2";
  experimentId: string;
  targetKey: string;
  candidateManifestHash: string;
  discoveryFamilySize: number;
  validationFamilySize: number;
  correction: "Holm";
  alpha: number;
  createdAtMs: number;
  forwardBoundaryMs: number;
  featureCalibration: FormulaFeatureCalibration;
  selected: Array<{
    candidateId: string;
    expression: FormulaNode;
    formula: string;
    thresholdZ: number;
    complexity: number;
    discoverySelectionScore: number;
    outputCalibration: FormulaMoments;
  }>;
  executionAllowed: false;
  strategyRegistrationAllowed: false;
  selectionHash: string;
};

export type FormulaValidationResult = {
  version: "alchemy-formula-validation-result-v1";
  selectionHash: string;
  targetKey: string;
  forwardBoundaryMs: number;
  evaluatedThroughMs: number;
  validationFamilySize: number;
  correction: "Holm";
  alpha: number;
  pValueMethod: "one-sided-normal-approximation";
  candidates: Array<{
    candidateId: string;
    trades: number;
    meanGrossBps: number | null;
    meanNetBps: number | null;
    hitRate: number | null;
    standardErrorBps: number | null;
    lowerConfidenceBoundBps: number | null;
    oneSidedPValue: number | null;
    holmRank: number;
    holmThreshold: number;
    familywisePass: boolean;
  }>;
  passingCandidates: number;
  verdictReviewEligible: boolean;
  executionAllowed: false;
  strategyRegistrationAllowed: false;
};

type Moments = FormulaMoments;
type CompiledInstruction =
  | { op: "feature"; index: number }
  | { op: "constant"; value: number }
  | { op: "neg" | "abs" | "tanh" | "add" | "sub" | "mul" | "protectedDiv" };

const FEATURES = [...FORMULAIC_FIXED_HORIZON_POC.features];
const UNARY_OPERATORS = [...FORMULAIC_FIXED_HORIZON_POC.grammar.unaryOperators];
const BINARY_OPERATORS = [...FORMULAIC_FIXED_HORIZON_POC.grammar.binaryOperators];

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function thresholdKey(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace(".", "p");
}

function canonicalNode(node: FormulaNode): FormulaNode {
  if (node.op === "feature" || node.op === "constant") return node;
  if ("child" in node) {
    return { op: node.op, child: canonicalNode(node.child) };
  }
  const left = canonicalNode(node.left);
  const right = canonicalNode(node.right);
  if (node.op === "add" || node.op === "mul") {
    return nodeKey(left) <= nodeKey(right)
      ? { op: node.op, left, right }
      : { op: node.op, left: right, right: left };
  }
  return { op: node.op, left, right };
}

function nodeKey(node: FormulaNode): string {
  if (node.op === "feature") return `f:${node.feature}`;
  if (node.op === "constant") return `c:${node.value}`;
  if ("child" in node) {
    return `${node.op}(${nodeKey(node.child)})`;
  }
  return `${node.op}(${nodeKey(node.left)},${nodeKey(node.right)})`;
}

function formulaPool(seed: string, required: number): FormulaNode[] {
  const leaves: FormulaNode[] = FEATURES.map((feature) => ({ op: "feature", feature }));
  const primitives: FormulaNode[] = [
    ...leaves,
    ...UNARY_OPERATORS.flatMap((op) =>
      leaves.map((child): FormulaNode => ({ op, child }))),
  ];
  const dedup = new Map<string, FormulaNode>();
  const add = (expression: FormulaNode) => {
    const canonical = canonicalNode(expression);
    try {
      validateFormula(canonical);
    } catch {
      return;
    }
    const key = nodeKey(canonical);
    // Exact structural constants such as x-x and x/x add no new hypothesis.
    if (
      (canonical.op === "sub" || canonical.op === "protectedDiv")
      && nodeKey(canonical.left) === nodeKey(canonical.right)
    ) {
      return;
    }
    dedup.set(key, canonical);
  };
  primitives.forEach(add);
  for (const op of BINARY_OPERATORS) {
    for (const left of primitives) {
      for (const right of primitives) {
        add({ op, left, right });
      }
    }
  }
  // Binary primitive enumeration is just shy of 2,500 unique expressions after symmetry
  // canonicalization. Wrap simple two-feature expressions to extend the bounded pool.
  for (const unary of UNARY_OPERATORS) {
    for (const binary of BINARY_OPERATORS) {
      for (const left of leaves) {
        for (const right of leaves) {
          add({ op: unary, child: { op: binary, left, right } });
        }
      }
    }
  }
  if (dedup.size < required) {
    throw new Error(`bounded formula pool has ${dedup.size} expressions; ${required} required`);
  }
  return [...dedup.entries()]
    .sort(([left], [right]) =>
      sha256(`${seed}\0${left}`).localeCompare(sha256(`${seed}\0${right}`))
      || left.localeCompare(right))
    .slice(0, required)
    .map(([, expression]) => expression);
}

export function generateFormulaVariantManifest(input: {
  seed: string;
  variantCount?: number;
  thresholdsZ?: readonly number[];
}): FormulaVariantManifest {
  const seed = input.seed.trim();
  const variantCount =
    input.variantCount ?? FORMULAIC_SCALE_ENGINE.defaultVariantCount;
  const thresholdsZ =
    input.thresholdsZ ?? FORMULAIC_SCALE_ENGINE.scoreThresholdsZ;
  if (!seed) throw new Error("formula variant seed is required");
  if (
    !Number.isSafeInteger(variantCount)
    || variantCount < 1
    || variantCount > FORMULAIC_SCALE_ENGINE.maximumVariants
  ) {
    throw new Error(
      `formula variant count must be between 1 and ${FORMULAIC_SCALE_ENGINE.maximumVariants}`,
    );
  }
  if (
    !thresholdsZ.length
    || new Set(thresholdsZ).size !== thresholdsZ.length
    || thresholdsZ.some((value) => !finite(value) || value < 0)
  ) {
    throw new Error("formula thresholds must be unique, finite, and non-negative");
  }
  const expressions = formulaPool(
    seed,
    Math.ceil(variantCount / thresholdsZ.length),
  );
  const candidates = expressions
    .flatMap((expression) => {
      const expressionHash = sha256(nodeKey(expression)).slice(0, 20);
      return thresholdsZ.map((thresholdZ): FormulaCandidate => ({
        id: `fx-${expressionHash}:z${thresholdKey(thresholdZ)}`,
        expression,
        thresholdZ,
      }));
    })
    .slice(0, variantCount);
  const candidateManifestHash = sha256(JSON.stringify({
    version: FORMULAIC_SCALE_ENGINE.version,
    generatorVersion: FORMULAIC_SCALE_ENGINE.generatorVersion,
    seed,
    variantCount,
    thresholdsZ,
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      expression: nodeKey(candidate.expression),
      thresholdZ: candidate.thresholdZ,
    })),
  }));
  return {
    version: FORMULAIC_SCALE_ENGINE.version,
    generatorVersion: FORMULAIC_SCALE_ENGINE.generatorVersion,
    seed,
    variantCount,
    thresholdsZ: [...thresholdsZ],
    candidateManifestHash,
    candidates,
  };
}

export function planFormulaExperiment(input: {
  manifest: FormulaVariantManifest;
  targets: FormulaTargetUnit[];
  createdAtMs: number;
  dataEndExclusiveMs: number;
  shardSize?: number;
}): FormulaExperimentPlan {
  const { manifest } = input;
  const shardSize = input.shardSize ?? FORMULAIC_SCALE_ENGINE.defaultShardSize;
  if (
    !Number.isSafeInteger(input.createdAtMs)
    || !Number.isSafeInteger(input.dataEndExclusiveMs)
    || input.dataEndExclusiveMs > input.createdAtMs
  ) {
    throw new Error("formula experiment requires an immutable data cut at or before creation");
  }
  if (!Number.isSafeInteger(shardSize) || shardSize < 1 || shardSize > 2_000) {
    throw new Error("formula shard size must be between 1 and 2000");
  }
  if (!input.targets.length) throw new Error("formula experiment requires targets");
  const targetKeys = new Set<string>();
  for (const target of input.targets) {
    if (
      !target.key
      || targetKeys.has(target.key)
      || !target.adapter
      || !target.pair
      || !Number.isSafeInteger(target.holdSeconds)
      || target.holdSeconds < 1
      || !finite(target.roundTripCostBps)
      || target.roundTripCostBps < 0
    ) {
      throw new Error("formula targets must be unique and valid");
    }
    targetKeys.add(target.key);
  }
  const shards = input.targets.flatMap((target) => {
    const targetShards: FormulaExperimentShard[] = [];
    for (
      let candidateStart = 0, index = 0;
      candidateStart < manifest.candidates.length;
      candidateStart += shardSize, index++
    ) {
      const candidateEndExclusive = Math.min(
        candidateStart + shardSize,
        manifest.candidates.length,
      );
      const candidateIds = manifest.candidates
        .slice(candidateStart, candidateEndExclusive)
        .map((candidate) => candidate.id);
      targetShards.push({
        id: `${target.key}:${String(index).padStart(4, "0")}`,
        targetKey: target.key,
        index,
        candidateStart,
        candidateEndExclusive,
        candidateCount: candidateEndExclusive - candidateStart,
        candidateHash: sha256(candidateIds.join("\n")),
      });
    }
    return targetShards;
  });
  const experimentId = `formula-${sha256(JSON.stringify({
    candidateManifestHash: manifest.candidateManifestHash,
    targets: input.targets,
    dataEndExclusiveMs: input.dataEndExclusiveMs,
  })).slice(0, 20)}`;
  const evaluationUnitCount = manifest.variantCount * input.targets.length;
  return {
    version: FORMULAIC_SCALE_ENGINE.version,
    experimentId,
    createdAtMs: input.createdAtMs,
    dataEndExclusiveMs: input.dataEndExclusiveMs,
    candidateManifestHash: manifest.candidateManifestHash,
    variantCount: manifest.variantCount,
    targetCount: input.targets.length,
    evaluationUnitCount,
    shardSize,
    shardCount: shards.length,
    targets: input.targets.map((target) => ({ ...target })),
    shards,
    family: {
      discoveryTrials: evaluationUnitCount,
      expectedFalsePositivesAtNominalFivePercent: evaluationUnitCount * 0.05,
      discoveryIsEvidence: false,
      validationRequiresNewBoundary: true,
    },
  };
}

function moments(values: number[]): Moments | null {
  if (!values.length) return null;
  let mean = 0;
  let m2 = 0;
  let count = 0;
  for (const value of values) {
    if (!finite(value)) continue;
    count++;
    const delta = value - mean;
    mean += delta / count;
    m2 += delta * (value - mean);
  }
  if (!count) return null;
  return {
    mean,
    std: count > 1 ? Math.sqrt(Math.max(0, m2 / (count - 1))) : 0,
  };
}

function compileFormula(node: FormulaNode): CompiledInstruction[] {
  if (node.op === "feature") {
    const index = FEATURES.indexOf(node.feature);
    if (index < 0) throw new Error(`unknown formula feature ${node.feature}`);
    return [{ op: "feature", index }];
  }
  if (node.op === "constant") return [{ op: "constant", value: node.value }];
  if ("child" in node) {
    return [...compileFormula(node.child), { op: node.op }];
  }
  return [
    ...compileFormula(node.left),
    ...compileFormula(node.right),
    { op: node.op },
  ];
}

function evaluateProgram(
  program: CompiledInstruction[],
  columns: Float64Array[],
  row: number,
  stack: Float64Array,
): number {
  let pointer = 0;
  for (const instruction of program) {
    if (instruction.op === "feature") {
      stack[pointer++] = columns[instruction.index][row];
      continue;
    }
    if (instruction.op === "constant") {
      stack[pointer++] = instruction.value;
      continue;
    }
    if (
      instruction.op === "neg"
      || instruction.op === "abs"
      || instruction.op === "tanh"
    ) {
      const child = stack[pointer - 1];
      stack[pointer - 1] =
        instruction.op === "neg"
          ? -child
          : instruction.op === "abs"
            ? Math.abs(child)
            : Math.tanh(child);
      continue;
    }
    const right = stack[--pointer];
    const left = stack[pointer - 1];
    if (
      instruction.op === "protectedDiv"
      && Math.abs(right)
        < FORMULAIC_FIXED_HORIZON_POC.grammar.protectedDivisionMinimumDenominator
    ) {
      stack[pointer - 1] = Number.NaN;
      continue;
    }
    const value =
      instruction.op === "add"
        ? left + right
        : instruction.op === "sub"
          ? left - right
          : instruction.op === "mul"
            ? left * right
            : left / right;
    stack[pointer - 1] =
      finite(value)
      && Math.abs(value)
        <= FORMULAIC_FIXED_HORIZON_POC.grammar.maximumAbsoluteIntermediate
        ? value
        : Number.NaN;
  }
  return pointer === 1 ? stack[0] : Number.NaN;
}

function validateFeatureCalibration(
  calibration: FormulaFeatureCalibration,
): void {
  for (const feature of FEATURES) {
    const value = calibration[feature];
    if (
      !value
      || !finite(value.mean)
      || !finite(value.std)
      || value.std < 0
    ) {
      throw new Error(`formula feature calibration is invalid for ${feature}`);
    }
  }
}

function prepareColumns(
  points: FormulaPoint[],
  frozenCalibration?: FormulaFeatureCalibration,
) {
  const featureCalibration = frozenCalibration
    ? structuredClone(frozenCalibration)
    : Object.fromEntries(
      FEATURES.map((feature) => [
        feature,
        moments(points.map((point) => point.features[feature])),
      ]),
    ) as Record<FormulaFeature, Moments | null>;
  if (FEATURES.some((feature) => featureCalibration[feature] == null)) {
    throw new Error("formula shard has a feature with no finite observations");
  }
  validateFeatureCalibration(
    featureCalibration as FormulaFeatureCalibration,
  );
  const columns = FEATURES.map((feature) => {
    const result = new Float64Array(points.length);
    const stats = featureCalibration[feature]!;
    for (let row = 0; row < points.length; row++) {
      const value = points[row].features[feature];
      result[row] = finite(value)
        ? stats.std > 1e-12
          ? (value - stats.mean) / stats.std
          : 0
        : Number.NaN;
    }
    return result;
  });
  const grossBps = new Float64Array(points.length);
  for (let row = 0; row < points.length; row++) {
    grossBps[row] =
      10_000
      * Math.log(
        points[row].entryUnderlyingPrice / points[row].exitUnderlyingPrice,
      );
  }
  return {
    columns,
    grossBps,
    featureCalibration: featureCalibration as FormulaFeatureCalibration,
  };
}

function validateShardInputs(
  points: FormulaPoint[],
  candidates: FormulaCandidate[],
  config: FormulaShardAssessmentConfig,
) {
  if (!points.length || !candidates.length) {
    throw new Error("formula shard requires points and candidates");
  }
  if (
    !Number.isSafeInteger(config.holdMs)
    || config.holdMs < 1
    || !finite(config.roundTripCostBps)
    || config.roundTripCostBps < 0
    || !Number.isSafeInteger(config.minimumTrades)
    || config.minimumTrades < 1
    || !finite(config.complexityPenaltyBps)
    || config.complexityPenaltyBps < 0
    || !Number.isSafeInteger(config.familySize)
    || config.familySize < candidates.length
  ) {
    throw new Error("invalid formula shard assessment config");
  }
  const pair = points[0].pair;
  const ids = new Set<string>();
  for (const candidate of candidates) {
    validateFormula(candidate.expression);
    if (!candidate.id || ids.has(candidate.id)) {
      throw new Error("formula shard candidate ids must be unique");
    }
    ids.add(candidate.id);
  }
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    if (
      point.pair !== pair
      || !Number.isSafeInteger(point.atMs)
      || !Number.isSafeInteger(point.labelEndAtMs)
      || point.labelEndAtMs !== point.atMs + config.holdMs
      || point.entryUnderlyingPrice <= 0
      || point.exitUnderlyingPrice <= 0
      || (index > 0 && point.atMs <= points[index - 1].atMs)
    ) {
      throw new Error(
        "formula shard points must be one target, exact-label, and chronological",
      );
    }
  }
}

export function evaluateFormulaShard(input: {
  targetKey: string;
  points: FormulaPoint[];
  candidates: FormulaCandidate[];
  candidateHash?: string;
  config: FormulaShardAssessmentConfig;
}): FormulaShardResult {
  validateShardInputs(input.points, input.candidates, input.config);
  const prepared = prepareColumns(input.points);
  const outputs = new Float64Array(input.points.length);
  const stack = new Float64Array(
    FORMULAIC_FIXED_HORIZON_POC.grammar.maximumNodes,
  );
  const results = input.candidates.map((candidate): FormulaVariantResult => {
    const program = compileFormula(candidate.expression);
    let outputCount = 0;
    let outputMean = 0;
    let outputM2 = 0;
    for (let row = 0; row < input.points.length; row++) {
      const value = evaluateProgram(program, prepared.columns, row, stack);
      outputs[row] = value;
      if (!finite(value)) continue;
      outputCount++;
      const delta = value - outputMean;
      outputMean += delta / outputCount;
      outputM2 += delta * (value - outputMean);
    }
    const outputStd =
      outputCount > 1
        ? Math.sqrt(Math.max(0, outputM2 / (outputCount - 1)))
        : 0;
    let trades = 0;
    let netMean = 0;
    let netM2 = 0;
    let hits = 0;
    let grossSum = 0;
    let nextEligibleAtMs = Number.NEGATIVE_INFINITY;
    if (outputStd > 1e-12) {
      for (let row = 0; row < input.points.length; row++) {
        const point = input.points[row];
        if (point.atMs < nextEligibleAtMs) continue;
        const value = outputs[row];
        if (!finite(value)) continue;
        const scoreZ = (value - outputMean) / outputStd;
        if (!finite(scoreZ) || scoreZ < candidate.thresholdZ) continue;
        const gross = prepared.grossBps[row];
        if (!finite(gross)) continue;
        const net = gross - input.config.roundTripCostBps;
        trades++;
        grossSum += gross;
        if (net > 0) hits++;
        const delta = net - netMean;
        netMean += delta / trades;
        netM2 += delta * (net - netMean);
        nextEligibleAtMs = point.labelEndAtMs;
      }
    }
    const standardDeviation =
      trades > 1 ? Math.sqrt(Math.max(0, netM2 / (trades - 1))) : 0;
    const standardError = trades ? standardDeviation / Math.sqrt(trades) : null;
    const lowerConfidenceBound =
      standardError == null ? null : netMean - 1.645 * standardError;
    const eligible =
      trades >= input.config.minimumTrades
      && lowerConfidenceBound != null;
    return {
      candidateId: candidate.id,
      formula: renderFormula(candidate.expression),
      thresholdZ: candidate.thresholdZ,
      complexity: formulaComplexity(candidate.expression),
      validOutputs: outputCount,
      trades,
      meanGrossBps: trades ? grossSum / trades : null,
      meanNetBps: trades ? netMean : null,
      hitRate: trades ? hits / trades : null,
      standardErrorBps: standardError,
      lowerConfidenceBoundBps: lowerConfidenceBound,
      selectionScore: eligible
        ? lowerConfidenceBound!
          - input.config.complexityPenaltyBps
            * formulaComplexity(candidate.expression)
        : null,
      eligible,
      outputCalibration: outputCount
        ? { mean: outputMean, std: outputStd }
        : null,
    };
  });
  return {
    version: FORMULAIC_SCALE_ENGINE.version,
    targetKey: input.targetKey,
    candidateHash:
      input.candidateHash
      ?? sha256(input.candidates.map((candidate) => candidate.id).join("\n")),
    candidatesEvaluated: input.candidates.length,
    pointsEvaluated: input.points.length,
    formulaPointEvaluations:
      input.candidates.length * input.points.length,
    familySize: input.config.familySize,
    bonferroniAlpha:
      FORMULAIC_SCALE_ENGINE.validation.validationAlpha
      / input.config.familySize,
    featureCalibration: prepared.featureCalibration,
    results,
  };
}

export function freezeFormulaValidationSelection(input: {
  experiment: FormulaExperimentPlan;
  manifest: FormulaVariantManifest;
  targetKey: string;
  discoveryFeatureCalibration: FormulaFeatureCalibration;
  discoveryResults: FormulaVariantResult[];
  topK: number;
  createdAtMs: number;
  forwardBoundaryMs: number;
}): FormulaValidationSelection {
  if (
    input.manifest.candidateManifestHash
      !== input.experiment.candidateManifestHash
  ) {
    throw new Error("formula selection manifest does not match experiment");
  }
  if (
    !input.experiment.targets.some((target) => target.key === input.targetKey)
  ) {
    throw new Error("formula selection target is not in the experiment");
  }
  if (
    !Number.isSafeInteger(input.topK)
    || input.topK < 1
    || input.topK > input.discoveryResults.length
  ) {
    throw new Error("formula selection topK is invalid");
  }
  if (
    !Number.isSafeInteger(input.createdAtMs)
    || !Number.isSafeInteger(input.forwardBoundaryMs)
    || input.createdAtMs < input.experiment.dataEndExclusiveMs
    || input.forwardBoundaryMs <= input.createdAtMs
  ) {
    throw new Error("formula validation requires a new future boundary");
  }
  validateFeatureCalibration(input.discoveryFeatureCalibration);
  const candidateById = new Map(
    input.manifest.candidates.map((candidate) => [candidate.id, candidate]),
  );
  if (
    new Set(input.discoveryResults.map((result) => result.candidateId)).size
      !== input.discoveryResults.length
  ) {
    throw new Error("formula discovery results contain duplicate candidates");
  }
  const eligible = input.discoveryResults
    .filter((result) =>
      result.eligible
      && result.selectionScore != null
      && result.outputCalibration != null
      && finite(result.outputCalibration.mean)
      && finite(result.outputCalibration.std)
      && result.outputCalibration.std > 1e-12
      && candidateById.has(result.candidateId))
    .sort((left, right) =>
      right.selectionScore! - left.selectionScore!
      || left.complexity - right.complexity
      || left.candidateId.localeCompare(right.candidateId));
  if (eligible.length < input.topK) {
    throw new Error("formula discovery produced too few eligible selections");
  }
  const selected = eligible.slice(0, input.topK).map((result) => {
    const candidate = candidateById.get(result.candidateId)!;
    return {
      candidateId: candidate.id,
      expression: candidate.expression,
      formula: renderFormula(candidate.expression),
      thresholdZ: candidate.thresholdZ,
      complexity: formulaComplexity(candidate.expression),
      discoverySelectionScore: result.selectionScore!,
      outputCalibration: structuredClone(result.outputCalibration!),
    };
  });
  const selection = {
    version: "alchemy-formula-validation-selection-v2" as const,
    experimentId: input.experiment.experimentId,
    targetKey: input.targetKey,
    candidateManifestHash: input.manifest.candidateManifestHash,
    discoveryFamilySize: input.experiment.evaluationUnitCount,
    validationFamilySize: selected.length,
    correction: FORMULAIC_SCALE_ENGINE.validation.validationCorrection,
    alpha: FORMULAIC_SCALE_ENGINE.validation.validationAlpha,
    createdAtMs: input.createdAtMs,
    forwardBoundaryMs: input.forwardBoundaryMs,
    featureCalibration: structuredClone(input.discoveryFeatureCalibration),
    selected,
    executionAllowed: false as const,
    strategyRegistrationAllowed: false as const,
  };
  return {
    ...selection,
    selectionHash: sha256(JSON.stringify(selection)),
  };
}

function oneSidedNormalPValue(mean: number, standardError: number): number {
  if (!finite(mean) || !finite(standardError) || standardError < 0) {
    throw new Error("formula validation mean and standard error must be finite");
  }
  if (standardError <= 1e-12) return mean > 0 ? 0 : 1;
  const z = mean / standardError;
  const absolute = Math.abs(z);
  const t = 1 / (1 + 0.2316419 * absolute);
  const density = Math.exp(-0.5 * absolute * absolute) / Math.sqrt(2 * Math.PI);
  const tail = density
    * (
      0.31938153 * t
      - 0.356563782 * t ** 2
      + 1.781477937 * t ** 3
      - 1.821255978 * t ** 4
      + 1.330274429 * t ** 5
    );
  const survival = z >= 0 ? tail : 1 - tail;
  return Math.min(1, Math.max(0, survival));
}

export function evaluateFormulaValidation(input: {
  selection: FormulaValidationSelection;
  targetKey: string;
  points: FormulaPoint[];
  holdMs: number;
  roundTripCostBps: number;
  minimumTrades: number;
  nowMs: number;
}): FormulaValidationResult {
  const {
    selectionHash,
    ...selectionBody
  } = input.selection;
  if (sha256(JSON.stringify(selectionBody)) !== selectionHash) {
    throw new Error("formula validation selection hash does not match its contents");
  }
  if (input.targetKey !== input.selection.targetKey) {
    throw new Error("formula validation target does not match the frozen selection");
  }
  if (
    !Number.isSafeInteger(input.nowMs)
    || input.nowMs < input.selection.forwardBoundaryMs
  ) {
    throw new Error("formula validation observation clock is before its boundary");
  }
  validateFeatureCalibration(input.selection.featureCalibration);
  validateShardInputs(
    input.points,
    input.selection.selected.map((candidate) => ({
      id: candidate.candidateId,
      expression: candidate.expression,
      thresholdZ: candidate.thresholdZ,
    })),
    {
      holdMs: input.holdMs,
      roundTripCostBps: input.roundTripCostBps,
      minimumTrades: input.minimumTrades,
      complexityPenaltyBps: 0,
      familySize: input.selection.validationFamilySize,
    },
  );
  if (
    input.selection.validationFamilySize !== input.selection.selected.length
    || input.selection.selected.length < 1
  ) {
    throw new Error("formula validation family does not match the frozen selection");
  }
  for (const point of input.points) {
    if (point.atMs < input.selection.forwardBoundaryMs) {
      throw new Error("formula validation received a pre-boundary feature row");
    }
    if (point.labelEndAtMs > input.nowMs) {
      throw new Error("formula validation received an unobserved future label");
    }
  }

  const prepared = prepareColumns(
    input.points,
    input.selection.featureCalibration,
  );
  const outputs = new Float64Array(input.points.length);
  const stack = new Float64Array(
    FORMULAIC_FIXED_HORIZON_POC.grammar.maximumNodes,
  );
  const provisional = input.selection.selected.map((candidate) => {
    if (
      !finite(candidate.outputCalibration.mean)
      || !finite(candidate.outputCalibration.std)
      || candidate.outputCalibration.std <= 1e-12
    ) {
      throw new Error(
        `formula validation output calibration is invalid for ${candidate.candidateId}`,
      );
    }
    const program = compileFormula(candidate.expression);
    for (let row = 0; row < input.points.length; row++) {
      outputs[row] = evaluateProgram(program, prepared.columns, row, stack);
    }
    let trades = 0;
    let netMean = 0;
    let netM2 = 0;
    let grossSum = 0;
    let hits = 0;
    let nextEligibleAtMs = Number.NEGATIVE_INFINITY;
    for (let row = 0; row < input.points.length; row++) {
      const point = input.points[row];
      if (point.atMs < nextEligibleAtMs) continue;
      const output = outputs[row];
      if (!finite(output)) continue;
      const scoreZ =
        (output - candidate.outputCalibration.mean)
        / candidate.outputCalibration.std;
      if (!finite(scoreZ) || scoreZ < candidate.thresholdZ) continue;
      const gross = prepared.grossBps[row];
      if (!finite(gross)) continue;
      const net = gross - input.roundTripCostBps;
      trades++;
      grossSum += gross;
      if (net > 0) hits++;
      const delta = net - netMean;
      netMean += delta / trades;
      netM2 += delta * (net - netMean);
      nextEligibleAtMs = point.labelEndAtMs;
    }
    const standardDeviation =
      trades > 1 ? Math.sqrt(Math.max(0, netM2 / (trades - 1))) : 0;
    const standardError = trades
      ? standardDeviation / Math.sqrt(trades)
      : null;
    const lowerConfidenceBound = standardError == null
      ? null
      : netMean - 1.645 * standardError;
    const oneSidedPValue =
      trades >= input.minimumTrades && standardError != null
        ? oneSidedNormalPValue(netMean, standardError)
        : null;
    return {
      candidateId: candidate.candidateId,
      trades,
      meanGrossBps: trades ? grossSum / trades : null,
      meanNetBps: trades ? netMean : null,
      hitRate: trades ? hits / trades : null,
      standardErrorBps: standardError,
      lowerConfidenceBoundBps: lowerConfidenceBound,
      oneSidedPValue,
    };
  });

  const ordered = provisional
    .map((candidate, index) => ({
      index,
      p: candidate.oneSidedPValue ?? Number.POSITIVE_INFINITY,
    }))
    .sort((left, right) =>
      left.p - right.p
      || provisional[left.index].candidateId.localeCompare(
        provisional[right.index].candidateId,
      ));
  const correction = new Map<number, {
    rank: number;
    threshold: number;
    pass: boolean;
  }>();
  let stepDownOpen = true;
  for (let index = 0; index < ordered.length; index++) {
    const ranked = ordered[index];
    const threshold =
      input.selection.alpha / (input.selection.validationFamilySize - index);
    const pass =
      stepDownOpen
      && finite(ranked.p)
      && ranked.p <= threshold;
    if (!pass) stepDownOpen = false;
    correction.set(ranked.index, {
      rank: index + 1,
      threshold,
      pass,
    });
  }
  const candidates = provisional.map((candidate, index) => {
    const adjusted = correction.get(index)!;
    return {
      ...candidate,
      holmRank: adjusted.rank,
      holmThreshold: adjusted.threshold,
      familywisePass: adjusted.pass,
    };
  });
  const passingCandidates = candidates.filter(
    (candidate) => candidate.familywisePass,
  ).length;
  return {
    version: "alchemy-formula-validation-result-v1",
    selectionHash: input.selection.selectionHash,
    targetKey: input.targetKey,
    forwardBoundaryMs: input.selection.forwardBoundaryMs,
    evaluatedThroughMs: Math.max(
      ...input.points.map((point) => point.labelEndAtMs),
    ),
    validationFamilySize: input.selection.validationFamilySize,
    correction: "Holm",
    alpha: input.selection.alpha,
    pValueMethod: "one-sided-normal-approximation",
    candidates,
    passingCandidates,
    verdictReviewEligible: passingCandidates > 0,
    executionAllowed: false,
    strategyRegistrationAllowed: false,
  };
}

export function inspectFormulaVariant(candidate: FormulaCandidate) {
  validateFormula(candidate.expression);
  return {
    id: candidate.id,
    formula: renderFormula(candidate.expression),
    canonical: nodeKey(canonicalNode(candidate.expression)),
    complexity: formulaComplexity(candidate.expression),
    depth: formulaDepth(candidate.expression),
    thresholdZ: candidate.thresholdZ,
  };
}
