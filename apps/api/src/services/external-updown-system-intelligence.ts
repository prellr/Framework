/**
 * Outcome-blind external system and historical Formula Lab intelligence.
 *
 * This is a static research artifact. It has no network, database, tape, result, paper-ledger,
 * strategy-registry, Crucible, account, wallet, signing, or order dependency.
 */
import { LEGACY_ALBERT_FORMULA_RESEARCH } from "./legacy-formula-research.ts";

export type ExternalSystemResearchSource = {
  key: string;
  evidenceTier: "open-source" | "public-live-ui" | "community-anecdote" | "commercial-ui";
  title: string;
  url: string;
  screenshotUrl?: string;
  reusableEvidence: string;
  limitation: string;
};

export const EXTERNAL_UPDOWN_SYSTEM_INTELLIGENCE = {
  version: "alchemy-external-updown-system-intelligence-2026-07-24",
  status: "active",
  recordedFor: ["Alchemy Formula Lab", "Polymarket Up/Down research"],
  sources: [
    {
      key: "btc5m-web",
      evidenceTier: "open-source",
      title: "doge-8/btc5m-web — open-source Polymarket BTC 5m decision console",
      url: "https://github.com/doge-8/btc5m-web",
      screenshotUrl:
        "https://raw.githubusercontent.com/doge-8/btc5m-web/main/docs/screenshots/dashboard.png",
      reusableEvidence:
        "A source-health strip, independent Polymarket/Chainlink/Binance/user streams, source ages, price-to-beat, remaining time, book state, rule explanation, and latency telemetry can coexist in one decision inspector.",
      limitation:
        "The repository and screenshot demonstrate software and interface patterns, not durable strategy profitability.",
    },
    {
      key: "weather-bot",
      evidenceTier: "open-source",
      title: "suislanchez/polymarket-kalshi-weather-bot — prediction-market operations dashboard",
      url: "https://github.com/suislanchez/polymarket-kalshi-weather-bot",
      screenshotUrl:
        "https://raw.githubusercontent.com/suislanchez/polymarket-kalshi-weather-bot/main/docs/dashboard.png",
      reusableEvidence:
        "System logs, market-window state, model probability, executable market price, stated edge, equity, calibration, feature diagnostics, and signal history should be inspectable together.",
      limitation:
        "README strategy and performance claims are self-reported and receive no evidentiary weight.",
    },
    {
      key: "polyism",
      evidenceTier: "public-live-ui",
      title: "Polyism — public multi-asset Polymarket 5m/15m/1h monitor",
      url: "https://polyism.xyz/",
      reusableEvidence:
        "A compact cross-asset view can align BTC, ETH, XRP, and SOL price paths, market probabilities, price-to-beat, time remaining, timeframe, and a live trade tape.",
      limitation:
        "The public description says price-to-beat can be approximated from a nearby Chainlink block; that approximation must not be treated as an authoritative resolution value.",
    },
    {
      key: "fair-value-archive",
      evidenceTier: "open-source",
      title: "zayansalman/btc-5m-binary-fair-value — self-falsified BTC 5m research archive",
      url: "https://github.com/zayansalman/btc-5m-binary-fair-value",
      reusableEvidence:
        "One fee model, preregistered replay thresholds, append-only ledgers, self-validating outcome reconstruction, subset ablations, FDR controls, kill criteria, and tick-cadence monitoring form a strong negative-result workflow.",
      limitation:
        "Its archived basis filters and strategies are not identical to Alchemy's resolution-source feature-cut question; the negative result is a prior, not a reason to rewrite an already frozen protocol.",
    },
    {
      key: "market-making-devpost",
      evidenceTier: "community-anecdote",
      title: "Polymarket Market Making — queue-position and microprice project",
      url: "https://devpost.com/software/polymarket-market-making",
      reusableEvidence:
        "Queue position, microprice, depth momentum, inventory skew, and late-window restrictions are plausible execution-mechanism features worth measuring.",
      limitation:
        "The public project page is not peer-reviewed evidence and supplies no transferable threshold.",
    },
    {
      key: "realistic-paper-engine",
      evidenceTier: "community-anecdote",
      title: "Community write-up — realistic Polymarket paper execution",
      url: "https://www.reddit.com/r/ai_trading/comments/1sr9iw4/built_two_polymarket_trading_bots_obsessed_over/",
      reusableEvidence:
        "Depth-aware VWAP, queue tracking, latency, adverse movement, actual fees, consumed depth, partial fills, and the Chainlink resolution source belong in paper execution semantics.",
      limitation:
        "This is an unverified community account; it supplies an implementation checklist, not measured execution constants.",
    },
    {
      key: "paper-live-gap",
      evidenceTier: "community-anecdote",
      title: "Community postmortem — paper/live divergence in short-window markets",
      url: "https://www.reddit.com/r/PredictionsMarkets/comments/1s46vn7/my_polymarket_bot_wins_68_of_the_time_and_still/",
      reusableEvidence:
        "Quote freshness tails, fill rate, stale-book events, partial fills, order acknowledgements, and market-close races should be first-class operational metrics.",
      limitation:
        "Reported timings and outcomes are anecdotal and must be measured independently on Alchemy's own shadow connector.",
    },
    {
      key: "paper-only-research",
      evidenceTier: "community-anecdote",
      title: "Community paper-only BTC 5m research notes",
      url: "https://www.reddit.com/r/algotrading/comments/1tpu2nz/i_was_bored_so_i_though_of_making_a_5min/",
      reusableEvidence:
        "Tail freshness, source drift, and execution realism can dominate a clean headline hit rate and deserve their own diagnostic panels.",
      limitation: "The post is an anecdotal research prior, not reproducible evidence of alpha.",
    },
    {
      key: "kalshi-cli",
      evidenceTier: "open-source",
      title: "OctagonAI/kalshi-trading-bot-cli — model-versus-market explanation table",
      url: "https://github.com/OctagonAI/kalshi-trading-bot-cli",
      screenshotUrl:
        "https://raw.githubusercontent.com/OctagonAI/kalshi-trading-bot-cli/main/assets/screenshot.png",
      reusableEvidence:
        "Showing independent model probability beside market probability, edge, volume, and source provenance makes a decision auditable.",
      limitation:
        "Kalshi market mechanics and the project's model outputs are not direct evidence for Polymarket crypto Up/Down markets.",
    },
    {
      key: "polybot",
      evidenceTier: "commercial-ui",
      title: "PolyBot — commercial dashboard preview",
      url: "https://getpolybot.com/",
      screenshotUrl: "https://getpolybot.com/static/dashboard-preview.png",
      reusableEvidence:
        "Fee-true balance, equity, drawdown episode, streaks, entry, side, stake, fee, result, P&L, ROI, and post-trade balance form a useful account-path view.",
      limitation:
        "Marketing and profitability claims are unverified; only the visual information architecture is retained.",
    },
  ] satisfies ExternalSystemResearchSource[],
  historicalFormula: LEGACY_ALBERT_FORMULA_RESEARCH,
  reusableAnalytics: [
    {
      priority: 1,
      name: "Decision clock and resolution inspector",
      detail:
        "For every opportunity show authoritative price-to-beat, current Chainlink round, venue price, basis, executable Up/Down asks, remaining time, source timestamps, receive timestamps, and the exact frozen rule outcome.",
    },
    {
      priority: 2,
      name: "Freshness-tail and tick-cadence health",
      detail:
        "Display p50, p95, p99, and maximum source age, inter-tick gaps, disconnect/reconnect counts, stale-decision abstentions, and per-source heartbeat separately from the engine heartbeat.",
    },
    {
      priority: 3,
      name: "Decision funnel",
      detail:
        "Count eligible windows, fired signals, abstentions, and rejection reasons such as stale source, no paired ask, insufficient edge, horizon mismatch, cooldown, or unavailable resolution anchor.",
    },
    {
      priority: 4,
      name: "Fee-true paper execution",
      detail:
        "Separate theoretical signal return from book VWAP, queue/partial-fill assumptions, quote age, spread, fees, slippage, unfilled quantity, capacity, and market-close risk.",
    },
    {
      priority: 5,
      name: "P&L decomposition and path risk",
      detail:
        "Show gross directional effect, fees, spread/slippage stress, unfilled opportunity cost, net return, drawdown episodes, exposure, and balance after each closed trade.",
    },
    {
      priority: 6,
      name: "Formula provenance and diversity",
      detail:
        "Retain canonical AST hash, parentage, operators, features, constants, complexity, depth, output distribution, signal density, clustering, asset, direction, threshold, horizon, and every failed trial.",
    },
  ],
  researchLeads: [
    {
      name: "Late-window distance-to-strike surface",
      disposition:
        "Visualize future outcomes across authoritative distance to strike × executable ask × remaining time × source freshness. Do not copy public snipe thresholds.",
    },
    {
      name: "Paired-book microprice and depth state",
      disposition:
        "Measure microprice, multi-level imbalance, depth momentum, spread, queue state, and cancellation bursts as a mechanism family with separate 5m and 15m identities.",
    },
    {
      name: "Resolution-source basis convergence",
      disposition:
        "Retain as the already preregistered outcome-blind feature-cut question. External failed basis filters are a negative prior, not permission to modify its version or boundary.",
    },
    {
      name: "Formula IC screen followed by walk-forward validation",
      disposition:
        "Use rank IC only inside training data to reduce expensive candidates; preserve the full generated denominator and require purged chronological folds, costs, multiplicity correction, and a new untouched boundary.",
    },
  ],
  rejectedPatterns: [
    "Always trade or never abstain.",
    "Adaptive leader switching on the same data used to score the leaders.",
    "Martingale, loss chasing, or risk increases justified by a recent streak.",
    "Copying public thresholds, screenshots, win rates, or backtest claims into a registered strategy.",
    "Treating websocket connectivity, a midpoint, or a model probability as evidence of an executable fill.",
    "Treating a visually good formula curve or clustered peak calls as untouched validation.",
  ],
  invariants: {
    readsLockedFeatureValues: false,
    readsMarketOutcomes: false,
    readsPaperOutcomes: false,
    changesFeatureCuts: false,
    createsStrategy: false,
    createsPaperBot: false,
    startsSearch: false,
    startsCrucibleRun: false,
    enablesExecution: false,
    preservesVerdictGate: true,
  },
} as const;

