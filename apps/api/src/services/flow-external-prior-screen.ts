/**
 * Outcome-blind external-prior disposition for the compact public flow tapes.
 *
 * This is a research queue contract, not a strategy. It fixes which ideas survived the literature
 * and repository screen before Jester's locked feature distributions are visible. It has no
 * database, network, paper-ledger, account, or execution dependency.
 */
import { POLYMARKET_MICROSTRUCTURE_TAPE } from "./polymarket-microstructure.ts";

export const FLOW_EXTERNAL_PRIOR_SCREEN = {
  version: "updown-flow-external-prior-screen-2026-07-24",
  status: "queued",
  candidate: {
    key: "state-conditioned-dual-flow-agreement",
    name: "State-conditioned dual-flow agreement",
    prerequisiteVersions: {
      flowDistribution: "updown-flow-distribution-audit-v1",
      flowFeatureCuts: "updown-flow-feature-cuts-v1",
      microstructureTape: POLYMARKET_MICROSTRUCTURE_TAPE.version,
    },
    horizonPolicy: "independent 5m and 15m paper identities",
    structuralPrior: [
      "Use fresh causal Polymarket liquidity state as the first layer; flow may add evidence but may not replace state.",
      "Treat same-sign Hyperliquid aggressor flow and paired-book Polymarket CLOB event-OFI as a continuation candidate; disagreement abstains.",
      "Prefer repeated multi-window flow to a single extreme print, and retain a single-print-dominance veto.",
      "Normalize activity and magnitude independently inside every asset and horizon bucket using only the immutable outcome-free cuts.",
      "Treat the quarter-hour opening phase as a 15m segmentation variable, not as evidence that a 5m rule transfers.",
    ],
    unresolvedUntilPrerequisitesPass: [
      "eligible microstructure states",
      "exact magnitude and activity cut usage",
      "multi-window persistence requirement",
      "entry ask cap",
      "decision offset",
    ],
  },
  retainedValidationPatterns: [
    "rolling chronological out-of-sample evaluation",
    "event-clustered or session-clustered validation",
    "asset-by-horizon support disclosure",
    "incremental comparison against a state-only layer",
    "single-print concentration and transport-quality diagnostics",
  ],
  rejectedAsCurrentStrategyInputs: [
    {
      key: "raw-single-venue-imbalance",
      reason: "A lone venue or lone extreme trade cannot distinguish information from liquidity shock.",
    },
    {
      key: "hawkes-first",
      reason:
        "The available study forecasts OFI on one NIFTY futures day with repeated fitting and simulation; it is not a direct crypto binary-return result and is heavier than the cheap persistence benchmark.",
    },
    {
      key: "deep-or-multilevel-l2-first",
      reason:
        "Deep and multi-level models require a new high-rate depth collector and must first beat Jester's top-of-book state baseline out of sample.",
    },
    {
      key: "footprint-stack-copy",
      reason:
        "Public footprint implementations require price-level trade storage and extra services; their example thresholds are not forward evidence.",
    },
    {
      key: "github-live-bot-claims",
      reason:
        "Execution repositories expose mechanics, failure modes, and operational patterns—not transferable alpha or verdict evidence.",
    },
  ],
  invariants: {
    readLockedFeatureValues: false,
    readOutcomes: false,
    createsPaperBot: false,
    changesCollector: false,
    enablesExecution: false,
    preservesVerdictGate: true,
  },
} as const;
