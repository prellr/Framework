/**
 * Committed summary of the content-addressed Albert 5m long-exit sensitivity receipt.
 *
 * The immutable source tape and full replay receipt stay outside git. Every declared horizon and
 * trial is retained here; availability means only that the frozen fold floor was met.
 */
type TrialTuple = readonly [
  id: string,
  available: boolean,
  trades: number,
  meanGrossBps: number | null,
  meanNetBps: number | null,
  hitRate: number | null,
  positiveFolds: number,
  worstFoldMeanNetBps: number | null,
  finalEquityUsd: number,
  maximumDrawdownPct: number,
];

const floorReason = "fewer than 100 trades in folds 1, 2, 3, 4";

function trials(rows: readonly TrialTuple[]) {
  return rows.map(([
    id,
    available,
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
      unavailableReason: available ? null : floorReason,
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

export const HISTORICAL_ALBERT_LONG_HORIZON_SENSITIVITY_RECEIPT = {
  version: "alchemy-historical-albert-btc-5m-long-horizon-sensitivity-v1",
  receiptHash: "sha256:02faa5ea3ac5417c4e039474221abcdc80e616220f8ea0b72f57fdcc425c0e72",
  evidenceClass: "retrospective-discovery-only",
  dataset: {
    id: "tradingview-hyperliquid-btcusdc-p-5m-ohlcv",
    version: "20250322105000000-20260725030459999-b15ddf827403-imported-20260725163357278",
    contentHash: "sha256:b15ddf82740373b2e23bbeee1965facaeff0c0dfef573432e128347ebbbc89e4",
    rows: 140_999,
    asset: "BTC-USDC-PERP",
    interval: "5m",
    segments: 9,
  },
  target: {
    side: "short",
    sourceIntervalMinutes: 5,
    requestedHoldMinutes: [480, 720, 1_440],
    entry: "next contiguous 5m bar open after the completed formula bar",
    exit: "contiguous 5m bar open exactly holdMinutes after entry",
    folds: 4,
    minimumTradesPerFold: 100,
    roundTripCostBps: 10,
    capital:
      "$10,000 start · $1,000 fixed notional · one non-overlapping position at a time",
  },
  horizons: [
    {
      holdMinutes: 480,
      replayReceiptHash: "sha256:3753bca172fc8419b21dcbd74967bc9e7749170f33725b960ef860eb7f8d7c4e",
      eligiblePoints: 139_550,
      spearmanInformationCoefficientByFold: [
        0.1295837922119716,
        0.06227126890999853,
        0.058825858796121254,
        0.20600755279120284,
      ],
      trials: trials([
        ["always-short-control", true, 874, 7.73998685103011, -2.2600131489698905, 0.45423340961098396, 3, -18.247071937279593, 9_715.860180525824, 5.482380089029897],
        ["albert-short-high:z0", true, 872, 7.567908830878046, -2.4320911691219482, 0.46788990825688076, 3, -18.78194951914581, 9_707.889124949314, 5.616572780584789],
        ["albert-short-high:z0.5", false, 0, null, null, null, 0, null, 10_000, 0],
        ["albert-short-high:z1", false, 0, null, null, null, 0, null, 10_000, 0],
        ["albert-short-low:z0", false, 135, -23.28424850780471, -33.28424850780473, 0.37037037037037035, 0, -108.06412408617, 9_540.040531983028, 4.612307656234189],
        ["albert-short-low:z0.5", false, 87, -14.007349069257081, -24.007349069257046, 0.42528735632183906, 1, -107.03915514411106, 9_783.355146469588, 2.813803521202481],
        ["albert-short-low:z1", false, 65, -21.79074509662946, -31.790745096629443, 0.35384615384615387, 1, -82.82873643344277, 9_788.159863740628, 2.395150235299006],
      ]),
    },
    {
      holdMinutes: 720,
      replayReceiptHash: "sha256:a2cf786918e8512222261af272c65fa54d534e4f41ed7e0e9ac5221897974a29",
      eligiblePoints: 139_118,
      spearmanInformationCoefficientByFold: [
        0.16167381435789077,
        0.05193093521460537,
        0.08540999001469803,
        0.2596397091580169,
      ],
      trials: trials([
        ["always-short-control", true, 581, 11.73786009263264, 1.737860092632646, 0.4612736660929432, 3, -23.638138398044322, 10_024.801442742968, 4.431337716102933],
        ["albert-short-high:z0", true, 581, 11.757210032755836, 1.757210032755821, 0.4750430292598967, 3, -21.72927027658998, 10_025.367132314976, 4.1714469029030505],
        ["albert-short-high:z0.5", false, 0, null, null, null, 0, null, 10_000, 0],
        ["albert-short-high:z1", false, 0, null, null, null, 0, null, 10_000, 0],
        ["albert-short-low:z0", false, 118, -33.91649568119465, -43.9164956811946, 0.3474576271186441, 0, -81.54208164372314, 9_470.529865926417, 5.373510205430048],
        ["albert-short-low:z0.5", false, 85, -10.68940321505887, -20.68940321505888, 0.4117647058823529, 0, -67.55738586427137, 9_815.817606862875, 2.0045076786527534],
        ["albert-short-low:z1", false, 64, -11.975176670534825, -21.97517667053483, 0.40625, 1, -70.56440917056547, 9_853.252954442278, 1.8397780650037747],
      ]),
    },
    {
      holdMinutes: 1_440,
      replayReceiptHash: "sha256:c4c2c10131bfd034b1ad037f300aabb86bc476ba8df61516d780deba41b69350",
      eligiblePoints: 137_822,
      spearmanInformationCoefficientByFold: [
        0.23778354971674281,
        0.042716060559978404,
        0.14413494065813345,
        0.3531681667936257,
      ],
      trials: trials([
        ["always-short-control", false, 288, 23.73697789088882, 13.736977890888824, 0.5069444444444444, 3, -37.668716665844975, 10_315.254828858117, 3.2802785080027186],
        ["albert-short-high:z0", false, 288, 22.908691059076702, 12.90869105907672, 0.4826388888888889, 3, -38.29078862957548, 10_290.871088349624, 3.2521483564779894],
        ["albert-short-high:z0.5", false, 0, null, null, null, 0, null, 10_000, 0],
        ["albert-short-high:z1", false, 0, null, null, null, 0, null, 10_000, 0],
        ["albert-short-low:z0", false, 100, -18.233761399219997, -28.233761399219976, 0.44, 0, -48.78654113726589, 9_697.334434626217, 3.2129936139284956],
        ["albert-short-low:z0.5", false, 80, 3.845725655431715, -6.154274344568282, 0.3875, 2, -59.250212313912364, 9_933.530058429118, 1.3906939486333976],
        ["albert-short-low:z1", false, 60, -3.3398174807561865, -13.339817480756192, 0.35, 1, -69.57533162899871, 9_907.295723062358, 1.5678105967465243],
      ]),
    },
  ],
  observedResult:
    "The 8h family remained net-negative after the frozen 10 bps cost stress. The 12h broad rows became slightly net-positive, but their confidence bounds and worst folds remained negative. The 24h broad rows were positive in three of four folds, but every 24h row still missed the 100-trades-per-fold floor and retained a negative confidence bound.",
  interpretation:
    "The longer source history did not establish a robust Albert edge. At every horizon the broad Albert z0 row stayed close to the always-short control, so the formula gate added little beyond BTC direction. The 12h and 24h gross drift is descriptive only because confidence bounds and worst folds remain negative.",
  invariants: {
    formulaChangedAcrossHorizons: false,
    thresholdsUseTrainingRowsOnly: true,
    selectsWinner: false,
    registersStrategy: false,
    createsPaperBot: false,
    enablesExecution: false,
    preservesVerdictGate: true,
  },
} as const;
