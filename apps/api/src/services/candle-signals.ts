/**
 * Candle-computed directional signals — book/literature/GitHub-mined mechanical rules computed from
 * Hyperliquid 1m candles aggregated to 5m bars. No Jester calls, no logger, evaluated fresh at each
 * floor tick.
 *
 * #7 sweepReclaim — the Williams "Specialists' Trap" / Connors "Turtle Soup" convergence:
 *     price sweeps the prior 20-bar extreme (which must be ≥4 bars old), fails to hold, and the
 *     live price has RECLAIMED back through it → fade the failed breakout (mean-reversion at
 *     liquidity — a different axis from every momentum bot on the floor).
 * #8 rocPivot — Connors Street Smarts Ch.8 2-period ROC pivot:
 *     pivot = close[t−1] + (close[t] − close[t−2]); long above, short below, natively a bar-close
 *     directional state. Bridged continuously: P(up) = N((S − pivot)/ATR).
 *
 * REGISTERED CONSTANTS (gate v1 amendment — change = re-registration):
 */
import type { HlCandle } from "./hyperliquid.ts";
import { normCdf } from "./pricer.ts";

export const SWEEP = {
  lookbackBars: 20, // the prior extreme window (5m bars)
  minExtremeAgeBars: 4, // Connors: prior extreme must be ≥4 bars before the sweep (else it's momentum)
  sweepWindowBars: 3, // the sweep must have happened within the last 3 completed bars
  pupLong: 0.75, // fixed event bridge (matches the V1 convention)
  pupShort: 0.25,
} as const;

export const ROCPIVOT = {
  atrBars: 20, // ATR = mean |close-to-close| move over this many completed 5m bars
  clampLo: 0.05,
  clampHi: 0.95,
} as const;

/** KB updown-bollinger-mfi-v1 — preregistered before implementation. */
export const BOLLINGER_MFI = {
  evalStartMs: 1_784_779_200_000, // 2026-07-23 04:00:00 UTC
  bandBars: 20,
  bandStdDev: 2,
  mfiBars: 10,
  longPercentB: 0.8,
  longMfi: 80,
  shortPercentB: 0.2,
  shortMfi: 20,
  pupLong: 0.75,
  pupShort: 0.25,
} as const;

/** KB updown-td9-perfected-exhaustion-v1 — preregistered before implementation. */
export const TD9_EXHAUSTION = {
  evalStartMs: 1_784_784_600_000, // 2026-07-23 05:30:00 UTC
  setupBars: 9,
  compareLagBars: 4,
  pupLong: 0.75,
  pupShort: 0.25,
} as const;

/** KB updown-stoch-adx-snapback-v1 — preregistered before implementation. */
export const STOCH_ADX_SNAPBACK = {
  evalStartMs: 1_784_790_000_000, // 2026-07-23 07:00:00 UTC
  emaBars: 5,
  fastKBars: 5,
  fastDBars: 3,
  adxBars: 14,
  oversold: 25,
  overbought: 75,
  minAdx: 25,
  pupLong: 0.75,
  pupShort: 0.25,
  eligibleHorizonsMin: [5, 15],
} as const;

/** KB updown-id-nr4-breakout-v1 — preregistered before implementation. */
export const ID_NR4_BREAKOUT = {
  evalStartMs: 1_784_795_400_000, // 2026-07-23 08:30:00 UTC
  setupBars: 4,
  barMs: 5 * 60_000,
  maxSpotAgeSec: 90,
  pupLong: 0.75,
  pupShort: 0.25,
  eligibleHorizonsMin: [5],
} as const;

export interface Bar5m { t: number; o: number; h: number; l: number; c: number; v?: number }

/** Aggregate 1m candles to COMPLETED 5m bars (incomplete trailing group dropped). */
export function aggregate5m(oneMin: HlCandle[]): Bar5m[] {
  const groups = new Map<number, HlCandle[]>();
  for (const c of oneMin) {
    const g = Math.floor(c.t / 300_000) * 300_000;
    const arr = groups.get(g) ?? [];
    arr.push(c); groups.set(g, arr);
  }
  const out: Bar5m[] = [];
  for (const [g, cs] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    // Require the five exact constituent minute slots. A duplicate candle must not make a partial
    // group look complete, and a missing minute must fail closed instead of distorting OHLCV/MFI.
    const minuteSlots = new Set(cs.map((c) => Math.floor(c.t / 60_000) * 60_000));
    if (
      minuteSlots.size !== 5
      || !Array.from({ length: 5 }, (_, i) => g + i * 60_000).every((slot) => minuteSlots.has(slot))
    ) continue;
    cs.sort((a, b) => a.t - b.t);
    out.push({
      t: g,
      o: cs[0].o,
      h: Math.max(...cs.map((c) => c.h)),
      l: Math.min(...cs.map((c) => c.l)),
      c: cs[cs.length - 1].c,
      v: cs.reduce((sum, c) => sum + c.v, 0),
    });
  }
  return out;
}

