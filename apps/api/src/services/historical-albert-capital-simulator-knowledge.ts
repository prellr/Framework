import {
  HISTORICAL_ALBERT_CAPITAL_SIMULATOR,
  HISTORICAL_ALBERT_TRADE_LEDGER_IDENTITY,
} from "./historical-albert-capital-simulator.ts";

export const HISTORICAL_ALBERT_CAPITAL_SIMULATOR_KNOWLEDGE = {
  version: "alchemy-historical-albert-capital-simulator-research-v1",
  status: "active",
  sources: [
    {
      title: "Hyperliquid trading fees",
      url: "https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees",
      use:
        "Primary venue source for the editable 4.5 bps-per-fill base-tier perpetual taker-fee default.",
    },
    {
      title: "Hyperliquid funding",
      url: "https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding",
      use:
        "Primary venue source for the hourly funding mechanism; imported OHLCV contains no historical funding ledger.",
    },
  ],
  invariants: {
    changesFrozenReceipt: false,
    readsLiveAccount: false,
    selectsWinner: false,
    registersStrategy: false,
    createsPaperBot: false,
    enablesExecution: false,
  },
} as const;

export function renderHistoricalAlbertCapitalSimulatorKnowledge(
  recordedAt: string,
): string {
  const simulator = HISTORICAL_ALBERT_CAPITAL_SIMULATOR;
  const artifact = HISTORICAL_ALBERT_TRADE_LEDGER_IDENTITY;
  const defaults = simulator.defaultAssumptions;
  return [
    "## Historical Albert trade ledger and capital simulator v1",
    "",
    `Recorded: ${recordedAt}`,
    "",
    "### What archived final equity means",
    "",
    "- It is a retrospective capital illustration over chronological out-of-sample holdout trades, not a live account balance.",
    "- The archived Formula Lab rows start with $10,000, size every accepted trade at a fixed $1,000 notional, do not compound, and permit only one open position.",
    "- Each row's scored period begins at its first eligible holdout entry and ends at its last forced exit. It is shorter than the full source tape.",
    "- The archived rows retain their original generic 10 bps round-trip cost so their frozen receipts remain reproducible.",
    "",
    "### Exact trade-ledger artifact",
    "",
    `- Artifact version: \`${artifact.version}\``,
    `- Content hash: \`${artifact.contentHash}\``,
    `- Evidence class: \`${artifact.evidenceClass}\``,
    `- Source dataset: \`${artifact.sourceDataset.id}\``,
    `- Source dataset hash: \`${artifact.sourceDataset.contentHash}\``,
    `- Source rows: ${artifact.sourceDataset.rows.toLocaleString()}`,
    `- Experiments: ${artifact.experiments}`,
    `- Formula trial rows: ${artifact.trialRows}`,
    `- Exact holdout trade observations: ${artifact.trades.toLocaleString()}`,
    "- Every trade records entry time, forced exit time, observed entry-open price, observed exit-open price, and the resulting short return.",
    "- Entries and exits are OHLCV research marks. They are not a reconstruction of executable order-book fills, latency, liquidation, or depth.",
    "",
    "### Configurable simulation",
    "",
    `- Starting equity default: $${defaults.initialCapitalUsd.toLocaleString()}.`,
    `- Position default: $${defaults.sizingValue.toLocaleString()} fixed notional; compounding ${defaults.compoundSizing ? "on" : "off"}.`,
    "- Supported sizing: fixed notional, percentage-of-equity notional, fixed risk budget, and percentage-of-equity risk budget.",
    `- Leverage default: ${defaults.leverage}×.`,
    `- Planned-loss default: ${defaults.plannedLossPct}% of notional.`,
    "- Risk-based sizing translates a risk budget into notional. No stop-loss is simulated, so realized loss can exceed the planned budget.",
    "- The simulator reports equity path, drawdown, exposure, profit factor, risk-budget breaches, and a paginated exact trade ledger.",
    "",
    "### Hyperliquid execution-cost contract",
    "",
    `- Taker fee default: ${defaults.takerFeeBpsPerSide} bps on entry and ${defaults.takerFeeBpsPerSide} bps on exit.`,
    "- Exit fee is charged against observed exit notional; it is not assumed to equal entry notional.",
    `- Slippage default: ${defaults.slippageBpsPerSide} bps per side, independently editable.`,
    `- Funding default: ${defaults.fundingBpsPerDay} bps per day, independently editable.`,
    "- Hyperliquid funding accrues hourly, but the TradingView OHLCV import has no historical funding series. Zero is therefore an explicit missing-data default, not a claim that funding was zero.",
    "- Fee tiers can differ by user volume, maker/taker role, and program state. The UI exposes the fee input instead of treating 4.5 bps as universal.",
    "",
    "### Example selected row",
    "",
    "- BTC 1h chart, 24h forced exit, Albert low-tail z1.",
    "- Scored holdout period: 2025-10-21 19:00 UTC through 2026-07-21 19:00 UTC.",
    "- 45 trades: 27 wins and 18 losses.",
    "- Archived generic-cost end equity: $10,131.49 from $10,000.",
    "- Hyperliquid-aware default illustration: $10,131.58 from $10,000 using 4.5 bps taker plus 0.5 bps slippage on each side and zero assumed funding.",
    "",
    "### Disposition",
    "",
    "- Retrospective analysis only.",
    "- Changing capital, leverage, fee, slippage, funding, or sizing assumptions does not modify a frozen research receipt.",
    "- No simulator result selects a formula, registers a strategy, creates a paper bot, reaches an account, signs an order, or enables execution.",
    "",
    "### Sources",
    "",
    ...HISTORICAL_ALBERT_CAPITAL_SIMULATOR_KNOWLEDGE.sources.map(
      (source) => `- [${source.title}](${source.url}) — ${source.use}`,
    ),
  ].join("\n");
}
