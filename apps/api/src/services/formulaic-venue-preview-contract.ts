/**
 * Frozen exploratory real-data preview for Formula Lab.
 *
 * The contract was fixed before any target return was queried. It evaluates five already-declared
 * formula/threshold trials independently on the existing Chainlink × Hyperliquid venue tape. The
 * tape predates this registration, so every result is retrospective exploratory evidence—not a
 * forward result, strategy verdict, or authorization to create a bot.
 */
import { LEAD_LAG_REPORT } from "./lead-lag-analysis.ts";

export const FORMULAIC_VENUE_PREVIEW = {
  version: "formulaic-venue-tape-preview-v1",
  registeredAtMs: Date.parse("2026-07-24T21:23:00.000Z"),
  dataStartMs: LEAD_LAG_REPORT.evalStartMs,
  dataEndExclusiveMs: Date.parse("2026-07-24T21:23:00.000Z"),
  status: "retrospective-exploratory",
  sourceTapeVersion: "updown-venue-lead-lag-tape-v1",
  pairs: [
    "BTC-USD",
    "ETH-USD",
    "SOL-USD",
    "XRP-USD",
    "DOGE-USD",
    "BNB-USD",
  ] as const,
  sampling: {
    frameSeconds: 60,
    maximumSourceAgeMs: 10_000,
    requireExactLagSeconds: [1, 2, 3, 4, 60, 300] as const,
    requireExactExitSeconds: 10 * 60,
    minuteRepresentative: "first complete paired observation in each UTC minute",
  },
  target: {
    adapter: "hyperliquid-mid-fixed-horizon-preview",
    direction: "short-underlying",
    holdSeconds: 10 * 60,
    roundTripCostBps: 10,
    label:
      "10000 × ln(entry Hyperliquid midpoint / exact 10-minute Hyperliquid midpoint) − 10 bps",
    executableFillModel: false,
  },
  trials: [
    "cl-1m-momentum-short:z0.5",
    "hl-1m-momentum-short:z0.5",
    "dual-1m-momentum-short:z0.5",
    "positive-basis-short:z0.5",
    "basis-widening-short:z0.5",
  ] as const,
  assessment: {
    folds: 4,
    testPointsPerFold: 240,
    minimumTrainPoints: 720,
    minimumTrainTrades: 12,
    minimumTestTrades: 2,
    complexityPenaltyBps: 0,
    overlappingPositionsAllowed: false,
    normalization: "prior training fold only",
    purgeSeconds: 10 * 60,
    selection: "none; every frozen trial is assessed independently",
  },
  disclosure: {
    rankingAllowed: false,
    hypothesisExportAllowed: false,
    strategyRegistrationAllowed: false,
    paperBotCreationAllowed: false,
    polymarketVerdictEligible: false,
    executionAllowed: false,
    disposition:
      "early real-data smoke test only; rerun under a new untouched forward boundary before treating any formula as evidence",
  },
  invariants: {
    readsOnlyVenuePriceSnapshots: true,
    readsPaperOutcomes: false,
    readsPolymarketOutcomes: false,
    readsAccounts: false,
    createsStrategy: false,
    createsPaperBot: false,
    startsCrucibleRun: false,
    enablesExecution: false,
    preservesVerdictGate: true,
  },
} as const;
