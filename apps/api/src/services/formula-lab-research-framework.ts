/**
 * Versioned research framework for Alchemy Formula Lab.
 *
 * This record joins the synthetic formula mechanics, scaled candidate ledger, retrospective venue
 * preview, and capital simulator into one reproducible methodology. It contains no database,
 * feature-value, outcome, account, Crucible, strategy-registry, paper-ledger, or execution access.
 */
import { FORMULAIC_CAPITAL_BACKTEST } from "./formulaic-capital-backtest.ts";
import { FORMULAIC_FIXED_HORIZON_POC } from "./formulaic-fixed-horizon-contract.ts";
import { FORMULAIC_SCALE_ENGINE } from "./formulaic-scale-engine.ts";
import { FORMULAIC_VENUE_PREVIEW } from "./formulaic-venue-preview-contract.ts";

export type FormulaLabResearchSource = {
  key: string;
  kind: "academic" | "official-data-interface" | "practitioner-engineering";
  title: string;
  url: string;
  contribution: string;
  limitation: string;
};

export const FORMULA_LAB_RESEARCH_FRAMEWORK = {
  version: "alchemy-formula-lab-research-framework-v2",
  status: "active",
  extends: FORMULAIC_FIXED_HORIZON_POC.version,
  mechanicsVersions: {
    fixedHorizon: FORMULAIC_FIXED_HORIZON_POC.version,
    scaleEngine: FORMULAIC_SCALE_ENGINE.version,
    venuePreview: FORMULAIC_VENUE_PREVIEW.version,
    capitalBacktest: FORMULAIC_CAPITAL_BACKTEST.version,
  },
  sources: [
    {
      key: "pysr",
      kind: "academic",
      title: "Interpretable Machine Learning for Science with PySR and SymbolicRegression.jl",
      url: "https://arxiv.org/abs/2305.01582",
      contribution:
        "Symbolic regression can search a bounded expression space while retaining human-readable formulas and explicit complexity control.",
      limitation:
        "Search quality does not establish financial profitability or remove selection bias.",
    },
    {
      key: "white-reality-check",
      kind: "academic",
      title: "A Reality Check for Data Snooping",
      url: "https://doi.org/10.1111/1468-0262.00152",
      contribution:
        "Repeated reuse of the same observations across many rules creates a multiple-testing problem; the winning rule can be a chance winner.",
      limitation:
        "The paper does not prescribe Alchemy's exact formula grammar, cost model, or forward gate.",
    },
    {
      key: "pbo",
      kind: "academic",
      title: "The Probability of Backtest Overfitting",
      url: "https://doi.org/10.21314/JCF.2016.322",
      contribution:
        "Combinatorially symmetric cross-validation provides a way to diagnose how often an in-sample winner underperforms out of sample.",
      limitation:
        "PBO is a diagnostic; it is not permission to promote a selected strategy.",
    },
    {
      key: "deflated-sharpe",
      kind: "academic",
      title: "The Deflated Sharpe Ratio: Correcting for Selection Bias, Backtest Overfitting, and Non-Normality",
      url: "https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf",
      contribution:
        "A performance statistic must account for the number of trials, selection bias, and non-normal returns.",
      limitation:
        "Alchemy's fixed-horizon preview reports basis-point outcomes, not a standalone Sharpe verdict.",
    },
    {
      key: "holm",
      kind: "academic",
      title: "A Simple Sequentially Rejective Multiple Test Procedure",
      url: "https://doi.org/10.2307/4615733",
      contribution:
        "The step-down Holm procedure controls familywise error without requiring independent hypotheses.",
      limitation:
        "A corrected statistical pass remains only one input to operational and economic review.",
    },
    {
      key: "harvey-liu-zhu",
      kind: "academic",
      title: "... and the Cross-Section of Expected Returns",
      url: "https://www.nber.org/system/files/working_papers/w20592/w20592.pdf",
      contribution:
        "Large strategy searches require a much higher evidentiary bar than an isolated nominal significance threshold.",
      limitation:
        "The asset-pricing setting is not a direct estimate of crypto fixed-horizon execution returns.",
    },
    {
      key: "polymarket-realtime",
      kind: "official-data-interface",
      title: "Polymarket Real-Time Data Socket",
      url: "https://docs.polymarket.com/market-data/realtime-data",
      contribution:
        "Defines public market-data streams separately from authenticated user and order activity.",
      limitation:
        "A public midpoint or book observation is not proof of a fill at that price.",
    },
    {
      key: "hyperliquid-websocket",
      kind: "official-data-interface",
      title: "Hyperliquid WebSocket subscriptions",
      url: "https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions",
      contribution:
        "Defines the public streaming interfaces used by a causal source adapter.",
      limitation:
        "Transport availability does not supply a target-specific cost, slippage, or funding model.",
    },
    {
      key: "chainlink-data-feeds",
      kind: "official-data-interface",
      title: "Chainlink Data Feeds API Reference",
      url: "https://docs.chain.link/data-feeds/api-reference",
      contribution:
        "Defines reference-feed round data and timestamps needed for causal freshness controls.",
      limitation:
        "A reference feed is not an executable venue quote.",
    },
    {
      key: "bandy",
      kind: "practitioner-engineering",
      title: "Quantitative Trading Systems: Practical Methods for Design, Testing, and Validation",
      url: "https://books.google.ca/books?id=ttotKQEACAAJ",
      contribution:
        "Supports the engineering discipline of reserving untouched observations and separating in-sample development from out-of-sample assessment.",
      limitation:
        "Practitioner guidance informs workflow design; it is not empirical evidence for an Alchemy formula.",
    },
    {
      key: "davey",
      kind: "practitioner-engineering",
      title: "Building Winning Algorithmic Trading Systems",
      url: "https://onlinelibrary.wiley.com/doi/book/10.1002/9781118778944",
      contribution:
        "Supports walk-forward testing, explicit position sizing, and Monte Carlo review of path-dependent account outcomes.",
      limitation:
        "The examples do not validate Alchemy's data, formulas, targets, or transaction-cost assumptions.",
    },
    {
      key: "van-tharp",
      kind: "practitioner-engineering",
      title: "Trade Your Way to Financial Freedom",
      url: "https://www.mheducation.com/highered/mhp/product/trade-your-way-financial-freedom.html",
      contribution:
        "Motivates separating trade expectancy from position sizing and stating risk in comparable units.",
      limitation:
        "The framework is used as risk-language guidance, not as a statistical validation method.",
    },
    {
      key: "bodek-shaw",
      kind: "practitioner-engineering",
      title: "Introduction to HFT Scalping Strategies",
      url: "https://www.smallake.kr/wp-content/uploads/2014/05/Bodek-H-Shaw-M-Introduction-to-HFT-Scalping-Strategies.pdf",
      contribution:
        "Highlights queue position, liquidity withdrawal, slippage, and transaction costs as first-order execution concerns.",
      limitation:
        "Equity-market microstructure examples cannot be copied directly into crypto or binary-event economics.",
    },
  ] satisfies FormulaLabResearchSource[],
  invariants: {
    readsLockedLiveValues: false,
    readsMarketOutcomes: false,
    readsPaperOutcomes: false,
    createsStrategy: false,
    createsPaperBot: false,
    startsCrucibleRun: false,
    enablesExecution: false,
    preservesVerdictGate: true,
  },
} as const;

