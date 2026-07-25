/**
 * Paper Floor — the live paper-trading harness (Cobra pattern). Every tick:
 *   decide(): for each live Up/Down market just entering its window, each registered bot computes its
 *             P(up) from the signal LOG (no extra Jester calls), and if the registered mid-edge rule
 *             fires, a paper trade is recorded at the REAL $5 CLOB book-walk fill right now.
 *   grade():  open trades whose market has resolved get won/lost + P&L (binary payout at the ask paid).
 *
 * The bots here are the SAME registered rules the Strategy Lab / verdict gate evaluate — this harness
 * is their forward-execution twin, eliminating alignment tolerance and modeled asks.
 *
 * PAPER ONLY — this service and its router have no order, fund, key, or Jester trade-channel path.
 * Arming is a locked UI placeholder gated on a verdict-gate PASS and a separate human decision/build.
 */
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, lt, ne, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  db,
  macroBreadthSnapshots,
  paperTrades,
  polymarketSmoothPathFunnel,
  polymarketStateSnapshots,
  polymarketUpdownScores,
  signalSnapshots,
  tesseractSnapshots,
} from "@framework/db";
import { getSetting } from "./config.ts";
import { createAsyncTtlCache } from "./async-ttl-cache.ts";
import { GAUGE_SOURCE } from "./signal-gauge-logger.ts";
import {
  fetchCurrentCryptoUpDown,
  fetchClobBook,
  fetchClobBooks,
  fetchClobMarket,
  fetchClobMarketInfo,
  bookSummary,
  updownHorizonMinutes,
  upTokenId,
  downTokenId,
  marketOutcomePrices,
  type GammaMarket,
} from "./polymarket.ts";
import {
  fillAskTotalUsd,
  takerFeeDescriptor,
  type FeeAdjustedAskFill,
  type TakerFeeDescriptor,
} from "./polymarket-fees.ts";
import {
  chainlinkNow,
  chainlinkAt,
  chainlinkPath,
  chainlinkPeakGapRetention,
  RTDS_FRESH_SEC,
} from "./rtds.ts";
import { gaugeToPup } from "./polymarket-updown.ts";
import { latestV1Signal, V1_SOURCE } from "./signal-v1-logger.ts";
import { readV1SignalSourceHealth } from "./signal-v1-source-health.ts";
import {
  buildJesterV1PaperBotActivity,
  buildSmoothPathPaperBotActivity,
  type PaperBotActivity,
} from "./paper-bot-activity.ts";
import { getRecentCandles } from "./hyperliquid.ts";
import { coinOf } from "./param-tracking.ts";
import { PRICER, digitalPupBSM, digitalPupMC, ewmaVol, logReturns, strikeAt } from "./pricer.ts";
import {
  PRICER_MC_5M_TREND,
  pricerMc5mTrendEligible,
  pricerMc5mTrendQualified,
} from "./pricer-mc-trend.ts";
import {
  aggregate5m,
  bollingerMfiSignal,
  BOLLINGER_MFI,
  idNr4BreakoutEligibleHorizon,
  idNr4BreakoutSignal,
  ID_NR4_BREAKOUT,
  rocPivotPup,
  stochAdxEligibleHorizon,
  stochAdxSnapbackSignal,
  STOCH_ADX_SNAPBACK,
  sweepReclaimPup,
  td9ExhaustionSignal,
  TD9_EXHAUSTION,
} from "./candle-signals.ts";
import {
  computePaperGate,
  PAPER_ENGINE_V2_START_MS,
  PAPER_ENGINE_V3_START_MS,
  PAPER_GATE,
} from "./paper-floor-gate.ts";
import {
  PAPER_DAILY_LEDGER,
  paperDailyLedgerDayKey,
} from "./paper-daily-ledger.ts";
import {
  computePaperTimeframeGate,
  paperTimeframeGateKey,
  type PaperTimeframeGateBot,
} from "./paper-timeframe-gate.ts";
import { loadEmpiricalTraining } from "./empirical-pricer.ts";
import { empiricalKnnPup, EMPIRICAL_PRICER } from "./empirical-pricer-model.ts";
import { normalizedDistance, surfaceSampleMinute } from "./polymarket-state-features.ts";
import { classifyMarketRegime, MARKET_REGIME_V1_START_MS, type MarketRegimeLabel } from "./market-regime.ts";
import {
  COBRA_5M_NIGHT_PRICER,
  COBRA_SESSION_PRICER,
  cobra5mNightPricerEligible,
  cobraSessionPricerEligible,
  ukTradingSessionAt,
} from "./cobra-session-pricer.ts";
import {
  BSM_PEAK_RETENTION,
  peakRetentionEligible,
  peakRetentionEligibleHorizon,
} from "./peak-gap-retention.ts";
import {
  BSM_WINDOW_PROFILE,
  bsmProfileRemainingVarianceMin,
  bsmWindowProfileEligible,
} from "./bsm-window-profile.ts";
import {
  PAIRED_BOOK_OFI_CONTINUATION,
  pairedBookOfiEligible,
  pairedBookOfiObservation,
  pairedBookOfiPaperDecision,
  type PairedBookTouch,
} from "./paired-book-ofi-continuation.ts";
import {
  SMOOTH_PATH_CAUSAL_DISPLACEMENT,
  SMOOTH_PATH_DISPLACEMENT,
  smoothPathCausalEligible,
  smoothPathCausalObservation,
  smoothPathEligible,
  smoothPathObservation,
  smoothPathPaperDecision,
} from "./smooth-path-displacement.ts";
import {
  MACRO_BREADTH_ROUTER,
  macroBreadthCompletedBarFresh,
  macroBreadthObservation,
  macroPaperDecision,
  macroSleevePup,
  macroTargetEligible,
  type MacroBreadthObservation,
  type MacroSleeve,
} from "./macro-breadth-router.ts";
import {
  MACRO_DIRECTION_CONTROLS,
  macroDirectionControlSide,
  type MacroDirectionControl,
} from "./macro-direction-controls.ts";
import {
  MACRO_DIRECTION_COVERAGE,
  macroDirectionCoverageMetadata,
} from "./macro-direction-coverage.ts";
import {
  computeMacroDirectionVerdictGate,
  macroDirectionOppositeAsk,
} from "./macro-direction-verdict-gate.ts";
import {
  applyPaperFamilywiseGate,
  PAPER_FAMILYWISE_GATE,
  PAPER_FAMILYWISE_HYPOTHESES,
} from "./paper-familywise-gate.ts";
import { PAPER_ACCOUNTING } from "./paper-accounting.ts";
import {
  PAPER_FLOOR_RUNTIME_HEARTBEAT,
  readPaperFloorRuntimeHeartbeat,
} from "./paper-floor-runtime-heartbeat.ts";
import {
  POLYMARKET_SHADOW_CONNECTOR,
  prepareLiveShadowMarketBuy,
  type ShadowPreparation,
} from "./polymarket-shadow-connector.ts";

const ENABLED_KEY = "paper_floor_enabled"; // "true" to run; default armed (paper is internal-only)
const SIZE_USD = 5; // fixed nominal stake per trade (Cobra's sizing)
const EDGE = 0.05; // the registered mid-edge threshold (matches the Lab bots)
const ENTRY_LATE_S = 150; // enter only within the first 150s of the window (5m markets: first half)
// Signal freshness at decision time, per source — bounded by each logger's cadence.
const TESS_MAX_AGE_S = 660; // broad Tesseract logger ticks every 10m
const GAUGE_MAX_AGE_S = 330; // gauge logger ticks every 5m
const V1_MAX_AGE_S = 900; // V1 entries are sparse EVENTS — fade the windows starting within 15min of one
const FLOOR_BUCKET_PAIRS = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD", "BNB-USD"] as const;
const FLOOR_BUCKET_HORIZONS = [5, 15] as const;

export async function paperFloorEnabled(): Promise<boolean> {
  const v = await getSetting(ENABLED_KEY);
  return v == null ? true : v === "true";
}

function pairOf(question: string): string | null {
  const q = question.toLowerCase();
  if (/bitcoin|\bbtc\b/.test(q)) return "BTC-USD";
  if (/ethereum|\beth\b/.test(q)) return "ETH-USD";
  if (/solana|\bsol\b/.test(q)) return "SOL-USD";
  if (/\bxrp\b/.test(q)) return "XRP-USD";
  if (/dogecoin|\bdoge\b/.test(q)) return "DOGE-USD";
  if (/\bbnb\b/.test(q)) return "BNB-USD";
  return null;
}

export interface PaperBot {
  key: string;
  name: string;
  color: string;
  /** P(up) source: which log feeds this bot (null = control, needs no signal). */
  source: "tesseract" | "gauge" | "jesterV1" | "sweep" | "rocPivot" | "bollingerMfi" | "td9Exhaustion" | "stochAdx" | "idNr4Breakout" | "macroTrend" | "macroRange" | "macroRouter" | "macroUpControl" | "macroDownControl" | "pairedBookOfi" | "smoothPath" | "smoothPathCausal" | "pricer" | null;
  /** This bot can only count rows at/after its own preregistration time (and the global gate start). */
  evalStartMs: number;
  /** Convert the logged source P(up) into this bot's own fair P(up) for edge metadata. */
  fairPup?: (sourcePup: number | null) => number | null;
  /** Optional preregistered market/decision-time eligibility rule. */
  eligible?: (context: { pair?: string; horizonMin: number; decidedAtMs: number }) => boolean;
  /** Decide a side. `regime` is prior-market up-rate; `technicalRegime` is market-regime-v1. */
  decide: (pup: number | null, mid: number, regime: number | null, technicalRegime: MarketRegimeLabel | null) => "up" | "down" | null;
}

const fadeDecide = (pup: number | null, mid: number): "up" | "down" | null => {
  if (pup == null) return null;
  const e = 1 - pup - mid;
  return e > EDGE ? "up" : e < -EDGE ? "down" : null;
};
const followPup = (pup: number | null) => pup;
const fadePup = (pup: number | null) => pup == null ? null : 1 - pup;

