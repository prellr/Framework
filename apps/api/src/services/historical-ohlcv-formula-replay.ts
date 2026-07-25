/**
 * Gap-safe historical OHLCV replay for numeric formula outputs and fixed-clock paper labels.
 *
 * The adapter consumes a caller-supplied immutable source tape. A decision is made only after one
 * completed bar, entry is the next contiguous bar open, and exit is the open exactly holdMs later.
 * It cannot fetch market data, register a strategy, write a paper decision, or execute an order.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  runFormulaCapitalBacktest,
  type FormulaCapitalBacktestResult,
  type FormulaPaperTradeOutcome,
} from "./formulaic-capital-backtest.ts";
import {
  evaluateLegacyQlibFormula,
  type LegacyQlibFormulaEvaluation,
  type LegacyQlibFormulaRow,
} from "./legacy-qlib-formula-evaluator.ts";
import {
  renderLegacyFormula,
  type LegacyFormulaNode,
} from "./legacy-formula-research.ts";

export const HISTORICAL_OHLCV_FORMULA_REPLAY = {
  version: "alchemy-historical-ohlcv-formula-replay-v1",
  evidenceClass: "retrospective-discovery-only",
  timing: {
    decision: "after completed source bar at bar_available_at_ms",
    entry: "next contiguous bar open",
    exit: "bar open exactly holdMs after entry",
  },
  capitalIllustration: {
    initialCapitalUsd: 10_000,
    fixedNotionalUsd: 1_000,
    capitalRequiredPerNotional: 1,
    plannedRiskPerNotional: 1,
  },
  invariants: {
    crossesTapeGaps: false,
    overlappingPositionsAllowed: false,
    thresholdsUseTrainingRowsOnly: true,
    randomSplitsAllowed: false,
    selectsWinner: false,
    registersStrategy: false,
    createsPaperBot: false,
    enablesExecution: false,
  },
} as const;

export type CanonicalOhlcvReplayRow = {
  row_id: string;
  asset: string;
  venue: string;
  symbol: string;
  interval: string;
  segment_id: number;
  open_time_ms: number;
  close_time_ms: number;
  bar_available_at_ms: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type HistoricalFormulaTrial = {
  id: string;
  kind: "always-short-control" | "formula-threshold";
  tail: "all" | "high" | "low";
  thresholdZ: number | null;
};

export type HistoricalFormulaReplayConfig = {
  intervalMs: number;
  holdMs: number;
  warmupBarsPerSegment: number;
  folds: number;
  testFractionPerFold: number;
  minimumTrainingPoints: number;
  minimumTestTrades: number;
  roundTripCostBps: number;
  thresholdZs: number[];
};

type ReplayPoint = {
  id: string;
  segmentId: number;
  decisionAtMs: number;
  entryAtMs: number;
  exitAtMs: number;
  entryPrice: number;
  exitPrice: number;
  formulaOutput: number;
  shortGrossBps: number;
  shortNetBps: number;
  shortNetSimpleReturn: number;
};

type Moments = {
  mean: number;
  std: number;
};

type TrialObservation = {
  id: string;
  entryAtMs: number;
  exitAtMs: number;
  grossBps: number;
  netBps: number;
  netSimpleReturn: number;
};

type TrialMetrics = {
  trades: number;
  meanGrossBps: number | null;
  meanNetBps: number | null;
  medianNetBps: number | null;
  hitRate: number | null;
  standardDeviationNetBps: number | null;
  standardErrorNetBps: number | null;
  lowerConfidenceBoundNetBps: number | null;
  maximumCumulativeDrawdownBps: number | null;
};

export type HistoricalFormulaFoldResult = {
  fold: number;
  trainPoints: number;
  testPoints: number;
  testStartAtMs: number;
  trainLastExitAtMs: number | null;
  outputMean: number;
  outputStd: number;
  pearsonInformationCoefficient: number | null;
  spearmanInformationCoefficient: number | null;
  metrics: TrialMetrics;
};

export type HistoricalFormulaTrialResult = {
  trial: HistoricalFormulaTrial;
  available: boolean;
  unavailableReason: string | null;
  folds: HistoricalFormulaFoldResult[];
  aggregate: TrialMetrics & {
    positiveFolds: number;
    totalFolds: number;
    worstFoldMeanNetBps: number | null;
  };
  capital: Pick<
    FormulaCapitalBacktestResult,
    | "startingCapitalUsd"
    | "finalEquityUsd"
    | "totalPnlUsd"
    | "totalReturnPct"
    | "maximumDrawdownUsd"
    | "maximumDrawdownPct"
    | "wins"
    | "losses"
    | "profitFactor"
    | "riskBreaches"
  >;
};

export type HistoricalFormulaReplayResult = {
  version: typeof HISTORICAL_OHLCV_FORMULA_REPLAY.version;
  evidenceClass: typeof HISTORICAL_OHLCV_FORMULA_REPLAY.evidenceClass;
  dataset: {
    id: string;
    version: string;
    contentHash: string;
    rows: number;
    asset: string;
    venue: string;
    symbol: string;
    interval: string;
    segments: number;
    startAtMs: number;
    endAtMs: number;
  };
  formula: {
    source: string;
    evaluation: Omit<LegacyQlibFormulaEvaluation, "values">;
  };
  config: HistoricalFormulaReplayConfig;
  eligiblePoints: number;
  rejectedPoints: {
    warmup: number;
    nonFiniteFormula: number;
    missingEntryOrExit: number;
    crossedGapOrClockMismatch: number;
  };
  trials: HistoricalFormulaTrialResult[];
  disclosure: string[];
  invariants: typeof HISTORICAL_OHLCV_FORMULA_REPLAY.invariants;
};

const sha256 = (value: Uint8Array | string) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

function assertReplayRow(value: unknown, index: number): CanonicalOhlcvReplayRow {
  if (!value || typeof value !== "object") {
    throw new Error(`canonical OHLCV row ${index + 1} is not an object`);
  }
  const row = value as Partial<CanonicalOhlcvReplayRow>;
  const numbers = [
    row.segment_id,
    row.open_time_ms,
    row.close_time_ms,
    row.bar_available_at_ms,
    row.open,
    row.high,
    row.low,
    row.close,
    row.volume,
  ];
  if (
    !row.row_id
    || !row.asset
    || !row.venue
    || !row.symbol
    || !row.interval
    || numbers.some((number) => !Number.isFinite(number))
    || !Number.isSafeInteger(row.segment_id)
    || !Number.isSafeInteger(row.open_time_ms)
    || !Number.isSafeInteger(row.close_time_ms)
    || !Number.isSafeInteger(row.bar_available_at_ms)
    || row.segment_id! < 1
    || row.open! <= 0
    || row.high! <= 0
    || row.low! <= 0
    || row.close! <= 0
    || row.volume! < 0
    || row.high! < Math.max(row.open!, row.close!, row.low!)
    || row.low! > Math.min(row.open!, row.close!, row.high!)
    || row.close_time_ms! < row.open_time_ms!
    || row.bar_available_at_ms! < row.close_time_ms!
  ) {
    throw new Error(`canonical OHLCV row ${index + 1} violates the replay schema`);
  }
  return row as CanonicalOhlcvReplayRow;
}

export async function loadCanonicalOhlcvReplayRows(input: {
  canonicalPath: string;
  expectedContentHash: string;
}): Promise<CanonicalOhlcvReplayRow[]> {
  const bytes = await readFile(input.canonicalPath);
  const actualHash = sha256(bytes);
  if (actualHash !== input.expectedContentHash) {
    throw new Error(
      `canonical OHLCV content hash mismatch: expected ${input.expectedContentHash}, received ${actualHash}`,
    );
  }
  const lines = bytes.toString("utf8").trim().split("\n");
  const rows = lines.map((line, index) => {
    try {
      return assertReplayRow(JSON.parse(line), index);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`canonical OHLCV row ${index + 1} is not valid JSON`);
      }
      throw error;
    }
  });
  const seenSegments = new Set<number>();
  let currentSegment: number | null = null;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    if (index > 0 && row.open_time_ms <= rows[index - 1]!.open_time_ms) {
      throw new Error("canonical OHLCV rows must be strictly chronological");
    }
    if (row.segment_id !== currentSegment) {
      if (seenSegments.has(row.segment_id)) {
        throw new Error("canonical OHLCV segment ids must be contiguous");
      }
      seenSegments.add(row.segment_id);
      currentSegment = row.segment_id;
    }
    if (index > 0 && row.segment_id === rows[index - 1]!.segment_id) {
      const previous = rows[index - 1]!;
      const intervalMs = previous.close_time_ms - previous.open_time_ms + 1;
      if (row.open_time_ms !== previous.open_time_ms + intervalMs) {
        throw new Error("canonical OHLCV rows inside a segment must be clock-contiguous");
      }
    }
  }
  const identity = rows[0];
  if (!identity) throw new Error("canonical OHLCV replay requires at least one row");
  for (const row of rows) {
    if (
      row.asset !== identity.asset
      || row.venue !== identity.venue
      || row.symbol !== identity.symbol
      || row.interval !== identity.interval
    ) {
      throw new Error("one historical replay tape must contain exactly one source identity");
    }
  }
  return rows;
}

function moments(values: number[]): Moments | null {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return null;
  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  const variance = finite.length > 1
    ? finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (finite.length - 1)
    : 0;
  return { mean, std: Math.sqrt(Math.max(0, variance)) };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const ordered = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]!
    : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

function metrics(observations: TrialObservation[]): TrialMetrics {
  if (!observations.length) {
    return {
      trades: 0,
      meanGrossBps: null,
      meanNetBps: null,
      medianNetBps: null,
      hitRate: null,
      standardDeviationNetBps: null,
      standardErrorNetBps: null,
      lowerConfidenceBoundNetBps: null,
      maximumCumulativeDrawdownBps: null,
    };
  }
  const gross = observations.map((item) => item.grossBps);
  const net = observations.map((item) => item.netBps);
  const netMoments = moments(net)!;
  const standardError = netMoments.std / Math.sqrt(net.length);
  let cumulative = 0;
  let peak = 0;
  let maximumDrawdown = 0;
  for (const value of net) {
    cumulative += value;
    peak = Math.max(peak, cumulative);
    maximumDrawdown = Math.max(maximumDrawdown, peak - cumulative);
  }
  return {
    trades: observations.length,
    meanGrossBps: moments(gross)!.mean,
    meanNetBps: netMoments.mean,
    medianNetBps: median(net),
    hitRate: net.filter((value) => value > 0).length / net.length,
    standardDeviationNetBps: netMoments.std,
    standardErrorNetBps: standardError,
    lowerConfidenceBoundNetBps: netMoments.mean - 1.645 * standardError,
    maximumCumulativeDrawdownBps: maximumDrawdown,
  };
}

function pearson(left: number[], right: number[]): number | null {
  const pairs = left
    .map((value, index) => [value, right[index]!] as const)
    .filter(([leftValue, rightValue]) => Number.isFinite(leftValue) && Number.isFinite(rightValue));
  if (pairs.length < 3) return null;
  const leftMean = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length;
  const rightMean = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length;
  let numerator = 0;
  let leftSquared = 0;
  let rightSquared = 0;
  for (const pair of pairs) {
    const leftCentered = pair[0] - leftMean;
    const rightCentered = pair[1] - rightMean;
    numerator += leftCentered * rightCentered;
    leftSquared += leftCentered ** 2;
    rightSquared += rightCentered ** 2;
  }
  const denominator = Math.sqrt(leftSquared * rightSquared);
  return denominator > 0 ? numerator / denominator : null;
}

function ranks(values: number[]): number[] {
  const sorted = values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value || left.index - right.index);
  const result = Array<number>(values.length);
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && sorted[end]!.value === sorted[start]!.value) end += 1;
    const averageRank = (start + end - 1) / 2 + 1;
    for (let cursor = start; cursor < end; cursor += 1) {
      result[sorted[cursor]!.index] = averageRank;
    }
    start = end;
  }
  return result;
}

function spearman(left: number[], right: number[]): number | null {
  const pairs = left
    .map((value, index) => [value, right[index]!] as const)
    .filter(([leftValue, rightValue]) => Number.isFinite(leftValue) && Number.isFinite(rightValue));
  if (pairs.length < 3) return null;
  return pearson(
    ranks(pairs.map((pair) => pair[0])),
    ranks(pairs.map((pair) => pair[1])),
  );
}

function validateConfig(config: HistoricalFormulaReplayConfig) {
  if (
    !Number.isSafeInteger(config.intervalMs)
    || config.intervalMs <= 0
    || !Number.isSafeInteger(config.holdMs)
    || config.holdMs <= 0
    || config.holdMs % config.intervalMs !== 0
    || !Number.isSafeInteger(config.warmupBarsPerSegment)
    || config.warmupBarsPerSegment < 0
    || !Number.isSafeInteger(config.folds)
    || config.folds < 1
    || !Number.isFinite(config.testFractionPerFold)
    || config.testFractionPerFold <= 0
    || config.testFractionPerFold * config.folds >= 1
    || !Number.isSafeInteger(config.minimumTrainingPoints)
    || config.minimumTrainingPoints < 2
    || !Number.isSafeInteger(config.minimumTestTrades)
    || config.minimumTestTrades < 1
    || !Number.isFinite(config.roundTripCostBps)
    || config.roundTripCostBps < 0
    || !config.thresholdZs.length
    || config.thresholdZs.some((value) => !Number.isFinite(value) || value < 0)
  ) {
    throw new Error("invalid historical OHLCV formula replay config");
  }
}

function trialFamily(thresholdZs: number[]): HistoricalFormulaTrial[] {
  return [
    {
      id: "always-short-control",
      kind: "always-short-control",
      tail: "all",
      thresholdZ: null,
    },
    ...(["high", "low"] as const).flatMap((tail) =>
      thresholdZs.map((thresholdZ) => ({
        id: `albert-short-${tail}:z${thresholdZ}`,
        kind: "formula-threshold" as const,
        tail,
        thresholdZ,
      }))),
  ];
}

function accepts(
  point: ReplayPoint,
  trial: HistoricalFormulaTrial,
  outputStats: Moments,
): boolean {
  if (trial.kind === "always-short-control") return true;
  if (outputStats.std <= 1e-12 || trial.thresholdZ == null) return false;
  const scoreZ = (point.formulaOutput - outputStats.mean) / outputStats.std;
  return trial.tail === "high"
    ? scoreZ >= trial.thresholdZ
    : scoreZ <= -trial.thresholdZ;
}

function observationsFor(
  points: ReplayPoint[],
  trial: HistoricalFormulaTrial,
  outputStats: Moments,
  firstEligibleEntryAtMs = Number.NEGATIVE_INFINITY,
): TrialObservation[] {
  const observations: TrialObservation[] = [];
  let nextEligibleEntryAtMs = firstEligibleEntryAtMs;
  for (const point of points) {
    if (point.entryAtMs < nextEligibleEntryAtMs) continue;
    if (!accepts(point, trial, outputStats)) continue;
    observations.push({
      id: `${trial.id}:${point.id}`,
      entryAtMs: point.entryAtMs,
      exitAtMs: point.exitAtMs,
      grossBps: point.shortGrossBps,
      netBps: point.shortNetBps,
      netSimpleReturn: point.shortNetSimpleReturn,
    });
    nextEligibleEntryAtMs = point.exitAtMs;
  }
  return observations;
}

function capitalResult(observations: TrialObservation[], holdMs: number) {
  const holdMinutes = holdMs / 60_000;
  const trades: FormulaPaperTradeOutcome[] = observations.map((observation) => ({
    id: observation.id,
    targetKey: `BTC-USDC-PERP:historical-5m-fixed-${holdMinutes}m-short`,
    entryAtMs: observation.entryAtMs,
    exitAtMs: observation.exitAtMs,
    netReturnOnNotional: observation.netSimpleReturn,
    riskPerNotional:
      HISTORICAL_OHLCV_FORMULA_REPLAY.capitalIllustration.plannedRiskPerNotional,
    capitalRequiredPerNotional:
      HISTORICAL_OHLCV_FORMULA_REPLAY.capitalIllustration.capitalRequiredPerNotional,
    priority: 0,
  }));
  const result = runFormulaCapitalBacktest({
    trades,
    config: {
      initialCapitalUsd:
        HISTORICAL_OHLCV_FORMULA_REPLAY.capitalIllustration.initialCapitalUsd,
      sizing: {
        mode: "fixed-notional",
        notionalUsd:
          HISTORICAL_OHLCV_FORMULA_REPLAY.capitalIllustration.fixedNotionalUsd,
      },
      compoundSizing: false,
      minimumNotionalUsd: 1,
      maximumNotionalUsd:
        HISTORICAL_OHLCV_FORMULA_REPLAY.capitalIllustration.fixedNotionalUsd,
      maximumGrossExposureFraction: 1,
      maximumConcurrentPositions: 1,
      liquidationEquityUsd: 0,
      captureTradeLedger: false,
    },
  });
  return {
    startingCapitalUsd: result.startingCapitalUsd,
    finalEquityUsd: result.finalEquityUsd,
    totalPnlUsd: result.totalPnlUsd,
    totalReturnPct: result.totalReturnPct,
    maximumDrawdownUsd: result.maximumDrawdownUsd,
    maximumDrawdownPct: result.maximumDrawdownPct,
    wins: result.wins,
    losses: result.losses,
    profitFactor: result.profitFactor,
    riskBreaches: result.riskBreaches,
  };
}

function replayPoints(input: {
  rows: CanonicalOhlcvReplayRow[];
  values: number[];
  config: HistoricalFormulaReplayConfig;
}) {
  const points: ReplayPoint[] = [];
  const rejected = {
    warmup: 0,
    nonFiniteFormula: 0,
    missingEntryOrExit: 0,
    crossedGapOrClockMismatch: 0,
  };
  const exitOffset = 1 + input.config.holdMs / input.config.intervalMs;
  let segmentStart = 0;
  for (let index = 0; index < input.rows.length; index += 1) {
    const decision = input.rows[index]!;
    if (index === 0 || decision.segment_id !== input.rows[index - 1]!.segment_id) {
      segmentStart = index;
    }
    if (index - segmentStart < input.config.warmupBarsPerSegment) {
      rejected.warmup += 1;
      continue;
    }
    const formulaOutput = input.values[index]!;
    if (!Number.isFinite(formulaOutput)) {
      rejected.nonFiniteFormula += 1;
      continue;
    }
    const entry = input.rows[index + 1];
    const exit = input.rows[index + exitOffset];
    if (!entry || !exit) {
      rejected.missingEntryOrExit += 1;
      continue;
    }
    if (
      entry.segment_id !== decision.segment_id
      || exit.segment_id !== decision.segment_id
      || entry.open_time_ms !== decision.open_time_ms + input.config.intervalMs
      || entry.open_time_ms !== decision.bar_available_at_ms + 1
      || exit.open_time_ms !== entry.open_time_ms + input.config.holdMs
    ) {
      rejected.crossedGapOrClockMismatch += 1;
      continue;
    }
    const shortGrossBps = 10_000 * Math.log(entry.open / exit.open);
    const shortNetBps = shortGrossBps - input.config.roundTripCostBps;
    const shortNetSimpleReturn =
      (entry.open - exit.open) / entry.open - input.config.roundTripCostBps / 10_000;
    if (
      !Number.isFinite(shortGrossBps)
      || !Number.isFinite(shortNetBps)
      || !Number.isFinite(shortNetSimpleReturn)
    ) {
      rejected.missingEntryOrExit += 1;
      continue;
    }
    points.push({
      id: decision.row_id,
      segmentId: decision.segment_id,
      decisionAtMs: decision.bar_available_at_ms,
      entryAtMs: entry.open_time_ms,
      exitAtMs: exit.open_time_ms,
      entryPrice: entry.open,
      exitPrice: exit.open,
      formulaOutput,
      shortGrossBps,
      shortNetBps,
      shortNetSimpleReturn,
    });
  }
  return { points, rejected };
}

export function runHistoricalOhlcvFormulaReplay(input: {
  datasetId: string;
  datasetVersion: string;
  datasetContentHash: string;
  rows: CanonicalOhlcvReplayRow[];
  expression: LegacyFormulaNode;
  config: HistoricalFormulaReplayConfig;
}): HistoricalFormulaReplayResult {
  validateConfig(input.config);
  if (!input.rows.length) throw new Error("historical OHLCV formula replay requires rows");
  const formulaEvaluation = evaluateLegacyQlibFormula({
    expression: input.expression,
    rows: input.rows.map((row): LegacyQlibFormulaRow => ({
      segmentId: row.segment_id,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
    })),
  });
  const { points, rejected } = replayPoints({
    rows: input.rows,
    values: formulaEvaluation.values,
    config: input.config,
  });
  const testPointsPerFold = Math.floor(points.length * input.config.testFractionPerFold);
  const firstTestIndex = points.length - input.config.folds * testPointsPerFold;
  if (testPointsPerFold < 1 || firstTestIndex < input.config.minimumTrainingPoints) {
    throw new Error("insufficient eligible points for the requested historical walk-forward");
  }

  const trials = trialFamily(input.config.thresholdZs).map((trial): HistoricalFormulaTrialResult => {
    const folds: HistoricalFormulaFoldResult[] = [];
    const aggregateObservations: TrialObservation[] = [];
    const insufficientFolds: number[] = [];
    for (let fold = 0; fold < input.config.folds; fold += 1) {
      const testStartIndex = firstTestIndex + fold * testPointsPerFold;
      const test = points.slice(testStartIndex, testStartIndex + testPointsPerFold);
      const testStartAtMs = test[0]!.decisionAtMs;
      const train = points
        .slice(0, testStartIndex)
        .filter((point) => point.exitAtMs <= testStartAtMs);
      if (train.length < input.config.minimumTrainingPoints) {
        throw new Error(`historical replay fold ${fold + 1} has insufficient purged training rows`);
      }
      const outputStats = moments(train.map((point) => point.formulaOutput));
      if (!outputStats || outputStats.std <= 1e-12) {
        throw new Error(`historical replay fold ${fold + 1} has degenerate formula output`);
      }
      const observations = observationsFor(
        test,
        trial,
        outputStats,
        aggregateObservations.at(-1)?.exitAtMs,
      );
      if (observations.length < input.config.minimumTestTrades) {
        insufficientFolds.push(fold + 1);
      }
      aggregateObservations.push(...observations);
      const outputs = test.map((point) => point.formulaOutput);
      const targets = test.map((point) => point.shortGrossBps);
      folds.push({
        fold: fold + 1,
        trainPoints: train.length,
        testPoints: test.length,
        testStartAtMs,
        trainLastExitAtMs: train.at(-1)?.exitAtMs ?? null,
        outputMean: outputStats.mean,
        outputStd: outputStats.std,
        pearsonInformationCoefficient: pearson(outputs, targets),
        spearmanInformationCoefficient: spearman(outputs, targets),
        metrics: metrics(observations),
      });
    }
    const aggregateMetrics = metrics(aggregateObservations);
    const finiteFoldMeans = folds
      .map((fold) => fold.metrics.meanNetBps)
      .filter((value): value is number => value != null);
    return {
      trial,
      available: insufficientFolds.length === 0,
      unavailableReason: insufficientFolds.length
        ? `fewer than ${input.config.minimumTestTrades} trades in fold${
          insufficientFolds.length === 1 ? "" : "s"
        } ${insufficientFolds.join(", ")}`
        : null,
      folds,
      aggregate: {
        ...aggregateMetrics,
        positiveFolds: folds.filter(
          (fold) => (fold.metrics.meanNetBps ?? Number.NEGATIVE_INFINITY) > 0,
        ).length,
        totalFolds: folds.length,
        worstFoldMeanNetBps: finiteFoldMeans.length
          ? Math.min(...finiteFoldMeans)
          : null,
      },
      capital: capitalResult(aggregateObservations, input.config.holdMs),
    };
  });

  const first = input.rows[0]!;
  const last = input.rows.at(-1)!;
  const { values: _values, ...evaluationSummary } = formulaEvaluation;
  return {
    version: HISTORICAL_OHLCV_FORMULA_REPLAY.version,
    evidenceClass: HISTORICAL_OHLCV_FORMULA_REPLAY.evidenceClass,
    dataset: {
      id: input.datasetId,
      version: input.datasetVersion,
      contentHash: input.datasetContentHash,
      rows: input.rows.length,
      asset: first.asset,
      venue: first.venue,
      symbol: first.symbol,
      interval: first.interval,
      segments: new Set(input.rows.map((row) => row.segment_id)).size,
      startAtMs: first.open_time_ms,
      endAtMs: last.close_time_ms,
    },
    formula: {
      source: renderLegacyFormula(input.expression),
      evaluation: evaluationSummary,
    },
    config: {
      ...input.config,
      thresholdZs: input.config.thresholdZs.slice(),
    },
    eligiblePoints: points.length,
    rejectedPoints: rejected,
    trials,
    disclosure: [
      "This is retrospective discovery on a historical TradingView OHLCV export, not untouched validation.",
      "The numeric formula is evaluated with pinned Microsoft Qlib v0.9.5 semantics; entry tails and z-score thresholds are separate Alchemy trial definitions.",
      "OHLCV bar opens are not executable fills. The fixed round-trip cost is a stress assumption and does not reconstruct spread, slippage, funding, latency, or liquidation.",
      "The capital path is an illustrative unlevered fixed-notional simulation, not a claim about deployable risk.",
      "No result selects, exports, registers, or activates a strategy. Any hypothesis carried forward requires a new immutable identity and future paper boundary.",
    ],
    invariants: HISTORICAL_OHLCV_FORMULA_REPLAY.invariants,
  };
}

export function historicalFormulaReplayReceiptHash(
  result: HistoricalFormulaReplayResult,
): string {
  return sha256(JSON.stringify(result));
}
