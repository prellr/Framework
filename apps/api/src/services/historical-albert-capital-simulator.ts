/**
 * Read-only capital and fee simulator for frozen historical Albert holdout trades.
 *
 * The source artifact contains only retrospective test-fold observations. This service changes
 * presentation-time capital assumptions; it cannot alter a receipt, select a formula, register a
 * strategy, create a paper bot, or reach an execution route.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import {
  runFormulaCapitalBacktest,
  type FormulaCapitalSizing,
  type FormulaPaperTradeOutcome,
} from "./formulaic-capital-backtest.ts";

export const HISTORICAL_ALBERT_CAPITAL_SIMULATOR = {
  version: "alchemy-historical-albert-capital-simulator-v1",
  artifactVersion: "alchemy-historical-albert-trade-ledgers-v1",
  side: "short",
  defaultAssumptions: {
    initialCapitalUsd: 10_000,
    sizingMode: "fixed-notional",
    sizingValue: 1_000,
    compoundSizing: false,
    leverage: 1,
    plannedLossPct: 100,
    takerFeeBpsPerSide: 4.5,
    slippageBpsPerSide: 0.5,
    fundingBpsPerDay: 0,
  },
  feeDisclosure: {
    venue: "Hyperliquid perpetuals",
    defaultTier:
      "base tier 0 taker rate: 0.045% (4.5 bps) on each executed fill",
    sourceUrl: "https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees",
    exitFee:
      "charged against observed exit notional, not assumed equal to entry notional",
    slippage:
      "0.5 bps per side is an explicit editable illustration that preserves the prior 10 bps round-trip baseline near flat prices",
    funding:
      "historical funding is absent from OHLCV; the editable daily assumption defaults to zero",
  },
  invariants: {
    observationsAreHoldoutOnly: true,
    onePositionAtATime: true,
    riskBudgetIsSizingOnly: true,
    stopLossSimulated: false,
    selectsWinner: false,
    registersStrategy: false,
    createsPaperBot: false,
    enablesExecution: false,
  },
} as const;

export type HistoricalCapitalSizingMode =
  | "fixed-notional"
  | "equity-fraction-notional"
  | "fixed-risk"
  | "equity-fraction-risk";

export type HistoricalAlbertCapitalSimulationInput = {
  chartIntervalMinutes: 5 | 60;
  holdMinutes: number;
  trialId: string;
  initialCapitalUsd: number;
  sizingMode: HistoricalCapitalSizingMode;
  /** Dollars for fixed modes; percent of equity for fraction modes. */
  sizingValue: number;
  compoundSizing: boolean;
  leverage: number;
  /** Planned loss used to translate a risk budget into notional. No stop is simulated. */
  plannedLossPct: number;
  takerFeeBpsPerSide: number;
  slippageBpsPerSide: number;
  /** Positive values are paid; negative values are received. */
  fundingBpsPerDay: number;
  page: number;
  pageSize: number;
};

type TradeTuple = readonly [
  entryAtMs: number,
  entryPrice: number,
  exitPrice: number,
];

type TradeLedgerTrial = {
  id: string;
  available: boolean;
  unavailableReason: string | null;
  scoredStartAtMs: number | null;
  scoredEndAtMs: number | null;
  trades: TradeTuple[];
};

type TradeLedgerExperiment = {
  id: string;
  chartIntervalMinutes: 5 | 60;
  holdMinutes: number;
  datasetStartAtMs: number;
  datasetEndAtMs: number;
  foldTestStartAtMs: number[];
  trials: TradeLedgerTrial[];
};

type TradeLedgerArtifact = {
  version: string;
  evidenceClass: string;
  sourceDataset: {
    id: string;
    version: string;
    contentHash: string;
    rows: number;
    startAtMs: number;
    endAtMs: number;
  };
  experiments: TradeLedgerExperiment[];
};

type ArtifactEnvelope = {
  contentHash: string;
  payload: TradeLedgerArtifact;
};

function loadArtifact(): ArtifactEnvelope {
  const artifactPath = fileURLToPath(new URL(
    "../data/historical-albert-trade-ledgers-v1.json.gz",
    import.meta.url,
  ));
  const envelope = JSON.parse(
    gunzipSync(readFileSync(artifactPath)).toString("utf8"),
  ) as ArtifactEnvelope;
  const actualHash =
    `sha256:${createHash("sha256").update(JSON.stringify(envelope.payload)).digest("hex")}`;
  if (
    envelope.contentHash !== actualHash
    || envelope.payload.version !==
      HISTORICAL_ALBERT_CAPITAL_SIMULATOR.artifactVersion
  ) {
    throw new Error("historical Albert trade-ledger artifact failed integrity validation");
  }
  return envelope;
}

const ARTIFACT = loadArtifact();

