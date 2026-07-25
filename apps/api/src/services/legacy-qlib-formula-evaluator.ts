/**
 * Restricted historical Qlib expression evaluator for research replay.
 *
 * This is deliberately separate from Formula Lab's bounded search grammar. It evaluates only a
 * parsed AST, only over caller-supplied arrays, and only with a small Qlib v0.9.5 operator subset.
 * It cannot execute source text, read a tape, create a strategy, or reach an order path.
 */
import {
  legacyFormulaComplexity,
  legacyFormulaDepth,
  renderLegacyFormula,
  type LegacyFormulaNode,
} from "./legacy-formula-research.ts";

export const LEGACY_QLIB_FORMULA_EVALUATOR = {
  version: "alchemy-legacy-qlib-formula-evaluator-v1",
  semantics: "microsoft-qlib-v0.9.5",
  sourceUrl: "https://github.com/microsoft/qlib/blob/v0.9.5/qlib/data/ops.py",
  maximumWindow: 512,
  maximumNodes: 256,
  maximumDepth: 32,
  supportedFeatures: ["$open", "$high", "$low", "$close", "$volume"] as const,
  supportedOperators: ["Add", "Sub", "Mul", "Div", "Less", "Ref", "Max", "WMA", "Cov"] as const,
  invariants: {
    sourceTextExecution: false,
    resetsAtTapeGaps: true,
    futureReferencesAllowed: false,
    createsStrategy: false,
    createsPaperBot: false,
    enablesExecution: false,
  },
} as const;

export type LegacyQlibFeature = (typeof LEGACY_QLIB_FORMULA_EVALUATOR.supportedFeatures)[number];