/**
 * Sweep-reclaim: null when no pattern (the bot abstains). Long: some bar in the last
 * `sweepWindowBars` traded below the prior 20-bar low (that low ≥4 bars old) AND the live price is
 * back above it. Short mirror. Conflicting signals → null.
 */
export function sweepReclaimPup(bars: Bar5m[], S: number): number | null {
  const n = bars.length;
  if (n < SWEEP.lookbackBars + SWEEP.sweepWindowBars + 1 || S <= 0) return null;
  const j = n - 1; // latest completed bar
  const winStart = j - SWEEP.sweepWindowBars + 1; // sweep candidates: bars[winStart..j]
  const priorLo = bars.slice(winStart - SWEEP.lookbackBars, winStart);
  const priorHi = priorLo;
  const L20 = Math.min(...priorLo.map((b) => b.l));
  const H20 = Math.max(...priorHi.map((b) => b.h));
  const idxL = winStart - SWEEP.lookbackBars + priorLo.findIndex((b) => b.l === L20);
  const idxH = winStart - SWEEP.lookbackBars + priorHi.findIndex((b) => b.h === H20);
  const recent = bars.slice(winStart);
  const sweptLow = recent.some((b) => b.l < L20) && winStart - idxL >= SWEEP.minExtremeAgeBars;
  const sweptHigh = recent.some((b) => b.h > H20) && winStart - idxH >= SWEEP.minExtremeAgeBars;
  const longSig = sweptLow && S > L20; // swept below the old low, now reclaimed above it
  const shortSig = sweptHigh && S < H20;
  if (longSig && !shortSig) return SWEEP.pupLong;
  if (shortSig && !longSig) return SWEEP.pupShort;
  return null;
}

/** 2-period ROC pivot: continuous P(up) = N((S − pivot)/ATR). Null only on insufficient bars. */
export function rocPivotPup(bars: Bar5m[], S: number): number | null {
  const n = bars.length;
  if (n < ROCPIVOT.atrBars + 3 || S <= 0) return null;
  const c = (i: number) => bars[n - 1 - i].c; // c(0) = latest completed close
  const pivot = c(1) + (c(0) - c(2));
  let atr = 0;
  for (let i = 0; i < ROCPIVOT.atrBars; i++) atr += Math.abs(c(i) - c(i + 1));
  atr = Math.max(atr / ROCPIVOT.atrBars, S * 1e-6);
  return Math.min(ROCPIVOT.clampHi, Math.max(ROCPIVOT.clampLo, normCdf((S - pivot) / atr)));
}

export interface BollingerMfiSignal {
  pup: number;
  percentB: number;
  mfi: number;
  close: number;
  middle: number;
  upper: number;
  lower: number;
  completedBarAt: number;
}

/**
 * Bollinger Method II, frozen in KB updown-bollinger-mfi-v1. All inputs are completed 5m bars:
 * 20-period ±2σ bands plus 10-period MFI confirmation. No signal means the bot abstains.
 */
