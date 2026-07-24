/**
 * Outcome-blind refinement of the queued dual-flow research lane.
 *
 * This freezes structural choices that do not require a feature value or market outcome. It is not
 * a strategy and has no database, network, paper-ledger, account, or execution dependency.
 */
import { FLOW_EXTERNAL_PRIOR_SCREEN } from "./flow-external-prior-screen.ts";
import { FLOW_FEATURE_CUT_FREEZE } from "./flow-feature-cut-freeze.ts";
import { POLYMARKET_MICROSTRUCTURE_TAPE } from "./polymarket-microstructure.ts";

export const FLOW_MECHANISM_REFINEMENT = {
  version: "updown-flow-mechanism-refinement-2026-07-24",
  status: "queued",
  inheritedPriorVersion: FLOW_EXTERNAL_PRIOR_SCREEN.version,
  candidateKey: FLOW_EXTERNAL_PRIOR_SCREEN.candidate.key,
  prerequisiteVersions: {
    flowFeatureCuts: FLOW_FEATURE_CUT_FREEZE.artifactVersion,
    microstructureTape: POLYMARKET_MICROSTRUCTURE_TAPE.version,
  },
  horizonPolicy: "independent 5m and 15m paper identities",
  frozenBeforeFeatureValues: {
    direction: [
      "Hyperliquid 30s and 60s imbalance must both be non-zero and have the same sign.",
      "Polymarket CLOB event-OFI 30s and 60s must both be non-zero and have the same sign.",
      "The persistent Hyperliquid and Polymarket signs must agree; disagreement abstains.",
      "A non-null, non-zero 5s value opposing its own venue's 60s sign vetoes the observation; a quiet null Hyperliquid 5s window does not.",
    ],
    immutableBucketQuality: [
      "Require absolute Hyperliquid 60s imbalance at or above its asset-by-horizon p75 cut.",
      "Require absolute CLOB event-OFI 60s at or above its asset-by-horizon p75 cut.",
      "Require Hyperliquid log-notional and trade count at or above their p25 cuts.",
      "Require Hyperliquid maximum-trade share at or below its p95 cut.",
      "Require CLOB event count at or above its p25 cut.",
      "Require CLOB receive age and maximum transport lag at or below their p95 cuts.",
    ],
    stateLayer: [
      "Require complete paired UP and DOWN books and a valid fee-adjusted executable ask for the selected side.",
      "Use the sign of canonical paired-book microprice skew as the outcome-free Polymarket state direction; zero or opposite skew abstains.",
      "Evaluate the identical state-only rule without either flow source as the mandatory first comparator.",
    ],
    comparisonLadder: [
      "state only",
      "state plus Hyperliquid flow",
      "state plus Polymarket CLOB event-OFI",
      "state plus both persistent agreeing flows",
    ],
  },
  unresolvedUntilPrerequisitesPass: [
    "liquidity-state depth or spread cut",
    "entry ask cap",
    "decision sample minute",
  ],
  rejectedAsCurrentAdditions: [
    {
      key: "estimated-microprice-transition-model",
      reason:
        "The published micro-price estimator is an empirical transition model; fitting it now would consume labels and create another model-selection surface before the state-only baseline is tested.",
    },
    {
      key: "multi-level-order-book-model",
      reason:
        "The supporting literature uses deeper books, while Jester's current compact tape can test the cheaper paired-touch state first without another collector.",
    },
    {
      key: "hawkes-flow-forecast",
      reason:
        "A fitted point-process layer adds compute and estimation risk before the deterministic persistence ladder has earned incremental value.",
    },
  ],
  validationContract: [
    "Register any executable paper rule at a later future boundary after every prerequisite passes.",
    "Keep 5m and 15m results, identities, and verdicts independent.",
    "Compare every layer on the same eligible market panel and fee-adjusted paired-book asks.",
    "Use chronological out-of-sample evaluation with event or session clustered uncertainty.",
    "Disclose asset-by-horizon support, abstention reasons, transport quality, and single-print concentration.",
    "Do not add a roster member unless the full dual-flow layer improves on the state-only comparator and passes the unchanged forward verdict gate.",
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
