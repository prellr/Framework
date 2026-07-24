/**
 * Frozen, outcome-free distribution plan for the existing Chainlink × Hyperliquid venue tape.
 *
 * The tape is horizon-neutral, so distributions are frozen by pair rather than duplicated into
 * artificial 5m/15m buckets. Any later decision rule must still register separate horizon identities.
 */
import { LEAD_LAG_REPORT } from "./lead-lag-analysis.ts";

export const RESOLUTION_SOURCE_BASIS_DISTRIBUTION_AUDIT = {
  version: "updown-resolution-source-basis-distribution-audit-v1",
  tapeVersion: "updown-venue-lead-lag-tape-v1",
  evalStartMs: LEAD_LAG_REPORT.evalStartMs,
  pairs: ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD", "BNB-USD"],
  quantileProbabilities: [0.05, 0.25, 0.5, 0.75, 0.95] as const,
  cacheMs: 15 * 60_000,
  maximumSourceAgeMs: 10_000,
  metrics: [
    "basisBps",
    "absoluteBasisBps",
    "basisChange1sBps",
    "sameSignPersistence5s",
    "chainlinkAgeMs",
    "hlAgeMs",
  ] as const,
  definitions: {
    basisBps: "10000 × ln(Hyperliquid midpoint / Chainlink resolution-source price)",
    basisChange1sBps: "current basisBps minus the exact prior-second basisBps",
    sameSignPersistence5s:
      "share of the current and four exact prior-second basis observations with the current non-zero sign",
  },
} as const;