export function bollingerMfiSignal(bars: Bar5m[]): BollingerMfiSignal | null {
  const n = bars.length;
  if (n < BOLLINGER_MFI.bandBars || n < BOLLINGER_MFI.mfiBars + 1) return null;

  const bandWindow = bars.slice(n - BOLLINGER_MFI.bandBars);
  const middle = bandWindow.reduce((sum, b) => sum + b.c, 0) / BOLLINGER_MFI.bandBars;
  const variance = bandWindow.reduce((sum, b) => sum + (b.c - middle) ** 2, 0) / BOLLINGER_MFI.bandBars;
  const sigma = Math.sqrt(variance);
  const upper = middle + BOLLINGER_MFI.bandStdDev * sigma;
  const lower = middle - BOLLINGER_MFI.bandStdDev * sigma;
  const width = upper - lower;
  if (!Number.isFinite(width) || width <= Math.max(1e-12, Math.abs(middle) * 1e-12)) return null;

  const close = bars[n - 1].c;
  const percentB = (close - lower) / width;
  let positiveFlow = 0;
  let negativeFlow = 0;
  for (let i = n - BOLLINGER_MFI.mfiBars; i < n; i++) {
    const typical = (bars[i].h + bars[i].l + bars[i].c) / 3;
    const previousTypical = (bars[i - 1].h + bars[i - 1].l + bars[i - 1].c) / 3;
    const flow = typical * (bars[i].v ?? Number.NaN);
    if (!Number.isFinite(flow) || flow < 0) return null;
    if (typical > previousTypical) positiveFlow += flow;
    else if (typical < previousTypical) negativeFlow += flow;
  }
  const mfi =
    positiveFlow === 0 && negativeFlow === 0 ? 50
    : negativeFlow === 0 ? 100
    : positiveFlow === 0 ? 0
    : 100 - 100 / (1 + positiveFlow / negativeFlow);
  const pup =
    percentB > BOLLINGER_MFI.longPercentB && mfi > BOLLINGER_MFI.longMfi ? BOLLINGER_MFI.pupLong
    : percentB < BOLLINGER_MFI.shortPercentB && mfi < BOLLINGER_MFI.shortMfi ? BOLLINGER_MFI.pupShort
    : null;
  if (pup == null) return null;
  return { pup, percentB, mfi, close, middle, upper, lower, completedBarAt: bars[n - 1].t };
}

export interface Td9ExhaustionSignal {
  pup: number;
  direction: "long" | "short";
  setupCount: 9;
  perfected: true;
  completedBarAt: number;
}

/**
 * Perfected TD-9 exhaustion, frozen in KB updown-td9-perfected-exhaustion-v1.
 *
 * The source implementation defines perfection permissively: bar 8 OR 9 need only exceed bar 6 OR
 * 7. We preserve that exact OR relation, but emit only on the exact ninth completed bar so a long
 * continuation cannot create repeated "new" exhaustion events.
 */
export function td9ExhaustionSignal(bars: Bar5m[]): Td9ExhaustionSignal | null {
  const n = bars.length;
  const { setupBars, compareLagBars } = TD9_EXHAUSTION;
  // Nine comparisons plus the preceding comparison needed to prove this is count 9, not count 10+.
  if (n < setupBars + compareLagBars + 1) return null;

  const setupStart = n - setupBars;
  const longSetup = Array.from(
    { length: setupBars },
    (_, offset) => bars[setupStart + offset].c < bars[setupStart + offset - compareLagBars].c,
  ).every(Boolean);
  const shortSetup = Array.from(
    { length: setupBars },
    (_, offset) => bars[setupStart + offset].c > bars[setupStart + offset - compareLagBars].c,
  ).every(Boolean);
  const precedingIndex = setupStart - 1;
  const exactLong =
    longSetup && !(bars[precedingIndex].c < bars[precedingIndex - compareLagBars].c);
  const exactShort =
    shortSetup && !(bars[precedingIndex].c > bars[precedingIndex - compareLagBars].c);

  const setup = bars.slice(setupStart);
  const bars6And7 = [setup[5], setup[6]];
  const bars8And9 = [setup[7], setup[8]];
  const longPerfected = bars8And9.some((later) =>
    bars6And7.some((earlier) => later.l < earlier.l));
  const shortPerfected = bars8And9.some((later) =>
    bars6And7.some((earlier) => later.h > earlier.h));

  if (exactLong && longPerfected) {
    return {
      pup: TD9_EXHAUSTION.pupLong,
      direction: "long",
      setupCount: 9,
      perfected: true,
      completedBarAt: bars[n - 1].t,
    };
  }
  if (exactShort && shortPerfected) {
    return {
      pup: TD9_EXHAUSTION.pupShort,
      direction: "short",
      setupCount: 9,
      perfected: true,
      completedBarAt: bars[n - 1].t,
    };
  }
  return null;
}

export interface StochAdxSnapbackSignal {
  pup: number;
  direction: "long" | "short";
  fastK: number;
  fastD: number;
  adx: number;
  emaHigh: number;
  emaLow: number;
  completedBarAt: number;
}

