import {
  HISTORICAL_ALBERT_LONG_HORIZON_SENSITIVITY_RECEIPT,
} from "./historical-albert-long-horizon-sensitivity-receipt.ts";
import { LEGACY_ALBERT_FORMULA_RESEARCH } from "./legacy-formula-research.ts";

export const HISTORICAL_ALBERT_LONG_HORIZON_SENSITIVITY_KNOWLEDGE = {
  version: "alchemy-historical-albert-btc-5m-long-horizon-sensitivity-research-v1",
  status: "active",
  receipt: HISTORICAL_ALBERT_LONG_HORIZON_SENSITIVITY_RECEIPT,
  formula: LEGACY_ALBERT_FORMULA_RESEARCH,
  sources: [
    {
      title: "Microsoft Qlib v0.9.5 operator implementation",
      url: "https://github.com/microsoft/qlib/blob/v0.9.5/qlib/data/ops.py",
      use:
        "Pinned primary-source semantics for the imported Albert expression; unchanged across every exit horizon.",
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
const pct = (value: number | null) =>
  value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const horizon = (minutes: number) => `${minutes / 60}h`;

export function renderHistoricalAlbertLongHorizonSensitivityKnowledge(
  recordedAt: string,
): string {
  const knowledge = HISTORICAL_ALBERT_LONG_HORIZON_SENSITIVITY_KNOWLEDGE;
  const receipt = knowledge.receipt;
  return [
    "## Historical Albert formula × BTC 5m long-exit sensitivity v1",
    "",
    `Recorded: ${recordedAt}`,
    "",
    "### Disposition",
    "",
    "- Retrospective discovery only.",
    "- The frozen family changes only the forced exit clock: 8h, 12h, and 24h.",
    "- Every declared trial is retained. Missing the per-fold floor cannot be repaired by a positive aggregate mean.",
    "- No horizon or trial was selected, exported, registered, paper-launched, armed, or executed.",
    "",
    "### Frozen identity and mechanics",
    "",
    `- Dataset: \`${receipt.dataset.id}\``,
    `- Dataset version: \`${receipt.dataset.version}\``,
    `- Dataset hash: \`${receipt.dataset.contentHash}\``,
    `- Sensitivity receipt: \`${receipt.receiptHash}\``,
    `- Source: ${receipt.dataset.rows.toLocaleString()} BTC 5m bars in ${receipt.dataset.segments} gap-safe segments`,
    `- Entry: ${receipt.target.entry}.`,
    `- Exit: ${receipt.target.exit}.`,
    `- Cost stress: ${receipt.target.roundTripCostBps} bps per completed trade.`,
    `- Assessment: ${receipt.target.folds} expanding chronological folds; ${receipt.target.minimumTradesPerFold} trades required in every fold.`,
    "- Formula, side, threshold family, source tape, training-only moments, and non-overlap rule are unchanged.",
    "- OHLCV opens are deterministic research marks, not executable fills, spread, slippage, funding, latency, liquidation, or depth.",
    `- Capital illustration: ${receipt.target.capital}. It cannot improve the evidence grade.`,
    "",
    "```text",
    knowledge.formula.source,
    "```",
    "",
    "### Complete horizon × trial ledger",
    "",
    "| Exit | Trial | Floor | Trades | Gross mean | Net mean | Net hit | Positive folds | Worst fold | Final equity |",
    "|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...receipt.horizons.flatMap((item) =>
      item.trials.map((trial) =>
        `| ${horizon(item.holdMinutes)} | ${trial.id} | ${
          trial.available ? "met" : "under"
        } | ${trial.trades.toLocaleString()} | ${bps(trial.meanGrossBps)} | ${
          bps(trial.meanNetBps)
        } | ${pct(trial.hitRate)} | ${trial.positiveFolds}/${receipt.target.folds} | ${
          bps(trial.worstFoldMeanNetBps)
        } | $${trial.finalEquityUsd.toFixed(2)} |`)),
    "",
    `Observed result: ${receipt.observedResult}`,
    "",
    receipt.interpretation,
    "",
    "The 24h aggregate is not a pass: its sample floor failed, only three folds were positive, its worst fold and lower confidence bound were negative, and the Albert row was nearly indistinguishable from always-short.",
    "",
    "### Sources",
    "",
    ...knowledge.sources.map((source) => `- [${source.title}](${source.url}) — ${source.use}`),
  ].join("\n");
}