export const HISTORICAL_ALBERT_TRADE_LEDGER_IDENTITY = {
  version: ARTIFACT.payload.version,
  contentHash: ARTIFACT.contentHash,
  evidenceClass: ARTIFACT.payload.evidenceClass,
  sourceDataset: ARTIFACT.payload.sourceDataset,
  experiments: ARTIFACT.payload.experiments.length,
  trialRows: ARTIFACT.payload.experiments.reduce(
    (sum, experiment) => sum + experiment.trials.length,
    0,
  ),
  trades: ARTIFACT.payload.experiments.reduce(
    (experimentSum, experiment) =>
      experimentSum
      + experiment.trials.reduce(
        (trialSum, trial) => trialSum + trial.trades.length,
        0,
      ),
    0,
  ),
} as const;

function sizing(input: HistoricalAlbertCapitalSimulationInput): FormulaCapitalSizing {
  switch (input.sizingMode) {
    case "fixed-notional":
      return { mode: "fixed-notional", notionalUsd: input.sizingValue };
    case "equity-fraction-notional":
      return { mode: "equity-fraction-notional", fraction: input.sizingValue / 100 };
    case "fixed-risk":
      return { mode: "fixed-risk", riskUsd: input.sizingValue };
    case "equity-fraction-risk":
      return { mode: "equity-fraction-risk", fraction: input.sizingValue / 100 };
  }
}

function downsample<T>(rows: T[], maximum = 600): T[] {
  if (rows.length <= maximum) return rows;
  const sampled: T[] = [];
  for (let index = 0; index < maximum; index += 1) {
    sampled.push(rows[Math.round(index * (rows.length - 1) / (maximum - 1))]!);
  }
  return sampled;
}

function assertInput(input: HistoricalAlbertCapitalSimulationInput) {
  const fractionMode =
    input.sizingMode === "equity-fraction-notional"
    || input.sizingMode === "equity-fraction-risk";
  if (
    !Number.isFinite(input.initialCapitalUsd)
    || input.initialCapitalUsd < 100
    || input.initialCapitalUsd > 100_000_000
    || !Number.isFinite(input.sizingValue)
    || input.sizingValue <= 0
    || (fractionMode && input.sizingValue > 100)
    || !Number.isFinite(input.leverage)
    || input.leverage < 1
    || input.leverage > 50
    || !Number.isFinite(input.plannedLossPct)
    || input.plannedLossPct <= 0
    || input.plannedLossPct > 100
    || !Number.isFinite(input.takerFeeBpsPerSide)
    || input.takerFeeBpsPerSide < -10
    || input.takerFeeBpsPerSide > 100
    || !Number.isFinite(input.slippageBpsPerSide)
    || input.slippageBpsPerSide < 0
    || input.slippageBpsPerSide > 100
    || !Number.isFinite(input.fundingBpsPerDay)
    || input.fundingBpsPerDay < -1_000
    || input.fundingBpsPerDay > 1_000
    || !Number.isSafeInteger(input.page)
    || input.page < 1
    || !Number.isSafeInteger(input.pageSize)
    || input.pageSize < 10
    || input.pageSize > 200
  ) {
    throw new Error("invalid historical capital simulation input");
  }
}