export function stochAdxEligibleHorizon(horizonMin: number): boolean {
  return (STOCH_ADX_SNAPBACK.eligibleHorizonsMin as readonly number[]).includes(horizonMin);
}

/** SMA-seeded EMA, matching the frozen channel definition. */
function emaLatest(values: number[], period: number): number | null {
  if (values.length < period || values.some((value) => !Number.isFinite(value))) return null;
  let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const alpha = 2 / (period + 1);
  for (let i = period; i < values.length; i++) ema += alpha * (values[i] - ema);
  return ema;
}

function fastStochastic(bars: Bar5m[]) {
  const rawK: number[] = [];
  for (let i = STOCH_ADX_SNAPBACK.fastKBars - 1; i < bars.length; i++) {
    const window = bars.slice(i - STOCH_ADX_SNAPBACK.fastKBars + 1, i + 1);
    const highest = Math.max(...window.map((bar) => bar.h));
    const lowest = Math.min(...window.map((bar) => bar.l));
    const range = highest - lowest;
    if (!Number.isFinite(range) || range <= 0) return null;
    rawK.push(100 * (bars[i].c - lowest) / range);
  }
  if (rawK.length < STOCH_ADX_SNAPBACK.fastDBars + 1) return null;
  const dAt = (endExclusive: number) =>
    rawK.slice(endExclusive - STOCH_ADX_SNAPBACK.fastDBars, endExclusive)
      .reduce((sum, value) => sum + value, 0) / STOCH_ADX_SNAPBACK.fastDBars;
  return {
    currentK: rawK[rawK.length - 1],
    previousK: rawK[rawK.length - 2],
    currentD: dAt(rawK.length),
    previousD: dAt(rawK.length - 1),
  };
}

/** Wilder ADX(14), using completed OHLC bars only. */
function adxLatest(bars: Bar5m[], period: number): number | null {
  if (bars.length < 2 * period) return null;
  const tr: number[] = [], plusDm: number[] = [], minusDm: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const current = bars[i], previous = bars[i - 1];
    const upMove = current.h - previous.h;
    const downMove = previous.l - current.l;
    tr.push(Math.max(
      current.h - current.l,
      Math.abs(current.h - previous.c),
      Math.abs(current.l - previous.c),
    ));
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  if (tr.some((value) => !Number.isFinite(value) || value < 0)) return null;

  let smoothTr = tr.slice(0, period).reduce((sum, value) => sum + value, 0);
  let smoothPlus = plusDm.slice(0, period).reduce((sum, value) => sum + value, 0);
  let smoothMinus = minusDm.slice(0, period).reduce((sum, value) => sum + value, 0);
  const dx: number[] = [];
  const addDx = () => {
    if (smoothTr <= 0) return false;
    const plusDi = 100 * smoothPlus / smoothTr;
    const minusDi = 100 * smoothMinus / smoothTr;
    const denominator = plusDi + minusDi;
    dx.push(denominator > 0 ? 100 * Math.abs(plusDi - minusDi) / denominator : 0);
    return true;
  };
  if (!addDx()) return null;
  for (let i = period; i < tr.length; i++) {
    smoothTr = smoothTr - smoothTr / period + tr[i];
    smoothPlus = smoothPlus - smoothPlus / period + plusDm[i];
    smoothMinus = smoothMinus - smoothMinus / period + minusDm[i];
    if (!addDx()) return null;
  }
  if (dx.length < period) return null;
  let adx = dx.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let i = period; i < dx.length; i++) adx = ((period - 1) * adx + dx[i]) / period;
  return Number.isFinite(adx) ? adx : null;
}

/**
 * Fast-stochastic reversal from an EMA channel extreme, gated by Wilder ADX. The UP rule preserves
 * the source fragment's fixed thresholds; DOWN is its preregistered exact mirror.
 */
