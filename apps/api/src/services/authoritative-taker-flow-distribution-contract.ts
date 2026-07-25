/**
 * Frozen, outcome-free distribution plan for the chain-verified Polymarket taker-flow tape.
 *
 * Only unsigned liquidity, timing, and reconciliation-quality coordinates are disclosed. The
 * contract never groups by token, reported side, chain side, or outcome-token mapping and cannot
 * define a directional rule.
 */
import { AUTHORITATIVE_TRADE_FLOW_TAPE } from "./polymarket-trade-flow-tape.ts";

const PAIRS = [
  "BNB-USD",
  "BTC-USD",
  "DOGE-USD",
  "ETH-USD",
  "SOL-USD",
  "XRP-USD",
] as const;
const HORIZONS = [5, 15] as const;

export const AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT = {
  version: "updown-authoritative-taker-flow-distribution-audit-v1",
  tapeVersion: AUTHORITATIVE_TRADE_FLOW_TAPE.version,
  evalStartMs: AUTHORITATIVE_TRADE_FLOW_TAPE.evalStartMs,
  quantileProbabilities: [0.05, 0.25, 0.5, 0.75, 0.95] as const,
  cacheMs: 15 * 60_000,
  pairs: PAIRS,
  horizons: HORIZONS,
  dimensions: ["pair", "horizonMin"] as const,
  expectedBuckets: PAIRS.length * HORIZONS.length,
  minMarketsPerBucket: 25,
  metrics: [
    "logChainNotionalUsd",
    "logChainShares",
    "absoluteChainPriceDistanceBps",
    "secondsFromWindowStart",
    "ingestionLatencyMs",
    "chainConfirmations",
    "absoluteSourceReceiptPriceErrorBps",
    "absoluteSourceReceiptShareErrorPpm",
  ] as const,
  definitions: {
    logChainNotionalUsd: "ln(1 + independently decoded chain price × chain shares)",
    logChainShares: "ln(1 + independently decoded chain shares)",
    absoluteChainPriceDistanceBps:
      "10000 × absolute distance of independently decoded chain price from 0.50",
    secondsFromWindowStart:
      "public stream event timestamp minus immutable market-window start, in seconds",
    ingestionLatencyMs: "public stream receive timestamp minus event timestamp, in milliseconds",
    chainConfirmations: "Polygon confirmation count at successful independent reconciliation",
    absoluteSourceReceiptPriceErrorBps:
      "10000 × absolute public-stream price minus independently decoded chain price",
    absoluteSourceReceiptShareErrorPpm:
      "1000000 × absolute public-stream shares minus chain shares, divided by public-stream shares",
  },
} as const;

export function expectedAuthoritativeTakerFlowBucketKeys(): string[] {
  return AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.pairs.flatMap((pair) =>
    AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.horizons.map(
      (horizonMin) => `${pair}:${horizonMin}`,
    ));
}