export function simulateHistoricalAlbertCapital(
  input: HistoricalAlbertCapitalSimulationInput,
) {
  assertInput(input);
  const experiment = ARTIFACT.payload.experiments.find(
    (candidate) =>
      candidate.chartIntervalMinutes === input.chartIntervalMinutes
      && candidate.holdMinutes === input.holdMinutes,
  );
  const trial = experiment?.trials.find((candidate) => candidate.id === input.trialId);
  if (!experiment || !trial) {
    throw new Error("historical Formula Lab trade ledger was not found");
  }

  const holdDays = input.holdMinutes / (24 * 60);
  const entryCostRate =
    (input.takerFeeBpsPerSide + input.slippageBpsPerSide) / 10_000;
  const fundingCostRate = input.fundingBpsPerDay * holdDays / 10_000;
  const tradeSource = new Map<string, {
    entryPrice: number;
    exitPrice: number;
    grossReturn: number;
    tradingCostRate: number;
    fundingCostRate: number;
  }>();
  const outcomes: FormulaPaperTradeOutcome[] = trial.trades.map((tuple, index) => {
    const [entryAtMs, entryPrice, exitPrice] = tuple;
    const exitAtMs = entryAtMs + input.holdMinutes * 60_000;
    const grossReturn = (entryPrice - exitPrice) / entryPrice;
    const exitCostRate = entryCostRate * exitPrice / entryPrice;
    const tradingCostRate = entryCostRate + exitCostRate;
    const id = `${experiment.id}:${trial.id}:${index + 1}`;
    tradeSource.set(id, {
      entryPrice,
      exitPrice,
      grossReturn,
      tradingCostRate,
      fundingCostRate,
    });
    return {
      id,
      targetKey: `${experiment.id}:${trial.id}`,
      entryAtMs,
      exitAtMs,
      netReturnOnNotional:
        grossReturn - tradingCostRate - fundingCostRate,
      riskPerNotional: input.plannedLossPct / 100,
      capitalRequiredPerNotional: 1 / input.leverage,
      priority: 0,
    };
  });
  const result = runFormulaCapitalBacktest({
    trades: outcomes,
    config: {
      initialCapitalUsd: input.initialCapitalUsd,
      sizing: sizing(input),
      compoundSizing: input.compoundSizing,
      minimumNotionalUsd: 1,
      maximumNotionalUsd: input.initialCapitalUsd * input.leverage,
      maximumGrossExposureFraction: input.leverage,
      maximumConcurrentPositions: 1,
      liquidationEquityUsd: 0,
      captureTradeLedger: true,
    },
  });
  const equityByExit = new Map(
    result.equityCurve.map((point) => [point.atMs, point.equityUsd]),
  );
  const detailedTrades = result.trades.map((trade, index) => {
    const source = tradeSource.get(trade.id)!;
    return {
      sequence: index + 1,
      entryAtMs: trade.entryAtMs,
      exitAtMs: trade.exitAtMs,
      entryPrice: source.entryPrice,
      exitPrice: source.exitPrice,
      notionalUsd: trade.notionalUsd,
      plannedRiskUsd: trade.plannedRiskUsd,
      grossReturnBps: source.grossReturn * 10_000,
      tradingCostUsd: source.tradingCostRate * trade.notionalUsd,
      fundingCostUsd: source.fundingCostRate * trade.notionalUsd,
      netReturnBps: trade.netReturnOnNotional * 10_000,
      pnlUsd: trade.pnlUsd,
      equityAfterUsd: equityByExit.get(trade.exitAtMs) ?? null,
      riskBreached: trade.riskBreached,
    };
  });
  const startIndex = (input.page - 1) * input.pageSize;
  const initialCurveAtMs =
    detailedTrades[0]?.entryAtMs
    ?? trial.scoredStartAtMs
    ?? experiment.datasetStartAtMs;

  return {
    version: HISTORICAL_ALBERT_CAPITAL_SIMULATOR.version,
    contentHash: ARTIFACT.contentHash,
    evidenceClass: ARTIFACT.payload.evidenceClass,
    selection: {
      experimentId: experiment.id,
      chartIntervalMinutes: experiment.chartIntervalMinutes,
      holdMinutes: experiment.holdMinutes,
      trialId: trial.id,
      available: trial.available,
      unavailableReason: trial.unavailableReason,
    },
    period: {
      sourceStartAtMs: experiment.datasetStartAtMs,
      sourceEndAtMs: experiment.datasetEndAtMs,
      scoredStartAtMs: trial.scoredStartAtMs,
      scoredEndAtMs: trial.scoredEndAtMs,
      foldTestStartAtMs: experiment.foldTestStartAtMs,
    },
    feeModel: {
      takerFeeBpsPerSide: input.takerFeeBpsPerSide,
      slippageBpsPerSide: input.slippageBpsPerSide,
      fundingBpsPerDay: input.fundingBpsPerDay,
      holdDays,
      disclosure: HISTORICAL_ALBERT_CAPITAL_SIMULATOR.feeDisclosure,
    },
    sizing: {
      mode: input.sizingMode,
      value: input.sizingValue,
      compoundSizing: input.compoundSizing,
      leverage: input.leverage,
      plannedLossPct: input.plannedLossPct,
      disclosure:
        "Risk-based sizing uses the planned-loss percentage only to derive notional. No stop is simulated, so realized loss can exceed the budget.",
    },
    summary: {
      proposedTrades: result.proposedTrades,
      executedTrades: result.executedTrades,
      skippedTrades: result.skippedTrades,
      skippedByReason: result.skippedByReason,
      startingCapitalUsd: result.startingCapitalUsd,
      finalEquityUsd: result.finalEquityUsd,
      totalPnlUsd: result.totalPnlUsd,
      totalReturnPct: result.totalReturnPct,
      peakEquityUsd: result.peakEquityUsd,
      minimumEquityUsd: result.minimumEquityUsd,
      maximumDrawdownUsd: result.maximumDrawdownUsd,
      maximumDrawdownPct: result.maximumDrawdownPct,
      maximumGrossExposureUsd: result.maximumGrossExposureUsd,
      maximumCapitalReservedUsd: result.maximumCapitalReservedUsd,
      totalNotionalUsd: result.totalNotionalUsd,
      averageNotionalUsd: result.averageNotionalUsd,
      averagePlannedRiskUsd: result.averagePlannedRiskUsd,
      wins: result.wins,
      losses: result.losses,
      flats: result.flats,
      winRate: result.winRate,
      profitFactor: result.profitFactor,
      largestWinUsd: result.largestWinUsd,
      largestLossUsd: result.largestLossUsd,
      riskBreaches: result.riskBreaches,
      liquidated: result.liquidated,
      liquidationAtMs: result.liquidationAtMs,
    },
    equityCurve: downsample([
      {
        atMs: initialCurveAtMs,
        equityUsd: result.startingCapitalUsd,
        drawdownUsd: 0,
        drawdownPct: 0,
      },
      ...result.equityCurve,
    ]),
    trades: {
      page: input.page,
      pageSize: input.pageSize,
      total: detailedTrades.length,
      pages: Math.max(1, Math.ceil(detailedTrades.length / input.pageSize)),
      rows: detailedTrades.slice(startIndex, startIndex + input.pageSize),
    },
    invariants: HISTORICAL_ALBERT_CAPITAL_SIMULATOR.invariants,
  };
}
