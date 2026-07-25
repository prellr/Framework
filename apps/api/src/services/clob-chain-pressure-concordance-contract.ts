/**
 * Frozen, outcome-free mechanism audit for the live CLOB event-OFI proxy.
 *
 * The public socket tape and the delayed chain-confirmed reference do not share an exact persisted
 * clock in v1. The closest immutable CLOB row is sample minute zero, normally captured just before
 * the first minute closes. This contract therefore admits only captures in [55s, 60s) after open
 * and describes the comparison as near-synchronous, never exact.
 */
import { CLOB_EVENT_OFI_TAPE } from "./clob-event-ofi.ts";
import {
  AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT,
} from "./authoritative-taker-pressure-distribution-contract.ts";

const PAIRS = ["BNB-USD", "BTC-USD", "DOGE-USD", "ETH-USD", "SOL-USD", "XRP-USD"] as const;
const HORIZONS = [5, 15] as const;

export const CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT = {
  version: "updown-clob-chain-pressure-concordance-audit-v1",
  evalStartMs: Math.max(
    CLOB_EVENT_OFI_TAPE.evalStartMs,
    AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.evalStartMs,
  ),
  clobTapeVersion: CLOB_EVENT_OFI_TAPE.version,
  referenceTapeVersion: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.tapeVersion,
  anchorSampleMinute: 0,
  anchorOffsetMinSec: 55,
  anchorOffsetMaxExclusiveSec: 60,
  referenceWindowSec: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.observationWindowSec,
  minimumClockOverlapSec: 55,
  maximumClockMismatchSec: 5,
  pairs: PAIRS,
  horizons: HORIZONS,
  dimensions: ["pair", "horizonMin"] as const,
  expectedBuckets: PAIRS.length * HORIZONS.length,
  minMatchedMarketsPerBucket: 100,
  minMatchedSpanDays: 5,
  minAnchorCoverage: CLOB_EVENT_OFI_TAPE.minCoverage,
  cacheMs: 15 * 60_000,
  metrics: [
    "pearsonCorrelation",
    "spearmanCorrelation",
    "nonzeroSignAgreement",
    "proxyZeroRate",
    "referenceZeroRate",
  ] as const,
  definitions: {
    pearsonCorrelation:
      "linear correlation between near-first-minute CLOB canonical OFI and normalized verified-chain pressure",
    spearmanCorrelation:
      "Pearson correlation of deterministic average ranks, robust to scale and monotone transforms",
    nonzeroSignAgreement:
      "fraction with equal signs after excluding markets where either aggregate is exactly zero",
    proxyZeroRate: "fraction of matched markets whose near-first-minute CLOB aggregate is zero",
    referenceZeroRate: "fraction of matched markets whose verified-chain aggregate is zero",
  },
  intendedUse:
    "outcome-free validation of whether decision-time public CLOB event OFI tracks delayed verified taker pressure",
  prohibitedUse:
    "strategy selection, paper admission, threshold fitting, direction choice, or execution",
} as const;

export function expectedClobChainPressureConcordanceBucketKeys(): string[] {
  return CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.pairs.flatMap((pair) =>
    CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.horizons.map(
      (horizonMin) => `${pair}:${horizonMin}`,
    ),
  );
}
