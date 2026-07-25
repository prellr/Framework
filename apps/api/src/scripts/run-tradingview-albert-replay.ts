/**
 * Run the imported Albert expression on an immutable TradingView BTC 5m source tape.
 *
 * This is retrospective, research-only, and writes only a content-addressed result receipt.
 */
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
const result = runHistoricalOhlcvFormulaReplay({
  datasetId: manifest.datasetId,
  datasetVersion: manifest.datasetVersion,
  datasetContentHash: manifest.contentHash,
  rows,
  expression: parseLegacyFormula(LEGACY_ALBERT_FORMULA_SOURCE),
  config: {
    intervalMs: 5 * 60_000,
    holdMs: 10 * 60_000,
    warmupBarsPerSegment: 64,
    folds: 4,
    testFractionPerFold: 0.15,
    minimumTrainingPoints: 20_000,
    minimumTestTrades: 100,
    roundTripCostBps: 10,
    thresholdZs: [0, 0.5, 1],
  },
});
const receiptHash = historicalFormulaReplayReceiptHash(result);
const receipt = {
  receiptHash,
  ...result,
};
const receiptDir = path.join(researchRoot, "results", "historical-formula-replay");
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
  dataset: result.dataset,
  formula: result.formula,
  eligiblePoints: result.eligiblePoints,
  rejectedPoints: result.rejectedPoints,
  trials: result.trials.map((trial) => ({
    ...trial.trial,
    aggregate: trial.aggregate,
    capital: trial.capital,
  })),
  evidenceClass: result.evidenceClass,
  strategyRegistered: false,
  executionAllowed: false,
}, null, 2));
