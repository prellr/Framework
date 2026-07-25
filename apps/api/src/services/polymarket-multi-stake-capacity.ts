/**
 * Prospective, outcome-blind liquidity-capacity tape for Polymarket Up/Down markets.
 *
 * The state collector already fetches one public UP book and one public DOWN book per market-minute
 * for its $5 fill. This contract walks those same in-memory books at $10 and $20. It adds no request,
 * socket, account access, decision, paper trade, verdict input, or execution capability.
 */
import { fillAskTotalUsd, type TakerFeeDescriptor } from "./polymarket-fees.ts";
import type { ClobBook } from "./polymarket.ts";

export const POLYMARKET_MULTI_STAKE_CAPACITY = {
  version: "polymarket-multi-stake-capacity-v1",
  evalStartMs: Date.UTC(2026, 6, 25, 22, 0, 0),
  modeledStakeUsd: [5, 10, 20] as const,
  capturedStakeUsd: [10, 20] as const,
  minMarkets: 1_500,
  minSpanDays: 7,
  minMarketsPerAssetTimeframe: 100,
  minCoverage: 0.9,
} as const;

export interface MultiStakeCapacityCapture {
  version: typeof POLYMARKET_MULTI_STAKE_CAPACITY.version;
  upFill10: number | null;
  downFill10: number | null;
  upFill20: number | null;
  downFill20: number | null;
}

function effectiveVwap(
  book: ClobBook,
  totalBudgetUsd: number,
  fee: TakerFeeDescriptor,
): number | null {
  return fillAskTotalUsd(book, totalBudgetUsd, fee)?.effectiveVwap ?? null;
}

/**
 * Walk both already-fetched books at the registered larger budgets.
 *
 * A capture remains version-tagged when only one budget or side has sufficient depth. Null is the
 * capacity observation for that particular side and stake; smaller successful walks are preserved.
 */
export function multiStakeCapacityCapture(
  upBook: ClobBook,
  downBook: ClobBook,
  capturedAtMs: number,
  fee: TakerFeeDescriptor | null,
): MultiStakeCapacityCapture | null {
  if (
    !Number.isFinite(capturedAtMs) ||
    capturedAtMs < POLYMARKET_MULTI_STAKE_CAPACITY.evalStartMs ||
    !fee
  )
    return null;

  return {
    version: POLYMARKET_MULTI_STAKE_CAPACITY.version,
    upFill10: effectiveVwap(upBook, 10, fee),
    downFill10: effectiveVwap(downBook, 10, fee),
    upFill20: effectiveVwap(upBook, 20, fee),
    downFill20: effectiveVwap(downBook, 20, fee),
  };
}

export function multiStakeCapacityReady(input: {
  markets: number;
  spanDays: number;
  coverage: number;
  minBucketMarkets: number;
}): boolean {
  return (
    input.markets >= POLYMARKET_MULTI_STAKE_CAPACITY.minMarkets &&
    input.spanDays >= POLYMARKET_MULTI_STAKE_CAPACITY.minSpanDays &&
    input.coverage >= POLYMARKET_MULTI_STAKE_CAPACITY.minCoverage &&
    input.minBucketMarkets >= POLYMARKET_MULTI_STAKE_CAPACITY.minMarketsPerAssetTimeframe
  );
}
