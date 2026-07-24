/**
 * Fixed trend/chop/compression classifier for the Up/Down paper tournament.
 *
 * It combines Chande's bounded momentum state with Crabel/Connors narrow-range compression. The
 * classifier is contextual only: it never emits a direction. Regime-conditioned bots remain
 * separate registered hypotheses so the ungated parent signals stay intact.
 */
import type { Bar5m } from "./candle-signals.ts";

export const MARKET_REGIME_V1 = {
  version: "market-regime-v1",
  cmoBars: 14,
  trendAbsCmo: 0.30,
  chopAbsCmo: 0.10,
  narrowRangeBars: 7,
  insideNarrowBars: 4,
} as const;

/** Clean forward boundary preregistered in KB updown-market-regime-v1. */
export const MARKET_REGIME_V1_START_MS = 1784774400000; // 2026-07-23 02:40:00.000 UTC

export type MarketRegimeLabel = "trend" | "chop" | "compression" | "neutral";

export interface MarketRegime {
  version: typeof MARKET_REGIME_V1.version;
  label: MarketRegimeLabel;
  cmo: number;
  absCmo: number;
  nr7: boolean;
  insideNr4: boolean;
  asOfMs: number;
}

/** Classify only from completed 5-minute bars; null means insufficient history. */
export function classifyMarketRegime(bars: Bar5m[]): MarketRegime | null {
  const need = Math.max(MARKET_REGIME_V1.cmoBars + 1, MARKET_REGIME_V1.narrowRangeBars);
  if (bars.length < need) return null;
  const recent = bars.slice(-need);

  let gains = 0, losses = 0;
  const cmoCloses = recent.slice(-(MARKET_REGIME_V1.cmoBars + 1));
  for (let i = 1; i < cmoCloses.length; i++) {
    const change = cmoCloses[i].c - cmoCloses[i - 1].c;
    if (change > 0) gains += change;
    else losses -= change;
  }
  const movement = gains + losses;
  const cmo = movement > 0 ? (gains - losses) / movement : 0;
  const absCmo = Math.abs(cmo);

  const ranges = recent.map((bar) => Math.max(0, bar.h - bar.l));
  const latestRange = ranges[ranges.length - 1];
  const nr7Ranges = ranges.slice(-MARKET_REGIME_V1.narrowRangeBars);
  const nr4Ranges = ranges.slice(-MARKET_REGIME_V1.insideNarrowBars);
  const latest = recent[recent.length - 1], previous = recent[recent.length - 2];
  const nr7 = latestRange < Math.min(...nr7Ranges.slice(0, -1));
  const inside = latest.h <= previous.h && latest.l >= previous.l;
  const insideNr4 = inside && latestRange < Math.min(...nr4Ranges.slice(0, -1));

  const label: MarketRegimeLabel = nr7 || insideNr4
    ? "compression"
    : absCmo >= MARKET_REGIME_V1.trendAbsCmo
      ? "trend"
      : absCmo <= MARKET_REGIME_V1.chopAbsCmo
        ? "chop"
        : "neutral";
  return { version: MARKET_REGIME_V1.version, label, cmo, absCmo, nr7, insideNr4, asOfMs: latest.t };
}
