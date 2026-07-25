/**
 * Build exact UTC-month summaries from the out-of-sample Albert replay trades.
 *
 * This runs only against the local immutable TradingView tape. It writes a content-addressed
 * retrospective receipt and cannot register a formula, create a bot, or execute an order.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadCanonicalOhlcvReplayRows,
  runHistoricalOhlcvFormulaReplay,
  type CanonicalOhlcvReplayRow,
} from "../services/historical-ohlcv-formula-replay.ts";
import {
  summarizeHistoricalFormulaCalendarMonths,
} from "../services/historical-formula-calendar-period.ts";
import {
  HISTORICAL_OHLCV_RESAMPLE,
  resampleCanonicalOhlcvReplayRows,
} from "../services/historical-ohlcv-resample.ts";
import {
  LEGACY_ALBERT_FORMULA_SOURCE,
  parseLegacyFormula,
} from "../services/legacy-formula-research.ts";

const CALENDAR_PERIOD_RUN = {
  version: "alchemy-historical-albert-calendar-periods-v1",
  evidenceClass: "retrospective-discovery-only",
  grouping: "UTC calendar month",
  side: "short",
  folds: 4,
  testFractionPerFold: 0.15,
  minimumTestTrades: 100,
  roundTripCostBps: 10,
  thresholdZs: [0, 0.5, 1],
  fixedNotionalUsd: 1_000,
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
    periodsUseOutOfSampleTradesOnly: true,
    thresholdsUseTrainingRowsOnly: true,
    periodKeyUsesEntryClock: true,
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

const experiments = CALENDAR_PERIOD_RUN.chartPlans.flatMap((plan) => {
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
        folds: CALENDAR_PERIOD_RUN.folds,
        testFractionPerFold: CALENDAR_PERIOD_RUN.testFractionPerFold,
        minimumTrainingPoints: plan.minimumTrainingPoints,
        minimumTestTrades: CALENDAR_PERIOD_RUN.minimumTestTrades,
        roundTripCostBps: CALENDAR_PERIOD_RUN.roundTripCostBps,
        thresholdZs: [...CALENDAR_PERIOD_RUN.thresholdZs],
      },
    });
    return {
      id: `albert-btc-${plan.chartIntervalMinutes}m-chart-${holdMinutes}m-exit`,
      chartIntervalMinutes: plan.chartIntervalMinutes,
      holdMinutes,
      dataset: replay.dataset,
      eligiblePoints: replay.eligiblePoints,
      trials: replay.trials.map((trial) => ({
        id: trial.trial.id,
        tail: trial.trial.tail,
        thresholdZ: trial.trial.thresholdZ,
        trades: trial.aggregate.trades,
        hitRate: trial.aggregate.hitRate,
        meanGrossBps: trial.aggregate.meanGrossBps,
        meanNetBps: trial.aggregate.meanNetBps,
        sampleComplete: trial.available,
        sampleNote: trial.unavailableReason,
        periods: summarizeHistoricalFormulaCalendarMonths({
          observations: trial.observations ?? [],
          fixedNotionalUsd: CALENDAR_PERIOD_RUN.fixedNotionalUsd,
        }),
      })),
    };
  });
});

const batch = {
  ...CALENDAR_PERIOD_RUN,
  sourceDataset: {
    id: manifest.datasetId,
    version: manifest.datasetVersion,
    contentHash: manifest.contentHash,
    rows: sourceRows.length,
  },
  derivedOneHourDataset: {
    version: HISTORICAL_OHLCV_RESAMPLE.version,
    contentHash: oneHour.contentHash,
    rows: oneHour.rows.length,
    rejectedBuckets: oneHour.rejectedBuckets,
  },
  formula: {
    source: LEGACY_ALBERT_FORMULA_SOURCE,
    semantics: "Microsoft Qlib v0.9.5",
  },
  experiments,
};
const receiptHash =
  `sha256:${createHash("sha256").update(JSON.stringify(batch)).digest("hex")}`;
const receipt = { receiptHash, ...batch };
const receiptDir = path.join(
  researchRoot,
  "results",
  "historical-albert-calendar-periods",
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

if (process.env.ALCHEMY_WRITE_STATIC_RECEIPT === "1") {
  const staticReceipt = {
    receiptHash: receipt.receiptHash,
    version: receipt.version,
    evidenceClass: receipt.evidenceClass,
    grouping: receipt.grouping,
    folds: receipt.folds,
    roundTripCostBps: receipt.roundTripCostBps,
    fixedNotionalUsd: receipt.fixedNotionalUsd,
    invariants: receipt.invariants,
    sourceDataset: receipt.sourceDataset,
    derivedOneHourDataset: receipt.derivedOneHourDataset,
    formula: receipt.formula,
    experiments: receipt.experiments.map((experiment) => ({
      id: experiment.id,
      chartIntervalMinutes: experiment.chartIntervalMinutes,
      holdMinutes: experiment.holdMinutes,
      asset: experiment.dataset.asset,
      eligiblePoints: experiment.eligiblePoints,
      trials: experiment.trials,
    })),
  };
  const staticPath = fileURLToPath(new URL(
    "../services/historical-albert-calendar-period-receipt.ts",
    import.meta.url,
  ));
  const staticPayload = [
    "/**",
    " * Generated summary of exact UTC-month Albert out-of-sample trades.",
    " *",
    " * Regenerate with ALCHEMY_WRITE_STATIC_RECEIPT=1. The full tape stays outside git.",
    " */",
    `export const HISTORICAL_ALBERT_CALENDAR_PERIOD_RECEIPT = ${
      JSON.stringify(staticReceipt, null, 2)
    } as const;`,
    "",
  ].join("\n");
  await writeFile(staticPath, staticPayload);
}

console.log(JSON.stringify({
  receiptHash,
  receiptPath,
  evidenceClass: receipt.evidenceClass,
  sourceRows: receipt.sourceDataset.rows,
  oneHourRows: receipt.derivedOneHourDataset.rows,
  experiments: receipt.experiments.length,
  trials: receipt.experiments.reduce((sum, experiment) => sum + experiment.trials.length, 0),
  periods: receipt.experiments.reduce(
    (sum, experiment) =>
      sum + experiment.trials.reduce((trialSum, trial) => trialSum + trial.periods.length, 0),
    0,
  ),
  strategySelected: false,
  strategyRegistered: false,
  executionAllowed: false,
}, null, 2));
