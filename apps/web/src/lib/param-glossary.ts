/**
 * Parameter glossary — what each strategy parameter does and how it impacts behavior. Jester
 * exposes the default values but no per-parameter prose, so this is authored from standard
 * technical-analysis knowledge. `describeParam` resolves a parameter name to an explanation:
 * an exact match first, then a keyword heuristic for the long tail (e.g. anything ending in
 * "Period" / "Multiplier" / "Threshold"). Returns null only when nothing sensible applies.
 */

export type ParamCategory = "indicator" | "risk" | "filter" | "execution" | "meta";

export interface ParamDoc {
  summary: string;
  category: ParamCategory;
  /** Rough direction of effect when the value increases. */
  impact?: string;
}

const EXACT: Record<string, ParamDoc> = {
  // --- moving averages / trend ---
  emaFast: { summary: "Period of the fast EMA — the responsive line that tracks recent price.", category: "indicator", impact: "Higher = smoother, slower signals (fewer, later entries)." },
  emaSlow: { summary: "Period of the slow EMA — the trend baseline the fast line is compared against.", category: "indicator", impact: "Higher = stricter trend definition, fewer trades." },
  emaPeriod: { summary: "EMA lookback used for trend bias.", category: "indicator", impact: "Higher = smoother, laggier trend." },
  smaPeriod: { summary: "Simple moving-average lookback used for trend/mean reference.", category: "indicator", impact: "Higher = smoother, laggier." },
  kijunPeriod: { summary: "Ichimoku Kijun (base line) lookback — a mid-term equilibrium level used for reclaim entries.", category: "indicator", impact: "Higher = slower, more significant level." },
  useKijun: { summary: "Whether the Kijun (Ichimoku base line) is used as an entry trigger.", category: "filter" },
  tenkanPeriod: { summary: "Ichimoku Tenkan (conversion line) lookback — short-term momentum reference.", category: "indicator" },
  // --- oscillators ---
  rsiPeriod: { summary: "RSI lookback — the window for the relative-strength oscillator.", category: "indicator", impact: "Higher = smoother RSI, fewer overbought/oversold flips." },
  stochPeriod: { summary: "Stochastic oscillator lookback.", category: "indicator" },
  cciPeriod: { summary: "CCI (Commodity Channel Index) lookback.", category: "indicator" },
  williamsPeriod: { summary: "Williams %R lookback.", category: "indicator" },
  mfiPeriod: { summary: "Money Flow Index lookback — volume-weighted momentum.", category: "indicator" },
  trixPeriod: { summary: "TRIX (triple-smoothed EMA rate-of-change) lookback.", category: "indicator" },
  // --- MACD ---
  macdFast: { summary: "MACD fast EMA length.", category: "indicator" },
  macdSlow: { summary: "MACD slow EMA length.", category: "indicator" },
  macdSignal: { summary: "MACD signal-line EMA length — smooths the MACD for crossovers.", category: "indicator" },
  // --- volatility / bands ---
  atrPeriod: { summary: "ATR lookback — measures recent volatility; drives stop/target distances.", category: "indicator", impact: "Higher = smoother volatility estimate." },
  useATR: { summary: "Whether stops/targets scale with ATR (volatility) rather than fixed percentages.", category: "risk" },
  bbPeriod: { summary: "Bollinger Band moving-average length.", category: "indicator" },
  bbStdDev: { summary: "Bollinger Band width in standard deviations.", category: "indicator", impact: "Higher = wider bands, fewer touches." },
  keltnerPeriod: { summary: "Keltner Channel EMA length.", category: "indicator" },
  keltnerMultiplier: { summary: "Keltner Channel width as a multiple of ATR.", category: "indicator", impact: "Higher = wider channel." },
  supertrendPeriod: { summary: "SuperTrend ATR lookback.", category: "indicator" },
  supertrendMultiplier: { summary: "SuperTrend band width (× ATR) — the trailing flip distance.", category: "indicator", impact: "Higher = looser trend, fewer flips." },
  // --- ADX / DMI ---
  adxPeriod: { summary: "ADX/DMI lookback — measures trend strength.", category: "indicator" },
  adxThreshold: { summary: "Minimum ADX for a trend to count as tradable.", category: "filter", impact: "Higher = only strong trends trade." },
  diPeriod: { summary: "Directional Indicator (DMI) lookback.", category: "indicator" },
  // --- structure ---
  swingLookback: { summary: "Bars scanned to identify swing highs/lows for structure and divergence.", category: "indicator", impact: "Higher = larger, rarer swings." },
  pivotLookback: { summary: "Bars used to detect pivot points.", category: "indicator" },
  lookbackPeriod: { summary: "General lookback window for the strategy's core signal.", category: "indicator" },
  divergenceTimeoutBars: { summary: "How many bars a detected divergence stays valid before it's discarded.", category: "filter" },
  // --- entry gating ---
  minConfidenceThreshold: { summary: "Minimum blended signal confidence (0–100) required to enter.", category: "filter", impact: "Higher = fewer, higher-conviction trades." },
  confidenceThreshold: { summary: "Minimum signal confidence required to act.", category: "filter", impact: "Higher = stricter entries." },
  volumeThreshold: { summary: "Minimum relative volume required to confirm a signal.", category: "filter" },
  allowReversals: { summary: "Whether an opposite signal can flip an open position directly.", category: "execution" },
  // --- risk / exits ---
  stopLossMultiplier: { summary: "Stop distance as a multiple of ATR.", category: "risk", impact: "Higher = wider stop, fewer stop-outs but larger losses." },
  takeProfitMultiplier: { summary: "Target distance as a multiple of ATR.", category: "risk", impact: "Higher = more ambitious target, lower hit rate." },
  stopLoss: { summary: "Stop-loss distance (percent or ATR multiple per strategy).", category: "risk" },
  takeProfit: { summary: "Take-profit distance (percent or ATR multiple per strategy).", category: "risk" },
  trailingStopPercent: { summary: "Trailing-stop distance as a percent of price.", category: "risk", impact: "Higher = looser trail, more room to run." },
  useTrailingStop: { summary: "Whether a trailing stop is active.", category: "risk" },
  riskPerTrade: { summary: "Fraction of equity risked per trade — sizes positions off the stop.", category: "risk", impact: "Higher = bigger positions, more variance." },
  maxDrawdownPercent: { summary: "Drawdown ceiling that halts or de-risks the strategy.", category: "risk" },
  maxDailyTrades: { summary: "Cap on trades per day — throttles overtrading.", category: "execution" },
  maxPositionHoldTime: { summary: "Maximum hours a position is held before a time-based exit.", category: "execution" },
  // --- regime / adaptive ---
  useRegimeFilter: { summary: "Whether trades are gated by a market-regime filter (trend/volatility).", category: "filter" },
  regimeFilter: { summary: "Regime gate config: minimum trend strength and a volatility band to avoid chop.", category: "filter" },
  adaptiveRisk: { summary: "Scales risk up/down with recent performance or volatility.", category: "meta" },
  adaptiveMode: { summary: "Lets the strategy adapt parameters to current conditions.", category: "meta" },
  volatilityAdjustment: { summary: "Scales stops/targets/sizing with current volatility.", category: "meta" },
  compoundProfits: { summary: "Whether gains are reinvested (compounding) vs fixed sizing.", category: "meta" },
  pyramiding: { summary: "Adding to a winning position in units — config for max units and spacing.", category: "execution" },
};

