/**
 * Committed summary of the content-addressed Albert/BTC 5m replay receipt.
 *
 * The immutable source tape and full receipt remain outside git. This summary is static,
 * read-only, and complete for the declared trial family.
 */
type TrialTuple = readonly [
  id: string,
  available: boolean,
  unavailableReason: string | null,
  trades: number,
  meanGrossBps: number | null,
  meanNetBps: number | null,
  hitRate: number | null,
  positiveFolds: number,
  worstFoldMeanNetBps: number | null,
  finalEquityUsd: number,
  maximumDrawdownPct: number,
];

function trials(rows: readonly TrialTuple[]) {
  return rows.map(([
    id,
    available,
    unavailableReason,
    trades,
    meanGrossBps,
    meanNetBps,
    hitRate,
    positiveFolds,
    worstFoldMeanNetBps,
    finalEquityUsd,
    maximumDrawdownPct,
  ]) => {
    const threshold = id.match(/:z([0-9.]+)$/)?.[1];
    return {
      id,
      tail: id === "always-short-control"
        ? "all" as const
        : id.includes("-high:")
        ? "high" as const
        : "low" as const,
      thresholdZ: threshold == null ? null : Number(threshold),
      available,
      unavailableReason,
      trades,
      meanGrossBps,
      meanNetBps,
      hitRate,
      positiveFolds,
      worstFoldMeanNetBps,
      finalEquityUsd,
      maximumDrawdownPct,
    };
  });
}

export const HISTORICAL_ALBERT_REPLAY_RECEIPT = {
  version: "alchemy-historical-albert-btc-5m-replay-2026-07-25",
  receiptHash: "sha256:76e61d73c35f7e47927b5bae393659e05904bf5f24763ef8349a10672de8d6bf",
  evidenceClass: "retrospective-discovery-only",
  dataset: {
    id: "tradingview-hyperliquid-btcusdc-p-5m-ohlcv",
    version: "20250322105000000-20260725030459999-b15ddf827403-imported-20260725163357278",
    contentHash: "sha256:b15ddf82740373b2e23bbeee1965facaeff0c0dfef573432e128347ebbbc89e4",
    rows: 140_999,
    eligiblePoints: 140_396,
    segments: 9,
    startAtMs: 1_742_640_600_000,
    endAtMs: 1_784_948_699_999,
    asset: "BTC-USDC-PERP",
    interval: "5m",
  },
  evaluator: {
    semantics: "Microsoft Qlib v0.9.5",
    sourceUrl: "https://github.com/microsoft/qlib/blob/v0.9.5/qlib/data/ops.py",
    finiteValues: 140_945,
    nanValues: 54,
    minimum: -77_676_964_846.65031,
    maximum: 59_116,
    mean: -29_853_961.45593963,
  },
  target: {
    side: "short",
    holdMinutes: 10,
    entry: "next contiguous 5m bar open after the formula bar closes",
    exit: "bar open exactly 10 minutes after entry",
    roundTripCostBps: 10,
    folds: 4,
    minimumTradesPerFold: 100,
    capital: "$10,000 start · $1,000 fixed notional · one position at a time",
  },
  informationCoefficientByFold: [
    { fold: 1, pearson: 0.008041918060705975, spearman: 0.014036898360587502 },
    { fold: 2, pearson: 0.0017948614301542018, spearman: 0.01523013934219283 },
    { fold: 3, pearson: -0.01630552814440231, spearman: 0.002151116110279026 },
    { fold: 4, pearson: -0.009168661926649916, spearman: 0.012835384110174519 },
  ],
  trials: trials([
    ["always-short-control", true, null, 42_119, 0.1616567200258595, -9.838343279974127, 0.2302523801609725, 0, -10.204348510327659, 0.9964537030236946, 99.99004505134047],
    ["albert-short-high:z0", true, null, 41_620, 0.16037273667814622, -9.839627263321775, 0.2278471888515137, 0, -10.23709110818729, 0.9997592030547803, 99.99001151978892],
    ["albert-short-high:z0.5", false, "fewer than 100 trades in folds 1, 2, 3, 4", 0, null, null, null, 0, null, 10_000, 0],
    ["albert-short-high:z1", false, "fewer than 100 trades in folds 1, 2, 3, 4", 0, null, null, null, 0, null, 10_000, 0],
    ["albert-short-low:z0", false, "fewer than 100 trades in fold 1", 615, 0.2203142267209436, -9.779685773279047, 0.23089430894308943, 0, -11.091664701952205, 9_397.08540764248, 6.0339328830594186],
    ["albert-short-low:z0.5", false, "fewer than 100 trades in folds 1, 3", 378, 0.7965512058982656, -9.203448794101737, 0.2830687830687831, 0, -14.709232641312903, 9_650.936075728996, 3.5080829246635226],
    ["albert-short-low:z1", false, "fewer than 100 trades in folds 1, 2, 3, 4", 251, 1.190397233740309, -8.809602766259694, 0.2948207171314741, 0, -13.842696963963341, 9_778.022243473228, 2.219777565267723],
  ]),
  observedResult:
    "No declared 10m trial produced a positive net fold after the frozen 10 bps cost stress. The low-tail z1 row had the largest gross mean at +1.19 bps, still -8.81 bps net, and missed the 100-trades-per-fold floor.",
  nextResearchStep:
    "The longer tape confirms that mean/std gates are structurally poor for this skewed expression at 10m. Any percentile, rank, winsorized, component, conventional-WMA, long-side, or alternate-horizon assessment remains a separately declared retrospective family.",
  invariants: {
    selectsWinner: false,
    registersStrategy: false,
    createsPaperBot: false,
    enablesExecution: false,
    preservesVerdictGate: true,
  },
} as const;