export type LegacyQlibFormulaRow = {
  segmentId: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type LegacyQlibFormulaEvaluation = {
  version: typeof LEGACY_QLIB_FORMULA_EVALUATOR.version;
  semantics: typeof LEGACY_QLIB_FORMULA_EVALUATOR.semantics;
  formula: string;
  rows: number;
  segments: number;
  finiteValues: number;
  nanValues: number;
  positiveInfinityValues: number;
  negativeInfinityValues: number;
  minimum: number | null;
  maximum: number | null;
  mean: number | null;
  values: number[];
};

const operatorSet = new Set<string>(LEGACY_QLIB_FORMULA_EVALUATOR.supportedOperators);
const featureSet = new Set<string>(LEGACY_QLIB_FORMULA_EVALUATOR.supportedFeatures);

function constantInteger(node: LegacyFormulaNode, label: string): number {
  if (
    node.kind !== "constant"
    || !Number.isSafeInteger(node.value)
    || node.value < 0
    || node.value > LEGACY_QLIB_FORMULA_EVALUATOR.maximumWindow
  ) {
    throw new Error(`${label} must be an integer from 0 to ${LEGACY_QLIB_FORMULA_EVALUATOR.maximumWindow}`);
  }
  return node.value;
}

function validateNode(node: LegacyFormulaNode): void {
  if (node.kind === "constant") {
    if (!Number.isFinite(node.value)) throw new Error("formula constants must be finite");
    return;
  }
  if (node.kind === "feature") {
    if (!featureSet.has(node.name)) {
      throw new Error(`unsupported legacy Qlib feature: ${node.name}`);
    }
    return;
  }
  if (!operatorSet.has(node.name)) {
    throw new Error(`unsupported legacy Qlib operator: ${node.name}`);
  }
  const expectedArity = node.name === "Cov" ? 3 : 2;
  if (node.args.length !== expectedArity) {
    throw new Error(`${node.name} requires exactly ${expectedArity} arguments`);
  }
  if (node.name === "Ref") {
    constantInteger(node.args[1]!, "Ref lag");
  } else if (node.name === "Max" || node.name === "WMA") {
    const window = constantInteger(node.args[1]!, `${node.name} window`);
    if (window < 1) throw new Error(`${node.name} window must be at least 1`);
  } else if (node.name === "Cov") {
    const window = constantInteger(node.args[2]!, "Cov window");
    if (window < 1) throw new Error("Cov window must be at least 1");
  }
  node.args.forEach(validateNode);
}

export function validateLegacyQlibFormula(node: LegacyFormulaNode): void {
  if (legacyFormulaComplexity(node) > LEGACY_QLIB_FORMULA_EVALUATOR.maximumNodes) {
    throw new Error("legacy Qlib formula exceeds the evaluator node limit");
  }
  if (legacyFormulaDepth(node) > LEGACY_QLIB_FORMULA_EVALUATOR.maximumDepth) {
    throw new Error("legacy Qlib formula exceeds the evaluator depth limit");
  }
  validateNode(node);
}

const pair = (
  left: number[],
  right: number[],
  operation: (leftValue: number, rightValue: number) => number,
) => left.map((value, index) => operation(value, right[index]!));

function rollingMaximum(values: number[], window: number): number[] {
  return values.map((_value, index) => {
    let maximum = Number.NEGATIVE_INFINITY;
    let observations = 0;
    for (let cursor = Math.max(0, index - window + 1); cursor <= index; cursor += 1) {
      const value = values[cursor]!;
      if (Number.isNaN(value)) continue;
      observations += 1;
      maximum = Math.max(maximum, value);
    }
    return observations ? maximum : Number.NaN;
  });
}

/**
 * Exact Qlib v0.9.5 behavior. Its implementation normalizes linear weights and then calls
 * np.nanmean(weight * x), so the result is divided by the number of non-NaN products once more.
 */
function legacyWeightedMean(values: number[], window: number): number[] {
  return values.map((_value, index) => {
    const start = Math.max(0, index - window + 1);
    const length = index - start + 1;
    const weightDenominator = length * (length + 1) / 2;
    let weightedProducts = 0;
    let observations = 0;
    for (let cursor = start; cursor <= index; cursor += 1) {
      const value = values[cursor]!;
      if (Number.isNaN(value)) continue;
      const weight = cursor - start + 1;
      weightedProducts += weight / weightDenominator * value;
      observations += 1;
    }
    return observations ? weightedProducts / observations : Number.NaN;
  });
}

function rollingCovariance(left: number[], right: number[], window: number): number[] {
  return left.map((_value, index) => {
    const pairs: Array<[number, number]> = [];
    for (let cursor = Math.max(0, index - window + 1); cursor <= index; cursor += 1) {
      const leftValue = left[cursor]!;
      const rightValue = right[cursor]!;
      if (Number.isNaN(leftValue) || Number.isNaN(rightValue)) continue;
      pairs.push([leftValue, rightValue]);
    }
    if (pairs.length < 2) return Number.NaN;
    const leftMean = pairs.reduce((sum, item) => sum + item[0], 0) / pairs.length;
    const rightMean = pairs.reduce((sum, item) => sum + item[1], 0) / pairs.length;
    return pairs.reduce(
      (sum, item) => sum + (item[0] - leftMean) * (item[1] - rightMean),
      0,
    ) / (pairs.length - 1);
  });
}

function featureValues(node: LegacyFormulaNode, rows: LegacyQlibFormulaRow[]): number[] {
  if (node.kind !== "feature") throw new Error("expected Qlib feature");
  const key = node.name.slice(1) as keyof Omit<LegacyQlibFormulaRow, "segmentId">;
  return rows.map((row) => row[key]);
}

function evaluateSegment(
  node: LegacyFormulaNode,
  rows: LegacyQlibFormulaRow[],
  memo: Map<string, number[]>,
): number[] {
  const key = renderLegacyFormula(node);
  const cached = memo.get(key);
  if (cached) return cached;
  let result: number[];
  if (node.kind === "constant") {
    result = Array.from({ length: rows.length }, () => node.value);
  } else if (node.kind === "feature") {
    result = featureValues(node, rows);
  } else {
    const args = node.args.map((child) => evaluateSegment(child, rows, memo));
    switch (node.name) {
      case "Add":
        result = pair(args[0]!, args[1]!, (left, right) => left + right);
        break;
      case "Sub":
        result = pair(args[0]!, args[1]!, (left, right) => left - right);
        break;
      case "Mul":
        result = pair(args[0]!, args[1]!, (left, right) => left * right);
        break;
      case "Div":
        result = pair(args[0]!, args[1]!, (left, right) => left / right);
        break;
      case "Less":
        result = pair(args[0]!, args[1]!, (left, right) => Math.min(left, right));
        break;
      case "Ref": {
        const lag = constantInteger(node.args[1]!, "Ref lag");
        result = lag === 0
          ? args[0]!.map(() => args[0]![0]!)
          : args[0]!.map((_value, index) =>
              index >= lag ? args[0]![index - lag]! : Number.NaN);
        break;
      }
      case "Max":
        result = rollingMaximum(
          args[0]!,
          constantInteger(node.args[1]!, "Max window"),
        );
        break;
      case "WMA":
        result = legacyWeightedMean(
          args[0]!,
          constantInteger(node.args[1]!, "WMA window"),
        );
        break;
      case "Cov":
        result = rollingCovariance(
          args[0]!,
          args[1]!,
          constantInteger(node.args[2]!, "Cov window"),
        );
        break;
      default:
        throw new Error(`unsupported legacy Qlib operator: ${node.name}`);
    }
  }
  memo.set(key, result);
  return result;
}

export function evaluateLegacyQlibFormula(input: {
  expression: LegacyFormulaNode;
  rows: LegacyQlibFormulaRow[];
}): LegacyQlibFormulaEvaluation {
  validateLegacyQlibFormula(input.expression);
  const values: number[] = [];
  const seenSegments = new Set<number>();
  let segments = 0;
  for (let start = 0; start < input.rows.length;) {
    const segmentId = input.rows[start]!.segmentId;
    if (!Number.isSafeInteger(segmentId) || segmentId < 1) {
      throw new Error("legacy Qlib rows require positive integer segment ids");
    }
    let end = start + 1;
    while (end < input.rows.length && input.rows[end]!.segmentId === segmentId) end += 1;
    if (seenSegments.has(segmentId)) {
      throw new Error("legacy Qlib segment ids must be contiguous");
    }
    seenSegments.add(segmentId);
    const segmentRows = input.rows.slice(start, end);
    for (const row of segmentRows) {
      if (
        !Number.isFinite(row.open)
        || !Number.isFinite(row.high)
        || !Number.isFinite(row.low)
        || !Number.isFinite(row.close)
        || !Number.isFinite(row.volume)
      ) {
        throw new Error("legacy Qlib input OHLCV values must be finite");
      }
    }
    values.push(...evaluateSegment(input.expression, segmentRows, new Map()));
    segments += 1;
    start = end;
  }

  const finiteValues = values.filter(Number.isFinite);
  const range = finiteValues.reduce(
    (current, value) => ({
      minimum: Math.min(current.minimum, value),
      maximum: Math.max(current.maximum, value),
      sum: current.sum + value,
    }),
    {
      minimum: Number.POSITIVE_INFINITY,
      maximum: Number.NEGATIVE_INFINITY,
      sum: 0,
    },
  );
  return {
    version: LEGACY_QLIB_FORMULA_EVALUATOR.version,
    semantics: LEGACY_QLIB_FORMULA_EVALUATOR.semantics,
    formula: renderLegacyFormula(input.expression),
    rows: input.rows.length,
    segments,
    finiteValues: finiteValues.length,
    nanValues: values.filter(Number.isNaN).length,
    positiveInfinityValues: values.filter((value) => value === Number.POSITIVE_INFINITY).length,
    negativeInfinityValues: values.filter((value) => value === Number.NEGATIVE_INFINITY).length,
    minimum: finiteValues.length ? range.minimum : null,
    maximum: finiteValues.length ? range.maximum : null,
    mean: finiteValues.length ? range.sum / finiteValues.length : null,
    values,
  };
}
