/**
 * Target-neutral path-dependent capital simulator for Formula Lab.
 *
 * A target adapter must state three economics explicitly for every completed paper trade:
 * net return on notional, maximum planned loss per dollar of notional, and capital reserved per
 * dollar of notional. This prevents a Polymarket stake, a fully funded spot position, and a
 * margined perpetual from silently sharing incompatible meanings of "risk".
 *
 * The simulator is pure and read-only. It never fetches prices, places an order, registers a
 * strategy, or mutates a paper ledger.
 */
export const FORMULAIC_CAPITAL_BACKTEST = {
  version: "alchemy-formula-capital-backtest-v1",
  simultaneousEntryPolicy:
    "lower numeric priority first, then stable trade id",
  equityMarking:
    "realized equity at grouped exit timestamps; no fabricated intratrade mark",
  invariants: {
    targetEconomicsRequired: true,
    riskBudgetIsMaximumPlannedLoss: true,
    realizedLossMayBreachRiskBudget: true,
    noSyntheticIntratradeDrawdown: true,
    createsStrategy: false,
    createsPaperBot: false,
    enablesExecution: false,
  },
} as const;

export type FormulaCapitalSizing =
  | { mode: "fixed-notional"; notionalUsd: number }
  | { mode: "equity-fraction-notional"; fraction: number }
  | { mode: "fixed-risk"; riskUsd: number }
  | { mode: "equity-fraction-risk"; fraction: number };

export type FormulaCapitalBacktestConfig = {
  initialCapitalUsd: number;
  sizing: FormulaCapitalSizing;
  compoundSizing: boolean;
  minimumNotionalUsd: number;
  maximumNotionalUsd: number;
  maximumGrossExposureFraction: number;
  maximumConcurrentPositions: number;
  liquidationEquityUsd: number;
  captureTradeLedger?: boolean;
};

export type FormulaPaperTradeOutcome = {
  id: string;
  targetKey: string;
  entryAtMs: number;
  exitAtMs: number;
  /** Includes target-specific fees, spread, slippage, funding, and exit economics. */
  netReturnOnNotional: number;
  /** Maximum planned loss in dollars per $1 notional; required for risk-based sizing. */
  riskPerNotional: number;
  /** Cash or margin reserved in dollars per $1 notional while the position is open. */
  capitalRequiredPerNotional: number;
  /** Lower values receive scarce simultaneous capacity first. Must be preregistered. */
  priority: number;
};

export type FormulaCapitalTradeLedgerRow = {
  id: string;
  targetKey: string;
  entryAtMs: number;
  exitAtMs: number;
  notionalUsd: number;
  plannedRiskUsd: number;
  capitalReservedUsd: number;
  netReturnOnNotional: number;
  pnlUsd: number;
  riskBreached: boolean;
};

export type FormulaCapitalBacktestResult = {
  version: typeof FORMULAIC_CAPITAL_BACKTEST.version;
  config: FormulaCapitalBacktestConfig;
  proposedTrades: number;
  executedTrades: number;
  skippedTrades: number;
  skippedByReason: {
    liquidated: number;
    concurrentLimit: number;
    exposureOrCapital: number;
    belowMinimumNotional: number;
  };
  startingCapitalUsd: number;
  finalEquityUsd: number;
  totalPnlUsd: number;
  totalReturnPct: number;
  peakEquityUsd: number;
  minimumEquityUsd: number;
  maximumDrawdownUsd: number;
  maximumDrawdownPct: number;
  maximumGrossExposureUsd: number;
  maximumCapitalReservedUsd: number;
  totalNotionalUsd: number;
  totalPlannedRiskUsd: number;
  averageNotionalUsd: number | null;
  averagePlannedRiskUsd: number | null;
  wins: number;
  losses: number;
  flats: number;
  winRate: number | null;
  grossProfitUsd: number;
  grossLossUsd: number;
  profitFactor: number | null;
  averagePnlUsd: number | null;
  largestWinUsd: number | null;
  largestLossUsd: number | null;
  riskBreaches: number;
  liquidated: boolean;
  liquidationAtMs: number | null;
  tradeLedgerCaptured: boolean;
  trades: FormulaCapitalTradeLedgerRow[];
  equityCurve: Array<{
    atMs: number;
    equityUsd: number;
    drawdownUsd: number;
    drawdownPct: number;
  }>;
};

