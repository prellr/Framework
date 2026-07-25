/**
 * Build the read-only Formula Lab trade-ledger artifact used by the capital simulator.
 *
 * The artifact contains exact chronological holdout entries/exits from the immutable TradingView
 * BTC tape. It is a compressed, content-hashed derivative: no result is selected, registered,
 * paper-traded, or connected to execution.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  loadCanonicalOhlcvReplayRows,
  runHistoricalOhlcvFormulaReplay,
  type CanonicalOhlcvReplayRow,
} from "../services/historical-ohlcv-formula-replay.ts";
import {
  HISTORICAL_OHLCV_RESAMPLE,
  resampleCanonicalOhlcvReplayRows,
} from "../services/historical-ohlcv-resample.ts";
import {
  LEGACY_ALBERT_FORMULA_SOURCE,
  parseLegacyFormula,
} from "../services/legacy-formula-research.ts";

const ARTIFACT = {
  version: "alchemy-historical-albert-trade-ledgers-v1",
  evidenceClass: "retrospective-discovery-only",
  generatedFrom: "immutable TradingView Hyperliquid BTCUSDC perpetual OHLCV",
  side: "short",
  folds: 4,
  testFractionPerFold: 0.15,
  minimumTestTrades: 100,
  frozenRoundTripCostBps: 10,
  thresholdZs: [0, 0.5, 1],
  chartPlans: [
    {
      chartIntervalMinutes: 5,
      warmupBarsPerSegment: 64,
      minimumTrainingPoints: 20_000,
      holdMinutes: [10, 30, 60, 240, 480, 720, 1_440],
    },
    {
      chartIntervalMinutes: 60,
      warmupBarsPerSegment: 64,
      minimumTrainingPoints: 2_000,
      holdMinutes: [60, 240, 720, 1_440],
    },
  ],
  invariants: {
    observationsAreHoldoutOnly: true,
    thresholdsUseTrainingRowsOnly: true,
    crossesTapeGaps: false,
    overlappingPositionsAllowed: false,
    selectsWinner: false,
    registersStrategy: false,
    createsPaperBot: false,
    enablesExecution: false,
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
const oneHour = resampleCanonicalOhlcvReplayRows({
  rows: sourceRows,
  sourceIntervalMs: 5 * 60_000,
  targetIntervalMs: 60 * 60_000,
  targetIntervalLabel: "1h",
});
const expression = parseLegacyFormula(LEGACY_ALBERT_FORMULA_SOURCE);
const inputsByChart = new Map<number, {
  rows: CanonicalOhlcvReplayRow[];
  datasetId: string;
  datasetVersion: string;
  contentHash: string;
}>([
  [5, {
    rows: sourceRows,
    datasetId: manifest.datasetId,
    datasetVersion: manifest.datasetVersion,
    contentHash: manifest.contentHash,
  }],
  [60, {
    rows: oneHour.rows,
    datasetId: `${manifest.datasetId}-utc-1h-full-buckets`,
    datasetVersion:
      `${manifest.datasetVersion}-${HISTORICAL_OHLCV_RESAMPLE.version}-${oneHour.contentHash.slice(7, 19)}`,
    contentHash: oneHour.contentHash,
  }],
]);

const experiments = ARTIFACT.chartPlans.flatMap((plan) => {
  const dataset = inputsByChart.get(plan.chartIntervalMinutes)!;
  return plan.holdMinutes.map((holdMinutes) => {
    const replay = runHistoricalOhlcvFormulaReplay({
      datasetId: dataset.datasetId,
      datasetVersion: dataset.datasetVersion,
      datasetContentHash: dataset.contentHash,
      rows: dataset.rows,
      expression,
      captureObservations: true,
      config: {
        intervalMs: plan.chartIntervalMinutes * 60_000,
        holdMs: holdMinutes * 60_000,
        warmupBarsPerSegment: plan.warmupBarsPerSegment,
        folds: ARTIFACT.folds,
        testFractionPerFold: ARTIFACT.testFractionPerFold,
        minimumTrainingPoints: plan.minimumTrainingPoints,
        minimumTestTrades: ARTIFACT.minimumTestTrades,
        roundTripCostBps: ARTIFACT.frozenRoundTripCostBps,
        thresholdZs: [...ARTIFACT.thresholdZs],
      },
    });
    return {
      id: `albert-btc-${plan.chartIntervalMinutes}m-chart-${holdMinutes}m-exit`,
      chartIntervalMinutes: plan.chartIntervalMinutes,
      holdMinutes,
      datasetStartAtMs: replay.dataset.startAtMs,
      datasetEndAtMs: replay.dataset.endAtMs,
      foldTestStartAtMs: replay.trials[0]!.folds.map((fold) => fold.testStartAtMs),
      trials: replay.trials.map((trial) => {
        const observations = trial.observations ?? [];
        return {
          id: trial.trial.id,
          available: trial.available,
          unavailableReason: trial.unavailableReason,
          scoredStartAtMs: observations[0]?.entryAtMs ?? null,
          scoredEndAtMs: observations.at(-1)?.exitAtMs ?? null,
          // exitAtMs is exactly entryAtMs + holdMinutes. Tuple shape stays deliberately compact.
          trades: observations.map((observation) => {
            if (observation.entryPrice == null || observation.exitPrice == null) {
              throw new Error("captured historical observation is missing source prices");
            }
            return [
              observation.entryAtMs,
              observation.entryPrice,
              observation.exitPrice,
            ] as const;
          }),
        };
      }),
    };
  });
});

const payload = {
  ...ARTIFACT,
  sourceDataset: {
    id: manifest.datasetId,
    version: manifest.datasetVersion,
    contentHash: manifest.contentHash,
    rows: sourceRows.length,
    startAtMs: sourceRows[0]!.open_time_ms,
    endAtMs: sourceRows.at(-1)!.close_time_ms,
  },
  derivedOneHourDataset: {
    version: HISTORICAL_OHLCV_RESAMPLE.version,
    contentHash: oneHour.contentHash,
    rows: oneHour.rows.length,
  },
  formula: LEGACY_ALBERT_FORMULA_SOURCE,
  experiments,
};
const json = JSON.stringify(payload);
const contentHash = `sha256:${createHash("sha256").update(json).digest("hex")}`;
const envelope = JSON.stringify({ contentHash, payload });
const compressed = gzipSync(envelope, { level: 9 });
const outputPath = fileURLToPath(new URL(
  "../data/historical-albert-trade-ledgers-v1.json.gz",
  import.meta.url,
));
await mkdir(path.dirname(outputPath), { recursive: true });
const temporaryPath = `${outputPath}.${process.pid}.tmp`;
await writeFile(temporaryPath, compressed, { flag: "wx" });
await rename(temporaryPath, outputPath);

console.log(JSON.stringify({
  outputPath,
  contentHash,
  experiments: experiments.length,
  trialRows: experiments.reduce((sum, experiment) => sum + experiment.trials.length, 0),
  trades: experiments.reduce(
    (sum, experiment) =>
      sum + experiment.trials.reduce(
        (trialSum, trial) => trialSum + trial.trades.length,
        0,
      ),
    0,
  ),
  uncompressedBytes: Buffer.byteLength(envelope),
  compressedBytes: compressed.byteLength,
  selectsWinner: false,
  registersStrategy: false,
  enablesExecution: false,
}, null, 2));
