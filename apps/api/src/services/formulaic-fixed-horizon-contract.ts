/**
 * Synthetic-only proof-of-concept contract for algebraic formula discovery.
 *
 * This fixes the representation and validation mechanics. It does not authorize reading the locked
 * live tape, searching a production dataset, creating a paper bot, or executing a trade.
 */
export const FORMULAIC_FIXED_HORIZON_POC = {
  version: "updown-formulaic-fixed-horizon-lab-poc-v1",
  status: "synthetic-only",
  system: {
    version: "jester-formula-lab-v1",
    scope: "venue-neutral formula hypothesis research",
    engineStages: [
      "causal source adapters",
      "typed feature frames",
      "bounded formula search",
      "purged chronological assessment",
      "append-only trial ledger",
      "immutable hypothesis export",
      "separate target economics",
    ] as const,
  },
  target: {
    direction: "short-underlying",
    holdSeconds: 10 * 60,
    label:
      "10000 × ln(entry underlying price / exact 10-minute exit underlying price), less caller-supplied round-trip cost",
    polymarketTranslation:
      "future 15m-only paper child: buy DOWN from a fee-adjusted executable ask and sell at the executable DOWN bid exactly 10 minutes later",
    fiveMinuteEligible: false,
  },
  features: [
    "chainlinkReturn60s",
    "chainlinkReturn300s",
    "hlReturn60s",
    "hlReturn300s",
    "basisBps",
    "basisChange60sBps",
    "basisPersistence5s",
  ] as const,
  grammar: {
    binaryOperators: ["add", "sub", "mul", "protectedDiv"] as const,
    unaryOperators: ["neg", "abs", "tanh"] as const,
    maximumNodes: 7,
    maximumDepth: 3,
    maximumAbsoluteIntermediate: 1_000_000,
    protectedDivisionMinimumDenominator: 1e-9,
  },
  search: {
    scoreThresholdsZ: [0, 0.5, 1] as const,
    outputNormalization: "training fold only",
    selectionMetric:
      "training mean net basis points minus 1.645 standard errors minus formula-complexity penalty",
    entryCooldownSeconds: 10 * 60,
  },
  validation: {
    chronologicalOnly: true,
    shuffledSplitsAllowed: false,
    purgeSeconds: 10 * 60,
    overlappingPositionsAllowed: false,
    everyFormulaThresholdExitCountsAsTrial: true,
    selectedFormulaRequiresNewForwardBoundary: true,
  },
  prerequisitesForLiveData: [
    "ready updown-venue-lead-lag-tape-v1 in all six pairs",
    "immutable outcome-free resolution-source basis feature cuts",
    "source and receive clock coverage",
    "a separately registered live-data experiment and trial ledger",
  ],
  prerequisitesForPolymarketTranslation: [
    "15m market only for the first 10-minute exit experiment",
    "causal paired-book entry ask and exact exit bid snapshots",
    "fees, spread, partial depth, and unavailable exits included",
    "a new strategy identity and future paper boundary",
    "the unchanged familywise verdict gate",
  ],
  sourceAdapters: [
    {
      key: "chainlink-spot",
      name: "Chainlink spot reference",
      role: "causal source",
      state: "tape prerequisite",
      provides: "source-timestamped reference price, returns, freshness, and resolution basis",
    },
    {
      key: "hyperliquid-public",
      name: "Hyperliquid public market data",
      role: "causal source",
      state: "tape prerequisite",
      provides: "underlying price, returns, trades, book state, and venue-to-reference basis",
    },
    {
      key: "future-source",
      name: "Additional Alchemy source adapter",
      role: "extension point",
      state: "interface only",
      provides: "causal numeric features with source and receive clocks",
    },
  ] as const,
  targetAdapters: [
    {
      key: "underlying-fixed-horizon",
      name: "Underlying fixed-horizon label",
      state: "synthetic mechanics only",
      economics: "short underlying return at the exact ten-minute horizon",
    },
    {
      key: "hyperliquid-perp-paper",
      name: "Hyperliquid perpetual paper target",
      state: "design only",
      economics: "executable entry and exact-time exit with fees, spread, slippage, and funding",
    },
    {
      key: "polymarket-down-paper",
      name: "Polymarket DOWN paper target",
      state: "design only",
      economics: "15m DOWN ask entry and exact ten-minute DOWN bid exit with fees and depth",
    },
  ] as const,
  invariants: {
    readsLockedLiveValues: false,
    readsPaperOutcomes: false,
    createsStrategy: false,
    createsPaperBot: false,
    startsCrucibleRun: false,
    enablesExecution: false,
    preservesVerdictGate: true,
  },
} as const;
