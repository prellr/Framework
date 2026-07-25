/**
 * Run the legacy Albert expression on deterministic UTC-aligned BTC 1h bars.
 *
 * This is a distinct formula family: all bar-based operators now consume completed 1h OHLCV bars.
 * The run writes only a content-addressed retrospective receipt and cannot register or execute.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  historicalFormulaReplayReceiptHash,
  loadCanonicalOhlcvReplayRows,
  runHistoricalOhlcvFormulaReplay,
} from "../services/historical-ohlcv-formula-replay.ts";
import {
  HISTORICAL_OHLCV_RESAMPLE,
  resampleCanonicalOhlcvReplayRows,
} from "../services/historical-ohlcv-resample.ts";
import {
  LEGACY_ALBERT_FORMULA_SOURCE,
  parseLegacyFormula,
} from "../services/legacy-formula-research.ts";

const ONE_HOUR_CHART_SENSITIVITY = {
  version: "alchemy-historical-albert-btc-1h-chart-sensitivity-v1",
  evidenceClass: "retrospective-discovery-only",
  sourceIntervalMinutes: 60,
  sourceAggregation: {
    source: "immutable BTC 5m TradingView tape",
    target: "UTC-aligned 1h full buckets",
    expectedBarsPerBucket: 12,
    partialBuckets: "discard",
    gaps: "never bridge; begin a new output segment",
  },
  holdMinutes: [60, 240, 720, 1_440],
  side: "short",
  entry: "next contiguous 1h bar open after the completed formula bar",
  exit: "contiguous 1h bar open exactly holdMinutes after entry",
  folds: 4,
  testFractionPerFold: 0.15,
  minimumTrainingPoints: 2_000,
  minimumTestTrades: 100,
  roundTripCostBps: 10,
  thresholdZs: [0, 0.5, 1],
  capital:
    "$10,000 start · $1,000 fixed notional · one non-overlapping position at a time",
  invariants: {
    chartIntervalChangesFormulaSemantics: true,
    thresholdsUseTrainingRowsOnly: true,
    crossesTapeGaps: false,
    overlappingPositionsAllowed: false,
    selectsWinner: false,
    registersStrategy: false,
    createsPaperBot: false,
    enablesExecution: false,
    preservesVerdictGate: true,
  },
} as const;

const researchRoot =
  process.env.ALCHEMY_RESEARCH_DATA_DIR
  ?? fileURLToPath(new URL("../../../../.research-data/", import.meta.url));
const datasetDir = path.join(
  researchRoot,
  "tradingview",
  "hyperliquid",
  "btcusdc-p",
  "5m",
);
const manifestPath =
  process.env.ALCHEMY_TV_MANIFEST_PATH
  ?? path.join(
    datasetDir,
    "20250322105000000-20260725030459999-b15ddf827403-imported-20260725163357278.manifest.json",
  );
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
  datasetId: string;
  datasetVersion: string;
  contentHash: string;
  artifact: { uri: string };
};
const canonicalPath =
  process.env.ALCHEMY_TV_CANONICAL_PATH
  ?? fileURLToPath(manifest.artifact.uri);
const sourceRows = await loadCanonicalOhlcvReplayRows({
  canonicalPath,
  expectedContentHash: manifest.contentHash,
});
const resampled = resampleCanonicalOhlcvReplayRows({
  rows: sourceRows,
  sourceIntervalMs: 5 * 60_000,
  targetIntervalMs: ONE_HOUR_CHART_SENSITIVITY.sourceIntervalMinutes * 60_000,
  targetIntervalLabel: "1h",
});
const derivedDatasetId = `${manifest.datasetId}-utc-1h-full-buckets`;
const derivedDatasetVersion =
  `${manifest.datasetVersion}-${HISTORICAL_OHLCV_RESAMPLE.version}-${resampled.contentHash.slice(7, 19)}`;
const expression = parseLegacyFormula(LEGACY_ALBERT_FORMULA_SOURCE);
const horizons = ONE_HOUR_CHART_SENSITIVITY.holdMinutes.map((holdMinutes) => {
  const result = runHistoricalOhlcvFormulaReplay({
    datasetId: derivedDatasetId,
    datasetVersion: derivedDatasetVersion,
    datasetContentHash: resampled.contentHash,
    rows: resampled.rows,
    expression,
    config: {
      intervalMs: ONE_HOUR_CHART_SENSITIVITY.sourceIntervalMinutes * 60_000,
      holdMs: holdMinutes * 60_000,
      warmupBarsPerSegment: 64,
      folds: ONE_HOUR_CHART_SENSITIVITY.folds,
      testFractionPerFold: ONE_HOUR_CHART_SENSITIVITY.testFractionPerFold,
      minimumTrainingPoints: ONE_HOUR_CHART_SENSITIVITY.minimumTrainingPoints,
      minimumTestTrades: ONE_HOUR_CHART_SENSITIVITY.minimumTestTrades,
      roundTripCostBps: ONE_HOUR_CHART_SENSITIVITY.roundTripCostBps,
      thresholdZs: [...ONE_HOUR_CHART_SENSITIVITY.thresholdZs],
    },
  });
  return {
    holdMinutes,
    replayReceiptHash: historicalFormulaReplayReceiptHash(result),
    result,
  };
});

const batch = {
  ...ONE_HOUR_CHART_SENSITIVITY,
  sourceDataset: {
    id: manifest.datasetId,
    version: manifest.datasetVersion,
    contentHash: manifest.contentHash,
    rows: sourceRows.length,
  },
  aggregation: {
    version: resampled.version,
    contentHash: resampled.contentHash,
    rows: resampled.rows.length,
    expectedSourceBarsPerTarget: resampled.expectedSourceBarsPerTarget,
    rejectedBuckets: resampled.rejectedBuckets,
    invariants: resampled.invariants,
  },
  dataset: horizons[0]!.result.dataset,
  formula: horizons[0]!.result.formula,
  horizons,
};
const receiptHash =
  `sha256:${createHash("sha256").update(JSON.stringify(batch)).digest("hex")}`;
const receipt = { receiptHash, ...batch };
const receiptDir = path.join(
  researchRoot,
  "results",
  "historical-albert-one-hour-chart-sensitivity",
);
const receiptPath = path.join(
  receiptDir,
  `${receiptHash.slice("sha256:".length)}.json`,
);
await mkdir(receiptDir, { recursive: true });
const payload = `${JSON.stringify(receipt, null, 2)}\n`;
try {
  const existing = await readFile(receiptPath, "utf8");
  if (existing !== payload) throw new Error(`result receipt collision at ${receiptPath}`);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  const temporaryPath = `${receiptPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, payload, { flag: "wx" });
  await rename(temporaryPath, receiptPath);
}

console.log(JSON.stringify({
  receiptHash,
  receiptPath,
  version: receipt.version,
  evidenceClass: receipt.evidenceClass,
  sourceDataset: receipt.sourceDataset,
  aggregation: receipt.aggregation,
  dataset: receipt.dataset,
  formula: receipt.formula,
  horizons: receipt.horizons.map((horizon) => ({
    holdMinutes: horizon.holdMinutes,
    replayReceiptHash: horizon.replayReceiptHash,
    eligiblePoints: horizon.result.eligiblePoints,
    rejectedPoints: horizon.result.rejectedPoints,
    informationCoefficientByFold: horizon.result.trials[0]!.folds.map((fold) => ({
      fold: fold.fold,
      pearson: fold.pearsonInformationCoefficient,
      spearman: fold.spearmanInformationCoefficient,
    })),
    trials: horizon.result.trials.map((trial) => ({
      ...trial.trial,
      available: trial.available,
      unavailableReason: trial.unavailableReason,
      aggregate: trial.aggregate,
      capital: trial.capital,
    })),
  })),
  strategySelected: false,
  strategyRegistered: false,
  executionAllowed: false,
}, null, 2));
