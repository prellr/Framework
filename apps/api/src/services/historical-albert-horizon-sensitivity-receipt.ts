/**
 * Committed summary of the content-addressed Albert BTC 5m medium-exit sensitivity receipt.
 *
 * Every declared row is retained. The full immutable tape and receipts stay outside git.
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

export const HISTORICAL_ALBERT_HORIZON_SENSITIVITY_RECEIPT = {
  version: "alchemy-historical-albert-btc-5m-horizon-sensitivity-v1",
  receiptHash: "sha256:ab3d662b0378eb12e77147f2adc1f812f3c96e35deefafb559ef92ad4fef1cbe",
  evidenceClass: "retrospective-discovery-only",
  baseline: {
    holdMinutes: 10,
    receiptHash: "sha256:76e61d73c35f7e47927b5bae393659e05904bf5f24763ef8349a10672de8d6bf",
  },
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
    requestedHoldMinutes: [30, 60, 240],
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
      holdMinutes: 30,
      replayReceiptHash: "sha256:62be370a13710b8de33469ef30d1b6a3292ac5830674dc13b4c3ad55b382257c",
      eligiblePoints: 140_360,
      spearmanInformationCoefficientByFold: [
        0.029507040621410824,
        0.026667845991197408,
        0.008634545646358953,
        0.028508832243915812,
      ],
      trials: trials([
        ["always-short-control", true, null, 14_037, 0.47601854255139164, -9.52398145744856, 0.3247844981121322, 0, -10.631383079580406, 11.333016634656829, 99.88666983365343],
        ["albert-short-high:z0", true, null, 13_913, 0.4815699149678548, -9.518430085032136, 0.3277510242219507, 0, -10.65153200936423, 12.906363880217933, 99.87093636119782],
        ["albert-short-high:z0.5", false, "fewer than 100 trades in folds 1, 2, 3, 4", 0, null, null, null, 0, null, 10_000, 0],
        ["albert-short-high:z1", false, "fewer than 100 trades in folds 1, 2, 3, 4", 0, null, null, null, 0, null, 10_000, 0],
        ["albert-short-low:z0", false, "fewer than 100 trades in folds 1, 2, 3", 280, -0.3815656473853841, -10.381565647385386, 0.33214285714285713, 0, -19.783728117966085, 9_706.930184758787, 3.028648896142252],
        ["albert-short-low:z0.5", false, "fewer than 100 trades in folds 1, 2, 3, 4", 175, 0.5693835524187831, -9.430616447581214, 0.35428571428571426, 0, -20.167510344077357, 9_833.594837563853, 1.7382204606819904],
        ["albert-short-low:z1", false, "fewer than 100 trades in folds 1, 2, 3, 4", 118, 1.8667419373301692, -8.133258062669828, 0.4491525423728814, 0, -19.687962136965716, 9_903.062270425817, 1.0611530851270377],
      ]),
    },
    {
      holdMinutes: 60,
      replayReceiptHash: "sha256:5af6cc41738cbd9399c1d11927263fe9eafbd13721c892200b21cd4040bc6582",
      eligiblePoints: 140_306,
      spearmanInformationCoefficientByFold: [
        0.04433009637846907,
        0.03468365277075243,
        0.021761441604444584,
        0.05000899829872676,
      ],
      trials: trials([
        ["always-short-control", true, null, 7_016, 0.955426426368005, -9.044573573632011, 0.37385974914481185, 0, -11.245869887480417, 3_570.1866505232497, 64.351217247033],
        ["albert-short-high:z0", true, null, 6_977, 0.9481681034218262, -9.05183189657817, 0.3785294539200229, 0, -11.24498668508372, 3_599.2538962110393, 64.04907166862719],
        ["albert-short-high:z0.5", false, "fewer than 100 trades in folds 1, 2, 3, 4", 0, null, null, null, 0, null, 10_000, 0],
        ["albert-short-high:z1", false, "fewer than 100 trades in folds 1, 2, 3, 4", 0, null, null, null, 0, null, 10_000, 0],
        ["albert-short-low:z0", false, "fewer than 100 trades in folds 1, 2, 3, 4", 201, -5.132541825520234, -15.13254182552024, 0.3333333333333333, 0, -26.81756782250609, 9_692.930425147955, 3.2384892847996887],
        ["albert-short-low:z0.5", false, "fewer than 100 trades in folds 1, 2, 3, 4", 128, -4.953620422174573, -14.953620422174572, 0.3515625, 1, -31.894391305548577, 9_806.362140755273, 2.1855261181508285],
        ["albert-short-low:z1", false, "fewer than 100 trades in folds 1, 2, 3, 4", 86, -4.445805439160317, -14.445805439160312, 0.4186046511627907, 1, -37.68797567256799, 9_874.163315910759, 1.5902915789816872],
      ]),
    },
    {
      holdMinutes: 240,
      replayReceiptHash: "sha256:28f0f78e1f2ea39d48a24cd71e143edc69eaf50f685f9ee2a98a724de6f76245",
      eligiblePoints: 139_982,
      spearmanInformationCoefficientByFold: [
        0.08523977897619146,
        0.0694480017249672,
        0.049920715116760155,
        0.1180538745214538,
      ],
      trials: trials([
        ["always-short-control", true, null, 1_751, 3.784342916724264, -6.2156570832757385, 0.4351798972015991, 0, -14.856918158662983, 8_824.216850493918, 12.891904973652949],
        ["albert-short-high:z0", true, null, 1_748, 3.6979858357360866, -6.30201416426391, 0.4502288329519451, 0, -14.627601084452031, 8_817.754863215654, 12.886751876707436],
        ["albert-short-high:z0.5", false, "fewer than 100 trades in folds 1, 2, 3, 4", 0, null, null, null, 0, null, 10_000, 0],
        ["albert-short-high:z1", false, "fewer than 100 trades in folds 1, 2, 3, 4", 0, null, null, null, 0, null, 10_000, 0],
        ["albert-short-low:z0", false, "fewer than 100 trades in folds 1, 2, 3, 4", 157, -12.179502238620065, -22.17950223862006, 0.35668789808917195, 0, -50.8824350010681, 9_644.368330402802, 3.696676230559242],
        ["albert-short-low:z0.5", false, "fewer than 100 trades in folds 1, 2, 3, 4", 101, -10.335957086052995, -20.335957086053, 0.4158415841584158, 1, -68.58164757634668, 9_788.324887071953, 2.2428241865605743],
        ["albert-short-low:z1", false, "fewer than 100 trades in folds 1, 2, 3, 4", 71, -16.189996019494753, -26.189996019494753, 0.36619718309859156, 1, -64.25011999576527, 9_809.964045207693, 1.905032495641044],
      ]),
    },
  ],
  observedResult:
    "No requested 30m, 1h, or 4h row produced a positive net mean after the frozen 10 bps cost stress. Every adequately sampled row had zero positive folds.",
  interpretation:
    "The longer source history strengthened the negative result. Albert remained close to the always-short control, while the low-tail rows were under-sampled and more negative. The formula adds no admissible medium-horizon edge.",
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
