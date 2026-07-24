/**
 * Outcome-blind research contract for resolution-source basis convergence.
 *
 * This is a queued hypothesis, not a strategy. It fixes the measurement and validation sequence
 * before the existing Chainlink/Hyperliquid tape is ready. It has no database, network, paper
 * ledger, account, or execution dependency.
 */
export const RESOLUTION_SOURCE_BASIS_RESEARCH = {
  version: "updown-resolution-source-basis-research-plan-v1",
  status: "queued",
  prerequisite: {
    version: "updown-venue-lead-lag-tape-v1",
    pairs: ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD", "BNB-USD"],
    minimumRowsPerPair: 100_000,
    minimumSpanDays: 3,
    minimumFiveMinuteBlocksPerPair: 500,
  },
  outcomeFreeFeaturePlan: {
    existingFields: [
      "basisBps",
      "chainlinkAgeMs",
      "hlAgeMs",
      "chainlinkSourceAt",
      "hlSourceAt",
    ],
    derivedOnlyAfterReadiness: [
      "basisChange1sBps",
      "absoluteBasisBps",
      "sameSignPersistence5s",
    ],
    cutPolicy:
      "Freeze per-pair robust distribution cuts from feature values only; do not inspect a market side, outcome, paper decision, P&L, or return label.",
    sourceFreshnessPolicy:
      "Retain the existing 10-second source and receive-age ceiling; disclose coverage and gaps by pair.",
  },
  candidate: {
    key: "resolution-source-basis-convergence",
    name: "Resolution-source basis convergence",
    horizonPolicy: "independent 5m and 15m paper identities",
    structuralPrior: [
      "Chainlink is the resolution-source price; Hyperliquid is a faster public external venue used only as a causal reference.",
      "A later candidate may follow symmetric Chainlink catch-up only when the ready diagnostic supports stable Hyperliquid-to-Chainlink precedence.",
      "Require fresh source and receive clocks, persistent basis state, and a fee-adjusted executable paired book; stale or conflicting evidence abstains.",
      "Compare incrementally against Chainlink-only pricers and smooth-path rules so shared price information is not mistaken for independent edge.",
    ],
    unresolvedUntilFeatureCutsFreeze: [
      "minimum absolute basis",
      "basis persistence requirement",
      "eligible decision phase",
      "entry ask cap",
      "minimum incremental edge over Chainlink-only controls",
    ],
    archiveIf:
      "The ready lead/lag diagnostic does not support stable Hyperliquid-to-Chainlink precedence, or the later forward rule fails incremental controls.",
  },
  rejectedTransfers: [
    {
      key: "long-dated-options-wedge",
      reason:
        "Multi-hour pricing wedges in long-duration Bitcoin threshold markets do not establish a 5m or 15m directional effect.",
    },
    {
      key: "public-bot-thresholds",
      reason:
        "Open-source divergence and PTB thresholds document mechanics, not transferable alpha or forward evidence.",
    },
    {
      key: "time-to-close-depth",
      reason:
        "The apparent depth effect becomes non-significant after duration and binary-uncertainty controls in the current Polymarket microstructure study.",
    },
  ],
  validation: [
    "freeze outcome-free feature cuts only after every pair passes the tape readiness floor",
    "register any executable rule at a new future boundary",
    "score 5m and 15m as separate identities",
    "cluster uncertainty by market and session",
    "compare against Chainlink-only pricers and always-UP/always-DOWN controls",
    "price every paper decision from a fee-adjusted executable paired book",
  ],
  invariants: {
    readsTapeValuesNow: false,
    readsOutcomes: false,
    createsStrategy: false,
    createsPaperBot: false,
    changesCollector: false,
    startsCrucibleRun: false,
    enablesExecution: false,
    preservesVerdictGate: true,
  },
} as const;