/** The floor roster — mirrors the Lab's registered bots (KB updown-verdict-gate-v1). */
export const PAPER_BOTS: PaperBot[] = [
  { key: "fade", name: "Fade Tesseract", color: "#22c55e", source: "tesseract", evalStartMs: PAPER_ENGINE_V2_START_MS, fairPup: fadePup, decide: (p, m) => fadeDecide(p, m) },
  { key: "fadeStrong", name: "Fade — strong gauge", color: "#3b82f6", source: "tesseract", evalStartMs: PAPER_ENGINE_V2_START_MS, fairPup: fadePup, decide: (p, m) => (p == null || Math.abs(p - 0.5) < 0.15 ? null : fadeDecide(p, m)) },
  { key: "fadeRegime", name: "Fade — chop regime", color: "#14b8a6", source: "tesseract", evalStartMs: PAPER_ENGINE_V2_START_MS, fairPup: fadePup, decide: (p, m, r) => (r == null || Math.abs(r - 0.5) > 0.15 ? null : fadeDecide(p, m)) },
  // Regime-v1 child hypotheses (KB updown-market-regime-v1). They preserve their parent signal and
  // edge rule, changing only the preregistered contextual eligibility filter.
  { key: "fadeTessCmoChop", name: "Fade Tesseract — CMO chop", color: "#10b981", source: "tesseract", evalStartMs: MARKET_REGIME_V1_START_MS, fairPup: fadePup, decide: (p, m, _r, technical) => technical === "chop" ? fadeDecide(p, m) : null },
  { key: "follow", name: "Follow Tesseract", color: "#ef4444", source: "tesseract", evalStartMs: PAPER_ENGINE_V2_START_MS, fairPup: followPup, decide: (p, m) => { if (p == null) return null; const e = p - m; return e > EDGE ? "up" : e < -EDGE ? "down" : null; } },
  { key: "gaugeFade", name: "Fade Trade-gauge", color: "#a855f7", source: "gauge", evalStartMs: PAPER_ENGINE_V2_START_MS, fairPup: fadePup, decide: (p, m) => fadeDecide(p, m) },
  { key: "gaugeFollow", name: "Follow Trade-gauge", color: "#f59e0b", source: "gauge", evalStartMs: PAPER_ENGINE_V2_START_MS, fairPup: followPup, decide: (p, m) => { if (p == null) return null; const e = p - m; return e > EDGE ? "up" : e < -EDGE ? "down" : null; } },
  // Bot #5 — the SUBSCRIBED jester_v1_remastered's live entries (BNB-USD/5m for now), bridged
  // buy→0.75/sell→0.25. The earlier 3.2σ claim was retracted after a source-semantics audit; both
  // orientations remain forward paper hypotheses and receive no historical evidentiary weight.
  { key: "fadeV1", name: "Fade Jester V1", color: "#ec4899", source: "jesterV1", evalStartMs: PAPER_ENGINE_V2_START_MS, fairPup: fadePup, decide: (p, m) => fadeDecide(p, m) },
  { key: "followV1", name: "Follow Jester V1", color: "#84cc16", source: "jesterV1", evalStartMs: PAPER_ENGINE_V2_START_MS, fairPup: followPup, decide: (p, m) => { if (p == null) return null; const e = p - m; return e > EDGE ? "up" : e < -EDGE ? "down" : null; } },
  // Bots #7/#8 — candle-computed book-mined signals (services/candle-signals.ts): #7 fades a failed
  // sweep of the prior 20-bar extreme (Williams/Connors convergence — mean-reversion at liquidity);
  // #8 is Connors' 2-period ROC pivot, a native bar-close directional state.
  { key: "sweepReclaim", name: "Sweep reclaim", color: "#eab308", source: "sweep", evalStartMs: PAPER_ENGINE_V2_START_MS, fairPup: followPup, decide: (p, m) => { if (p == null) return null; const e = p - m; return e > EDGE ? "up" : e < -EDGE ? "down" : null; } },
  { key: "rocPivot", name: "2-ROC pivot", color: "#f43f5e", source: "rocPivot", evalStartMs: PAPER_ENGINE_V2_START_MS, fairPup: followPup, decide: (p, m) => { if (p == null) return null; const e = p - m; return e > EDGE ? "up" : e < -EDGE ? "down" : null; } },
  { key: "rocPivotCmoTrend", name: "2-ROC pivot — CMO trend", color: "#fb7185", source: "rocPivot", evalStartMs: MARKET_REGIME_V1_START_MS, fairPup: followPup, decide: (p, m, _r, technical) => { if (p == null || technical !== "trend") return null; const e = p - m; return e > EDGE ? "up" : e < -EDGE ? "down" : null; } },
  // Literature-mined volume-confirmed trend signal (Bollinger Method II), preregistered in
  // KB updown-bollinger-mfi-v1. Completed 5m bars only; fixed 20/2 bands and MFI(10) thresholds.
  { key: "bollingerMfi", name: "Bollinger %b + MFI", color: "#f97316", source: "bollingerMfi", evalStartMs: BOLLINGER_MFI.evalStartMs, fairPup: followPup, decide: (p, m) => { if (p == null) return null; const e = p - m; return e > EDGE ? "up" : e < -EDGE ? "down" : null; } },
  // GitHub-mined perfected TD-9 exhaustion (KB updown-td9-perfected-exhaustion-v1): exact ninth
  // completed 5m setup bar, source-compatible OR perfection, fixed event bridge, no tuned inputs.
  { key: "td9Exhaustion", name: "TD-9 perfected exhaustion", color: "#d946ef", source: "td9Exhaustion", evalStartMs: TD9_EXHAUSTION.evalStartMs, fairPup: followPup, decide: (p, m) => { if (p == null) return null; const e = p - m; return e > EDGE ? "up" : e < -EDGE ? "down" : null; } },
  // GitHub-scavenged and independently implemented fast-stochastic/EMA-channel snapback, gated by
  // Wilder ADX(14). Fixed 5m/15m scope and exact mirrored DOWN rule.
  { key: "stochAdxSnapback", name: "Stoch-ADX snapback", color: "#818cf8", source: "stochAdx", evalStartMs: STOCH_ADX_SNAPBACK.evalStartMs, eligible: ({ horizonMin }) => stochAdxEligibleHorizon(horizonMin), fairPup: followPup, decide: (p, m) => { if (p == null) return null; const e = p - m; return e > EDGE ? "up" : e < -EDGE ? "down" : null; } },
  // Book/GitHub-convergent volatility-expansion hypothesis (KB updown-id-nr4-breakout-v1):
  // strict inside+narrowest-four setup, direction only from an immediate-next-5m-bar breakout.
  { key: "idNr4Breakout", name: "ID/NR4 next-bar breakout", color: "#38bdf8", source: "idNr4Breakout", evalStartMs: ID_NR4_BREAKOUT.evalStartMs, eligible: ({ horizonMin }) => idNr4BreakoutEligibleHorizon(horizonMin), fairPup: followPup, decide: (p, m) => { if (p == null) return null; const e = p - m; return e > EDGE ? "up" : e < -EDGE ? "down" : null; } },
  // Outcome-free paired-book continuation child (KB updown-paired-book-ofi-continuation-v1).
  // A dedicated minute-2 pass below computes canonical OFI from the immutable minute-1 touch and
  // one current batch-book response, then applies its own fee-adjusted real-ask rule.
  { key: "pairedBookOfiContinuation", name: "Paired-book OFI continuation", color: "#2dd4bf", source: "pairedBookOfi", evalStartMs: PAIRED_BOOK_OFI_CONTINUATION.evalStartMs, eligible: ({ pair = "", horizonMin }) => pairedBookOfiEligible(pair, horizonMin, PAIRED_BOOK_OFI_CONTINUATION.decisionSampleMinute), decide: () => null },
  // Outcome-free resolution-path candidate (KB updown-smooth-path-displacement-v1). A dedicated
  // minute-2 pass below combines the Chainlink-only path with immutable minute-1 fee-adjusted fills.
  { key: "smoothPathDisplacement", name: "Smooth path / strike displacement", color: "#60a5fa", source: "smoothPath", evalStartMs: SMOOTH_PATH_DISPLACEMENT.evalStartMs, eligible: ({ pair = "", horizonMin }) => smoothPathEligible(pair, horizonMin, SMOOTH_PATH_DISPLACEMENT.decisionSampleMinute), decide: () => null },
  // Prospective causal-delivery child (KB updown-smooth-path-causal-displacement-v2): identical v1
  // gates, but reconstructs the path only from RTDS deliveries available by the paired-book time.
  { key: "smoothPathCausalDisplacement", name: "Smooth path — causal ticks", color: "#93c5fd", source: "smoothPathCausal", evalStartMs: SMOOTH_PATH_CAUSAL_DISPLACEMENT.evalStartMs, eligible: ({ pair = "", horizonMin }) => smoothPathCausalEligible(pair, horizonMin, SMOOTH_PATH_CAUSAL_DISPLACEMENT.decisionSampleMinute), decide: () => null },
  // Fair-value digital pricer family (services/pricer.ts; KB updown-digital-fair-value-pricer).
  // NOT signal bots: they price the contract (P(up) from vol + distance-to-strike) and bet vs the ASK,
  // any time in-window. Handled by the dedicated pricer pass — decide() here is never invoked.
  { key: "pricerMC", name: "Pricer — bootstrap MC", color: "#0ea5e9", source: "pricer", evalStartMs: PAPER_ENGINE_V2_START_MS, decide: () => null },
  // Outcome-inspired, prospectively isolated child (KB updown-pricer-mc-5m-trend-v1).
  // It shares the exact parent MC draw, fill, and edge calculation and changes only completed-bar
  // regime eligibility. All diagnostics visible before its later boundary are excluded.
  { key: "pricerMC5mTrend", name: "Pricer — bootstrap MC 5m trend", color: "#0284c7", source: "pricer", evalStartMs: PRICER_MC_5M_TREND.evalStartMs, eligible: ({ horizonMin }) => pricerMc5mTrendEligible(horizonMin), decide: () => null },
  // External screenshot-derived prospective child (KB updown-pricer-mc-5m-cobra-night-v1).
  // It shares the parent's exact Monte Carlo draw and ask-edge rule; only the clock-known UK
  // night23-07 5m eligibility changes. Hidden Cobra bull factors and starred results are not copied.
  { key: "pricerMC5mCobraNight", name: "Pricer — bootstrap MC 5m Cobra night", color: "#0369a1", source: "pricer", evalStartMs: COBRA_5M_NIGHT_PRICER.evalStartMs, eligible: ({ horizonMin, decidedAtMs }) => cobra5mNightPricerEligible(horizonMin, decidedAtMs), decide: () => null },
  { key: "pricerBSM", name: "Pricer — BSM N(d2)", color: "#6366f1", source: "pricer", evalStartMs: PAPER_ENGINE_V2_START_MS, decide: () => null },
  // Fixed-commit GitHub hypothesis (KB updown-bsm-window-profile-v1): the parent BSM with only
  // its remaining variance clock changed to a training-only BTC intrawindow curve. BTC 5m only.
  { key: "pricerBSMWindowProfile", name: "Pricer — BSM 5m window profile", color: "#a78bfa", source: "pricer", evalStartMs: BSM_WINDOW_PROFILE.evalStartMs, eligible: bsmWindowProfileEligible, decide: () => null },
  // GitHub-scavenged path-quality child (KB updown-bsm-peak-retention-v1). Retention is computed
  // only from the Chainlink resolution-source path; fair value and ask-edge stay the BSM parent's.
  { key: "pricerBSMPeakRetention", name: "Pricer — BSM peak retention", color: "#f0abfc", source: "pricer", evalStartMs: BSM_PEAK_RETENTION.evalStartMs, eligible: ({ horizonMin }) => peakRetentionEligibleHorizon(horizonMin), decide: () => null },
  // External screenshot-derived child hypothesis (KB cobra-session-horizon-pricer-v1): same
  // deterministic BSM price and 8-cent executable-ask rule, but 15m UK night/evening only.
  { key: "pricerBSMOffHours15", name: "Pricer — BSM 15m off-hours", color: "#c084fc", source: "pricer", evalStartMs: COBRA_SESSION_PRICER.evalStartMs, eligible: ({ horizonMin, decidedAtMs }) => cobraSessionPricerEligible(horizonMin, decidedAtMs), decide: () => null },
  // Bot #9 — nonparametric fair value from the preregistered forward state tape. It remains dormant
  // until 100 distinct resolved markets qualify; Chainlink-only current/training states, no fallback.
  { key: "pricerEmpirical", name: "Pricer — empirical kNN", color: "#06b6d4", source: "pricer", evalStartMs: Math.max(EMPIRICAL_PRICER.evalStartMs, PAPER_ENGINE_V2_START_MS), decide: () => null },
  // Cross-asset macro context (KB updown-macro-breadth-router-v1). The three sleeves are scored
  // independently so trend, range-fade, and routing value remain identifiable. A dedicated branch
  // below applies their fixed 65% side bridge directly to the fee-adjusted real ask.
  { key: "alwaysUp", name: "Always up (benchmark)", color: "#cbd5e1", source: null, evalStartMs: MACRO_BREADTH_ROUTER.evalStartMs, eligible: ({ pair = "", horizonMin }) => macroTargetEligible(pair, horizonMin), decide: () => "up" },
  // Outcome-inspired pure direction filters (KB updown-macro-direction-controls-v1). These preserve
  // both unconditional controls and ask no probability/edge question: the matching live macro state
  // admits the side, while RANGE, NEUTRAL, missing, stale, or desynchronized context abstains.
  { key: "macroUpOnly", name: "Always up — macro UP only", color: "#38bdf8", source: "macroUpControl", evalStartMs: MACRO_DIRECTION_CONTROLS.evalStartMs, eligible: ({ pair = "", horizonMin }) => macroTargetEligible(pair, horizonMin), decide: () => null },
  { key: "macroDownOnly", name: "Always down — macro DOWN only", color: "#a78bfa", source: "macroDownControl", evalStartMs: MACRO_DIRECTION_CONTROLS.evalStartMs, eligible: ({ pair = "", horizonMin }) => macroTargetEligible(pair, horizonMin), decide: () => null },
  { key: "macroTrendSleeve", name: "Macro leader — trend", color: "#22d3ee", source: "macroTrend", evalStartMs: MACRO_BREADTH_ROUTER.evalStartMs, eligible: ({ pair = "", horizonMin }) => macroTargetEligible(pair, horizonMin), fairPup: followPup, decide: () => null },
  { key: "macroRangeFade", name: "Macro leader — range fade", color: "#fbbf24", source: "macroRange", evalStartMs: MACRO_BREADTH_ROUTER.evalStartMs, eligible: ({ pair = "", horizonMin }) => macroTargetEligible(pair, horizonMin), fairPup: followPup, decide: () => null },
  { key: "macroRegimeRouter", name: "Macro leader — regime router", color: "#2dd4bf", source: "macroRouter", evalStartMs: MACRO_BREADTH_ROUTER.evalStartMs, eligible: ({ pair = "", horizonMin }) => macroTargetEligible(pair, horizonMin), fairPup: followPup, decide: () => null },
  { key: "drift", name: "Always down (control)", color: "#9ca3af", source: null, evalStartMs: PAPER_GATE.evalStartMs, decide: () => "down" },
];

/** Latest logged P(up) for a pair per source, with freshness bound. */
async function latestSignals(pair: string, nowMs: number): Promise<{ tess: { pup: number; ageSec: number } | null; gauge: { pup: number; ageSec: number } | null; v1: { pup: number; ageSec: number } | null }> {
  const [tessRow] = await db
    .select({ gauge: tesseractSnapshots.gaugeScore, at: tesseractSnapshots.capturedAt })
    .from(tesseractSnapshots)
    .where(and(eq(tesseractSnapshots.pair, pair), gte(tesseractSnapshots.capturedAt, new Date(nowMs - TESS_MAX_AGE_S * 1000)), sql`${tesseractSnapshots.gaugeScore} is not null`))
    .orderBy(desc(tesseractSnapshots.capturedAt))
    .limit(1);
  const [gaugeRow] = await db
    .select({ pup: signalSnapshots.pup, at: signalSnapshots.capturedAt })
    .from(signalSnapshots)
    .where(and(eq(signalSnapshots.source, GAUGE_SOURCE), eq(signalSnapshots.pair, pair), gte(signalSnapshots.capturedAt, new Date(nowMs - GAUGE_MAX_AGE_S * 1000))))
    .orderBy(desc(signalSnapshots.capturedAt))
    .limit(1);
  return {
    tess: tessRow?.gauge != null ? { pup: gaugeToPup(tessRow.gauge), ageSec: (nowMs - tessRow.at.getTime()) / 1000 } : null,
    gauge: gaugeRow ? { pup: gaugeRow.pup, ageSec: (nowMs - gaugeRow.at.getTime()) / 1000 } : null,
    v1: await latestV1Signal(pair, nowMs, V1_MAX_AGE_S),
  };
}

/** Prior-24 same-pair resolved up-rate from the scorer's ledger (bot #4's regime input). */
async function regimeOf(pair: string): Promise<number | null> {
  const rows = await db
    .select({ up: polymarketUpdownScores.resolvedUp })
    .from(polymarketUpdownScores)
    .where(eq(polymarketUpdownScores.pair, pair))
    .orderBy(desc(polymarketUpdownScores.windowStart))
    .limit(24);
  if (rows.length < 12) return null;
  return rows.filter((r) => r.up).length / rows.length;
}

export interface PaperDecideOptions {
  /** Run only these registered bots. Used by narrow-cadence lanes without changing other bots. */
  onlyBotKeys?: readonly string[];
  /** Skip these registered bots. Used by the general lane when a bot has its own cadence. */
  excludeBotKeys?: readonly string[];
}

/** Resolve a cadence lane to the frozen roster. Exported so scheduler isolation is unit-testable. */
export function paperBotsForDecision(options: PaperDecideOptions = {}): PaperBot[] {
  const only = options.onlyBotKeys?.length ? new Set(options.onlyBotKeys) : null;
  const excluded = new Set(options.excludeBotKeys ?? []);
  return PAPER_BOTS.filter((bot) => (!only || only.has(bot.key)) && !excluded.has(bot.key));
}

/** Gate v3 restarts every bot no earlier than the fee-corrected global boundary. */
export function paperBotEffectiveStartMs(bot: Pick<PaperBot, "evalStartMs">): number {
  return Math.max(PAPER_GATE.evalStartMs, bot.evalStartMs);
}

/** Every preregistered asset × horizon cell, including cells with no decisions yet. */
export function paperBotBucketUniverse(bot: PaperBot): Array<{ pair: string; horizonMin: number }> {
  return FLOOR_BUCKET_PAIRS.flatMap((pair) =>
    FLOOR_BUCKET_HORIZONS
      .filter((horizonMin) => !bot.eligible || bot.eligible({
        pair,
        horizonMin,
        // Static universe eligibility is evaluated at the strategy's frozen boundary. This keeps
        // session-gated strategies (for example 15m off-hours) visible outside their active session.
        decidedAtMs: bot.evalStartMs,
      }))
      .map((horizonMin) => ({ pair, horizonMin })),
  );
}