export function stochAdxSnapbackSignal(bars: Bar5m[]): StochAdxSnapbackSignal | null {
  if (bars.length < 2 * STOCH_ADX_SNAPBACK.adxBars) return null;
  const stochastic = fastStochastic(bars);
  const adx = adxLatest(bars, STOCH_ADX_SNAPBACK.adxBars);
  const emaHigh = emaLatest(bars.map((bar) => bar.h), STOCH_ADX_SNAPBACK.emaBars);
  const emaLow = emaLatest(bars.map((bar) => bar.l), STOCH_ADX_SNAPBACK.emaBars);
  if (!stochastic || adx == null || emaHigh == null || emaLow == null) return null;
  const latest = bars[bars.length - 1];
  const crossedUp =
    stochastic.previousK <= stochastic.previousD && stochastic.currentK > stochastic.currentD;
  const crossedDown =
    stochastic.previousK >= stochastic.previousD && stochastic.currentK < stochastic.currentD;
  const long =
    latest.o < emaLow
    && crossedUp
    && stochastic.currentK < STOCH_ADX_SNAPBACK.oversold
    && stochastic.currentD < STOCH_ADX_SNAPBACK.oversold
    && adx > STOCH_ADX_SNAPBACK.minAdx;
  const short =
    latest.o > emaHigh
    && crossedDown
    && stochastic.currentK > STOCH_ADX_SNAPBACK.overbought
    && stochastic.currentD > STOCH_ADX_SNAPBACK.overbought
    && adx > STOCH_ADX_SNAPBACK.minAdx;
  if (long === short) return null;
  return {
    pup: long ? STOCH_ADX_SNAPBACK.pupLong : STOCH_ADX_SNAPBACK.pupShort,
    direction: long ? "long" : "short",
    fastK: stochastic.currentK,
    fastD: stochastic.currentD,
    adx,
    emaHigh,
    emaLow,
    completedBarAt: latest.t,
  };
}

export interface IdNr4BreakoutSignal {
  pup: number;
  direction: "long" | "short";
  setupHigh: number;
  setupLow: number;
  setupRange: number;
  spot: number;
  spotAgeSec: number;
  completedBarAt: number;
  nextWindowStartMs: number;
}

export function idNr4BreakoutEligibleHorizon(horizonMin: number): boolean {
  return (ID_NR4_BREAKOUT.eligibleHorizonsMin as readonly number[]).includes(horizonMin);
}

/**
 * Immediate-next-bar ID/NR4 breakout from Street Smarts chapter 19.
 *
 * The setup is strict (inside equality and narrow-range ties abstain), the four bars must be
 * contiguous, and a valid setup expires after exactly one UTC-aligned five-minute window.
 */
export function idNr4BreakoutSignal(
  bars: Bar5m[],
  spot: number,
  spotAtMs: number,
  nowMs: number,
): IdNr4BreakoutSignal | null {
  if (
    bars.length < ID_NR4_BREAKOUT.setupBars
    || !Number.isFinite(spot)
    || spot <= 0
    || !Number.isFinite(spotAtMs)
    || !Number.isFinite(nowMs)
  ) return null;

  const spotAgeSec = (nowMs - spotAtMs) / 1_000;
  if (spotAgeSec < 0 || spotAgeSec > ID_NR4_BREAKOUT.maxSpotAgeSec) return null;

  const setup = bars.slice(-ID_NR4_BREAKOUT.setupBars);
  if (setup.some((bar, index) =>
    ![bar.t, bar.o, bar.h, bar.l, bar.c].every(Number.isFinite)
    || bar.h < bar.l
    || (index > 0 && bar.t - setup[index - 1].t !== ID_NR4_BREAKOUT.barMs)
  )) return null;

  const latest = setup[setup.length - 1];
  const previous = setup[setup.length - 2];
  const nextWindowStartMs = Math.floor(nowMs / ID_NR4_BREAKOUT.barMs) * ID_NR4_BREAKOUT.barMs;
  if (latest.t + ID_NR4_BREAKOUT.barMs !== nextWindowStartMs) return null;

  const ranges = setup.map((bar) => bar.h - bar.l);
  const latestRange = ranges[ranges.length - 1];
  const strictInside = latest.h < previous.h && latest.l > previous.l;
  const strictNr4 = latestRange > 0
    && ranges.slice(0, -1).every((range) => latestRange < range);
  if (!strictInside || !strictNr4) return null;

  const long = spot > latest.h;
  const short = spot < latest.l;
  if (long === short) return null;
  return {
    pup: long ? ID_NR4_BREAKOUT.pupLong : ID_NR4_BREAKOUT.pupShort,
    direction: long ? "long" : "short",
    setupHigh: latest.h,
    setupLow: latest.l,
    setupRange: latestRange,
    spot,
    spotAgeSec,
    completedBarAt: latest.t,
    nextWindowStartMs,
  };
}
