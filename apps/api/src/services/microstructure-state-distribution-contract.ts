/**
 * Frozen, outcome-free distribution plan for the prospective Polymarket state tape.
 *
 * The audit normalizes liquidity state independently inside every asset, horizon, and causal sample
 * minute. It is not a strategy, threshold, label, or execution contract.
 */
import { POLYMARKET_MICROSTRUCTURE_TAPE } from "./polymarket-microstructure.ts";

const PAIRS = ["BNB-USD", "BTC-USD", "DOGE-USD", "ETH-USD", "SOL-USD", "XRP-USD"] as const;
const HORIZONS = [5, 15] as const;

export const MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT = {
  version: "updown-microstructure-state-distribution-audit-v1",
  tapeVersion: POLYMARKET_MICROSTRUCTURE_TAPE.version,
  evalStartMs: POLYMARKET_MICROSTRUCTURE_TAPE.evalStartMs,
  quantileProbabilities: [0.05, 0.25, 0.5, 0.75, 0.95] as const,
  cacheMs: 15 * 60_000,
  pairs: PAIRS,
  horizons: HORIZONS,
  expectedBuckets: PAIRS.length * HORIZONS.reduce((sum, horizon) => sum + horizon, 0),
  minMarketsPerBucket: 50,
  dimensions: ["pair", "horizonMin", "sampleMinute"] as const,
  metrics: [
    "micropriceSkew",
    "absoluteMicropriceSkew",
    "touchPressure",
    "absoluteTouchPressure",
    "pairedSpread",
    "logMinDepthUsd",
    "complementError",
  ] as const,
} as const;

export function expectedMicrostructureStateBucketKeys(): string[] {
  return MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.pairs.flatMap((pair) =>
    MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.horizons.flatMap((horizonMin) =>
      Array.from({ length: horizonMin }, (_, sampleMinute) =>
        `${pair}:${horizonMin}:${sampleMinute}`)));
}
