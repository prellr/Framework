import { HISTORICAL_ALBERT_REPLAY_RECEIPT } from "./historical-albert-replay-receipt.ts";
import { LEGACY_ALBERT_FORMULA_RESEARCH } from "./legacy-formula-research.ts";

export const HISTORICAL_ALBERT_REPLAY_KNOWLEDGE = {
  version: "alchemy-historical-albert-btc-5m-replay-research-v1",
  status: "active",
  receipt: HISTORICAL_ALBERT_REPLAY_RECEIPT,
  formula: LEGACY_ALBERT_FORMULA_RESEARCH,
  sources: [
    {
      title: "Microsoft Qlib v0.9.5 operator implementation",
      url: "https://github.com/microsoft/qlib/blob/v0.9.5/qlib/data/ops.py",
      use:
        "Primary-source semantics for Less, Max, Ref, WMA, Cov, arithmetic operators, rolling windows, and historical WMA scaling.",
    },
    {
      title: "Microsoft Qlib v0.9.5 release tree",
      url: "https://github.com/microsoft/qlib/tree/v0.9.5",
      use:
        "Version pin predating the August 2024 supplied formula and retained for reproducible replay.",
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

export function renderHistoricalAlbertReplayKnowledge(recordedAt: string): string {
  const knowledge = HISTORICAL_ALBERT_REPLAY_KNOWLEDGE;
  const receipt = knowledge.receipt;
  const formula = knowledge.formula;
  return [
    "## Historical Albert formula × BTC 5m fixed-horizon replay v1",
    "",
    `Recorded: ${recordedAt}`,
    "",
    "### Disposition",
    "",
    "- Retrospective discovery only.",
    "- No strategy selected, exported, registered, paper-launched, armed, or executed.",
    "- No declared trial produced a positive net fold after the 10 bps cost stress.",
    "- Any later survivor must receive a new identity and begin at a new untouched paper boundary.",
    "",
    "### Source and receipt identity",
    "",
    `- Dataset: \`${receipt.dataset.id}\``,
    `- Dataset version: \`${receipt.dataset.version}\``,
    `- Dataset hash: \`${receipt.dataset.contentHash}\``,
    `- Replay receipt: \`${receipt.receiptHash}\``,
    `- Rows: ${receipt.dataset.rows.toLocaleString()} source bars; ${receipt.dataset.eligiblePoints.toLocaleString()} eligible decisions; ${receipt.dataset.segments} gap-safe segments`,
    `- Coverage: ${new Date(receipt.dataset.startAtMs).toISOString()} through ${new Date(receipt.dataset.endAtMs).toISOString()}`,
    "",
    "### Corrected formula semantics",
    "",
    "```text",
    formula.source,
    "```",
    "",
    `The expression is evaluated with ${receipt.evaluator.semantics}, pinned to ${receipt.evaluator.sourceUrl}.`,
    "",
    "- `Less(left,right)` is the numeric element-wise minimum. It is not Boolean less-than; Qlib's Boolean operator is `Lt`.",
    "- `Max(feature,N)` is an N-observation rolling maximum. It is not a two-input maximum or a numeric floor.",
    "- `Ref(feature,N)` reads N periods ago for positive N. Future references are rejected by Alchemy.",
    "- `Cov(left,right,N)` is rolling sample covariance over pairwise available observations.",
    "- Qlib v0.9.5 `WMA` normalizes linear weights and then applies `np.nanmean(weight * x)`. Alchemy reproduces that historical scaling exactly; a conventional weighted sum is a separate sensitivity trial.",
    "- All lag and rolling state resets at canonical tape gaps.",
    "",
    `Observed output range: ${receipt.evaluator.minimum.toExponential(4)} to ${receipt.evaluator.maximum.toExponential(4)}, mean ${receipt.evaluator.mean.toExponential(4)}. The extreme negative skew explains why the mean-plus-0.5σ and mean-plus-1σ high-tail gates produce no trades.`,
    "",
    "### Fixed-clock replay mechanics",
    "",
    `- Decision: ${receipt.target.entry}.`,
    `- Exit: ${receipt.target.exit}.`,
    `- Side: ${receipt.target.side}; hold: ${receipt.target.holdMinutes} minutes.`,
    `- Cost stress: ${receipt.target.roundTripCostBps} bps per completed trade.`,
    `- Assessment: ${receipt.target.folds} expanding chronological folds; thresholds estimated from purged prior rows only; ${receipt.target.minimumTradesPerFold} trades required in every fold.`,
    "- Positions cannot overlap. Labels cannot cross a canonical gap.",
    "- OHLCV opens are deterministic research marks, not bids, asks, fills, funding, latency, liquidation, or depth.",
    `- Capital illustration: ${receipt.target.capital}. It is descriptive and cannot improve the evidence grade.`,
    "",
    "### Trial ledger",
    "",
    "| Trial | Floor | Trades | Gross mean | Net mean | Net hit | Positive folds | Worst fold | Final equity |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...receipt.trials.map((trial) =>
      `| ${trial.id} | ${trial.available ? "met" : "under"} | ${trial.trades.toLocaleString()} | ${bps(trial.meanGrossBps)} | ${bps(trial.meanNetBps)} | ${
        trial.hitRate == null ? "—" : `${(trial.hitRate * 100).toFixed(1)}%`
      } | ${trial.positiveFolds}/${receipt.target.folds} | ${bps(trial.worstFoldMeanNetBps)} | $${trial.finalEquityUsd.toFixed(2)} |`),
    "",
    `Observed result: ${receipt.observedResult}`,
    "",
    "### Information coefficient",
    "",
    "| Fold | Pearson IC | Spearman rank IC |",
    "|---:|---:|---:|",
    ...receipt.informationCoefficientByFold.map((fold) =>
      `| ${fold.fold} | ${fold.pearson >= 0 ? "+" : ""}${fold.pearson.toFixed(4)} | ${fold.spearman >= 0 ? "+" : ""}${fold.spearman.toFixed(4)} |`),
    "",
    "The rank IC is small and positive in each fold, but a small association is not executable alpha. Thresholded short returns do not cover the cost stress.",
    "",
    "### Next Formula Lab family",
    "",
    receipt.nextResearchStep,
    "",
    "A defensible second family may separately declare rank/percentile gates, winsorized scores, the two root components, a conventional-WMA sensitivity, long-side targets, and alternate fixed horizons. Those are new trials prompted by this distribution audit, not corrections silently applied to the original receipt.",
    "",
    "### Sources",
    "",
    ...knowledge.sources.map((source) => `- [${source.title}](${source.url}) — ${source.use}`),
  ].join("\n");
}
