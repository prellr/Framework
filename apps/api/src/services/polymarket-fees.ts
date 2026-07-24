import type { ClobBook, ClobMarketInfo } from "./polymarket.ts";

/** Frozen paper-fill implementation registered in KB updown-verdict-gate-v3. */
export const PAPER_FILL_VERSION = "fee-adjusted-total-budget-v1";

export interface TakerFeeDescriptor {
  rate: number;
  exponent: number;
  takerOnly: true;
}

export interface FeeAdjustedAskFill {
  version: typeof PAPER_FILL_VERSION;
  totalBudgetUsd: number;
  shares: number;
  grossCostUsd: number;
  feeUsd: number;
  totalCostUsd: number;
  grossVwap: number;
  effectiveVwap: number;
  levelsConsumed: number;
}

/**
 * Normalize the current CLOB-v2 wire descriptor. The v3 paper engine handles taker-only curves;
 * missing, malformed, or differently-scoped descriptors fail closed instead of assuming zero fees.
 */
export function takerFeeDescriptor(info: ClobMarketInfo | null | undefined): TakerFeeDescriptor | null {
  const rate = Number(info?.fd?.r);
  const exponent = Number(info?.fd?.e);
  if (
    !Number.isFinite(rate)
    || rate < 0
    || !Number.isFinite(exponent)
    || exponent <= 0
    || info?.fd?.to !== true
  ) return null;
  return { rate, exponent, takerOnly: true };
}

/**
 * Buy asks against a fixed TOTAL dollar budget, including the captured taker fee at every level.
 *
 * fee/share = rate × [p × (1-p)]^exponent
 *
 * The partial final level is sized by its effective unit cost, so gross cost + fee equals the
 * requested budget. This differs from the legacy gross-only `fillAskUsd`, which bought $5 of tokens
 * and omitted the additional taker fee.
 */
export function fillAskTotalUsd(
  book: ClobBook,
  totalBudgetUsd: number,
  fee: TakerFeeDescriptor,
): FeeAdjustedAskFill | null {
  if (
    !Number.isFinite(totalBudgetUsd)
    || totalBudgetUsd <= 0
    || !Number.isFinite(fee.rate)
    || fee.rate < 0
    || !Number.isFinite(fee.exponent)
    || fee.exponent <= 0
    || fee.takerOnly !== true
  ) return null;

  const rawAsks = book.asks ?? [];
  if (!rawAsks.length) return null;
  const asks = rawAsks.map((level) => ({
    price: Number(level.price),
    shares: Number(level.size),
  }));
  if (asks.some((level) => (
    !Number.isFinite(level.price)
    || level.price <= 0
    || level.price >= 1
    || !Number.isFinite(level.shares)
    || level.shares <= 0
  ))) return null;
  asks.sort((a, b) => a.price - b.price);

  let remainingUsd = totalBudgetUsd;
  let shares = 0;
  let grossCostUsd = 0;
  let feeUsd = 0;
  let levelsConsumed = 0;
  for (const level of asks) {
    const feePerShare = fee.rate * Math.pow(level.price * (1 - level.price), fee.exponent);
    const effectiveUnitCost = level.price + feePerShare;
    if (!Number.isFinite(effectiveUnitCost) || effectiveUnitCost <= 0) return null;

    const availableCost = level.shares * effectiveUnitCost;
    const spend = Math.min(remainingUsd, availableCost);
    const takeShares = spend / effectiveUnitCost;
    if (!(takeShares > 0)) continue;

    shares += takeShares;
    grossCostUsd += takeShares * level.price;
    feeUsd += takeShares * feePerShare;
    remainingUsd -= spend;
    levelsConsumed++;
    if (remainingUsd <= 1e-9) {
      remainingUsd = 0;
      break;
    }
  }

  if (remainingUsd > 1e-9 || shares <= 0) return null;
  const totalCostUsd = grossCostUsd + feeUsd;
  if (Math.abs(totalCostUsd - totalBudgetUsd) > 1e-8) return null;
  return {
    version: PAPER_FILL_VERSION,
    totalBudgetUsd,
    shares,
    grossCostUsd,
    feeUsd,
    totalCostUsd,
    grossVwap: grossCostUsd / shares,
    effectiveVwap: totalCostUsd / shares,
    levelsConsumed,
  };
}
