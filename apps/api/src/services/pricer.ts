/**
 * Fair-value digital pricer — tournament bots #6a/#6b (KB: updown-digital-fair-value-pricer).
 *
 * An Up/Down market is a cash-or-nothing digital option: strike K = price at window start, maturity
 * τ = minutes remaining, payout $1. Two registered models price it from Hyperliquid 1m candles:
 *   pricerBSM: P(up) = N(d2), d2 = [ln(S/K) − σ²τ/2]/(σ√τ)  (Hilpisch Ch.5 vanilla machinery → digital)
 *   pricerMC:  bootstrap Monte Carlo — resample ACTUAL recent 1m log returns for τ steps; inherits
 *              crypto's fat tails with zero calibration (BSM underprices the wings at short horizons).
 * Running both answers the fat-tail question empirically: their divergence IS the wing correction.
 *
 * REGISTERED CONSTANTS (gate v1 amendment — changing any = re-registration):
 *   vol: EWMA λ=0.94 (RiskMetrics) over the last ≤240 1m log returns, ≥60 required, per-minute σ,
 *        floored at 0.0001 (1bp/min) so a dead tape can't fabricate certainty.
 *   MC: 4000 paths, steps = max(1, round(τ_min)), sampling with replacement from the same returns.
 *   Entry: ANY time in-window with ≥60s remaining (mid-window is where stale-quote edge lives);
 *          edge measured vs the ASK: bet up if P − upAsk > 0.08, down if (1−P) − downAsk > 0.08.
 *          One bet per bot per market (first tick that clears).
 * Known caveat: S and K both come from Hyperliquid (coherent ratio); Polymarket resolves on its own
 * oracle, so a hair of resolution-source noise is absorbed into the sample. Read-only, paper only.
 */

export const PRICER = {
  volLambda: 0.94,
  volMaxBars: 240,
  volMinBars: 60,
  volFloorPerMin: 0.0001,
  mcPaths: 4000,
  minRemainingSec: 60,
  askEdge: 0.08,
} as const;

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 via erf; |err| < 1.5e-7). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp((-x * x) / 2);
  return x >= 0 ? 0.5 + y / 2 : 0.5 - y / 2;
}

/** Log returns from a close series (chronological). */
export function logReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > 0 && closes[i - 1] > 0) out.push(Math.log(closes[i] / closes[i - 1]));
  }
  return out;
}

/** EWMA (RiskMetrics) per-bar volatility of the given returns; null if too few bars. */
export function ewmaVol(returns: number[]): number | null {
  const rs = returns.slice(-PRICER.volMaxBars);
  if (rs.length < PRICER.volMinBars) return null;
  // Iterate oldest→newest: σ²_t = λσ²_{t−1} + (1−λ)r²_t, seeded with the simple variance.
  let v = rs.reduce((a, r) => a + r * r, 0) / rs.length;
  for (const r of rs) v = PRICER.volLambda * v + (1 - PRICER.volLambda) * r * r;
  return Math.max(Math.sqrt(v), PRICER.volFloorPerMin);
}

/** BSM digital fair value: P(S_τ > K) with zero drift. σ is PER-MINUTE, τ in minutes. */
export function digitalPupBSM(S: number, K: number, sigmaPerMin: number, tauMin: number): number {
  if (S <= 0 || K <= 0 || tauMin <= 0) return 0.5;
  const sT = sigmaPerMin * Math.sqrt(tauMin);
  const d2 = (Math.log(S / K) - (sigmaPerMin * sigmaPerMin * tauMin) / 2) / sT;
  return Math.min(0.995, Math.max(0.005, normCdf(d2)));
}

/** Bootstrap-MC digital fair value: resample actual 1m returns for τ steps, count up-finishes.
 * Returns are DE-MEANED first (registered; the book's moment-matching idea): otherwise the bootstrap
 * inherits the recent sample mean as drift and the pricer silently becomes a momentum bet. De-meaned,
 * it prices pure diffusion with REAL kurtosis — its divergence from N(d2) isolates the fat-tail effect. */
export function digitalPupMC(S: number, K: number, returns: number[], tauMin: number): number | null {
  const raw = returns.slice(-PRICER.volMaxBars);
  if (raw.length < PRICER.volMinBars || S <= 0 || K <= 0 || tauMin <= 0) return null;
  const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
  const rs = raw.map((r) => r - mean);
  const steps = Math.max(1, Math.round(tauMin));
  const logK = Math.log(K / S); // path wins for "up" when Σ sampled returns > ln(K/S)
  let ups = 0;
  for (let p = 0; p < PRICER.mcPaths; p++) {
    let sum = 0;
    for (let s = 0; s < steps; s++) sum += rs[(Math.random() * rs.length) | 0];
    if (sum > logK) ups++;
  }
  return Math.min(0.995, Math.max(0.005, ups / PRICER.mcPaths));
}

/** The strike: close of the last 1m candle at/before the window start. Null if history doesn't cover it. */
export function strikeAt(candles: { t: number; c: number }[], windowStartMs: number): number | null {
  let k: number | null = null;
  for (const c of candles) {
    if (c.t <= windowStartMs) k = c.c;
    else break;
  }
  return k;
}