/** Keyword heuristics for parameters not in EXACT — matched as case-insensitive substrings. */
const HEURISTICS: { key: string; doc: ParamDoc }[] = [
  { key: "period", doc: { summary: "Lookback window for this indicator — how many bars it averages over.", category: "indicator", impact: "Higher = smoother and slower to react." } },
  { key: "length", doc: { summary: "Lookback length for this indicator.", category: "indicator", impact: "Higher = smoother, laggier." } },
  { key: "multiplier", doc: { summary: "Scaling factor (often × ATR) for a band or stop/target distance.", category: "risk", impact: "Higher = wider distance." } },
  { key: "threshold", doc: { summary: "Minimum level a signal must clear to act.", category: "filter", impact: "Higher = stricter, fewer trades." } },
  { key: "lookback", doc: { summary: "Bars scanned to detect the pattern/structure.", category: "indicator", impact: "Higher = larger, rarer structures." } },
  { key: "percent", doc: { summary: "A percentage-of-price setting (distance or band).", category: "risk" } },
  { key: "stop", doc: { summary: "Stop-loss related setting — controls where losing trades are cut.", category: "risk" } },
  { key: "target", doc: { summary: "Profit-target related setting.", category: "risk" } },
  { key: "profit", doc: { summary: "Profit-target / take-profit related setting.", category: "risk" } },
  { key: "volume", doc: { summary: "Volume-based confirmation or filter.", category: "filter" } },
  { key: "atr", doc: { summary: "ATR (volatility) based setting.", category: "indicator" } },
  { key: "rsi", doc: { summary: "RSI (relative-strength) based setting.", category: "indicator" } },
  { key: "ema", doc: { summary: "EMA (exponential moving average) based setting.", category: "indicator" } },
  { key: "adx", doc: { summary: "ADX/DMI (trend-strength) based setting.", category: "indicator" } },
  { key: "max", doc: { summary: "An upper bound / cap on this behavior.", category: "execution" } },
  { key: "min", doc: { summary: "A lower bound / minimum required for this behavior.", category: "filter" } },
  { key: "use", doc: { summary: "Toggle for an optional filter or mechanism.", category: "filter" } },
  { key: "enable", doc: { summary: "Toggle for an optional filter or mechanism.", category: "filter" } },
];

export function describeParam(name: string): ParamDoc | null {
  if (EXACT[name]) return EXACT[name];
  const lower = name.toLowerCase();
  for (const h of HEURISTICS) if (lower.includes(h.key)) return h.doc;
  return null;
}

export const CATEGORY_LABEL: Record<ParamCategory, string> = {
  indicator: "Indicator",
  risk: "Risk / Exit",
  filter: "Filter / Gate",
  execution: "Execution",
  meta: "Adaptive",
};