type OpenPosition = FormulaCapitalTradeLedgerRow;
type SkipReason = keyof FormulaCapitalBacktestResult["skippedByReason"];

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function validateConfig(config: FormulaCapitalBacktestConfig) {
  if (
    !finitePositive(config.initialCapitalUsd)
    || !Number.isFinite(config.minimumNotionalUsd)
    || config.minimumNotionalUsd < 0
    || !finitePositive(config.maximumNotionalUsd)
    || config.maximumNotionalUsd < config.minimumNotionalUsd
    || !finitePositive(config.maximumGrossExposureFraction)
    || !Number.isSafeInteger(config.maximumConcurrentPositions)
    || config.maximumConcurrentPositions < 1
    || !Number.isFinite(config.liquidationEquityUsd)
    || config.liquidationEquityUsd < 0
    || config.liquidationEquityUsd >= config.initialCapitalUsd
  ) {
    throw new Error("invalid formula capital backtest config");
  }
  const sizing = config.sizing;
  if (
    (sizing.mode === "fixed-notional" && !finitePositive(sizing.notionalUsd))
    || (sizing.mode === "fixed-risk" && !finitePositive(sizing.riskUsd))
    || (
      (sizing.mode === "equity-fraction-notional"
        || sizing.mode === "equity-fraction-risk")
      && (!finitePositive(sizing.fraction) || sizing.fraction > 1)
    )
  ) {
    throw new Error("invalid formula capital sizing");
  }
}

function validateTrades(trades: FormulaPaperTradeOutcome[]) {
  const ids = new Set<string>();
  for (const trade of trades) {
    if (
      !trade.id
      || ids.has(trade.id)
      || !trade.targetKey
      || !Number.isSafeInteger(trade.entryAtMs)
      || !Number.isSafeInteger(trade.exitAtMs)
      || trade.exitAtMs <= trade.entryAtMs
      || !Number.isFinite(trade.netReturnOnNotional)
      || !finitePositive(trade.riskPerNotional)
      || !finitePositive(trade.capitalRequiredPerNotional)
      || !Number.isSafeInteger(trade.priority)
      || trade.priority < 0
    ) {
      throw new Error(
        "formula paper outcomes require unique ids, valid clocks, and explicit target economics",
      );
    }
    ids.add(trade.id);
  }
}

function desiredNotional(
  config: FormulaCapitalBacktestConfig,
  sizingEquityUsd: number,
  trade: FormulaPaperTradeOutcome,
): number {
  switch (config.sizing.mode) {
    case "fixed-notional":
      return config.sizing.notionalUsd;
    case "equity-fraction-notional":
      return sizingEquityUsd * config.sizing.fraction;
    case "fixed-risk":
      return config.sizing.riskUsd / trade.riskPerNotional;
    case "equity-fraction-risk":
      return sizingEquityUsd * config.sizing.fraction
        / trade.riskPerNotional;
  }
}