/** One decision pass over the markets currently entering their window. */
export async function paperDecideTick(options: PaperDecideOptions = {}): Promise<{ placed: number; considered: number }> {
  const now = Date.now();
  const decisionBots = paperBotsForDecision(options);
  // A future preregistration must be a true no-op: do not even poll Gamma before the frozen boundary.
  if (!decisionBots.length || decisionBots.every((bot) => now < paperBotEffectiveStartMs(bot))) {
    return { placed: 0, considered: 0 };
  }
  const inWindow = (await fetchCurrentCryptoUpDown().catch(() => []))
    .map((m) => ({ m, pair: pairOf(m.question), hz: updownHorizonMinutes(m.question), endMs: m.endDate ? new Date(m.endDate).getTime() : null }))
    .filter((x): x is { m: GammaMarket; pair: string; hz: number; endMs: number } => !!x.pair && !!x.hz && !!x.endMs && x.hz <= 60)
    .filter((x) => now >= x.endMs - x.hz * 60_000 && now <= x.endMs - PRICER.minRemainingSec * 1000);
  // Signal bots enter only EARLY in the window (price ≈ strike, the registered rule); the pricer
  // bots consider the whole window — their edge is mid-window, after moves, when quotes lag.
  const live = inWindow.filter((x) => {
    const startMs = x.endMs - x.hz * 60_000;
    return now <= startMs + Math.min(ENTRY_LATE_S, (x.hz * 60) / 2) * 1000;
  });
  if (!inWindow.length) return { placed: 0, considered: 0 };

  // Skip markets every bot has already traded (unique bot+market).
  const ids = inWindow.map((x) => x.m.conditionId);
  const existing = await db
    .select({ bot: paperTrades.botKey, cid: paperTrades.conditionId })
    .from(paperTrades)
    .where(inArray(paperTrades.conditionId, ids));
  const seen = new Set(existing.map((r) => `${r.bot}|${r.cid}`));

  let placed = 0;
  const signalCache = new Map<string, Awaited<ReturnType<typeof latestSignals>>>();
  // Hyperliquid 1m candles per pair, shared by the candle-signal bots (#7/#8) and the pricer pass.
  const candleCache = new Map<string, { closes: number[]; returns: number[]; sigma: number | null; lastT: number; S: number; candles: any[] } | null>();
  const loadCandles = async (pair: string) => {
    if (!candleCache.has(pair)) {
      const candles = await getRecentCandles(coinOf(pair), 1, PRICER.volMaxBars + 5).catch(() => []);
      if (candles.length < PRICER.volMinBars + 1) candleCache.set(pair, null);
      else {
        const closes = candles.map((c) => c.c);
        const returns = logReturns(closes);
        candleCache.set(pair, { closes, returns, sigma: ewmaVol(returns), lastT: candles[candles.length - 1].t, S: closes[closes.length - 1], candles });
      }
    }
    return candleCache.get(pair)!;
  };
  type CandleSig = {
    sweep: number | null;
    roc: number | null;
    bollingerMfi: ReturnType<typeof bollingerMfiSignal>;
    td9Exhaustion: ReturnType<typeof td9ExhaustionSignal>;
    stochAdx: ReturnType<typeof stochAdxSnapbackSignal>;
    idNr4Breakout: ReturnType<typeof idNr4BreakoutSignal>;
    regime: ReturnType<typeof classifyMarketRegime>;
    ageSec: number;
  } | null;
  const candleSigCache = new Map<string, CandleSig>();
  const candleSigFor = async (pair: string): Promise<CandleSig> => {
    if (!candleSigCache.has(pair)) {
      const cd = await loadCandles(pair);
      if (!cd) candleSigCache.set(pair, null);
      else {
        const bars = aggregate5m(cd.candles);
        candleSigCache.set(pair, {
          sweep: sweepReclaimPup(bars, cd.S),
          roc: rocPivotPup(bars, cd.S),
          bollingerMfi: bollingerMfiSignal(bars),
          td9Exhaustion: td9ExhaustionSignal(bars),
          stochAdx: stochAdxSnapbackSignal(bars),
          idNr4Breakout: idNr4BreakoutSignal(bars, cd.S, cd.lastT, now),
          regime: classifyMarketRegime(bars),
          ageSec: (now - cd.lastT) / 1000,
        });
      }
    }
    return candleSigCache.get(pair)!;
  };
  const macroSleeveFor = (source: PaperBot["source"]): MacroSleeve | null =>
    source === "macroTrend" ? "trend"
    : source === "macroRange" ? "range"
    : source === "macroRouter" ? "router"
    : null;
  const macroDirectionControlFor = (
    source: PaperBot["source"],
  ): MacroDirectionControl | null =>
    source === "macroUpControl" ? "up"
    : source === "macroDownControl" ? "down"
    : null;
  let macroObservationPromise: Promise<MacroBreadthObservation | null> | null = null;
  const macroObservationFor = () => macroObservationPromise ??= Promise.all(
    MACRO_BREADTH_ROUTER.anchors.map(async (anchor) => {
      const candles = await loadCandles(anchor);
      return [anchor, candles ? aggregate5m(candles.candles) : null] as const;
    }),
  ).then((entries) => {
    const anchors: Partial<Record<(typeof MACRO_BREADTH_ROUTER.anchors)[number], ReturnType<typeof aggregate5m>>> = {};
    for (const [anchor, bars] of entries) {
      if (!bars) return null;
      anchors[anchor] = bars;
    }
    return macroBreadthObservation(anchors, now);
  });
  const pupFor = (src: PaperBot["source"], sig: Awaited<ReturnType<typeof latestSignals>>, cs: CandleSig): number | null =>
    src === "tesseract" ? (sig.tess?.pup ?? null)
    : src === "gauge" ? (sig.gauge?.pup ?? null)
    : src === "jesterV1" ? (sig.v1?.pup ?? null)
    : src === "sweep" ? (cs?.sweep ?? null)
    : src === "rocPivot" ? (cs?.roc ?? null)
    : src === "bollingerMfi" ? (cs?.bollingerMfi?.pup ?? null)
    : src === "td9Exhaustion" ? (cs?.td9Exhaustion?.pup ?? null)
    : src === "stochAdx" ? (cs?.stochAdx?.pup ?? null)
    : src === "idNr4Breakout" ? (cs?.idNr4Breakout?.pup ?? null)
    : null;
  const ageFor = (src: PaperBot["source"], sig: Awaited<ReturnType<typeof latestSignals>>, cs: CandleSig): number | null =>
    src === "tesseract" ? (sig.tess?.ageSec ?? null)
    : src === "gauge" ? (sig.gauge?.ageSec ?? null)
    : src === "jesterV1" ? (sig.v1?.ageSec ?? null)
    : src === "sweep" || src === "rocPivot" || src === "bollingerMfi" || src === "td9Exhaustion" || src === "stochAdx" || src === "idNr4Breakout" ? (cs?.ageSec ?? null)
    : null;
  const regimeCache = new Map<string, number | null>();
  let macroEligibleWindows = 0;
  let macroObservedWindows = 0;
  let macroQualified = 0;
  let macroPlaced = 0;
  let macroTickObservation: MacroBreadthObservation | null = null;
  const macroStateCounts: Record<MacroBreadthObservation["state"], number> = {
    up: 0,
    down: 0,
    range: 0,
    neutral: 0,
  };
  // V3 real-fill cache: $5 is TOTAL taker outlay (gross book cost + captured CLOB-v2 fee).
  // Both candidate and same-tick DOWN control share the exact market fee descriptor and book fetch.
  type BookSnapshot = ReturnType<typeof bookSummary>;
  const shadowSummary = (prepared: ShadowPreparation) => prepared.accepted
    ? {
        version: prepared.plan.version,
        mode: prepared.plan.mode,
        accepted: true,
        orderType: prepared.plan.orderType,
        marketDataAgeMs: prepared.plan.marketDataAgeMs,
        preparationMicros: prepared.plan.preparationMicros,
        effectiveVwap: prepared.plan.quote.effectiveVwap,
        worstPrice: prepared.plan.worstPrice,
        levelsConsumed: prepared.plan.quote.levelsConsumed,
      }
    : {
        version: POLYMARKET_SHADOW_CONNECTOR.version,
        mode: POLYMARKET_SHADOW_CONNECTOR.mode,
        accepted: false,
        reason: prepared.reason,
        marketDataAgeMs: prepared.marketDataAgeMs,
        preparationMicros: prepared.preparationMicros,
      };
  const bookCache = new Map<string, {
    upBestAsk: number | null;
    downBestAsk: number | null;
    fee: TakerFeeDescriptor | null;
    upFill: FeeAdjustedAskFill | null;
    downFill: FeeAdjustedAskFill | null;
    mid: number | null;
    microstructure: { up: BookSnapshot | null; down: BookSnapshot | null };
    shadow: { up: ReturnType<typeof shadowSummary>; down: ReturnType<typeof shadowSummary> } | null;
  }>();
  const loadBook = async (m: GammaMarket) => {
    if (!bookCache.has(m.conditionId)) {
      const upTok = upTokenId(m), downTok = downTokenId(m);
      const info = await fetchClobMarketInfo(m.conditionId).catch(() => null);
      const fee = takerFeeDescriptor(info);
      const upB = upTok ? await fetchClobBook(upTok).catch(() => null) : null;
      const downB = downTok ? await fetchClobBook(downTok).catch(() => null) : null;
      const upS = upB ? bookSummary(upB) : null, downS = downB ? bookSummary(downB) : null;
      const tickSize = Number(info?.mts);
      const minOrderShares = Number(info?.mos);
      const shadowObservedAtMs = Date.now();
      const shadow = fee
        && upTok
        && downTok
        && Number.isFinite(tickSize)
        && Number.isFinite(minOrderShares)
        ? {
            up: shadowSummary(prepareLiveShadowMarketBuy({
              conditionId: m.conditionId,
              tokenId: upTok,
              totalBudgetUsd: SIZE_USD,
              tickSize,
              minOrderShares,
            }, fee, shadowObservedAtMs)),
            down: shadowSummary(prepareLiveShadowMarketBuy({
              conditionId: m.conditionId,
              tokenId: downTok,
              totalBudgetUsd: SIZE_USD,
              tickSize,
              minOrderShares,
            }, fee, shadowObservedAtMs)),
          }
        : null;
      bookCache.set(m.conditionId, {
        upBestAsk: upS?.bestAsk ?? null, downBestAsk: downS?.bestAsk ?? null,
        fee,
        upFill: upB && fee ? fillAskTotalUsd(upB, SIZE_USD, fee) : null,
        downFill: downB && fee ? fillAskTotalUsd(downB, SIZE_USD, fee) : null,
        mid: upS?.mid ?? null,
        microstructure: { up: upS, down: downS },
        shadow,
      });
    }
    return bookCache.get(m.conditionId)!;
  };

  for (const { m, pair, hz, endMs } of live) {
    if (!signalCache.has(pair)) signalCache.set(pair, await latestSignals(pair, now));
    const csig = await candleSigFor(pair);
    if (!regimeCache.has(pair)) regimeCache.set(pair, await regimeOf(pair));
    const sig = signalCache.get(pair)!;
    const regime = regimeCache.get(pair)!;

    // Every unseen signal bot must be evaluated against the LIVE CLOB midpoint. Gamma is discovery
    // metadata and can lag the book; using it as a pre-screen silently changed the registered rule.
    const mids = marketOutcomePrices(m);
    const gammaMid = mids.length === 2 && Number.isFinite(mids[0]) ? mids[0] : 0.5;
    const candidates = decisionBots.filter((b) => {
      if (
        b.source === "pricer"
        || b.source === "pairedBookOfi"
        || b.source === "smoothPath"
        || b.source === "smoothPathCausal"
      ) return false; // dedicated passes below
      if (endMs - hz * 60_000 < paperBotEffectiveStartMs(b)) return false; // future preregistrations stay dormant
      if (b.eligible && !b.eligible({ pair, horizonMin: hz, decidedAtMs: now })) return false;
      return !seen.has(`${b.key}|${m.conditionId}`);
    });
    if (!candidates.length) continue;

    const book = await loadBook(m);
    if (!book.fee || !book.upFill || !book.downFill) continue;
    const mid = book.mid ?? gammaMid;
    const macroCandidates = candidates.filter(
      (candidate) =>
        macroSleeveFor(candidate.source) != null
        || macroDirectionControlFor(candidate.source) != null,
    );
    const macroObservation = macroCandidates.length ? await macroObservationFor() : null;
    if (macroCandidates.length) {
      macroEligibleWindows++;
      if (macroObservation) {
        macroTickObservation = macroObservation;
        macroObservedWindows++;
        macroStateCounts[macroObservation.state]++;
      }
    }

    for (const b of candidates) {
      const macroSleeve = macroSleeveFor(b.source);
      const macroDirectionControl = macroDirectionControlFor(b.source);
      const pup = macroSleeve
        ? macroSleevePup(macroSleeve, macroObservation, csig?.regime?.cmo ?? null)
        : pupFor(b.source, sig, csig);
      const macroDecision = macroSleeve
        ? macroPaperDecision(pup, book.upFill.effectiveVwap, book.downFill.effectiveVwap)
        : null;
      const side = macroDirectionControl
        ? macroDirectionControlSide(macroDirectionControl, macroObservation)
        : macroSleeve
        ? macroDecision?.side ?? null
        : b.decide(pup, mid, regime, csig?.regime?.label ?? null);
      if (!side) continue;
      if (macroSleeve || macroDirectionControl) macroQualified++;
      const ask = macroDecision?.selectedAsk
        ?? (side === "up" ? book.upFill : book.downFill).effectiveVwap;
      if (ask == null || ask <= 0.02 || ask >= 0.98) continue; // no coherent/fillable book → skip
      const fairPup = b.fairPup?.(pup) ?? pup;
      const pSide = fairPup == null ? null : side === "up" ? fairPup : 1 - fairPup;
      const ageSec =
        macroSleeve || macroDirectionControl
          ? macroObservation?.ageSec ?? null
          : ageFor(b.source, sig, csig);
      const inserted = await db
        .insert(paperTrades)
        .values({
          botKey: b.key, conditionId: m.conditionId, slug: m.slug, pair, horizonMin: hz,
          windowStart: new Date(endMs - hz * 60_000), endDate: new Date(endMs),
          side, pSignal: pup, impliedMid: mid, askPaid: ask,
          controlAskPaid: book.downFill.effectiveVwap > 0.02 && book.downFill.effectiveVwap < 0.98
            ? book.downFill.effectiveVwap
            : null,
          edgeMid: pSide == null ? null : pSide - (side === "up" ? mid : 1 - mid),
          edgeAsk: macroDecision?.edgeAsk ?? (pSide == null ? null : pSide - ask),
          sizeUsd: SIZE_USD, signalAgeSec: ageSec,
          // The drift control also retains the contextual regime snapshot, giving one unbiased
          // regime observation per market even when every directional bot abstains.
          modelMeta: {
            version: macroDirectionControl
              ? MACRO_DIRECTION_CONTROLS.version
              : "signal-bridge-v1",
            source: b.source,
            sourcePup: pup,
            fairPup,
            regime,
            technicalRegime: csig?.regime ?? null,
            macroBreadth:
              (macroSleeve || macroDirectionControl) && macroObservation
                ? {
                    ...macroObservation,
                    // `ageSec` is measured against this frozen batch-evaluation instant. Book
                    // processing and inserts are sequential, so `decidedAt` can legitimately trail
                    // it by several seconds while remaining inside the 120-second freshness gate.
                    evaluatedAtMs: now,
                  }
                : undefined,
            macroSleeve: macroSleeve ?? undefined,
            macroDirectionControl: macroDirectionControl
              ? {
                  version: MACRO_DIRECTION_CONTROLS.version,
                  side: macroDirectionControl,
                }
              : undefined,
            macroDirectionCoverage:
              b.key === MACRO_DIRECTION_COVERAGE.denominatorBotKey
              && now >= MACRO_DIRECTION_COVERAGE.evalStartMs
                ? macroDirectionCoverageMetadata(
                    macroObservation,
                    now,
                    endMs - hz * 60_000,
                  )
                : undefined,
            bookExecution: {
              version: book.upFill.version,
              fee: book.fee,
              totalBudgetUsd: SIZE_USD,
              up: book.upFill,
              down: book.downFill,
            },
            // Prospective metadata only. No current bot reads these GitHub-mined microstructure
            // features; any directional use requires a separately preregistered forward hypothesis.
            bookMicrostructure: book.microstructure,
            // One market-level copy on the universal control is enough to measure the connector
            // without multiplying identical telemetry by every strategy that entered this window.
            shadowConnector: b.key === "drift" ? book.shadow : undefined,
            bollingerMfi: b.source === "bollingerMfi" ? csig?.bollingerMfi ?? null : undefined,
            td9Exhaustion: b.source === "td9Exhaustion" ? csig?.td9Exhaustion ?? null : undefined,
            stochAdx: b.source === "stochAdx" ? csig?.stochAdx ?? null : undefined,
            idNr4Breakout: b.source === "idNr4Breakout" ? csig?.idNr4Breakout ?? null : undefined,
          },
        })
        .onConflictDoNothing()
        .returning({ id: paperTrades.id });
      if (inserted.length) {
        seen.add(`${b.key}|${m.conditionId}`);
        placed++;
        if (macroSleeve || macroDirectionControl) macroPlaced++;
      }
    }
  }
  if (macroEligibleWindows) {
    console.log(
      `[macro-breadth] eligible=${macroEligibleWindows} observed=${macroObservedWindows} states=up:${macroStateCounts.up},down:${macroStateCounts.down},range:${macroStateCounts.range},neutral:${macroStateCounts.neutral} qualified=${macroQualified} placed=${macroPlaced}`,
    );
    if (macroTickObservation) {
      await db
        .insert(macroBreadthSnapshots)
        .values({
          version: macroTickObservation.version,
          barStart: new Date(macroTickObservation.asOfMs),
          barEnd: new Date(macroTickObservation.completedAtMs),
          capturedAt: new Date(now),
          state: macroTickObservation.state,
          btcCmo: macroTickObservation.cmoByAnchor["BTC-USD"],
          ethCmo: macroTickObservation.cmoByAnchor["ETH-USD"],
          solCmo: macroTickObservation.cmoByAnchor["SOL-USD"],
          medianCmo: macroTickObservation.medianCmo,
          medianAbsCmo: macroTickObservation.medianAbsCmo,
          sourceAgeSec: macroTickObservation.ageSec,
          eligibleWindows: macroEligibleWindows,
          observedWindows: macroObservedWindows,
          qualifiedDecisions: macroQualified,
          placedRows: macroPlaced,
        })
        .onConflictDoUpdate({
          target: [macroBreadthSnapshots.version, macroBreadthSnapshots.barStart],
          set: {
            capturedAt: new Date(now),
            sourceAgeSec: macroTickObservation.ageSec,
            eligibleWindows: sql`greatest(${macroBreadthSnapshots.eligibleWindows}, excluded.eligible_windows)`,
            observedWindows: sql`greatest(${macroBreadthSnapshots.observedWindows}, excluded.observed_windows)`,
            qualifiedDecisions: sql`${macroBreadthSnapshots.qualifiedDecisions} + excluded.qualified_decisions`,
            placedRows: sql`${macroBreadthSnapshots.placedRows} + excluded.placed_rows`,
          },
        });
    }
  }
  // ── Paired-book OFI continuation — elapsed minute 2, current real batch-book fills ──
  const pairedBookBots = decisionBots.filter((bot) => bot.source === "pairedBookOfi");
  type PairedBookSnapshot = {
    capturedAtMs: number;
    requestDurationMs: number;
    fee: TakerFeeDescriptor;
    upFill: FeeAdjustedAskFill;
    downFill: FeeAdjustedAskFill;
    up: ReturnType<typeof bookSummary>;
    down: ReturnType<typeof bookSummary>;
  };
  const pairedBookCache = new Map<string, PairedBookSnapshot | null>();
  const pairedBookFor = async (market: GammaMarket): Promise<PairedBookSnapshot | null> => {
    if (!pairedBookCache.has(market.conditionId)) {
      const upToken = upTokenId(market);
      const downToken = downTokenId(market);
      if (!upToken || !downToken || upToken === downToken) {
        pairedBookCache.set(market.conditionId, null);
      } else {
        const fee = takerFeeDescriptor(
          await fetchClobMarketInfo(market.conditionId).catch(() => null),
        );
        const requestStartedMs = Date.now();
        const books = await fetchClobBooks([upToken, downToken]).catch(() => []);
        const capturedAtMs = Date.now();
        const requestDurationMs = capturedAtMs - requestStartedMs;
        const byToken = new Map(
          books
            .filter((book) => book.market === market.conditionId)
            .map((book) => [String(book.asset_id), book]),
        );
        const upBook = byToken.get(upToken);
        const downBook = byToken.get(downToken);
        const upFill = upBook && fee ? fillAskTotalUsd(upBook, SIZE_USD, fee) : null;
        const downFill = downBook && fee ? fillAskTotalUsd(downBook, SIZE_USD, fee) : null;
        pairedBookCache.set(
          market.conditionId,
          fee
            && upBook
            && downBook
            && upFill
            && downFill
            && requestDurationMs <= PAIRED_BOOK_OFI_CONTINUATION.maxBatchRequestMs
            ? {
                capturedAtMs,
                requestDurationMs,
                fee,
                upFill,
                downFill,
                up: bookSummary(upBook),
                down: bookSummary(downBook),
              }
            : null,
        );
      }
    }
    return pairedBookCache.get(market.conditionId) ?? null;
  };
  const touchOf = (
    summary: ReturnType<typeof bookSummary>,
  ): PairedBookTouch | null => (
    summary.bestBid != null
    && summary.bestAsk != null
    && summary.bestBidSize != null
    && summary.bestAskSize != null
      ? {
          bid: summary.bestBid,
          bidSize: summary.bestBidSize,
          ask: summary.bestAsk,
          askSize: summary.bestAskSize,
        }
      : null
  );

  let pairedEligibleWindows = 0;
  let pairedObserved = 0;
  let pairedQualified = 0;
  let pairedPlaced = 0;
  if (pairedBookBots.length) {
    for (const { m, pair, hz, endMs } of inWindow) {
      const startMs = endMs - hz * 60_000;
      const sampleMinute = surfaceSampleMinute(startMs, now);
      if (!pairedBookOfiEligible(pair, hz, sampleMinute)) continue;
      const candidates = pairedBookBots.filter((bot) =>
        startMs >= paperBotEffectiveStartMs(bot)
        && (!bot.eligible || bot.eligible({ pair, horizonMin: hz, decidedAtMs: now }))
        && !seen.has(`${bot.key}|${m.conditionId}`),
      );
      if (!candidates.length) continue;
      pairedEligibleWindows++;

      const [previous] = await db
        .select({
          capturedAt: polymarketStateSnapshots.capturedAt,
          upBid: polymarketStateSnapshots.upBid,
          upAsk: polymarketStateSnapshots.upAsk,
          upBidSize: polymarketStateSnapshots.upBidSize,
          upAskSize: polymarketStateSnapshots.upAskSize,
          downBid: polymarketStateSnapshots.downBid,
          downAsk: polymarketStateSnapshots.downAsk,
          downBidSize: polymarketStateSnapshots.downBidSize,
          downAskSize: polymarketStateSnapshots.downAskSize,
        })
        .from(polymarketStateSnapshots)
        .where(and(
          eq(polymarketStateSnapshots.conditionId, m.conditionId),
          eq(polymarketStateSnapshots.windowStart, new Date(startMs)),
          eq(
            polymarketStateSnapshots.sampleMinute,
            PAIRED_BOOK_OFI_CONTINUATION.previousSampleMinute,
          ),
          eq(polymarketStateSnapshots.referenceSource, "chainlink"),
          isNotNull(polymarketStateSnapshots.upBid),
          isNotNull(polymarketStateSnapshots.upAsk),
          isNotNull(polymarketStateSnapshots.upBidSize),
          isNotNull(polymarketStateSnapshots.upAskSize),
          isNotNull(polymarketStateSnapshots.downBid),
          isNotNull(polymarketStateSnapshots.downAsk),
          isNotNull(polymarketStateSnapshots.downBidSize),
          isNotNull(polymarketStateSnapshots.downAskSize),
        ))
        .limit(1);
      if (!previous) continue;

      const current = await pairedBookFor(m);
      if (!current) continue;
      const currentUp = touchOf(current.up);
      const currentDown = touchOf(current.down);
      if (!currentUp || !currentDown) continue;
      const previousUp: PairedBookTouch = {
        bid: Number(previous.upBid),
        ask: Number(previous.upAsk),
        bidSize: Number(previous.upBidSize),
        askSize: Number(previous.upAskSize),
      };
      const previousDown: PairedBookTouch = {
        bid: Number(previous.downBid),
        ask: Number(previous.downAsk),
        bidSize: Number(previous.downBidSize),
        askSize: Number(previous.downAskSize),
      };
      const observation = pairedBookOfiObservation({
        previousCapturedAtMs: new Date(previous.capturedAt).getTime(),
        currentCapturedAtMs: current.capturedAtMs,
        previousUp,
        previousDown,
        currentUp,
        currentDown,
      });
      if (!observation) continue;
      pairedObserved++;
      const decision = pairedBookOfiPaperDecision(
        observation,
        current.upFill.effectiveVwap,
        current.downFill.effectiveVwap,
      );
      if (!decision) continue;
      pairedQualified++;

      for (const bot of candidates) {
        const selectedMid = decision.side === "up"
          ? observation.currentCanonicalMid
          : 1 - observation.currentCanonicalMid;
        const inserted = await db
          .insert(paperTrades)
          .values({
            botKey: bot.key,
            conditionId: m.conditionId,
            slug: m.slug,
            pair,
            horizonMin: hz,
            windowStart: new Date(startMs),
            endDate: new Date(endMs),
            side: decision.side,
            pSignal: decision.pup,
            impliedMid: observation.currentCanonicalMid,
            askPaid: decision.selectedAsk,
            controlAskPaid: decision.controlAsk,
            edgeMid: PAIRED_BOOK_OFI_CONTINUATION.eventSideProbability - selectedMid,
            edgeAsk: decision.edgeAsk,
            sizeUsd: SIZE_USD,
            signalAgeSec: Math.max(0, (Date.now() - current.capturedAtMs) / 1_000),
            modelMeta: {
              version: PAIRED_BOOK_OFI_CONTINUATION.version,
              previousSampleMinute: PAIRED_BOOK_OFI_CONTINUATION.previousSampleMinute,
              decisionSampleMinute: PAIRED_BOOK_OFI_CONTINUATION.decisionSampleMinute,
              previousCapturedAtMs: new Date(previous.capturedAt).getTime(),
              currentCapturedAtMs: current.capturedAtMs,
              requestDurationMs: current.requestDurationMs,
              previousUp,
              previousDown,
              currentUp,
              currentDown,
              ...observation,
              bookExecution: {
                version: current.upFill.version,
                fee: current.fee,
                totalBudgetUsd: SIZE_USD,
                up: current.upFill,
                down: current.downFill,
              },
            },
          })
          .onConflictDoNothing()
          .returning({ id: paperTrades.id });
        if (inserted.length) {
          seen.add(`${bot.key}|${m.conditionId}`);
          placed++;
          pairedPlaced++;
        }
      }
    }
  }
  if (pairedEligibleWindows) {
    console.log(
      `[paired-ofi] eligible=${pairedEligibleWindows} observed=${pairedObserved} qualified=${pairedQualified} placed=${pairedPlaced}`,
    );
  }
  // ── Smooth Chainlink path / strike displacement — elapsed minute 2 ──
  const smoothPathBots = decisionBots.filter((bot) =>
    bot.source === "smoothPath" || bot.source === "smoothPathCausal"
  );
  type SmoothPathMetrics = {
    eligible: number;
    observed: number;
    qualified: number;
    placed: number;
    rejections: Map<string, number>;
  };
  const smoothMetrics = new Map<string, SmoothPathMetrics>();
  const metricsFor = (version: string) => {
    let metrics = smoothMetrics.get(version);
    if (!metrics) {
      metrics = { eligible: 0, observed: 0, qualified: 0, placed: 0, rejections: new Map() };
      smoothMetrics.set(version, metrics);
    }
    return metrics;
  };
  type SmoothFunnelInsert = typeof polymarketSmoothPathFunnel.$inferInsert;
  const smoothContractFor = (bot: PaperBot) => bot.source === "smoothPathCausal"
    ? SMOOTH_PATH_CAUSAL_DISPLACEMENT
    : SMOOTH_PATH_DISPLACEMENT;
  const smoothFunnelRow = (
    bot: PaperBot,
    market: GammaMarket,
    pair: string,
    startMs: number,
    values: Partial<SmoothFunnelInsert>,
  ): SmoothFunnelInsert => ({
    version: smoothContractFor(bot).version,
    botKey: bot.key,
    conditionId: market.conditionId,
    pair,
    windowStart: new Date(startMs),
    observed: false,
    pathQualified: false,
    bookQualified: false,
    placed: false,
    rejectionReasons: [],
    ...values,
  });
  const smoothFunnelUpdate = (row: SmoothFunnelInsert) => ({
    observedAt: row.observedAt ?? null,
    bookRequestDurationMs: row.bookRequestDurationMs ?? null,
    observed: row.observed ?? false,
    pathQualified: row.pathQualified ?? false,
    bookQualified: row.bookQualified ?? false,
    placed: row.placed ?? false,
    rejectionReasons: row.rejectionReasons ?? [],
    tickCount: row.tickCount ?? null,
    startCoverageSec: row.startCoverageSec ?? null,
    maxIntertickGapSec: row.maxIntertickGapSec ?? null,
    sourceAgeSec: row.sourceAgeSec ?? null,
    receiveAgeSec: row.receiveAgeSec ?? null,
    absDisplacementLog: row.absDisplacementLog ?? null,
    pathR2: row.pathR2 ?? null,
    pathEfficiency: row.pathEfficiency ?? null,
    continuationSlopePerSec: row.continuationSlopePerSec ?? null,
    continuationFreshLog: row.continuationFreshLog ?? null,
    capturedAt: new Date(),
  });
  const recordSmoothFunnel = async (
    bot: PaperBot,
    market: GammaMarket,
    pair: string,
    startMs: number,
    values: Partial<SmoothFunnelInsert>,
  ) => {
    if (startMs < SMOOTH_PATH_CAUSAL_DISPLACEMENT.evalStartMs) return;
    const row = smoothFunnelRow(bot, market, pair, startMs, values);
    await db
      .insert(polymarketSmoothPathFunnel)
      .values(row)
      .onConflictDoUpdate({
        target: [
          polymarketSmoothPathFunnel.version,
          polymarketSmoothPathFunnel.conditionId,
        ],
        set: smoothFunnelUpdate(row),
      });
  };
  if (smoothPathBots.length) {
    for (const { m, pair, hz, endMs } of inWindow) {
      const startMs = endMs - hz * 60_000;
      const sampleMinute = surfaceSampleMinute(startMs, now);
      if (
        !smoothPathEligible(pair, hz, sampleMinute)
        && !smoothPathCausalEligible(pair, hz, sampleMinute)
      ) continue;
      const candidates = smoothPathBots.filter((bot) =>
        startMs >= paperBotEffectiveStartMs(bot)
        && (!bot.eligible || bot.eligible({ pair, horizonMin: hz, decidedAtMs: now }))
        && !seen.has(`${bot.key}|${m.conditionId}`),
      );
      if (!candidates.length) continue;
      for (const bot of candidates) {
        const contract = bot.source === "smoothPathCausal"
          ? SMOOTH_PATH_CAUSAL_DISPLACEMENT
          : SMOOTH_PATH_DISPLACEMENT;
        metricsFor(contract.version).eligible++;
      }

      const [previous] = await db
        .select({
          capturedAt: polymarketStateSnapshots.capturedAt,
          strike: polymarketStateSnapshots.chainlinkStrike,
          upFill: polymarketStateSnapshots.upFill5,
          downFill: polymarketStateSnapshots.downFill5,
        })
        .from(polymarketStateSnapshots)
        .where(and(
          eq(polymarketStateSnapshots.conditionId, m.conditionId),
          eq(polymarketStateSnapshots.windowStart, new Date(startMs)),
          eq(
            polymarketStateSnapshots.sampleMinute,
            SMOOTH_PATH_DISPLACEMENT.previousSampleMinute,
          ),
          eq(polymarketStateSnapshots.referenceSource, "chainlink"),
          isNotNull(polymarketStateSnapshots.chainlinkStrike),
          isNotNull(polymarketStateSnapshots.upFill5),
          isNotNull(polymarketStateSnapshots.downFill5),
        ))
        .limit(1);
      if (!previous) {
        for (const bot of candidates) {
          await recordSmoothFunnel(bot, m, pair, startMs, {
            rejectionReasons: ["missing-minute-1-state"],
          });
        }
        continue;
      }

      const current = await pairedBookFor(m);
      if (!current) {
        for (const bot of candidates) {
          await recordSmoothFunnel(bot, m, pair, startMs, {
            rejectionReasons: ["paired-book-unavailable"],
          });
        }
        continue;
      }
      const upMid = current.up.mid;
      const downMid = current.down.mid;
      if (upMid == null || downMid == null) {
        for (const bot of candidates) {
          await recordSmoothFunnel(bot, m, pair, startMs, {
            observedAt: new Date(current.capturedAtMs),
            bookRequestDurationMs: current.requestDurationMs,
            rejectionReasons: ["paired-book-mid-unavailable"],
          });
        }
        continue;
      }
      const currentCanonicalMid = (upMid + 1 - downMid) / 2;
      if (!(currentCanonicalMid > 0) || !(currentCanonicalMid < 1)) {
        for (const bot of candidates) {
          await recordSmoothFunnel(bot, m, pair, startMs, {
            observedAt: new Date(current.capturedAtMs),
            bookRequestDurationMs: current.requestDurationMs,
            rejectionReasons: ["canonical-mid-invalid"],
          });
        }
        continue;
      }

      const input = {
        windowStartMs: startMs,
        observedAtMs: current.capturedAtMs,
        strike: Number(previous.strike),
        ticks: chainlinkPath(pair, startMs, current.capturedAtMs),
      };
      for (const bot of candidates) {
        const causal = bot.source === "smoothPathCausal";
        const contract = causal
          ? SMOOTH_PATH_CAUSAL_DISPLACEMENT
          : SMOOTH_PATH_DISPLACEMENT;
        const metrics = metricsFor(contract.version);
        const rejectSmooth = (reason: string) => {
          metrics.rejections.set(reason, (metrics.rejections.get(reason) ?? 0) + 1);
        };
        const observation = causal
          ? smoothPathCausalObservation(input)
          : smoothPathObservation(input);
        if (!observation) {
          rejectSmooth("invalid-path");
          await recordSmoothFunnel(bot, m, pair, startMs, {
            observedAt: new Date(current.capturedAtMs),
            bookRequestDurationMs: current.requestDurationMs,
            rejectionReasons: ["invalid-path"],
          });
          continue;
        }
        metrics.observed++;
        for (const reason of observation.rejectionReasons) rejectSmooth(reason);
        const decision = smoothPathPaperDecision(
          observation,
          Number(previous.upFill),
          Number(previous.downFill),
          current.upFill.effectiveVwap,
          current.downFill.effectiveVwap,
        );
        if (!decision) {
          const rejectionReasons = observation.rejectionReasons.length === 0
            ? ["book-edge-or-chase"]
            : observation.rejectionReasons;
          if (rejectionReasons[0] === "book-edge-or-chase") {
            rejectSmooth("book-edge-or-chase");
          }
          await recordSmoothFunnel(bot, m, pair, startMs, {
            observedAt: new Date(current.capturedAtMs),
            bookRequestDurationMs: current.requestDurationMs,
            observed: true,
            pathQualified: observation.rejectionReasons.length === 0,
            bookQualified: false,
            placed: false,
            rejectionReasons,
            tickCount: observation.tickCount,
            startCoverageSec: observation.startCoverageSec,
            maxIntertickGapSec: observation.maxIntertickGapSec,
            sourceAgeSec: observation.sourceAgeSec,
            receiveAgeSec: observation.receiveAgeSec,
            absDisplacementLog: Math.abs(observation.currentDisplacementLog),
            pathR2: observation.pathR2,
            pathEfficiency: observation.pathEfficiency,
            continuationSlopePerSec: observation.signedSlopePerSec,
            continuationFreshLog: observation.signedFreshReturnLog,
          });
          continue;
        }
        metrics.qualified++;

        const selectedMid = decision.side === "up"
          ? currentCanonicalMid
          : 1 - currentCanonicalMid;
        const tradeRow: typeof paperTrades.$inferInsert = {
          botKey: bot.key,
          conditionId: m.conditionId,
          slug: m.slug,
          pair,
          horizonMin: hz,
          windowStart: new Date(startMs),
          endDate: new Date(endMs),
          side: decision.side,
          pSignal: decision.pup,
          impliedMid: currentCanonicalMid,
          askPaid: decision.selectedAsk,
          controlAskPaid: decision.controlAsk,
          edgeMid: contract.eventSideProbability - selectedMid,
          edgeAsk: decision.edgeAsk,
          sizeUsd: SIZE_USD,
          signalAgeSec: observation.sourceAgeSec,
          modelMeta: {
            version: contract.version,
            previousSampleMinute: contract.previousSampleMinute,
            decisionSampleMinute: contract.decisionSampleMinute,
            previousCapturedAtMs: new Date(previous.capturedAt).getTime(),
            previousUpFill: Number(previous.upFill),
            previousDownFill: Number(previous.downFill),
            currentCapturedAtMs: current.capturedAtMs,
            requestDurationMs: current.requestDurationMs,
            currentCanonicalMid,
            ...observation,
            askDrift: decision.askDrift,
            previousSelectedAsk: decision.previousSelectedAsk,
            bookExecution: {
              version: current.upFill.version,
              fee: current.fee,
              totalBudgetUsd: SIZE_USD,
              up: current.upFill,
              down: current.downFill,
            },
          },
        };
        const inserted = startMs >= SMOOTH_PATH_CAUSAL_DISPLACEMENT.evalStartMs
          ? await db.transaction(async (tx) => {
              const paperRows = await tx
                .insert(paperTrades)
                .values(tradeRow)
                .onConflictDoNothing()
                .returning({ id: paperTrades.id });
              const funnelRow = smoothFunnelRow(bot, m, pair, startMs, {
                observedAt: new Date(current.capturedAtMs),
                bookRequestDurationMs: current.requestDurationMs,
                observed: true,
                pathQualified: true,
                bookQualified: true,
                placed: paperRows.length > 0,
                rejectionReasons: paperRows.length > 0 ? [] : ["paper-row-conflict"],
                tickCount: observation.tickCount,
                startCoverageSec: observation.startCoverageSec,
                maxIntertickGapSec: observation.maxIntertickGapSec,
                sourceAgeSec: observation.sourceAgeSec,
                receiveAgeSec: observation.receiveAgeSec,
                absDisplacementLog: Math.abs(observation.currentDisplacementLog),
                pathR2: observation.pathR2,
                pathEfficiency: observation.pathEfficiency,
                continuationSlopePerSec: observation.signedSlopePerSec,
                continuationFreshLog: observation.signedFreshReturnLog,
              });
              await tx
                .insert(polymarketSmoothPathFunnel)
                .values(funnelRow)
                .onConflictDoUpdate({
                  target: [
                    polymarketSmoothPathFunnel.version,
                    polymarketSmoothPathFunnel.conditionId,
                  ],
                  set: smoothFunnelUpdate(funnelRow),
                });
              return paperRows;
            })
          : await db
              .insert(paperTrades)
              .values(tradeRow)
              .onConflictDoNothing()
              .returning({ id: paperTrades.id });
        if (inserted.length) {
          seen.add(`${bot.key}|${m.conditionId}`);
          placed++;
          metrics.placed++;
        }
      }
    }
  }
  for (const [version, metrics] of [...smoothMetrics.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const rejectionSummary = [...metrics.rejections.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([reason, count]) => `${reason}:${count}`)
      .join(",");
    console.log(
      `[smooth-path] version=${version} eligible=${metrics.eligible}`
      + ` observed=${metrics.observed} qualified=${metrics.qualified}`
      + ` placed=${metrics.placed} rejections=${rejectionSummary || "none"}`,
    );
  }
  // ── Pricer pass — whole window, edge vs the ASK ──
  const pricerBots = decisionBots.filter((b) => b.source === "pricer");
  let empiricalTrainingPromise: ReturnType<typeof loadEmpiricalTraining> | null = null;
  const empiricalTraining = () => empiricalTrainingPromise ??= loadEmpiricalTraining(now);
  let pricedCl = 0, pricedHl = 0; // which reference the pricer used this tick (Chainlink vs Hyperliquid)
  for (const { m, pair, hz, endMs } of inWindow) {
    const startMs = endMs - hz * 60_000;
    const unseen = pricerBots.filter((b) =>
      startMs >= paperBotEffectiveStartMs(b)
      && (!b.eligible || b.eligible({ pair, horizonMin: hz, decidedAtMs: now }))
      && !seen.has(`${b.key}|${m.conditionId}`),
    );
    if (!unseen.length) continue;

    const cd = await loadCandles(pair);
    if (!cd) continue;

    // Price S and the strike K off the RESOLUTION SOURCE (Chainlink via RTDS) when the feed covers the
    // window — measured in the units the market actually settles. Fall back to Hyperliquid (both S and K,
    // never mixed — mixing sources would inject the very basis we're removing) when the buffer can't.
    const clNow = chainlinkNow(pair), clK = chainlinkAt(pair, startMs);
    const useCl = !!clNow && clNow.ageSec < RTDS_FRESH_SEC && clK != null;
    const S = useCl ? clNow!.px : cd.S;
    const K = useCl ? clK! : strikeAt(cd.candles, startMs);
    if (!K) continue;
    if (useCl) pricedCl++; else pricedHl++;
    const tauMin = (endMs - now) / 60_000;
    const remainingSec = (endMs - now) / 1_000;
    const technicalRegime = classifyMarketRegime(aggregate5m(cd.candles));
    const bsmPup = cd.sigma != null ? digitalPupBSM(S, K, cd.sigma, tauMin) : null;
    const profileVarianceMin = bsmProfileRemainingVarianceMin(tauMin);
    const bsmWindowProfilePup = cd.sigma != null && profileVarianceMin != null
      ? digitalPupBSM(S, K, cd.sigma, profileVarianceMin)
      : null;
    const peakRetention = unseen.some((bot) => bot.key === "pricerBSMPeakRetention") && useCl
      ? chainlinkPeakGapRetention(pair, startMs, K, now)
      : null;
    const peakRetentionReady = peakRetentionEligible(peakRetention, remainingSec);
    const peakRetentionPup = peakRetentionReady && cd.sigma != null
      ? digitalPupBSM(peakRetention.currentPx, K, cd.sigma, tauMin)
      : null;
    const modelMeta: Record<string, Record<string, unknown>> = {
      pricerMC: { version: "bootstrap-mc-v1", referenceSource: useCl ? "chainlink" : "hyperliquid", spot: S, strike: K, tauMin, sigmaPerMin: cd.sigma, returnBars: cd.returns.length, technicalRegime },
      pricerMC5mTrend: {
        version: PRICER_MC_5M_TREND.version,
        parentVersion: PRICER_MC_5M_TREND.parentVersion,
        referenceSource: useCl ? "chainlink" : "hyperliquid",
        spot: S,
        strike: K,
        tauMin,
        sigmaPerMin: cd.sigma,
        returnBars: cd.returns.length,
        technicalRegime,
      },
      pricerMC5mCobraNight: {
        version: COBRA_5M_NIGHT_PRICER.version,
        parentVersion: COBRA_5M_NIGHT_PRICER.parentVersion,
        referenceSource: useCl ? "chainlink" : "hyperliquid",
        spot: S,
        strike: K,
        tauMin,
        sigmaPerMin: cd.sigma,
        returnBars: cd.returns.length,
        technicalRegime,
        ukSession: ukTradingSessionAt(now),
      },
      pricerBSM: { version: "bsm-digital-v1", referenceSource: useCl ? "chainlink" : "hyperliquid", spot: S, strike: K, tauMin, sigmaPerMin: cd.sigma, technicalRegime },
      pricerBSMWindowProfile: {
        version: BSM_WINDOW_PROFILE.version,
        referenceSource: useCl ? "chainlink" : "hyperliquid",
        spot: S,
        strike: K,
        tauMin,
        profileVarianceMin,
        sigmaPerMin: cd.sigma,
        varianceWeights: BSM_WINDOW_PROFILE.varianceWeights,
        technicalRegime,
      },
      pricerBSMPeakRetention: {
        version: "bsm-peak-retention-v1",
        referenceSource: "chainlink",
        spot: peakRetention?.currentPx ?? null,
        strike: K,
        tauMin,
        remainingSec,
        sigmaPerMin: cd.sigma,
        technicalRegime,
        peakRetention,
      },
      pricerBSMOffHours15: { version: "bsm-digital-cobra-session15-v1", referenceSource: useCl ? "chainlink" : "hyperliquid", spot: S, strike: K, tauMin, sigmaPerMin: cd.sigma, technicalRegime, ukSession: ukTradingSessionAt(now) },
    };
    const mcPup = digitalPupMC(S, K, cd.returns, tauMin);
    const pups: Record<string, number | null> = {
      pricerMC: mcPup, // returns = vol shape (source-agnostic); S/K set the distance
      pricerMC5mTrend: pricerMc5mTrendQualified(technicalRegime) ? mcPup : null,
      pricerMC5mCobraNight: mcPup,
      pricerBSM: bsmPup,
      pricerBSMWindowProfile: bsmWindowProfilePup,
      pricerBSMPeakRetention: peakRetentionPup,
      pricerBSMOffHours15: bsmPup,
      pricerEmpirical: null,
    };
    if (useCl && cd.sigma != null) {
      const coords = normalizedDistance(S, K, cd.sigma, Math.floor((endMs - now) / 1000));
      if (coords?.zDistance != null) {
        const estimate = empiricalKnnPup(await empiricalTraining(), {
          conditionId: m.conditionId,
          zDistance: coords.zDistance,
          remainingSec: Math.floor((endMs - now) / 1000),
        });
        if (estimate) {
          pups.pricerEmpirical = estimate.pup;
          modelMeta.pricerEmpirical = {
            version: "empirical-knn-v1",
            referenceSource: "chainlink",
            spot: S,
            strike: K,
            tauMin,
            sigmaPerMin: cd.sigma,
            zDistance: coords.zDistance,
            technicalRegime,
            ...estimate,
          };
        }
      }
    }

    // Gamma is not a decision input. Evaluate every available model against the real two-sided fills.
    const mids = marketOutcomePrices(m);
    const gammaMid = mids.length === 2 && Number.isFinite(mids[0]) ? mids[0] : 0.5;
    const modeled = unseen.filter((b) => pups[b.key] != null);
    if (!modeled.length) continue;

    const book = await loadBook(m);
    if (!book.fee || !book.upFill || !book.downFill) continue;
    const mid = book.mid ?? gammaMid;

    for (const b of modeled) {
      const p = pups[b.key]!;
      // Registered rule: bet the side whose model edge OVER THE (real book-walk) FILL clears the threshold.
      const edgeUp = book.upFill.effectiveVwap > 0.02 && book.upFill.effectiveVwap < 0.98
        ? p - book.upFill.effectiveVwap
        : -Infinity;
      const edgeDown = book.downFill.effectiveVwap > 0.02 && book.downFill.effectiveVwap < 0.98
        ? 1 - p - book.downFill.effectiveVwap
        : -Infinity;
      let side: "up" | "down" | null = null;
      if (edgeUp > PRICER.askEdge && edgeUp >= edgeDown) side = "up";
      else if (edgeDown > PRICER.askEdge) side = "down";
      if (!side) continue;
      const ask = (side === "up" ? book.upFill : book.downFill).effectiveVwap;
      const pSide = side === "up" ? p : 1 - p;
      await db
        .insert(paperTrades)
        .values({
          botKey: b.key, conditionId: m.conditionId, slug: m.slug, pair, horizonMin: hz,
          windowStart: new Date(startMs), endDate: new Date(endMs),
          side, pSignal: p, impliedMid: mid, askPaid: ask,
          controlAskPaid: book.downFill.effectiveVwap > 0.02 && book.downFill.effectiveVwap < 0.98
            ? book.downFill.effectiveVwap
            : null,
          edgeMid: pSide - (side === "up" ? mid : 1 - mid),
          edgeAsk: pSide - ask,
          sizeUsd: SIZE_USD,
          signalAgeSec: b.key === "pricerBSMPeakRetention"
            ? peakRetention?.sourceAgeSec ?? null
            : (now - cd.lastT) / 1000,
          modelMeta: {
            ...(modelMeta[b.key] ?? {}),
            bookExecution: {
              version: book.upFill.version,
              fee: book.fee,
              totalBudgetUsd: SIZE_USD,
              up: book.upFill,
              down: book.downFill,
            },
            // Observational only; never enters the current pricer decision.
            bookMicrostructure: book.microstructure,
          },
        })
        .onConflictDoNothing();
      seen.add(`${b.key}|${m.conditionId}`);
      placed++;
    }
  }

  if (pricedCl || pricedHl) console.log(`[pricer] reference: chainlink=${pricedCl} hyperliquid=${pricedHl}`);
  return { placed, considered: inWindow.length };
}

// In-memory round-robin cursor for the backlog lane. A restart safely begins from the oldest row;
// the separate recent lane keeps the live cohort timely while the cursor eventually revisits every
// older unresolved condition.
let paperGradeCursorId = 0;

/** Grade open trades whose market has resolved. Binary payout at the ask paid. */
export async function paperGradeTick(): Promise<{ graded: number }> {
  const now = Date.now();
  // Retire zombies independently of the fetch batch. Otherwise a few permanently-unresolved
  // markets can occupy the oldest page forever and prevent newer, resolved windows from grading.
  await db
    .update(paperTrades)
    .set({ status: "void", pnlUsd: 0, gradedAt: new Date(now) })
    .where(and(eq(paperTrades.status, "open"), lt(paperTrades.endDate, new Date(now - 86_400_000))));

  const dueBefore = new Date(now - 90_000);
  const recent = await db
    .select()
    .from(paperTrades)
    .where(and(eq(paperTrades.status, "open"), lt(paperTrades.endDate, dueBefore)))
    .orderBy(desc(paperTrades.endDate))
    .limit(120);
  const backlogPage = () =>
    db
      .select()
      .from(paperTrades)
      .where(and(eq(paperTrades.status, "open"), lt(paperTrades.endDate, dueBefore), gt(paperTrades.id, paperGradeCursorId)))
      .orderBy(asc(paperTrades.id))
      .limit(120);
  let backlog = await backlogPage();
  if (!backlog.length && paperGradeCursorId > 0) {
    paperGradeCursorId = 0;
    backlog = await backlogPage();
  }
  if (backlog.length) paperGradeCursorId = backlog[backlog.length - 1].id;
  const due = [...new Map([...recent, ...backlog].map((trade) => [trade.id, trade])).values()];
  let graded = 0;
  const byMarket = new Map<string, typeof due>();
  for (const t of due) {
    const arr = byMarket.get(t.conditionId) ?? [];
    arr.push(t); byMarket.set(t.conditionId, arr);
  }
  for (const [cid, trades] of byMarket) {
    const clob = await fetchClobMarket(cid).catch(() => null);
    if (!clob || !clob.closed) continue;
    const upTok = clob.tokens.find((x) => /up/i.test(x.outcome));
    if (!upTok) continue;
    const resolvedUp = typeof upTok.winner === "boolean" ? upTok.winner : typeof upTok.price === "number" ? upTok.price > 0.5 : null;
    if (resolvedUp == null) continue;
    for (const t of trades) {
      const won = (t.side === "up") === resolvedUp;
      const pnl = won ? (t.sizeUsd * (1 - t.askPaid)) / t.askPaid : -t.sizeUsd;
      await db.update(paperTrades).set({ status: won ? "won" : "lost", pnlUsd: pnl, gradedAt: new Date() }).where(eq(paperTrades.id, t.id));
      graded++;
    }
  }
  return { graded };
}

export type PaperFloorScope = "paper" | "forward" | "history";

/**
 * A bounded, read-only decision feed for one strategy page. Keeping this query separate prevents a
 * busy strategy from crowding other strategies out of the overview's intentionally compact feed.
 */
export async function paperStrategyFeed(input: {
  botKey: string;
  horizonMin: 5 | 15;
  scope: PaperFloorScope;
  assets?: ("BTC" | "ETH" | "SOL" | "XRP" | "DOGE" | "BNB")[];
  limit?: number;
}) {
  const registered = PAPER_BOTS.some((bot) => bot.key === input.botKey);
  if (!registered) return [];
  const scopeCondition: SQL = input.scope === "paper"
    ? gte(paperTrades.windowStart, new Date(PAPER_ENGINE_V3_START_MS))
    : input.scope === "forward"
      ? gte(paperTrades.windowStart, new Date(PAPER_GATE.evalStartMs))
      : sql`true`;
  const limit = Math.max(1, Math.min(200, Math.trunc(input.limit ?? 100)));
  const selectedPairs = [...new Set(input.assets ?? [])].map((asset) => `${asset}-USD`);
  const rows = await db
    .select({
      id: paperTrades.id,
      decidedAt: paperTrades.decidedAt,
      windowStart: paperTrades.windowStart,
      pair: paperTrades.pair,
      horizonMin: paperTrades.horizonMin,
      side: paperTrades.side,
      pSignal: paperTrades.pSignal,
      askPaid: paperTrades.askPaid,
      edgeAsk: paperTrades.edgeAsk,
      sizeUsd: paperTrades.sizeUsd,
      status: paperTrades.status,
      pnlUsd: paperTrades.pnlUsd,
    })
    .from(paperTrades)
    .where(and(
      eq(paperTrades.botKey, input.botKey),
      eq(paperTrades.horizonMin, input.horizonMin),
      scopeCondition,
      ...(selectedPairs.length ? [inArray(paperTrades.pair, selectedPairs)] : []),
    ))
    .orderBy(desc(paperTrades.decidedAt))
    .limit(limit);
  return rows.map((trade) => ({
    id: trade.id,
    at: trade.decidedAt.getTime(),
    bot: input.botKey,
    pair: trade.pair,
    horizonMin: trade.horizonMin,
    windowStart: trade.windowStart.getTime(),
    side: trade.side,
    p: trade.pSignal,
    ask: trade.askPaid,
    edge: trade.edgeAsk,
    size: trade.sizeUsd,
    status: trade.status,
    pnl: trade.pnlUsd,
  }));
}

/**
 * A bounded, read-only decision feed for one asset page. This intentionally retains every paper
 * strategy so the page can expose agreement, crowding, and strategy dispersion on the same asset.
 */
export async function paperAssetFeed(input: {
  asset: "BTC" | "ETH" | "SOL" | "XRP" | "DOGE" | "BNB";
  horizonMin: 5 | 15;
  scope: PaperFloorScope;
  limit?: number;
}) {
  const scopeCondition: SQL = input.scope === "paper"
    ? gte(paperTrades.windowStart, new Date(PAPER_ENGINE_V3_START_MS))
    : input.scope === "forward"
      ? gte(paperTrades.windowStart, new Date(PAPER_GATE.evalStartMs))
      : sql`true`;
  const limit = Math.max(1, Math.min(200, Math.trunc(input.limit ?? 100)));
  const pair = `${input.asset}-USD`;
  const rows = await db
    .select({
      id: paperTrades.id,
      botKey: paperTrades.botKey,
      decidedAt: paperTrades.decidedAt,
      windowStart: paperTrades.windowStart,
      pair: paperTrades.pair,
      horizonMin: paperTrades.horizonMin,
      side: paperTrades.side,
      pSignal: paperTrades.pSignal,
      askPaid: paperTrades.askPaid,
      edgeAsk: paperTrades.edgeAsk,
      sizeUsd: paperTrades.sizeUsd,
      status: paperTrades.status,
      pnlUsd: paperTrades.pnlUsd,
    })
    .from(paperTrades)
    .where(and(
      eq(paperTrades.pair, pair),
      eq(paperTrades.horizonMin, input.horizonMin),
      scopeCondition,
    ))
    .orderBy(desc(paperTrades.decidedAt))
    .limit(limit);
  return rows.map((trade) => ({
    id: trade.id,
    at: trade.decidedAt.getTime(),
    bot: trade.botKey,
    pair: trade.pair,
    horizonMin: trade.horizonMin,
    windowStart: trade.windowStart.getTime(),
    side: trade.side,
    p: trade.pSignal,
    ask: trade.askPaid,
    edge: trade.edgeAsk,
    size: trade.sizeUsd,
    status: trade.status,
    pnl: trade.pnlUsd,
  }));
}

/** Uncached authoritative floor snapshot. Public callers use the short coalescing cache below. */
async function loadFloorState() {
  const winnerProfitHaircut = PAPER_ACCOUNTING.profitStress.winnerProfitHaircut;
  const now = Date.now();
  const currentChicagoDay = paperDailyLedgerDayKey(now);
  // Drizzle's timestamp columns are PostgreSQL `timestamp without time zone` values containing UTC
  // wall-clock fields. Attach UTC first, then project into Chicago before deriving a calendar day.
  const chicagoGradedDay = sql`(
    (${paperTrades.gradedAt} at time zone 'UTC')
    at time zone ${PAPER_DAILY_LEDGER.timeZone}
  )::date`;
  const paperFloorStart = new Date(PAPER_ENGINE_V3_START_MS);
  const gateFloorStart = new Date(PAPER_GATE.evalStartMs);
  // Both display scopes use compact aggregates. The forward scope is authoritative; all-history is
  // explicitly exploratory and restores access to burned rows without ever feeding the gate.
  const summaryQuery = (condition: SQL) => db
      .select({
        botKey: paperTrades.botKey,
        pair: paperTrades.pair,
        horizonMin: paperTrades.horizonMin,
        status: paperTrades.status,
        n: sql<number>`count(*)::int`,
        pnl: sql<number>`coalesce(sum(${paperTrades.pnlUsd}), 0)::double precision`,
        size: sql<number>`coalesce(sum(${paperTrades.sizeUsd}), 0)::double precision`,
        todayN: sql<number>`count(*) filter (
          where ${chicagoGradedDay} = ${currentChicagoDay}::date
        )::int`,
        todayPnl: sql<number>`coalesce(sum(${paperTrades.pnlUsd}) filter (
          where ${chicagoGradedDay} = ${currentChicagoDay}::date
        ), 0)::double precision`,
        lastDecision: sql<Date | string>`max(${paperTrades.decidedAt})`,
      })
      .from(paperTrades)
      .where(condition)
      .groupBy(paperTrades.botKey, paperTrades.pair, paperTrades.horizonMin, paperTrades.status);
  const equityQuery = (condition: SQL) => db
      .select({
        botKey: paperTrades.botKey,
        bucket: sql<Date | string>`date_bin('5 minutes', ${paperTrades.gradedAt}, timestamp '1970-01-01')`,
        rawDelta: sql<number>`coalesce(sum(${paperTrades.pnlUsd}), 0)::double precision`,
        profitStressDelta: sql<number>`coalesce(sum(case when ${paperTrades.status} = 'won' then ${paperTrades.pnlUsd} * ${1 - winnerProfitHaircut} else ${paperTrades.pnlUsd} end), 0)::double precision`,
      })
      .from(paperTrades)
      .where(and(
        condition,
        inArray(paperTrades.status, ["won", "lost"]),
        isNotNull(paperTrades.gradedAt),
      ))
      .groupBy(paperTrades.botKey, sql`date_bin('5 minutes', ${paperTrades.gradedAt}, timestamp '1970-01-01')`)
      .orderBy(asc(sql`date_bin('5 minutes', ${paperTrades.gradedAt}, timestamp '1970-01-01')`), asc(paperTrades.botKey));
  const totalQuery = (condition: SQL) => db.select({ n: sql<number>`count(*)::int` }).from(paperTrades).where(condition);
  const fadeReference = alias(paperTrades, "fade_reference");
  // Same-market side agreement exposes correlated hypotheses without treating them as independent
  // evidence. This is descriptive only and never feeds the gate.
  const overlapQuery = (condition: SQL) => db
    .select({
      botKey: paperTrades.botKey,
      shared: sql<number>`count(*)::int`,
      sameSide: sql<number>`count(*) filter (where ${paperTrades.side} = ${fadeReference.side})::int`,
      gradedShared: sql<number>`count(*) filter (
        where ${paperTrades.status} in ('won', 'lost')
          and ${fadeReference.status} in ('won', 'lost')
      )::int`,
    })
    .from(paperTrades)
    .innerJoin(
      fadeReference,
      and(
        eq(fadeReference.conditionId, paperTrades.conditionId),
        eq(fadeReference.botKey, "fade"),
      ),
    )
    .where(and(condition, ne(paperTrades.botKey, "fade")))
    .groupBy(paperTrades.botKey);
  const paperCondition = gte(paperTrades.windowStart, paperFloorStart);
  const forwardCondition = gte(paperTrades.windowStart, gateFloorStart);
  const historyCondition = sql`true`;
  /**
   * One scan produces every scope's Chicago-calendar realized RAW ledger. A row belongs to its
   * decision scope by window_start, while the calendar day is assigned at graded_at—the instant
   * binary P&L becomes realized. This remains descriptive and never enters a verdict calculation.
   */
  const dailyLedgerQuery = () => db.execute(sql`
    with graded as (
      select
        ${paperTrades.botKey} as bot_key,
        ${paperTrades.pair} as pair,
        ${paperTrades.horizonMin} as horizon_min,
        ${paperTrades.windowStart} as window_start,
        (
          (${paperTrades.gradedAt} at time zone 'UTC')
          at time zone ${PAPER_DAILY_LEDGER.timeZone}
        )::date as calendar_day,
        ${paperTrades.pnlUsd} as pnl_usd
      from ${paperTrades}
      where ${paperTrades.status} in ('won', 'lost')
        and ${paperTrades.gradedAt} is not null
        and ${paperTrades.pnlUsd} is not null
    ),
    scoped as (
      select
        scope_name,
        bot_key,
        pair,
        horizon_min,
        calendar_day,
        pnl_usd
      from graded
      cross join lateral (
        values
          ('history'::text, true),
          ('forward'::text, window_start >= ${gateFloorStart}),
          ('paper'::text, window_start >= ${paperFloorStart})
      ) as scope(scope_name, included)
      where included
    )
    select
      scope_name,
      bot_key,
      pair,
      horizon_min,
      calendar_day::text as day,
      count(*)::int as n,
      coalesce(sum(pnl_usd), 0)::double precision as raw
    from scoped
    group by scope_name, bot_key, pair, horizon_min, calendar_day
    order by calendar_day, bot_key, pair, horizon_min, scope_name
  `);
  /**
   * One outcome observation per market, sourced from the universal Always Down control. Using the
   * control avoids multiplying a market by every strategy that happened to enter it, and the
   * (bot_key, condition_id) unique index keeps this to one indexed aggregate rather than another
   * feed or a full cross-bot deduplication pass.
   *
   * Because the control always takes DOWN, a lost control row means the market resolved UP.
   * This is descriptive UI context only; it never enters a bot decision or the verdict gate.
   */
  const marketTapeQuery = () => db.execute(sql`
    with control as (
      select
        ${paperTrades.pair} as pair,
        ${paperTrades.horizonMin} as horizon_min,
        ${paperTrades.windowStart} as window_start,
        ${paperTrades.status} as status
      from ${paperTrades}
      where ${paperTrades.botKey} = 'drift'
        and ${paperTrades.status} in ('won', 'lost')
    ),
    scoped as (
      select
        scope_name,
        pair,
        horizon_min,
        status
      from control
      cross join lateral (
        values
          ('history'::text, true),
          ('forward'::text, window_start >= ${gateFloorStart}),
          ('paper'::text, window_start >= ${paperFloorStart})
      ) as scope(scope_name, included)
      where included
    )
    select
      scope_name,
      pair,
      horizon_min,
      count(*)::int as n,
      count(*) filter (where status = 'lost')::int as up
    from scoped
    group by scope_name, pair, horizon_min
  `);
  const [
    paperSummary,
    paperEquity,
    paperTotal,
    paperOverlap,
    forwardSummary,
    forwardEquity,
    forwardTotal,
    forwardOverlap,
    historySummary,
    historyEquity,
    historyTotal,
    historyOverlap,
    feedRows,
    gateLedger,
    macroLatest,
    macroStateRows,
    macroCoverageRows,
    dailyLedgerResult,
    marketTapeResult,
    runtimeHeartbeat,
    v1SourceHealth,
    v1SignalTally,
    smoothPathFunnelRows,
  ] = await Promise.all([
    summaryQuery(paperCondition),
    equityQuery(paperCondition),
    totalQuery(paperCondition),
    overlapQuery(paperCondition),
    summaryQuery(forwardCondition),
    equityQuery(forwardCondition),
    totalQuery(forwardCondition),
    overlapQuery(forwardCondition),
    summaryQuery(historyCondition),
    equityQuery(historyCondition),
    totalQuery(historyCondition),
    overlapQuery(historyCondition),
    db.select().from(paperTrades).orderBy(desc(paperTrades.decidedAt)).limit(60),
    db
      .select({
        id: paperTrades.id,
        botKey: paperTrades.botKey,
        conditionId: paperTrades.conditionId,
        pair: paperTrades.pair,
        horizonMin: paperTrades.horizonMin,
        windowStart: paperTrades.windowStart,
        decidedAt: paperTrades.decidedAt,
        side: paperTrades.side,
        askPaid: paperTrades.askPaid,
        controlAskPaid: paperTrades.controlAskPaid,
        modelMeta: paperTrades.modelMeta,
        status: paperTrades.status,
      })
      .from(paperTrades)
      .where(gte(paperTrades.windowStart, new Date(PAPER_GATE.evalStartMs))),
    db
      .select()
      .from(macroBreadthSnapshots)
      .where(eq(macroBreadthSnapshots.version, MACRO_BREADTH_ROUTER.version))
      .orderBy(desc(macroBreadthSnapshots.barStart))
      .limit(1),
    db
      .select({
        state: macroBreadthSnapshots.state,
        bars: sql<number>`count(*)::int`,
        observedWindows: sql<number>`coalesce(sum(${macroBreadthSnapshots.observedWindows}), 0)::int`,
        qualifiedDecisions: sql<number>`coalesce(sum(${macroBreadthSnapshots.qualifiedDecisions}), 0)::int`,
        placedRows: sql<number>`coalesce(sum(${macroBreadthSnapshots.placedRows}), 0)::int`,
      })
      .from(macroBreadthSnapshots)
      .where(eq(macroBreadthSnapshots.version, MACRO_BREADTH_ROUTER.version))
      .groupBy(macroBreadthSnapshots.state),
    db.execute<{
      horizon_min: number;
      eligible_rows: number;
      available_rows: number;
      aligned_rows: number;
      unavailable_rows: number;
      up_rows: number;
      down_rows: number;
      range_rows: number;
      neutral_rows: number;
      expected_rows: number;
      placed_rows: number;
      missing_rows: number;
      unexpected_rows: number;
    }>(sql`
      with parents as (
        select
          condition_id,
          window_start,
          horizon_min,
          (model_meta->'macroDirectionCoverage'->>'available')::boolean as available,
          (model_meta->'macroDirectionCoverage'->>'causalAligned')::boolean as causal_aligned,
          model_meta->'macroDirectionCoverage'->>'state' as macro_state,
          model_meta->'macroDirectionCoverage'->>'expectedChildKey' as expected_child_key
        from paper_trade
        where bot_key = ${MACRO_DIRECTION_COVERAGE.denominatorBotKey}
          and window_start >= ${new Date(MACRO_DIRECTION_COVERAGE.evalStartMs)}
          and model_meta->'macroDirectionCoverage'->>'version'
            = ${MACRO_DIRECTION_COVERAGE.version}
      ),
      children as (
        select condition_id, window_start, horizon_min, bot_key
        from paper_trade
        where bot_key in (
          ${MACRO_DIRECTION_CONTROLS.upBotKey},
          ${MACRO_DIRECTION_CONTROLS.downBotKey}
        )
          and window_start >= ${new Date(MACRO_DIRECTION_COVERAGE.evalStartMs)}
      )
      select
        horizon.horizon_min,
        count(parent.condition_id)::int as eligible_rows,
        count(parent.condition_id) filter (where parent.available)::int as available_rows,
        count(parent.condition_id) filter (where parent.causal_aligned)::int as aligned_rows,
        count(parent.condition_id) filter (where not parent.available)::int as unavailable_rows,
        count(parent.condition_id) filter (where parent.macro_state = 'up')::int as up_rows,
        count(parent.condition_id) filter (where parent.macro_state = 'down')::int as down_rows,
        count(parent.condition_id) filter (where parent.macro_state = 'range')::int as range_rows,
        count(parent.condition_id) filter (where parent.macro_state = 'neutral')::int as neutral_rows,
        count(parent.condition_id) filter (
          where parent.expected_child_key is not null
        )::int as expected_rows,
        count(child.condition_id) filter (
          where parent.expected_child_key is not null
        )::int as placed_rows,
        (
          count(parent.condition_id) filter (
            where parent.expected_child_key is not null
          )
          - count(child.condition_id) filter (
            where parent.expected_child_key is not null
          )
        )::int as missing_rows,
        (
          select count(*)::int
          from children candidate
          left join parents denominator
            on denominator.condition_id = candidate.condition_id
            and denominator.window_start = candidate.window_start
            and denominator.horizon_min = candidate.horizon_min
          where candidate.horizon_min = horizon.horizon_min
            and denominator.expected_child_key is distinct from candidate.bot_key
        ) as unexpected_rows
      from (values (5), (15)) as horizon(horizon_min)
      left join parents parent
        on parent.horizon_min = horizon.horizon_min
      left join children child
        on child.condition_id = parent.condition_id
        and child.window_start = parent.window_start
        and child.horizon_min = parent.horizon_min
        and child.bot_key = parent.expected_child_key
      group by horizon.horizon_min
      order by horizon.horizon_min
    `).then((result) => result.rows),
    dailyLedgerQuery(),
    marketTapeQuery(),
    readPaperFloorRuntimeHeartbeat(undefined, now),
    readV1SignalSourceHealth(now),
    db
      .select({
        rows: sql<number>`count(*)::int`,
        lastSignal: sql<Date | null>`max(${signalSnapshots.capturedAt})`,
      })
      .from(signalSnapshots)
      .where(eq(signalSnapshots.source, V1_SOURCE)),
    db
      .select({
        botKey: polymarketSmoothPathFunnel.botKey,
        eligibleRows: sql<number>`count(*)::int`,
        observedRows:
          sql<number>`count(*) filter (where ${polymarketSmoothPathFunnel.observed})::int`,
        pathQualifiedRows:
          sql<number>`count(*) filter (where ${polymarketSmoothPathFunnel.pathQualified})::int`,
        bookQualifiedRows:
          sql<number>`count(*) filter (where ${polymarketSmoothPathFunnel.bookQualified})::int`,
        placedRows:
          sql<number>`count(*) filter (where ${polymarketSmoothPathFunnel.placed})::int`,
        lastCapturedAt: sql<Date | null>`max(${polymarketSmoothPathFunnel.capturedAt})`,
      })
      .from(polymarketSmoothPathFunnel)
      .groupBy(polymarketSmoothPathFunnel.botKey),
  ]);
  const num = (value: number | string | null | undefined) => Number(value ?? 0);
  const timeMs = (value: Date | string) => value instanceof Date ? value.getTime() : new Date(value).getTime();
  type MarketTapeRow = {
    scope_name: string;
    pair: string;
    horizon_min: number | string;
    n: number | string;
    up: number | string;
  };
  type DailyLedgerRow = {
    scope_name: string;
    bot_key: string;
    pair: string;
    horizon_min: number | string;
    day: string;
    n: number | string;
    raw: number | string;
  };
  const dailyLedgerRows = dailyLedgerResult.rows as DailyLedgerRow[];
  const marketTapeRows = marketTapeResult.rows as MarketTapeRow[];
  const v1Tally = v1SignalTally[0];
  const v1Activity = buildJesterV1PaperBotActivity(v1SourceHealth, {
    rows: v1Tally?.rows ?? 0,
    lastSignalAtMs: v1Tally?.lastSignal ? timeMs(v1Tally.lastSignal) : null,
  }, now);
  const activityByBot = new Map<string, PaperBotActivity>([
    ["fadeV1", v1Activity],
    ["followV1", v1Activity],
  ]);
  for (const row of smoothPathFunnelRows) {
    activityByBot.set(row.botKey, buildSmoothPathPaperBotActivity({
      ...row,
      lastCapturedAtMs: row.lastCapturedAt ? timeMs(row.lastCapturedAt) : null,
    }, now));
  }
  const globalControlRows = historySummary.filter((row) => row.botKey === "drift");
  const globalControlLastDecision = globalControlRows.length
    ? Math.max(...globalControlRows.map((row) => timeMs(row.lastDecision)))
    : null;
  const globalEngineHeartbeatAgoSec = runtimeHeartbeat?.ageSec
    ?? (
      globalControlLastDecision
        ? Math.max(0, (now - globalControlLastDecision) / 1_000)
        : null
    );
  const buildScope = (
    scopeName: "paper" | "forward" | "history",
    summaryRows: typeof forwardSummary,
    equityBuckets: typeof forwardEquity,
    totalRows: typeof forwardTotal,
    overlapRows: typeof forwardOverlap,
  ) => {
    const bots = PAPER_BOTS.map((b) => {
      const mine = summaryRows.filter((row) => row.botKey === b.key);
      const graded = mine.filter((row) => row.status === "won" || row.status === "lost");
      const open = mine.filter((row) => row.status === "open");
      const pnl = (rows: typeof mine) => rows.reduce((sum, row) => sum + num(row.pnl), 0);
      const profitStress = graded.reduce(
        (sum, row) =>
          sum + (row.status === "won"
            ? num(row.pnl) * (1 - winnerProfitHaircut)
            : num(row.pnl)),
        0,
      );
      const lastDecision = mine.length ? Math.max(...mine.map((row) => timeMs(row.lastDecision))) : null;
      const overlap = overlapRows.find((row) => row.botKey === b.key);
      const keyOf = (row: { pair: string; horizonMin: number }) => `${row.pair}|${row.horizonMin}`;
      const registeredBucketKeys = paperBotBucketUniverse(b).map(keyOf);
      const buckets = [...new Set([...registeredBucketKeys, ...mine.map(keyOf)])]
        .map((key) => {
          const [pair, hStr] = key.split("|");
          const horizonMin = Number(hStr);
          const hs = graded.filter((row) => row.pair === pair && row.horizonMin === horizonMin);
          return {
            pair,
            horizonMin,
            n: hs.reduce((sum, row) => sum + num(row.n), 0),
            wins: hs.filter((row) => row.status === "won").reduce((sum, row) => sum + num(row.n), 0),
            pnl: pnl(hs),
            openNow: open.filter((row) => row.pair === pair && row.horizonMin === horizonMin).reduce((sum, row) => sum + num(row.n), 0),
          };
        })
        .sort((a, b) => b.n - a.n || b.openNow - a.openNow);
      return {
        key: b.key, name: b.name, color: b.color,
        activity: activityByBot.get(b.key) ?? null,
        tradesToday: graded.reduce((sum, row) => sum + num(row.todayN), 0),
        pnlToday: graded.reduce((sum, row) => sum + num(row.todayPnl), 0),
        openNow: open.reduce((sum, row) => sum + num(row.n), 0),
        openUsd: open.reduce((sum, row) => sum + num(row.size), 0),
        wins: graded.filter((row) => row.status === "won").reduce((sum, row) => sum + num(row.n), 0),
        losses: graded.filter((row) => row.status === "lost").reduce((sum, row) => sum + num(row.n), 0),
        pnlAll: pnl(graded), profitStressAll: profitStress, buckets,
        lastDecisionAgoSec: lastDecision ? Math.round((now - lastDecision) / 1000) : null,
        engineHeartbeatAgoSec:
          globalEngineHeartbeatAgoSec == null ? null : Math.round(globalEngineHeartbeatAgoSec),
        overlapVsFade: overlap ? {
          shared: num(overlap.shared),
          sameSide: num(overlap.sameSide),
          gradedShared: num(overlap.gradedShared),
          agreement: num(overlap.shared) ? num(overlap.sameSide) / num(overlap.shared) : null,
        } : null,
      };
    });

    // One equity point per bot/five-minute grade bucket bounds response size over a long run.
    const cumulative = new Map<string, { raw: number; profitStress: number }>();
    const equity = equityBuckets.map((row) => {
      const current = cumulative.get(row.botKey) ?? { raw: 0, profitStress: 0 };
      current.raw += num(row.rawDelta);
      current.profitStress += num(row.profitStressDelta);
      cumulative.set(row.botKey, { ...current });
      return {
        t: timeMs(row.bucket),
        bot: row.botKey,
        raw: current.raw,
        profitStress: current.profitStress,
      };
    });

    const segCell = () => ({ n: 0, w: 0, pnl: 0 });
    const byPair = new Map<string, ReturnType<typeof segCell>>();
    const byHorizon = new Map<string, ReturnType<typeof segCell>>();
    for (const row of summaryRows.filter((item) => item.status === "won" || item.status === "lost")) {
      const kp = `${row.botKey}|${row.pair}`, kh = `${row.botKey}|${row.horizonMin}`;
      const cp = byPair.get(kp) ?? segCell();
      cp.n += num(row.n); if (row.status === "won") cp.w += num(row.n); cp.pnl += num(row.pnl); byPair.set(kp, cp);
      const ch = byHorizon.get(kh) ?? segCell();
      ch.n += num(row.n); if (row.status === "won") ch.w += num(row.n); ch.pnl += num(row.pnl); byHorizon.set(kh, ch);
    }
    const segments = {
      pairs: [...new Set(summaryRows.map((row) => row.pair))].sort(),
      horizons: [...new Set(summaryRows.map((row) => row.horizonMin))].sort((a, b) => a - b),
      byPair: [...byPair.entries()].map(([key, value]) => { const [bot, pair] = key.split("|"); return { bot, pair, ...value }; }),
      byHorizon: [...byHorizon.entries()].map(([key, value]) => { const [bot, horizon] = key.split("|"); return { bot, horizonMin: Number(horizon), ...value }; }),
    };

    type Combo = {
      botKey: string;
      pair: string;
      horizonMin: number;
      n: number;
      wins: number;
      pnl: number;
      profitStress: number;
      openNow: number;
      openUsd: number;
      todayN: number;
      todayPnl: number;
      lastDecisionAtMs: number | null;
    };
    const comboMap = new Map<string, Combo>();
    for (const row of summaryRows) {
      const key = `${row.botKey}|${row.pair}|${row.horizonMin}`;
      const combo = comboMap.get(key) ?? {
        botKey: row.botKey,
        pair: row.pair,
        horizonMin: row.horizonMin,
        n: 0,
        wins: 0,
        pnl: 0,
        profitStress: 0,
        openNow: 0,
        openUsd: 0,
        todayN: 0,
        todayPnl: 0,
        lastDecisionAtMs: null,
      };
      combo.lastDecisionAtMs = Math.max(
        combo.lastDecisionAtMs ?? Number.NEGATIVE_INFINITY,
        timeMs(row.lastDecision),
      );
      if (row.status === "won" || row.status === "lost") {
        combo.n += num(row.n);
        combo.todayN += num(row.todayN);
        combo.todayPnl += num(row.todayPnl);
        if (row.status === "won") {
          combo.wins += num(row.n);
          combo.pnl += num(row.pnl);
          combo.profitStress += num(row.pnl) * (1 - winnerProfitHaircut);
        } else {
          combo.pnl += num(row.pnl);
          combo.profitStress += num(row.pnl);
        }
      } else if (row.status === "open") {
        combo.openNow += num(row.n);
        combo.openUsd += num(row.size);
      }
      comboMap.set(key, combo);
    }
    const combos = [...comboMap.values()].map((combo) => ({
      ...combo,
      avg: combo.n ? combo.pnl / combo.n : 0,
      winRate: combo.n ? combo.wins / combo.n : null,
      lastDecisionAgoSec: combo.lastDecisionAtMs == null
        ? null
        : Math.max(0, Math.round((now - combo.lastDecisionAtMs) / 1_000)),
    }));
    const tapeByBucket = new Map(
      marketTapeRows
        .filter((row) => row.scope_name === scopeName)
        .map((row) => [`${row.pair}|${Number(row.horizon_min)}`, row] as const),
    );
    const assetTape = MACRO_BREADTH_ROUTER.targetPairs.flatMap((pair) =>
      MACRO_BREADTH_ROUTER.eligibleHorizonsMin.map((horizonMin) => {
        const row = tapeByBucket.get(`${pair}|${horizonMin}`);
        const n = num(row?.n);
        const up = num(row?.up);
        return { pair, horizonMin, n, up, down: Math.max(0, n - up) };
      }),
    );
    const dailyLedger = {
      version: PAPER_DAILY_LEDGER.version,
      timeZone: PAPER_DAILY_LEDGER.timeZone,
      attributionClock: PAPER_DAILY_LEDGER.attributionClock,
      defaultVisibleDays: PAPER_DAILY_LEDGER.defaultVisibleDays,
      rangeOptions: [...PAPER_DAILY_LEDGER.rangeOptions],
      completedDayReviewFloor: PAPER_DAILY_LEDGER.completedDayReviewFloor,
      reviewPolicy: PAPER_DAILY_LEDGER.reviewPolicy,
      currentDay: currentChicagoDay,
      rows: dailyLedgerRows
        .filter((row) => row.scope_name === scopeName)
        .map((row) => ({
          botKey: row.bot_key,
          pair: row.pair,
          horizonMin: Number(row.horizon_min),
          day: row.day,
          n: num(row.n),
          raw: num(row.raw),
        })),
    };
    return {
      bots,
      equity,
      segments,
      combos,
      assetTape,
      dailyLedger,
      total: num(totalRows[0]?.n),
    };
  };

  const paper = buildScope("paper", paperSummary, paperEquity, paperTotal, paperOverlap);
  const forward = buildScope("forward", forwardSummary, forwardEquity, forwardTotal, forwardOverlap);
  const history = buildScope("history", historySummary, historyEquity, historyTotal, historyOverlap);
  const historyFeed = feedRows.map((t) => ({
    id: t.id, at: t.decidedAt.getTime(), bot: t.botKey, pair: t.pair, horizonMin: t.horizonMin,
    windowStart: t.windowStart.getTime(),
    side: t.side, p: t.pSignal, ask: t.askPaid, edge: t.edgeAsk, size: t.sizeUsd,
    status: t.status, pnl: t.pnlUsd,
  }));
  const paperFeed = historyFeed.filter((trade) => trade.windowStart >= PAPER_ENGINE_V3_START_MS);
  const forwardFeed = historyFeed.filter((trade) => trade.windowStart >= PAPER_GATE.evalStartMs);
  const mappedGateLedger = gateLedger.map((trade) => ({
    id: trade.id,
    botKey: trade.botKey,
    conditionId: trade.conditionId,
    pair: trade.pair,
    horizonMin: trade.horizonMin,
    windowStartMs: trade.windowStart.getTime(),
    decidedAtMs: trade.decidedAt.getTime(),
    side: trade.side,
    askPaid: trade.askPaid,
    controlAskPaid: trade.controlAskPaid,
    oppositeAskPaid: macroDirectionOppositeAsk(trade.side, trade.modelMeta),
    status: trade.status,
  }));
  const gate = computePaperGate(
    mappedGateLedger,
    PAPER_BOTS.map((bot) => ({
      key: bot.key,
      name: bot.name,
      evalStartMs: bot.evalStartMs,
      control: bot.key === "drift",
      eligible: bot.eligible,
    })),
  );
  const timeframeGateBots: PaperTimeframeGateBot[] = PAPER_BOTS
    .filter((bot) => bot.key !== "drift")
    .flatMap((bot) =>
      [...new Set(
        paperBotBucketUniverse(bot)
          .map((bucket) => bucket.horizonMin)
          .filter((horizonMin): horizonMin is 5 | 15 => horizonMin === 5 || horizonMin === 15),
      )].map((horizonMin) => ({
        key: paperTimeframeGateKey(bot.key, horizonMin),
        sourceKey: bot.key,
        horizonMin,
        name: `${bot.name} · ${horizonMin}m`,
        evalStartMs: bot.evalStartMs,
        eligible: (context: { pair?: string; horizonMin: number; decidedAtMs: number }) =>
          context.horizonMin === horizonMin && (bot.eligible?.(context) ?? true),
      }))
    );
  const timeframeGate = computePaperTimeframeGate(
    mappedGateLedger,
    timeframeGateBots,
  );
  const macroDirectionGate = computeMacroDirectionVerdictGate(mappedGateLedger);
  const timeframeGateBotByKey = new Map(timeframeGateBots.map((bot) => [bot.key, bot]));
  const familywiseGateBots = PAPER_FAMILYWISE_HYPOTHESES.map((key) => {
    const bot = timeframeGateBotByKey.get(key);
    if (!bot) throw new Error(`familywise gate roster is missing ${key}`);
    return bot;
  });
  const familywiseOrdinary = computePaperTimeframeGate(
    mappedGateLedger,
    familywiseGateBots,
    now,
    PAPER_FAMILYWISE_GATE,
  );
  const familywiseMacro = computeMacroDirectionVerdictGate(
    mappedGateLedger,
    now,
    PAPER_FAMILYWISE_GATE,
  );
  const familywiseGate = applyPaperFamilywiseGate(
    familywiseOrdinary.bots,
    familywiseMacro.bots,
    now,
  );
  const latestMacro = macroLatest[0];
  const latestMacroLiveAgeSec = latestMacro
    ? (now - latestMacro.barEnd.getTime()) / 1_000
    : null;
  const latestMacroFresh = latestMacro
    ? macroBreadthCompletedBarFresh(latestMacro.barEnd.getTime(), now)
    : false;
  const macroStateSummary = {
    up: { bars: 0, observedWindows: 0, qualifiedDecisions: 0, placedRows: 0 },
    down: { bars: 0, observedWindows: 0, qualifiedDecisions: 0, placedRows: 0 },
    range: { bars: 0, observedWindows: 0, qualifiedDecisions: 0, placedRows: 0 },
    neutral: { bars: 0, observedWindows: 0, qualifiedDecisions: 0, placedRows: 0 },
  };
  for (const row of macroStateRows) {
    if (!(row.state in macroStateSummary)) continue;
    macroStateSummary[row.state as keyof typeof macroStateSummary] = {
      bars: num(row.bars),
      observedWindows: num(row.observedWindows),
      qualifiedDecisions: num(row.qualifiedDecisions),
      placedRows: num(row.placedRows),
    };
  }
  const macroCoverageHorizons = macroCoverageRows.map((row) => ({
    horizonMin: num(row.horizon_min),
    eligibleRows: num(row.eligible_rows),
    availableRows: num(row.available_rows),
    alignedRows: num(row.aligned_rows),
    unavailableRows: num(row.unavailable_rows),
    stateRows: {
      up: num(row.up_rows),
      down: num(row.down_rows),
      range: num(row.range_rows),
      neutral: num(row.neutral_rows),
    },
    expectedRows: num(row.expected_rows),
    placedRows: num(row.placed_rows),
    missingRows: num(row.missing_rows),
    unexpectedRows: num(row.unexpected_rows),
  }));
  const macroCoverageOverall = macroCoverageHorizons.reduce(
    (total, row) => ({
      eligibleRows: total.eligibleRows + row.eligibleRows,
      availableRows: total.availableRows + row.availableRows,
      alignedRows: total.alignedRows + row.alignedRows,
      unavailableRows: total.unavailableRows + row.unavailableRows,
      expectedRows: total.expectedRows + row.expectedRows,
      placedRows: total.placedRows + row.placedRows,
      missingRows: total.missingRows + row.missingRows,
      unexpectedRows: total.unexpectedRows + row.unexpectedRows,
    }),
    {
      eligibleRows: 0,
      availableRows: 0,
      alignedRows: 0,
      unavailableRows: 0,
      expectedRows: 0,
      placedRows: 0,
      missingRows: 0,
      unexpectedRows: 0,
    },
  );

  return {
    ...forward,
    accounting: PAPER_ACCOUNTING,
    feed: forwardFeed,
    gate,
    timeframeGate,
    macroDirectionGate,
    familywiseGate,
    macroDirectionCoverage: {
      version: MACRO_DIRECTION_COVERAGE.version,
      evalStartMs: MACRO_DIRECTION_COVERAGE.evalStartMs,
      horizons: macroCoverageHorizons,
      overall: macroCoverageOverall,
    },
    engineRuntime: runtimeHeartbeat ?? {
      version: PAPER_FLOOR_RUNTIME_HEARTBEAT.version,
      source: "decision-fallback" as const,
      status: null,
      startedAtMs: null,
      observedAtMs: null,
      ageSec: globalEngineHeartbeatAgoSec,
      fresh: false,
    },
    scopes: {
      paper: { ...paper, feed: paperFeed, label: "Current paper", fromMs: PAPER_ENGINE_V3_START_MS, authoritative: false },
      forward: { ...forward, feed: forwardFeed, label: "Forward / gate cohort", fromMs: PAPER_GATE.evalStartMs, authoritative: true },
      history: { ...history, feed: historyFeed, label: "All history", fromMs: null, authoritative: false },
    },
    macroLeader: latestMacro ? {
      version: latestMacro.version,
      state: latestMacro.state as MacroBreadthObservation["state"],
      liveState: latestMacroFresh
        ? latestMacro.state as MacroBreadthObservation["state"]
        : null,
      fresh: latestMacroFresh,
      evalStartMs: MACRO_BREADTH_ROUTER.evalStartMs,
      barStartMs: latestMacro.barStart.getTime(),
      barEndMs: latestMacro.barEnd.getTime(),
      capturedAtMs: latestMacro.capturedAt.getTime(),
      sourceAgeAtCaptureSec: latestMacro.sourceAgeSec,
      liveAgeSec: Math.max(0, latestMacroLiveAgeSec ?? 0),
      cmoByAnchor: {
        "BTC-USD": latestMacro.btcCmo,
        "ETH-USD": latestMacro.ethCmo,
        "SOL-USD": latestMacro.solCmo,
      },
      medianCmo: latestMacro.medianCmo,
      medianAbsCmo: latestMacro.medianAbsCmo,
      eligibleWindows: latestMacro.eligibleWindows,
      observedWindows: latestMacro.observedWindows,
      qualifiedDecisions: latestMacro.qualifiedDecisions,
      placedRows: latestMacro.placedRows,
      stateSummary: macroStateSummary,
    } : {
      version: MACRO_BREADTH_ROUTER.version,
      state: null,
      liveState: null,
      fresh: false,
      evalStartMs: MACRO_BREADTH_ROUTER.evalStartMs,
      stateSummary: macroStateSummary,
    },
    enabled: await paperFloorEnabled(),
  };
}

/**
 * The floor snapshot is cumulative and read-only, while every UI consumer polls at 30 seconds or
 * slower. Coalesce concurrent consumers and bound duplicate aggregate/gate work without changing
 * the paper collector, ledger, or any frozen verdict boundary.
 */
const readFloorState = createAsyncTtlCache(10_000, loadFloorState);

export function floorState() {
  return readFloorState();
}
