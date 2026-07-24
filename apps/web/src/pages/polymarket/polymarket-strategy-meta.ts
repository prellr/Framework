export type StrategyFamily = "signal" | "regime" | "pattern" | "pricer" | "control";

export interface StrategyMeta {
  family: StrategyFamily;
  thesis: string;
  scope: string;
  origin: string;
}

export const FAMILY_META: Record<StrategyFamily, { label: string; short: string; color: string }> = {
  signal: {
    label: "Directional signals",
    short: "Signal",
    color: "#3b82f6",
  },
  regime: {
    label: "Regime overlays",
    short: "Regime",
    color: "#14b8a6",
  },
  pattern: {
    label: "Price patterns",
    short: "Pattern",
    color: "#f59e0b",
  },
  pricer: {
    label: "Fair-value pricers",
    short: "Pricer",
    color: "#8b5cf6",
  },
  control: {
    label: "Benchmarks & controls",
    short: "Baseline",
    color: "#9ca3af",
  },
};

export const STRATEGY_META: Record<string, StrategyMeta> = {
  fade: {
    family: "signal",
    thesis: "Trade the inverse Tesseract probability when executable ask edge exceeds 5¢.",
    scope: "6 assets · 5m/15m",
    origin: "Tesseract",
  },
  fadeStrong: {
    family: "signal",
    thesis: "Fade Tesseract only when its probability is at least 15 points from neutral.",
    scope: "6 assets · 5m/15m",
    origin: "Tesseract",
  },
  fadeRegime: {
    family: "regime",
    thesis: "Fade Tesseract only when the prior 24 same-asset results describe a chop regime.",
    scope: "6 assets · 5m/15m",
    origin: "Outcome regime",
  },
  fadeTessCmoChop: {
    family: "regime",
    thesis: "Preserve the Tesseract fade, but admit entries only in a preregistered CMO chop state.",
    scope: "6 assets · 5m/15m",
    origin: "CMO regime",
  },
  follow: {
    family: "signal",
    thesis: "Trade in the direction of the Tesseract probability when ask edge exceeds 5¢.",
    scope: "6 assets · 5m/15m",
    origin: "Tesseract",
  },
  gaugeFade: {
    family: "signal",
    thesis: "Trade the inverse of the composite Trade-gauge probability.",
    scope: "6 assets · 5m/15m",
    origin: "Trade-gauge",
  },
  gaugeFollow: {
    family: "signal",
    thesis: "Trade in the direction of the composite Trade-gauge probability.",
    scope: "6 assets · 5m/15m",
    origin: "Trade-gauge",
  },
  fadeV1: {
    family: "signal",
    thesis: "Prospectively test the fade orientation of subscribed Jester V1 entries; the earlier counter-informative claim was retracted.",
    scope: "Subscribed pairs",
    origin: "Jester V1",
  },
  followV1: {
    family: "signal",
    thesis: "Follow subscribed Jester V1 entries using the same fixed probability bridge.",
    scope: "Subscribed pairs",
    origin: "Jester V1",
  },
  sweepReclaim: {
    family: "pattern",
    thesis: "Fade a failed sweep of the prior 20-bar extreme after the level is reclaimed.",
    scope: "6 assets · 5m/15m",
    origin: "Williams / Connors",
  },
  rocPivot: {
    family: "pattern",
    thesis: "Trade a fixed two-period rate-of-change pivot from completed candles.",
    scope: "6 assets · 5m/15m",
    origin: "Connors",
  },
  rocPivotCmoTrend: {
    family: "regime",
    thesis: "Apply the two-ROC pivot only while the preregistered CMO state is trending.",
    scope: "6 assets · 5m/15m",
    origin: "ROC + CMO",
  },
  bollingerMfi: {
    family: "pattern",
    thesis: "Confirm a Bollinger %b expansion with fixed MFI(10) volume pressure.",
    scope: "6 assets · 5m/15m",
    origin: "Bollinger Method II",
  },
  td9Exhaustion: {
    family: "pattern",
    thesis: "Trade only perfected ninth-bar TD setup exhaustion events.",
    scope: "6 assets · 5m/15m",
    origin: "TD Sequential",
  },
  stochAdxSnapback: {
    family: "pattern",
    thesis: "Take fast-stochastic snapbacks through an EMA channel only under fixed ADX conditions.",
    scope: "6 assets · 5m/15m",
    origin: "Stochastic + ADX",
  },
  idNr4Breakout: {
    family: "pattern",
    thesis: "Trade the immediate next-bar break after a strict inside-day / narrowest-four setup.",
    scope: "6 assets · 5m",
    origin: "ID/NR4",
  },
  pairedBookOfiContinuation: {
    family: "signal",
    thesis: "Follow large paired-book order-flow pressure only after a confirmed one-cent continuation.",
    scope: "6 assets · 5m · minute 2",
    origin: "Paired CLOB OFI",
  },
  smoothPathDisplacement: {
    family: "signal",
    thesis: "Follow a displaced ~1 Hz Chainlink resolution-price path only when it is linear, efficient, fresh, and still executable without chasing.",
    scope: "6 assets · 5m · minute 2",
    origin: "Chainlink resolution ticks",
  },
  smoothPathCausalDisplacement: {
    family: "signal",
    thesis: "Run the unchanged smooth-path gates on only the Chainlink deliveries already available at the paired-book timestamp.",
    scope: "6 assets · 5m · minute 2",
    origin: "Causal Chainlink child",
  },
  pricerMC: {
    family: "pricer",
    thesis: "Price the binary payoff with a bootstrap Monte Carlo path distribution, then buy ask edge.",
    scope: "6 assets · 5m/15m",
    origin: "Bootstrap MC",
  },
  pricerMC5mTrend: {
    family: "pricer",
    thesis: "Run the unchanged bootstrap Monte Carlo price only on 5m markets whose frozen completed-bar regime is trending.",
    scope: "6 assets · 5m trend",
    origin: "Bootstrap MC child",
  },
  pricerMC5mCobraNight: {
    family: "pricer",
    thesis: "Run the unchanged bootstrap Monte Carlo price only during the prospectively frozen UK 23–07 session.",
    scope: "6 assets · 5m · UK night",
    origin: "Cobra v1.9.2 external prior",
  },
  pricerBSM: {
    family: "pricer",
    thesis: "Use the digital-option N(d2) probability against the executable ask.",
    scope: "6 assets · 5m/15m",
    origin: "Black–Scholes",
  },
  pricerBSMWindowProfile: {
    family: "pricer",
    thesis: "Replace clock time with a frozen BTC 5m intrawindow variance profile.",
    scope: "BTC · 5m",
    origin: "BSM child",
  },
  pricerBSMPeakRetention: {
    family: "pricer",
    thesis: "Gate the parent BSM price with Chainlink path peak-retention quality.",
    scope: "Eligible 5m markets",
    origin: "BSM child",
  },
  pricerBSMOffHours15: {
    family: "pricer",
    thesis: "Run the unchanged BSM fair value only in preregistered 15m UK off-hours.",
    scope: "6 assets · 15m off-hours",
    origin: "Session child",
  },
  pricerEmpirical: {
    family: "pricer",
    thesis: "Estimate fair value from nearest historical Chainlink-only state neighbors.",
    scope: "6 assets · 5m/15m",
    origin: "Empirical kNN",
  },
  alwaysUp: {
    family: "control",
    thesis: "Always buy UP at the same early-window tick as a symmetric directional benchmark.",
    scope: "6 assets · 5m/15m",
    origin: "Directional baseline",
  },
  macroUpOnly: {
    family: "regime",
    thesis: "Buy UP with no model edge filter only when the causal macro-breadth state is UP.",
    scope: "6 assets · 5m/15m · macro UP",
    origin: "Macro-filtered control",
  },
  macroDownOnly: {
    family: "regime",
    thesis: "Buy DOWN with no model edge filter only when the causal macro-breadth state is DOWN.",
    scope: "6 assets · 5m/15m · macro DOWN",
    origin: "Macro-filtered control",
  },
  macroTrendSleeve: {
    family: "regime",
    thesis: "Follow synchronized BTC/ETH/SOL CMO breadth only when the macro state is clearly UP or DOWN.",
    scope: "6 assets · 5m/15m",
    origin: "Macro breadth",
  },
  macroRangeFade: {
    family: "regime",
    thesis: "In a broad RANGE state, fade only a preregistered local CMO extreme.",
    scope: "6 assets · 5m/15m",
    origin: "Macro breadth",
  },
  macroRegimeRouter: {
    family: "regime",
    thesis: "Route coherent macro trends to continuation and broad ranges to local mean reversion.",
    scope: "6 assets · 5m/15m",
    origin: "Macro breadth",
  },
  drift: {
    family: "control",
    thesis: "Always buy DOWN at the same tick; isolates market drift from strategy alpha.",
    scope: "All eligible markets",
    origin: "Same-tick control",
  },
};

export const strategyMeta = (key: string): StrategyMeta =>
  STRATEGY_META[key] ?? {
    family: "signal",
    thesis: "Registered forward paper strategy.",
    scope: "Registered scope",
    origin: "Jester",
  };