function sourceLine(source: ExternalSystemResearchSource): string {
  return [
    `- **${source.title}** · \`${source.evidenceTier}\``,
    `  - Retain: ${source.reusableEvidence}`,
    `  - Limit: ${source.limitation}`,
  ].join("\n");
}

export function renderExternalUpdownSystemIntelligence(recordedAtIso: string): string {
  const record = EXTERNAL_UPDOWN_SYSTEM_INTELLIGENCE;
  const legacy = record.historicalFormula;
  return [
    "## External crypto Up/Down systems and Formula Lab priors — 2026-07-24",
    "",
    `Recorded ${recordedAtIso}. This is an outcome-blind research record, not a strategy admission or feature-cut change.`,
    "",
    "### Evidence policy",
    "",
    "- Open-source projects are retained as reproducible implementation and interface evidence. Their profitability claims are not inherited.",
    "- Public live and commercial systems contribute information architecture only unless their data and methods can be independently reconstructed.",
    "- Community reports contribute failure hypotheses and operational checklists only.",
    "- The user-supplied 2024 Albert conversations are primary historical design provenance. Their charts, win rates, and profit tables are not untouched evidence.",
    "",
    "### Systems and screenshots reviewed",
    "",
    ...record.sources.map(sourceLine),
    "",
    "### Highest-value analytics to bring into Alchemy",
    "",
    ...record.reusableAnalytics.map((item) => `${item.priority}. **${item.name}:** ${item.detail}`),
    "",
    "### Strategy-mechanism leads—not registered strategies",
    "",
    ...record.researchLeads.map((item) => `- **${item.name}:** ${item.disposition}`),
    "",
    "### Historical Formula Lab artifact: Albert",
    "",
    `Provenance: ${legacy.provenance.kind}, ${legacy.provenance.period}; supplied ${legacy.provenance.suppliedAt}.`,
    "",
    "```text",
    legacy.source,
    "```",
    "",
    `The parser round-trips the source exactly into a ${legacy.complexity}-node, depth-${legacy.depth} AST using ${legacy.operators.length} function types and features ${legacy.features.join(", ")}.`,
    "",
    ...legacy.interpretation.map((item) => `- ${item}`),
    "",
    "#### What the historical system contributes",
    "",
    "- A modular pipeline: generate formulae, run a cheap statistical screen, send survivors to expensive walk-forward assessment, then simulate target-specific capital and risk.",
    "- Formula output must be plotted against price before trade markers, so a human can see what the expression actually detects.",
    "- Long and short formulas may be different families. Fixed exits such as `SHORT_8`, `SHORT_16`, `SHORT_24`, and `SHORT_36` are different horizon trials.",
    "- Cross-period tables should expose the minimum period, recent period, per-period profit/points-per-trade/win rate, and signal clustering instead of only aggregate return.",
    "- Distributed workers should report scan rate, validation rate, machine health, complete denominators, canonical formula hashes, and duplicate/failed candidates.",
    "- Operator recurrence and ancestry across survivors are research diagnostics; genetic search can converge on local optima and does not remove the multiple-testing problem.",
    "",
    "#### Modernized validation contract",
    "",
    "- Information coefficient means a training-only time-series rank association between formula output and a future fixed-horizon return. It is a screening statistic, not P&L and not a verdict.",
    "- Screen thresholds, candidate budget, direction, asset, horizon, null construction, and survivor count are frozen before the search cut.",
    "- Autocorrelation and overlapping labels require purging/embargo or non-overlapping samples; arbitrary random train/test splits are inadmissible.",
    "- Every generated, invalid, duplicate, zero-trade, screened-out, and selected formula stays in the trial denominator.",
    "- Survivors receive purged chronological walk-forward tests, target-specific costs/fills, familywise correction, and then a newly registered untouched forward boundary.",
    "- Capital simulation receives a frozen trade ledger plus starting funds, risk model, concurrency, exposure, compounding, liquidity, and liquidation rules. It never improves a formula's evidence grade.",
    "",
    "#### Formula-specific warnings",
    "",
    ...legacy.warnings.map((item) => `- ${item}`),
    "",
    "### Explicit rejections",
    "",
    ...record.rejectedPatterns.map((item) => `- ${item}`),
    "",
    "### Disposition",
    "",
    "- Add the exact Albert expression as a non-executable import/AST fixture and knowledge-base artifact.",
    "- Add source freshness tails, decision funnel, fee decomposition, formula provenance, and cross-period minima to the product backlog.",
    "- Do not add a strategy, paper bot, threshold, result, feature cut, collector, search job, Crucible run, account access, signing route, allocation, or fund-moving path.",
    "- Preserve the frozen familywise roster, the current resolution-source feature-cut version, and the unchanged verdict gate.",
  ].join("\n");
}
