/**
 * Preregistered, outcome-blind crypto macro context for Polymarket Up/Down paper strategies.
 *
 * KB: updown-macro-breadth-router-v1
 * PAPER ONLY — this module classifies completed public candles and returns hypothetical decisions.
 */
import type { Bar5m } from "./candle-signals.ts";

export const MACRO_BREADTH_ROUTER = {
  version: "updown-macro-breadth-router-v1",
  evalStartMs: 1_784_829_600_000, // 2026-07-23 18:00:00 UTC
  anchors: ["BTC-USD", "ETH-USD", "SOL-USD"],
  targetPairs: ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD", "BNB-USD"],
  eligibleHorizonsMin: [5, 15],
  cmoBars: 14,
  trendCmo: 0.30,
  rangeAbsCmo: 0.10,
  rangeLocalAbsCmo: 0.20,
  barMs: 5 * 60_000,
  maxCompletedBarAgeSec: 120,
  selectedSideProbability: 0.65,
  askEdge: 0.05,
  minFill: 0.02,
  maxFill: 0.98,
} as const;

export type MacroAnchor = (typeof MACRO_BREADTH_ROUTER.anchors)[number];
export type MacroBreadthState = "up" | "down" | "range" | "neutral";
export type MacroSleeve = "trend" | "range" | "router";

export interface MacroBreadthObservation {
  version: typeof MACRO_BREADTH_ROUTER.version;
  state: MacroBreadthState;
  cmoByAnchor: Record<MacroAnchor, number>;
  medianCmo: number;
  medianAbsCmo: number;
  asOfMs: number;
  completedAtMs: number;
  ageSec: number;
}

export interface MacroPaperDecision {
  side: "up" | "down";
  pup: number;
  selectedAsk: number;
  controlAsk: number;
  edgeAsk: number;
}

/** The same fail-closed completed-bar freshness predicate used by trading and status surfaces. */
export function macroBreadthCompletedBarFresh(
  completedAtMs: number,
  nowMs: number,
): boolean {
  if (!Number.isFinite(completedAtMs) || !Number.isFinite(nowMs)) return false;
  const ageSec = (nowMs - completedAtMs) / 1_000;
  return ageSec >= 0 && ageSec <= MACRO_BREADTH_ROUTER.maxCompletedBarAgeSec;
}

/** Chande Momentum Oscillator on exactly the latest frozen lookback. */
export function cmo14(bars: readonly Bar5m[]): number | null {
  if (bars.length < MACRO_BREADTH_ROUTER.cmoBars + 1) return null;
  const closes = bars.slice(-(MACRO_BREADTH_ROUTER.cmoBars + 1));
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < closes.length; i++) {
    const previous = closes[i - 1]?.c;
    const current = closes[i]?.c;
    if (!Number.isFinite(previous) || !Number.isFinite(current)) return null;
    const change = current - previous;
    if (change > 0) gains += change;
    else losses -= change;
  }
  const movement = gains + losses;
  return movement > 0 ? (gains - losses) / movement : 0;
}

/**
 * Classify a synchronized completed-bar snapshot. Any missing, stale, future, or desynchronized
 * anchor fails closed rather than silently substituting a partial breadth vote.
 */
