import {
  HISTORICAL_ALBERT_ONE_HOUR_CHART_SENSITIVITY_RECEIPT,
} from "./historical-albert-one-hour-chart-sensitivity-receipt.ts";
import { LEGACY_ALBERT_FORMULA_RESEARCH } from "./legacy-formula-research.ts";

export const HISTORICAL_ALBERT_ONE_HOUR_CHART_SENSITIVITY_KNOWLEDGE = {
  version: "alchemy-historical-albert-btc-1h-chart-sensitivity-research-v1",
  status: "active",
  receipt: HISTORICAL_ALBERT_ONE_HOUR_CHART_SENSITIVITY_RECEIPT,
  formula: LEGACY_ALBERT_FORMULA_RESEARCH,
  sources: [
    {
      title: "Microsoft Qlib v0.9.5 operator implementation",
      url: "https://github.com/microsoft/qlib/blob/v0.9.5/qlib/data/ops.py",
      use: "Pinned semantics for the imported Albert expression on completed 1h bars.",
    },
  ],
  invariants: {
    readsLockedLiveValues: false,
    readsPaperOutcomes: false,
    changesVerdictGate: false,
    createsStrategy: false,
    createsPaperBot: false,
    startsSearch: false,
    enablesExecution: false,
    preservesVerdictGate: true,
  },
} as const;

const bps = (value: number | null) =>
  value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)} bps`;
const horizon = (minutes: number) => `${minutes / 60}h`;

export function renderHistoricalAlbertOneHourChartSensitivityKnowledge(
  recordedAt: string,
): string {
  const knowledge = HISTORICAL_ALBERT_ONE_HOUR_CHART_SENSITIVITY_KNOWLEDGE;
  const receipt = knowledge.receipt;
  return [
    "## Historical Albert formula × BTC 1h-chart sensitivity v1",
    "",
    `Recorded: ${recordedAt}`,
    "",
    "### Disposition",
    "",
    "- Retrospective discovery only; chart-timeframe semantics differ from the 5m formula family.",
    "- Complete UTC 1h buckets only; partial buckets are discarded and source gaps are never bridged.",
    "- Every declared trial is retained. No result was selected, registered, paper-launched, armed, or executed.",
    "",
    "### Frozen identity and mechanics",
    "",
    `- Source dataset: \`${receipt.sourceDataset.id}\``,
    `- Source hash: \`${receipt.sourceDataset.contentHash}\``,
    `- Aggregation contract: \`${receipt.aggregation.version}\``,
    `- Derived 1h hash: \`${receipt.aggregation.contentHash}\``,
    `- Receipt: \`${receipt.receiptHash}\``,
    `- Derived rows: ${receipt.dataset.rows.toLocaleString()} in ${receipt.dataset.segments} gap-safe segments.`,
    `- Rejected partial buckets: ${receipt.aggregation.rejectedPartialBuckets}; non-contiguous buckets: ${receipt.aggregation.rejectedNonContiguousBuckets}.`,
    `- Entry: ${receipt.target.entry}.`,
    `- Exit: ${receipt.target.exit}.`,
    `- Cost stress: ${receipt.target.roundTripCostBps} bps per completed trade.`,
    `- Floor: ${receipt.target.minimumTradesPerFold} trades in each of ${receipt.target.folds} chronological folds.`,
    "- The 40/20/50-bar Albert operators now span roughly 40–50 hours, so this is not the 5m signal with a slower label.",
    "",
    "```text",
    knowledge.formula.source,
    "```",
    "",
    "### Complete horizon × trial ledger",
    "",
    "| Exit | Trial | Floor | Trades | Gross | Net | LCB | Positive folds | Worst fold |",
    "|---:|---|---:|---:|---:|---:|---:|---:|---:|",
    ...receipt.horizons.flatMap((item) =>
      item.trials.map((trial) =>
        `| ${horizon(item.holdMinutes)} | ${trial.id} | ${
          trial.available ? "met" : "under"
        } | ${trial.trades.toLocaleString()} | ${bps(trial.meanGrossBps)} | ${
          bps(trial.meanNetBps)
        } | ${bps(trial.lowerConfidenceBoundNetBps)} | ${
          trial.positiveFolds
        }/${receipt.target.folds} | ${bps(trial.worstFoldMeanNetBps)} |`)),
    "",
    `Observed result: ${receipt.observedResult}`,
    "",
    receipt.interpretation,
    "",
    "The 24h low-tail z1 row is explicitly not a pass. Its 45 trades are far below the frozen per-fold floor, only three folds were positive, and its aggregate lower confidence bound is negative.",
    "",
    "### Sources",
    "",
    ...knowledge.sources.map((source) => `- [${source.title}](${source.url}) — ${source.use}`),
  ].join("\n");
}
