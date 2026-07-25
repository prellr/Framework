/**
 * Committed summary of the content-addressed Albert BTC 1h-chart sensitivity receipt.
 *
 * The source 5m tape was deterministically aggregated into complete UTC 1h buckets. Every
 * declared horizon and trial remains present; no result is selected or admitted.
 */
type TrialTuple = readonly [
  id: string,
  available: boolean,
  unavailableReason: string | null,
  trades: number,
  meanGrossBps: number | null,
  meanNetBps: number | null,
  lowerConfidenceBoundNetBps: number | null,
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
    lowerConfidenceBoundNetBps,
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
      lowerConfidenceBoundNetBps,
      hitRate,
      positiveFolds,
      worstFoldMeanNetBps,
      finalEquityUsd,
      maximumDrawdownPct,
    };
  });
}

const allFoldsUnder = "fewer than 100 trades in folds 1, 2, 3, 4";

export const HISTORICAL_ALBERT_ONE_HOUR_CHART_SENSITIVITY_RECEIPT = {
  version: "alchemy-historical-albert-btc-1h-chart-sensitivity-v1",
  receiptHash: "sha256:5836d965344afa185f1bd2059656a92cfca56207095c25d1e128ddbd25371363",
  evidenceClass: "retrospective-discovery-only",
  sourceDataset: {
    id: "tradingview-hyperliquid-btcusdc-p-5m-ohlcv",
    version: "20250322105000000-20260725030459999-b15ddf827403-imported-20260725163357278",
    contentHash: "sha256:b15ddf82740373b2e23bbeee1965facaeff0c0dfef573432e128347ebbbc89e4",
    rows: 140_999,
    interval: "5m",
  },
  aggregation: {
    version: "alchemy-historical-ohlcv-resample-v1",
    alignment: "UTC epoch boundaries",
    contentHash: "sha256:495e5ad046e730a5876de6b22c801a087d01ece2f07dcb0cf836ea05cbb26c46",
    expectedSourceBarsPerTarget: 12,
    rows: 11_742,
    rejectedPartialBuckets: 16,
    rejectedNonContiguousBuckets: 0,
    imputesBars: false,
    crossesSourceSegments: false,
  },
  dataset: {
    id: "tradingview-hyperliquid-btcusdc-p-5m-ohlcv-utc-1h-full-buckets",
    version: "20250322105000000-20260725030459999-b15ddf827403-imported-20260725163357278-alchemy-historical-ohlcv-resample-v1-495e5ad046e7",
    contentHash: "sha256:495e5ad046e730a5876de6b22c801a087d01ece2f07dcb0cf836ea05cbb26c46",
    rows: 11_742,
    asset: "BTC-USDC-PERP",
    interval: "1h",
    segments: 9,
  },
  target: {
    side: "short",
    sourceIntervalMinutes: 60,
    requestedHoldMinutes: [60, 240, 720, 1_440],
    entry: "next contiguous 1h bar open after the completed formula bar",
    exit: "contiguous 1h bar open exactly holdMinutes after entry",
    folds: 4,
    minimumTradesPerFold: 100,
    roundTripCostBps: 10,
    capital:
      "$10,000 start · $1,000 fixed notional · one non-overlapping position at a time",
  },
  horizons: [
    {
      holdMinutes: 60,
      replayReceiptHash: "sha256:53660cb1832afaa54d67cc77a6ca87549d2684ba48068a2aa4ff291acb2f3dd1",
      eligiblePoints: 11_148,
      spearmanInformationCoefficientByFold: [0.037195892279190464, 0.0070596148496183415, 0.014357167788622316, 0.04150467996154127],
      trials: trials([
        ["always-short-control", true, null, 6_688, 0.801721643301314, -9.198278356698658, -10.17560715659439, 0.3672248803827751, 0, -10.55530645060122, 3_769.274263569657, 62.486721639639775],
        ["albert-short-high:z0", true, null, 5_952, 0.8948955104291717, -9.105104489570813, -10.160354025758606, 0.36794354838709675, 0, -10.270769083779467, 4_507.776936093723, 55.16134218490506],
        ["albert-short-high:z0.5", false, allFoldsUnder, 0, null, null, null, null, 0, null, 10_000, 0],
        ["albert-short-high:z1", false, allFoldsUnder, 0, null, null, null, null, 0, null, 10_000, 0],
        ["albert-short-low:z0", true, null, 736, 0.04822863087601244, -9.951771369123989, -12.411950566675596, 0.36141304347826086, 0, -12.424868902402638, 9_261.497327475929, 7.5964153541265675],
        ["albert-short-low:z0.5", true, null, 615, 1.1402116428915694, -8.859788357108435, -11.597966712189189, 0.37073170731707317, 0, -10.59652309132119, 9_449.885759004004, 5.79098533817151],
        ["albert-short-low:z1", false, "fewer than 100 trades in folds 1, 4", 478, 2.0251443820928725, -7.974855617907127, -11.150244560579555, 0.3891213389121339, 0, -11.324853584827835, 9_614.544104049575, 4.144287043746258],
      ]),
    },
    {
      holdMinutes: 240,
      replayReceiptHash: "sha256:8ed3f94af6b04a318c567827e696cb6f35aeb90428de88824aff324e59a4ff7a",
      eligiblePoints: 11_121,
      spearmanInformationCoefficientByFold: [0.06652445914406216, 0.008340974149408197, 0.03426584349281191, 0.12326942450071865],
      trials: trials([
        ["always-short-control", true, null, 1_669, 3.1144724602620593, -6.885527539737944, -10.72675422718245, 0.42660275614140203, 0, -12.34299954858946, 8_774.925700743084, 12.813848758325404],
        ["albert-short-high:z0", true, null, 1_507, 3.465346854973492, -6.53465314502651, -10.636365952400638, 0.43861977438619776, 0, -11.048160543818751, 8_944.680137057847, 11.0789801172622],
        ["albert-short-high:z0.5", false, allFoldsUnder, 0, null, null, null, null, 0, null, 10_000, 0],
        ["albert-short-high:z1", false, allFoldsUnder, 0, null, null, null, null, 0, null, 10_000, 0],
        ["albert-short-low:z0", false, allFoldsUnder, 205, -0.8320976708522502, -10.832097670852253, -20.78455587351295, 0.44878048780487806, 0, -15.401243182624697, 9_770.283479805677, 2.6324169341051205],
        ["albert-short-low:z0.5", false, allFoldsUnder, 174, 4.329138265673095, -5.670861734326904, -16.32285948828763, 0.47701149425287354, 1, -12.814919760951145, 9_895.001893869055, 1.5696762834967606],
        ["albert-short-low:z1", false, allFoldsUnder, 135, 8.405983680351948, -1.5940163196480515, -13.589555173967984, 0.48148148148148145, 1, -16.67686491707998, 9_973.62696253559, 0.708902404184407],
      ]),
    },
    {
      holdMinutes: 720,
      replayReceiptHash: "sha256:8356cbb223b9746841f3db80c1456940e140f95af96814136cc11bd3e5e8da8e",
      eligiblePoints: 11_049,
      spearmanInformationCoefficientByFold: [0.14572185729672746, 0.0663307863768852, 0.12242717872999555, 0.26714077764293853],
      trials: trials([
        ["always-short-control", true, null, 553, 9.269862867914998, -0.7301371320849979, -12.393343145078735, 0.4665461121157324, 3, -17.53755752775765, 9_882.691981271046, 4.45926455236839],
        ["albert-short-high:z0", true, null, 515, 11.057902681819558, 1.0579026818195518, -11.055359226925825, 0.4815533980582524, 3, -17.464971112182724, 9_982.59437493584, 4.154964064442812],
        ["albert-short-high:z0.5", false, allFoldsUnder, 0, null, null, null, null, 0, null, 10_000, 0],
        ["albert-short-high:z1", false, allFoldsUnder, 0, null, null, null, null, 0, null, 10_000, 0],
        ["albert-short-low:z0", false, allFoldsUnder, 87, -8.646804910323276, -18.646804910323272, -44.90810692320639, 0.3793103448275862, 1, -48.69519042736108, 9_828.221543326874, 2.2229192627470016],
        ["albert-short-low:z0.5", false, allFoldsUnder, 74, 6.595504289431139, -3.4044957105688596, -29.38723927434727, 0.44594594594594594, 1, -13.98490586539175, 9_968.07074284713, 0.9148661450069859],
        ["albert-short-low:z1", false, allFoldsUnder, 62, 9.477620559317419, -0.5223794406825855, -30.7705038995282, 0.4838709677419355, 3, -17.52176119070998, 9_990.355238407074, 0.834391298761843],
      ]),
    },
    {
      holdMinutes: 1_440,
      replayReceiptHash: "sha256:a75ee6f829eb7dc8b091608085084c1a39f1cafceafedd7086d1dd66a2826c0e",
      eligiblePoints: 10_941,
      spearmanInformationCoefficientByFold: [0.21968405339567257, 0.12386960921812712, 0.1059812996637027, 0.3356008176782541],
      trials: trials([
        ["always-short-control", false, allFoldsUnder, 275, 18.76533218592044, 8.765332185920439, -15.189555656379582, 0.5127272727272727, 3, -26.222740464262937, 10_161.096070235495, 3.59087190301579],
        ["albert-short-high:z0", false, allFoldsUnder, 258, 19.74541882796991, 9.745418827969912, -15.005290562537288, 0.4728682170542636, 3, -26.29149738646543, 10_176.334541326807, 3.4736210254500564],
        ["albert-short-high:z0.5", false, allFoldsUnder, 0, null, null, null, null, 0, null, 10_000, 0],
        ["albert-short-high:z1", false, allFoldsUnder, 0, null, null, null, null, 0, null, 10_000, 0],
        ["albert-short-low:z0", false, allFoldsUnder, 58, 17.05649281818638, 7.056492818186379, -43.37490820912151, 0.5344827586206896, 2, -43.20245167388162, 10_025.337663227732, 1.2614011232911244],
        ["albert-short-low:z0.5", false, allFoldsUnder, 50, 21.210531461595465, 11.210531461595485, -40.389408407010706, 0.54, 1, -27.40044128595172, 10_043.929398704979, 0.962152455513894],
        ["albert-short-low:z1", false, allFoldsUnder, 45, 41.502095086217274, 31.50209508621727, -20.514969077048637, 0.6, 3, -12.472833860678476, 10_131.488808702943, 0.8752812107654576],
      ]),
    },
  ],
  observedResult:
    "Every adequately sampled 1h and 4h row was net-negative after the frozen 10 bps cost stress. At 12h the broad Albert row was slightly positive but its confidence bound and worst fold were negative. The 24h low-tail z1 row stayed positive in aggregate, but it fell to three of four positive folds, had only 45 trades, failed every per-fold sample floor, and retained a negative confidence bound.",
  interpretation:
    "The added history weakened the 24h low-tail lead rather than confirming it, so it remains non-admissible. The 1h and 4h rows failed clearly; at 12h Albert improved only marginally over the always-short control and still lacked a positive confidence bound. Extending beyond 24h on this tape would reduce independence further.",
  invariants: {
    chartIntervalChangesFormulaSemantics: true,
    thresholdsUseTrainingRowsOnly: true,
    selectsWinner: false,
    registersStrategy: false,
    createsPaperBot: false,
    enablesExecution: false,
    preservesVerdictGate: true,
  },
} as const;
