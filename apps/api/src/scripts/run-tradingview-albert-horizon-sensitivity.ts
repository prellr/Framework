/**
 * Run the frozen Albert expression over a declared fixed-exit horizon family.
 *
 * The 10-minute replay is retained as the baseline. The 30-, 60-, and 240-minute exits are
 * sensitivity rows, not replacements for the original receipt. This script writes only a
 * content-addressed retrospective research receipt. It cannot register or execute a strategy.
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
  LEGACY_ALBERT_FORMULA_SOURCE,
  parseLegacyFormula,
} from "../services/legacy-formula-research.ts";

const HORIZON_SENSITIVITY = {
  version: "alchemy-historical-albert-btc-5m-horizon-sensitivity-v1",
  evidenceClass: "retrospective-discovery-only",
  sourceIntervalMinutes: 5,
  holdMinutes: [10, 30, 60, 240],
  side: "short",
  entry: "next contiguous 5m bar open after the completed formula bar",
  exit: "contiguous 5m bar open exactly holdMinutes after entry",
  folds: 4,
  testFractionPerFold: 0.15,
  minimumTrainingPoints: 20_000,
  minimumTestTrades: 100,
  roundTripCostBps: 10,
  thresholdZs: [0, 0.5, 1],
  capital:
    "$10,000 start · $1,000 fixed notional · one non-overlapping position at a time",
  invariants: {
    formulaChangedAcrossHorizons: false,
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
    "20250804000000000-20260725030459999-455ea5183517-imported-20260725031556411.manifest.json",
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
const rows = await loadCanonicalOhlcvReplayRows({
  canonicalPath,
  expectedContentHash: manifest.contentHash,
});
const expression = parseLegacyFormula(LEGACY_ALBERT_FORMULA_SOURCE);
const horizons = HORIZON_SENSITIVITY.holdMinutes.map((holdMinutes) => {
  const result = runHistoricalOhlcvFormulaReplay({
    datasetId: manifest.datasetId,
    datasetVersion: manifest.datasetVersion,
    datasetContentHash: manifest.contentHash,
    rows,
    expression,
    config: {
      intervalMs: HORIZON_SENSITIVITY.sourceIntervalMinutes * 60_000,
      holdMs: holdMinutes * 60_000,
      warmupBarsPerSegment: 64,
      folds: HORIZON_SENSITIVITY.folds,
      testFractionPerFold: HORIZON_SENSITIVITY.testFractionPerFold,
      minimumTrainingPoints: HORIZON_SENSITIVITY.minimumTrainingPoints,
      minimumTestTrades: HORIZON_SENSITIVITY.minimumTestTrades,
      roundTripCostBps: HORIZON_SENSITIVITY.roundTripCostBps,
      thresholdZs: [...HORIZON_SENSITIVITY.thresholdZs],
    },
  });
  return {
    holdMinutes,
    replayReceiptHash: historicalFormulaReplayReceiptHash(result),
    result,
  };
});

const batch = {
  ...HORIZON_SENSITIVITY,
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
  "historical-albert-horizon-sensitivity",
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
