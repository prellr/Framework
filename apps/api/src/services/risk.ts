/**
 * Risk-of-account framing. The user sizes by RISK PER TRADE (default 2% of account lost if a trade
 * stops out), so results are most meaningful expressed in R-multiples and % of account rather than
 * the backtest's own sizing.
 *
 * With average loss ≈ 1R (a loser stops out at the risk unit), a strategy's per-trade expectancy in
 * R is (1 − winRate)(PF − 1) — derived from PF = (winRate/lossRate)·(avgWin/avgLoss). Total account
 * return over a period ≈ trades × E[R] × risk%.
 *
 * CAVEAT (load-bearing): this assumes losers lose about your per-trade risk. If a strategy's stops
 * are wider than your risk sizing, or it averages down so losers exceed 1R, this OVERSTATES the
 * result. It's an estimate for comparing strategies on a common risk basis, not a P&L guarantee —
 * the exact figure needs per-trade results Jester's backtest doesn't return (API report finding #7).
 */
import { getSetting } from "./config.ts";

export const DEFAULT_RISK_PER_TRADE_PCT = 2;

/** Global default risk-per-trade (% of account), editable via the RISK_PER_TRADE_PCT setting. */
export async function getRiskPerTrade(): Promise<number> {
  const v = parseFloat((await getSetting("RISK_PER_TRADE_PCT")) ?? "");
  return Number.isFinite(v) && v > 0 && v <= 100 ? v : DEFAULT_RISK_PER_TRADE_PCT;
}

/** Per-trade expectancy in R (assumes avg loss ≈ 1R). Null if win rate or PF is unknown. */
export function expectancyR(winRatePct: number | null, profitFactor: number | null): number | null {
  if (winRatePct == null || profitFactor == null || !Number.isFinite(profitFactor)) return null;
  return (1 - winRatePct / 100) * (profitFactor - 1);
}

/** Total R accumulated over a set of trades. */
export function totalR(winRatePct: number | null, profitFactor: number | null, trades: number | null): number | null {
  const e = expectancyR(winRatePct, profitFactor);
  return e == null || trades == null ? null : e * trades;
}

/** Estimated account return (%) at a given risk-per-trade: total R × risk%. */
export function accountReturnEstimate(
  winRatePct: number | null,
  profitFactor: number | null,
  trades: number | null,
  riskPct: number,
): number | null {
  const r = totalR(winRatePct, profitFactor, trades);
  return r == null ? null : r * riskPct;
}
