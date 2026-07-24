/**
 * Versioned fill semantics for the forward market-state tape.
 *
 * Rows before the v2 boundary keep the historical gross-budget book walk.
 * Rows at/after it use Gate v3's fee-adjusted $5 total-outlay model. The
 * boundary is the immutable version discriminator; history is never rewritten.
 */
import { fillAskUsd, type ClobBook } from "./polymarket.ts";
import {
  fillAskTotalUsd,
  type TakerFeeDescriptor,
} from "./polymarket-fees.ts";

export const STATE_TAPE_EXECUTION_V2 = {
  version: "polymarket-state-tape-fee-execution-v2",
  evalStartMs: Date.UTC(2026, 6, 23, 12, 0, 0),
  totalBudgetUsd: 5,
} as const;

export interface StateTapeBookFill {
  version: "legacy-gross-budget-v1" | "fee-adjusted-total-budget-v1";
  effectiveVwap: number;
  grossVwap: number;
  feeUsd: number;
  totalCostUsd: number;
}

export function stateTapeBookFill(
  book: ClobBook,
  capturedAtMs: number,
  fee: TakerFeeDescriptor | null,
): StateTapeBookFill | null {
  if (!Number.isFinite(capturedAtMs)) return null;
  if (capturedAtMs < STATE_TAPE_EXECUTION_V2.evalStartMs) {
    const vwap = fillAskUsd(book, STATE_TAPE_EXECUTION_V2.totalBudgetUsd);
    return vwap == null
      ? null
      : {
          version: "legacy-gross-budget-v1",
          effectiveVwap: vwap,
          grossVwap: vwap,
          feeUsd: 0,
          totalCostUsd: STATE_TAPE_EXECUTION_V2.totalBudgetUsd,
        };
  }
  if (!fee) return null;
  const fill = fillAskTotalUsd(book, STATE_TAPE_EXECUTION_V2.totalBudgetUsd, fee);
  return fill
    ? {
        version: fill.version,
        effectiveVwap: fill.effectiveVwap,
        grossVwap: fill.grossVwap,
        feeUsd: fill.feeUsd,
        totalCostUsd: fill.totalCostUsd,
      }
    : null;
}
