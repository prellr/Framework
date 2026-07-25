/**
 * Frozen, outcome-free first-minute pressure plan for the chain-verified Polymarket trade tape.
 *
 * The private transform maps verified trades into canonical UP-probability space, aggregates them
 * to one row per market, and discloses unsigned magnitude/activity coordinates only. It is a
 * reference for validating live public-stream proxies; it is not assumed to be available on the
 * paper decision path.
 */
import { AUTHORITATIVE_TRADE_FLOW_TAPE } from "./polymarket-trade-flow-tape.ts";

const PAIRS = ["BNB-USD", "BTC-USD", "DOGE-USD", "ETH-USD", "SOL-USD", "XRP-USD"] as const;
const HORIZONS = [5, 15] as const;

export const AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT = {
  version: "updown-authoritative-taker-pressure-distribution-audit-v1",
  tapeVersion: AUTHORITATIVE_TRADE_FLOW_TAPE.version,
  evalStartMs: AUTHORITATIVE_TRADE_FLOW_TAPE.evalStartMs,
  observationWindowSec: 60,
  quantileProbabilities: [0.05, 0.25, 0.5, 0.75, 0.95] as const,
  cacheMs: 15 * 60_000,
  pairs: PAIRS,
  horizons: HORIZONS,
  dimensions: ["pair", "horizonMin"] as const,
  expectedBuckets: PAIRS.length * HORIZONS.length,
  minMarketsPerBucket: 25,
  metrics: [
    "logGrossShares",
    "eventCount",
    "uniqueReceiptCount",
    "absoluteSharePressure",
    "maxEventShareFraction",
  ] as const,
  definitions: {
    logGrossShares: "ln(1 + total independently decoded chain shares in the first 60 seconds)",
    eventCount: "verified trade events in the first 60 seconds",
    uniqueReceiptCount:
      "distinct independently reconciled receipt hashes represented in the first 60 seconds",
    absoluteSharePressure:
      "absolute canonical net shares divided by gross shares; bounded from zero to one",
    maxEventShareFraction:
      "largest single verified event's chain shares divided by gross first-minute chain shares",
  },
  intendedUse: "outcome-free reference for validating live public-stream OFI/taker-flow proxies",
  prohibitedUse:
    "direct paper or execution signal unless a later preregistration proves decision-time availability",
} as const;

export type AuthoritativeOutcomeToken = "up" | "down";
export type AuthoritativeChainAction = "buy" | "sell";

/**
 * Canonical UP-probability pressure sign.
 *
 * Buying UP and selling DOWN increase UP pressure. Selling UP and buying DOWN decrease it.
 */
export function canonicalAuthoritativeTakerPressureSign(
  outcomeToken: AuthoritativeOutcomeToken,
  chainAction: AuthoritativeChainAction,
): -1 | 1 {
  return (outcomeToken === "up" && chainAction === "buy") ||
    (outcomeToken === "down" && chainAction === "sell")
    ? 1
    : -1;
}

export function expectedAuthoritativeTakerPressureBucketKeys(): string[] {
  return AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.pairs.flatMap((pair) =>
    AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.horizons.map(
      (horizonMin) => `${pair}:${horizonMin}`,
    ),
  );
}