function sourceLine(source: FormulaLabResearchSource): string {
  return `- **${source.title}** (${source.kind}): ${source.contribution} ${source.limitation}`;
}

export function renderFormulaLabResearchFramework(recordedAtIso: string): string {
  const fixed = FORMULAIC_FIXED_HORIZON_POC;
  const scale = FORMULAIC_SCALE_ENGINE;
  const preview = FORMULAIC_VENUE_PREVIEW;
  const capital = FORMULAIC_CAPITAL_BACKTEST;
  const minimumPreviewFrames =
    preview.assessment.minimumTrainPoints
    + preview.assessment.folds * preview.assessment.testPointsPerFold;

  return [
    "## Alchemy Formula Lab research framework v2",
    "",
    `Recorded ${recordedAtIso}. This version extends \`${fixed.version}\`; it does not rewrite the v1 synthetic POC.`,
    "",
    "### Purpose and evidence boundary",
    "",
    "- Formula Lab is a hypothesis factory for bounded, human-inspectable algebraic entry rules and explicit time-based exits. It is not an optimizer-to-production pipeline.",
    "- Synthetic tests establish software mechanics only. A retrospective venue preview establishes that the adapters and statistics can run on a frozen historical cut only. Neither is forward market evidence.",
    "- A discovery winner is a newly registered hypothesis. It receives no inherited verdict, paper allocation, strategy registration, or execution authority.",
    "",
    "### What the research contributes—and what it does not",
    "",
    ...FORMULA_LAB_RESEARCH_FRAMEWORK.sources.map(sourceLine),
    "",
    "### Bounded formula representation",
    "",
    `- Formulas are typed expression trees with ${fixed.grammar.maximumNodes} nodes maximum and depth ${fixed.grammar.maximumDepth} maximum; arbitrary code and JavaScript evaluation are forbidden.`,
    `- Allowed source features are fixed: ${fixed.features.join(", ")}.`,
    `- The scale engine defaults to ${scale.defaultVariantCount.toLocaleString("en-US")} variants and rejects experiments above ${scale.maximumVariants.toLocaleString("en-US")} variants.`,
    "- Formula × constants × entry threshold × exit horizon × asset × target adapter is the trial unit. Every generated unit remains in the append-only denominator, including invalid, missing, and zero-trade rows.",
    "- Complexity and evaluation budgets are research controls. They improve reproducibility and interpretability; they do not make a formula statistically valid.",
    "",
    "### Data, labels, and distributed evaluation",
    "",
    "- A coordinator freezes one causal, source-timestamped dataset and an immutable candidate manifest. Content hashes bind workers to those exact inputs.",
    "- Workers pull bounded shards and return one result for every assigned candidate-target unit. They cannot select winners, change manifests, read accounts, or mutate strategy state.",
    `- The first target is fixed before search: a ${fixed.target.holdSeconds / 60}-minute short-underlying log return. Entry cooldown equals the hold, so accepted positions cannot overlap.`,
    "- Source adapters and target adapters remain separate. Chainlink can provide a resolution reference and Hyperliquid can provide venue state without pretending that either midpoint is an executable Polymarket fill.",
    "",
    "### Chronological validation and multiplicity",
    "",
    "- Discovery and validation are chronological. All labels extending through a split boundary are purged, and all normalization and entry thresholds are fit on prior training data only.",
    "- Candidate ranking is descriptive during discovery. Selected definitions are frozen behind a new untouched future boundary.",
    `- The untouched validation family uses ${scale.validation.validationCorrection} correction at familywise alpha ${scale.validation.validationAlpha}. Missing, invalid, and zero-trade candidates remain part of the declared family.`,
    "- A familywise statistical pass can make a candidate eligible for human verdict review; it cannot register a strategy, create a paper bot, or enable execution.",
    "",
    "### Cost and execution semantics",
    "",
    `- The current venue preview subtracts a frozen ${preview.target.roundTripCostBps} bps round-trip stress from every accepted trade.`,
    "- Gross mean describes the directional effect before that stress. Net mean describes the same held-out trades after it.",
    "- The preview uses Hyperliquid midpoint labels and explicitly has no fill model. A separate target adapter must model executable entry/exit prices, fees, spread, slippage, depth, funding, stale data, partial fills, and unavailable exits.",
    "- Public market data and authenticated order activity remain separate interfaces. Formula Lab has no signing, order, wallet, or fund-moving path.",
    "",
    "### Capital simulation",
    "",
    `- Capital simulations use \`${capital.version}\` and require starting capital, sizing mode, compounding policy, min/max notional, exposure limit, concurrency limit, and liquidation equity.`,
    "- Every target outcome states net return on notional, maximum planned loss per dollar of notional, and capital reserved per dollar of notional. This keeps binary stakes, spot positions, and margined perpetuals from silently sharing incompatible risk semantics.",
    "- Equity is marked at grouped exit timestamps. Without a trustworthy intratrade path the simulator does not fabricate an intratrade drawdown.",
    "- Monte Carlo, path reshuffling, and stress scenarios are diagnostics around a frozen trade distribution, never substitutes for untouched forward validation.",
    "",
    "### Preview column dictionary",
    "",
    "- **Asset:** one independently assessed Chainlink × Hyperliquid USD pair; pairs are never pooled.",
    "- **Frozen trial:** the preregistered formula and entry threshold. `z0.5` means the formula output must be at least 0.5 training-fold standard deviations above its training-fold mean.",
    `- **Complete frames:** all usable one-minute feature/label observations in the immutable cut, including training and holdout observations. The current four-fold preview needs at least ${minimumPreviewFrames.toLocaleString("en-US")} frames before a full walk-forward can be formed.`,
    "- **Holdout trades:** non-overlapping entries accepted inside the chronological test folds; this is not the number of complete frames.",
    "- **Positive folds:** test folds whose average net return is above zero after the frozen cost stress; this is fold consistency, not individual trade wins.",
    "- **Gross mean (bps):** trade-weighted mean fixed-horizon short return before the cost stress.",
    "- **Net mean (bps):** trade-weighted mean after the cost stress.",
    "- **Net hit rate:** share of held-out trades whose return remains above zero after the cost stress.",
    "- A dash means the preregistered row was retained but lacked enough observations or trades; it does not mean zero.",
    "",
    "### Current disposition",
    "",
    `- \`${preview.version}\` is frozen as \`${preview.status}\`; it cannot rank, export, register, or promote a hypothesis.`,
    `- \`${scale.version}\` can generate and account for ${scale.defaultVariantCount.toLocaleString("en-US")} default variants, but discovery scores remain non-authorizing.`,
    "- The next admissible evidence step is a preregistered, untouched future validation boundary with a complete candidate denominator and frozen target economics.",
    "- This record adds no collector, subscription, market query, result query, strategy, paper decision, Crucible run, account access, signing capability, order route, allocation, or fund-moving path.",
  ].join("\n");
}