export function macroBreadthObservation(
  anchorBars: Partial<Record<MacroAnchor, readonly Bar5m[]>>,
  nowMs: number,
): MacroBreadthObservation | null {
  const latestStarts: number[] = [];
  const cmoByAnchor = {} as Record<MacroAnchor, number>;
  for (const anchor of MACRO_BREADTH_ROUTER.anchors) {
    const bars = anchorBars[anchor];
    if (!bars || bars.length < MACRO_BREADTH_ROUTER.cmoBars + 1) return null;
    const latest = bars[bars.length - 1];
    const cmo = cmo14(bars);
    if (!latest || cmo == null || !Number.isFinite(latest.t)) return null;
    latestStarts.push(latest.t);
    cmoByAnchor[anchor] = cmo;
  }
  if (!latestStarts.every((value) => value === latestStarts[0])) return null;

  const asOfMs = latestStarts[0]!;
  const completedAtMs = asOfMs + MACRO_BREADTH_ROUTER.barMs;
  const ageSec = (nowMs - completedAtMs) / 1_000;
  if (!macroBreadthCompletedBarFresh(completedAtMs, nowMs)) return null;

  const cmos = MACRO_BREADTH_ROUTER.anchors.map((anchor) => cmoByAnchor[anchor]);
  const sorted = [...cmos].sort((a, b) => a - b);
  const absSorted = cmos.map(Math.abs).sort((a, b) => a - b);
  const medianCmo = sorted[1]!;
  const medianAbsCmo = absSorted[1]!;
  const upVotes = cmos.filter((value) => value >= MACRO_BREADTH_ROUTER.trendCmo).length;
  const downVotes = cmos.filter((value) => value <= -MACRO_BREADTH_ROUTER.trendCmo).length;
  const rangeVotes = cmos.filter((value) => Math.abs(value) <= MACRO_BREADTH_ROUTER.rangeAbsCmo).length;
  const state: MacroBreadthState =
    upVotes >= 2 && medianCmo >= MACRO_BREADTH_ROUTER.trendCmo ? "up"
    : downVotes >= 2 && medianCmo <= -MACRO_BREADTH_ROUTER.trendCmo ? "down"
    : rangeVotes >= 2 && medianAbsCmo <= MACRO_BREADTH_ROUTER.rangeAbsCmo ? "range"
    : "neutral";

  return {
    version: MACRO_BREADTH_ROUTER.version,
    state,
    cmoByAnchor,
    medianCmo,
    medianAbsCmo,
    asOfMs,
    completedAtMs,
    ageSec,
  };
}

/** Fixed P(up) bridge for the three independently scored macro sleeves. */
export function macroSleevePup(
  sleeve: MacroSleeve,
  observation: MacroBreadthObservation | null,
  localCmo: number | null,
): number | null {
  if (!observation) return null;
  if (sleeve === "trend" || sleeve === "router") {
    if (observation.state === "up") return MACRO_BREADTH_ROUTER.selectedSideProbability;
    if (observation.state === "down") return 1 - MACRO_BREADTH_ROUTER.selectedSideProbability;
    if (sleeve === "trend") return null;
  }
  if (
    (sleeve === "range" || sleeve === "router")
    && observation.state === "range"
    && localCmo != null
    && Math.abs(localCmo) >= MACRO_BREADTH_ROUTER.rangeLocalAbsCmo
  ) {
    return localCmo < 0
      ? MACRO_BREADTH_ROUTER.selectedSideProbability
      : 1 - MACRO_BREADTH_ROUTER.selectedSideProbability;
  }
  return null;
}

/** Apply the frozen fee-adjusted real-ask rule to a macro sleeve's fixed probability. */
export function macroPaperDecision(
  pup: number | null,
  upFill: number,
  downFill: number,
): MacroPaperDecision | null {
  if (
    pup == null
    || !Number.isFinite(upFill)
    || !Number.isFinite(downFill)
    || upFill <= MACRO_BREADTH_ROUTER.minFill
    || upFill >= MACRO_BREADTH_ROUTER.maxFill
    || downFill <= MACRO_BREADTH_ROUTER.minFill
    || downFill >= MACRO_BREADTH_ROUTER.maxFill
  ) return null;
  const side = pup > 0.5 ? "up" : pup < 0.5 ? "down" : null;
  if (!side) return null;
  const selectedAsk = side === "up" ? upFill : downFill;
  const pSide = side === "up" ? pup : 1 - pup;
  // Compare the fill to the derived ceiling so an exact 0.60 boundary cannot pass because of
  // binary floating-point representation of 0.65 - 0.60.
  if (!(selectedAsk < pSide - MACRO_BREADTH_ROUTER.askEdge)) return null;
  const edgeAsk = pSide - selectedAsk;
  return { side, pup, selectedAsk, controlAsk: downFill, edgeAsk };
}

export function macroTargetEligible(pair: string, horizonMin: number): boolean {
  return (
    MACRO_BREADTH_ROUTER.targetPairs.includes(pair as (typeof MACRO_BREADTH_ROUTER.targetPairs)[number])
    && MACRO_BREADTH_ROUTER.eligibleHorizonsMin.includes(
      horizonMin as (typeof MACRO_BREADTH_ROUTER.eligibleHorizonsMin)[number],
    )
  );
}
