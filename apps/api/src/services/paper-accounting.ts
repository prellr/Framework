/**
 * Display-only accounting semantics for the Polymarket paper ledger.
 *
 * RAW P&L is the authoritative realized paper result: a fixed total USD outlay is converted into
 * contracts at the fee-adjusted depth-walk VWAP captured at decision time, then settled at $1/$0.
 *
 * The 36% scenario was copied from the Cobra dashboard as an intentionally harsh sensitivity
 * display. It removes 36% of positive profit while leaving losses unchanged. It is not calibrated
 * to Jester latency, slippage, fees, markouts, failed fills, or Polymarket settlement and therefore
 * must never be described as "worst-case" or used by a verdict gate.
 */
export const PAPER_ACCOUNTING = {
  version: "updown-paper-accounting-v1",
  raw: {
    version: "fee-adjusted-total-budget-v1",
    totalOutlayUsd: 5,
    settlement: "binary-$1-or-$0",
    authoritative: true,
  },
  profitStress: {
    version: "legacy-cobra-winner-profit-stress-v1",
    winnerProfitHaircut: 0.36,
    calibrated: false,
    verdictInput: false,
    executionModel: false,
  },
  conservativeComparison: {
    version: "same-tick-control-residual-v1",
    verdictInput: true,
  },
} as const;

export function legacyWinnerProfitStressPnl(
  status: string,
  pnlUsd: number,
): number {
  if (!Number.isFinite(pnlUsd)) return 0;
  return status === "won"
    ? pnlUsd * (1 - PAPER_ACCOUNTING.profitStress.winnerProfitHaircut)
    : pnlUsd;
}
