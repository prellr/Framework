/**
 * Prospective, paper-only child of the bootstrap-MC digital pricer.
 *
 * The hypothesis was selected after viewing one-day diagnostic segment outcomes. Every row before
 * this later boundary is therefore contaminated and permanently excluded. The child changes only
 * eligibility: 5m markets whose latest completed-bar market-regime-v1 label is exactly `trend`.
 * Pricing, side selection, fee-adjusted real-ask edge, size, and same-tick DOWN control are inherited
 * unchanged from the parent.
 */
import type { MarketRegime } from "./market-regime.ts";
import { MARKET_REGIME_V1 } from "./market-regime.ts";
import { PRICER } from "./pricer.ts";

export const PRICER_MC_5M_TREND = {
  version: "updown-pricer-mc-5m-trend-v1",
  evalStartMs: Date.parse("2026-07-24T05:00:00.000Z"),
  parentKey: "pricerMC",
  parentVersion: "bootstrap-mc-v1",
  horizonMin: 5,
  regimeVersion: MARKET_REGIME_V1.version,
  regimeLabel: "trend",
  askEdge: PRICER.askEdge,
} as const;

export function pricerMc5mTrendEligible(horizonMin: number): boolean {
  return horizonMin === PRICER_MC_5M_TREND.horizonMin;
}

export function pricerMc5mTrendQualified(
  regime: MarketRegime | null,
): boolean {
  return (
    regime?.version === PRICER_MC_5M_TREND.regimeVersion
    && regime.label === PRICER_MC_5M_TREND.regimeLabel
  );
}