export function runFormulaCapitalBacktest(input: {
  trades: FormulaPaperTradeOutcome[];
  config: FormulaCapitalBacktestConfig;
}): FormulaCapitalBacktestResult {
  validateConfig(input.config);
  validateTrades(input.trades);
  const config = {
    ...input.config,
    sizing: { ...input.config.sizing },
    captureTradeLedger: input.config.captureTradeLedger ?? false,
  };
  const entryGroups = new Map<number, FormulaPaperTradeOutcome[]>();
  const exitTimes = new Set<number>();
  for (const trade of input.trades) {
    const group = entryGroups.get(trade.entryAtMs) ?? [];
    group.push(trade);
    entryGroups.set(trade.entryAtMs, group);
    exitTimes.add(trade.exitAtMs);
  }
  const eventTimes = [...new Set([
    ...entryGroups.keys(),
    ...exitTimes,
  ])].sort((left, right) => left - right);
  const open = new Map<string, OpenPosition>();
  const ledger: FormulaCapitalTradeLedgerRow[] = [];
  const equityCurve: FormulaCapitalBacktestResult["equityCurve"] = [];
  const skippedByReason: Record<SkipReason, number> = {
    liquidated: 0,
    concurrentLimit: 0,
    exposureOrCapital: 0,
    belowMinimumNotional: 0,
  };
  let equity = config.initialCapitalUsd;
  let peakEquity = equity;
  let minimumEquity = equity;
  let maximumDrawdownUsd = 0;
  let maximumDrawdownPct = 0;
  let grossExposure = 0;
  let capitalReserved = 0;
  let maximumGrossExposureUsd = 0;
  let maximumCapitalReservedUsd = 0;
  let totalNotionalUsd = 0;
  let totalPlannedRiskUsd = 0;
  let grossProfitUsd = 0;
  let grossLossUsd = 0;
  let pnlSum = 0;
  let wins = 0;
  let losses = 0;
  let flats = 0;
  let largestWinUsd: number | null = null;
  let largestLossUsd: number | null = null;
  let riskBreaches = 0;
  let liquidated = false;
  let liquidationAtMs: number | null = null;
  let executedTrades = 0;

  const skip = (reason: SkipReason) => {
    skippedByReason[reason]++;
  };

  for (const atMs of eventTimes) {
    // All positions sharing an exit timestamp settle as one equity mark. This avoids inventing an
    // order-dependent intratimestamp drawdown.
    const exiting = [...open.values()]
      .filter((position) => position.exitAtMs === atMs)
      .sort((left, right) => left.id.localeCompare(right.id));
    if (exiting.length) {
      let timestampPnl = 0;
      for (const position of exiting) {
        open.delete(position.id);
        grossExposure -= position.notionalUsd;
        capitalReserved -= position.capitalReservedUsd;
        timestampPnl += position.pnlUsd;
        pnlSum += position.pnlUsd;
        if (position.pnlUsd > 0) {
          wins++;
          grossProfitUsd += position.pnlUsd;
          largestWinUsd = largestWinUsd == null
            ? position.pnlUsd
            : Math.max(largestWinUsd, position.pnlUsd);
        } else if (position.pnlUsd < 0) {
          losses++;
          grossLossUsd += -position.pnlUsd;
          largestLossUsd = largestLossUsd == null
            ? position.pnlUsd
            : Math.min(largestLossUsd, position.pnlUsd);
        } else {
          flats++;
        }
        if (position.riskBreached) riskBreaches++;
        if (config.captureTradeLedger) ledger.push(position);
      }
      equity += timestampPnl;
      peakEquity = Math.max(peakEquity, equity);
      minimumEquity = Math.min(minimumEquity, equity);
      const drawdownUsd = Math.max(0, peakEquity - equity);
      const drawdownPct = peakEquity > 0 ? drawdownUsd / peakEquity : 0;
      maximumDrawdownUsd = Math.max(maximumDrawdownUsd, drawdownUsd);
      maximumDrawdownPct = Math.max(maximumDrawdownPct, drawdownPct);
      equityCurve.push({ atMs, equityUsd: equity, drawdownUsd, drawdownPct });
      if (!liquidated && equity <= config.liquidationEquityUsd) {
        liquidated = true;
        liquidationAtMs = atMs;
      }
    }

    const entering = (entryGroups.get(atMs) ?? [])
      .slice()
      .sort((left, right) =>
        left.priority - right.priority || left.id.localeCompare(right.id));
    for (const trade of entering) {
      if (liquidated || equity <= config.liquidationEquityUsd) {
        skip("liquidated");
        continue;
      }
      if (open.size >= config.maximumConcurrentPositions) {
        skip("concurrentLimit");
        continue;
      }
      const sizingEquity = config.compoundSizing
        ? Math.max(0, equity)
        : config.initialCapitalUsd;
      const requestedNotional = Math.min(
        config.maximumNotionalUsd,
        desiredNotional(config, sizingEquity, trade),
      );
      const exposureCapacity = Math.max(
        0,
        config.maximumGrossExposureFraction * Math.max(0, equity)
          - grossExposure,
      );
      const freeCapital = Math.max(0, equity - capitalReserved);
      const capitalCapacity =
        freeCapital / trade.capitalRequiredPerNotional;
      const notionalUsd = Math.min(
        requestedNotional,
        exposureCapacity,
        capitalCapacity,
      );
      if (!finitePositive(notionalUsd)) {
        skip("exposureOrCapital");
        continue;
      }
      if (notionalUsd + 1e-9 < config.minimumNotionalUsd) {
        skip("belowMinimumNotional");
        continue;
      }
      const plannedRiskUsd = notionalUsd * trade.riskPerNotional;
      const capitalReservedUsd =
        notionalUsd * trade.capitalRequiredPerNotional;
      const pnlUsd = notionalUsd * trade.netReturnOnNotional;
      const position: OpenPosition = {
        id: trade.id,
        targetKey: trade.targetKey,
        entryAtMs: trade.entryAtMs,
        exitAtMs: trade.exitAtMs,
        notionalUsd,
        plannedRiskUsd,
        capitalReservedUsd,
        netReturnOnNotional: trade.netReturnOnNotional,
        pnlUsd,
        riskBreached: pnlUsd < -plannedRiskUsd - 1e-9,
      };
      open.set(position.id, position);
      executedTrades++;
      totalNotionalUsd += notionalUsd;
      totalPlannedRiskUsd += plannedRiskUsd;
      grossExposure += notionalUsd;
      capitalReserved += capitalReservedUsd;
      maximumGrossExposureUsd = Math.max(
        maximumGrossExposureUsd,
        grossExposure,
      );
      maximumCapitalReservedUsd = Math.max(
        maximumCapitalReservedUsd,
        capitalReserved,
      );
    }
  }

  if (open.size) {
    throw new Error("formula capital backtest ended with unsettled positions");
  }
  const skippedTrades = Object.values(skippedByReason)
    .reduce((sum, value) => sum + value, 0);
  return {
    version: FORMULAIC_CAPITAL_BACKTEST.version,
    config,
    proposedTrades: input.trades.length,
    executedTrades,
    skippedTrades,
    skippedByReason,
    startingCapitalUsd: config.initialCapitalUsd,
    finalEquityUsd: equity,
    totalPnlUsd: pnlSum,
    totalReturnPct:
      100 * (equity / config.initialCapitalUsd - 1),
    peakEquityUsd: peakEquity,
    minimumEquityUsd: minimumEquity,
    maximumDrawdownUsd,
    maximumDrawdownPct: maximumDrawdownPct * 100,
    maximumGrossExposureUsd,
    maximumCapitalReservedUsd,
    totalNotionalUsd,
    totalPlannedRiskUsd,
    averageNotionalUsd:
      executedTrades ? totalNotionalUsd / executedTrades : null,
    averagePlannedRiskUsd:
      executedTrades ? totalPlannedRiskUsd / executedTrades : null,
    wins,
    losses,
    flats,
    winRate: executedTrades ? wins / executedTrades : null,
    grossProfitUsd,
    grossLossUsd,
    profitFactor:
      grossLossUsd > 0
        ? grossProfitUsd / grossLossUsd
        : grossProfitUsd > 0
          ? Number.POSITIVE_INFINITY
          : null,
    averagePnlUsd: executedTrades ? pnlSum / executedTrades : null,
    largestWinUsd,
    largestLossUsd,
    riskBreaches,
    liquidated,
    liquidationAtMs,
    tradeLedgerCaptured: config.captureTradeLedger,
    trades: ledger,
    equityCurve,
  };
}
