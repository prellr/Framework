import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  FORMULAIC_CAPITAL_BACKTEST,
  runFormulaCapitalBacktest,
  type FormulaCapitalBacktestConfig,
  type FormulaPaperTradeOutcome,
} from "./formulaic-capital-backtest.ts";

const baseConfig: FormulaCapitalBacktestConfig = {
  initialCapitalUsd: 10_000,
  sizing: { mode: "fixed-notional", notionalUsd: 1_000 },
  compoundSizing: false,
  minimumNotionalUsd: 1,
  maximumNotionalUsd: 100_000,
  maximumGrossExposureFraction: 10,
  maximumConcurrentPositions: 10,
  liquidationEquityUsd: 0,
  captureTradeLedger: true,
};

function trade(
  id: string,
  entryAtMs: number,
  netReturnOnNotional: number,
  overrides: Partial<FormulaPaperTradeOutcome> = {},
): FormulaPaperTradeOutcome {
  return {
    id,
    targetKey: "BTC-USD:test",
    entryAtMs,
    exitAtMs: entryAtMs + 600_000,
    netReturnOnNotional,
    riskPerNotional: 1,
    capitalRequiredPerNotional: 1,
    priority: 0,
    ...overrides,
  };
}

test("fixed-notional backtest compounds P&L only when configured", () => {
  const trades = [
    trade("a", 1_900_000_000_000, 0.1),
    trade("b", 1_900_000_600_000, -0.05),
    trade("c", 1_900_001_200_000, 0.2),
  ];
  const result = runFormulaCapitalBacktest({ trades, config: baseConfig });
  assert.equal(result.executedTrades, 3);
  assert.equal(result.totalNotionalUsd, 3_000);
  assert.equal(result.totalPnlUsd, 250);
  assert.equal(result.finalEquityUsd, 10_250);
  assert.equal(result.totalReturnPct, 2.499999999999991);
  assert.equal(result.wins, 2);
  assert.equal(result.losses, 1);
  assert.equal(result.profitFactor, 6);
  assert.equal(result.maximumDrawdownUsd, 50);
  assert.equal(result.riskBreaches, 0);
  assert.equal(result.trades.length, 3);
});

test("equity-fraction sizing follows the realized capital path", () => {
  const trades = [
    trade("a", 1_900_000_000_000, 0.1),
    trade("b", 1_900_000_600_000, 0.1),
  ];
  const compounded = runFormulaCapitalBacktest({
    trades,
    config: {
      ...baseConfig,
      sizing: { mode: "equity-fraction-notional", fraction: 0.1 },
      compoundSizing: true,
    },
  });
  assert.equal(compounded.trades[0].notionalUsd, 1_000);
  assert.equal(compounded.trades[1].notionalUsd, 1_010);
  assert.equal(compounded.finalEquityUsd, 10_201);
  const fixedBase = runFormulaCapitalBacktest({
    trades,
    config: {
      ...baseConfig,
      sizing: { mode: "equity-fraction-notional", fraction: 0.1 },
      compoundSizing: false,
    },
  });
  assert.equal(fixedBase.trades[1].notionalUsd, 1_000);
  assert.equal(fixedBase.finalEquityUsd, 10_200);
});

test("risk sizing preserves the dollar-loss budget across target economics", () => {
  const at = 1_900_000_000_000;
  const result = runFormulaCapitalBacktest({
    trades: [
      trade("polymarket", at, 0.5, {
        targetKey: "BTC-USD:polymarket-down",
        riskPerNotional: 1,
        capitalRequiredPerNotional: 1,
      }),
      trade("perp", at, 0.01, {
        targetKey: "BTC-USD:hyperliquid-perp",
        riskPerNotional: 0.02,
        capitalRequiredPerNotional: 0.1,
        priority: 1,
      }),
    ],
    config: {
      ...baseConfig,
      sizing: { mode: "fixed-risk", riskUsd: 100 },
      maximumGrossExposureFraction: 2,
    },
  });
  const prediction = result.trades.find((row) => row.id === "polymarket");
  const perp = result.trades.find((row) => row.id === "perp");
  assert.equal(prediction?.notionalUsd, 100);
  assert.equal(prediction?.plannedRiskUsd, 100);
  assert.equal(perp?.notionalUsd, 5_000);
  assert.equal(perp?.plannedRiskUsd, 100);
  assert.equal(prediction?.capitalReservedUsd, 100);
  assert.equal(perp?.capitalReservedUsd, 500);
});

test("concurrency, exposure, and simultaneous priority are deterministic", () => {
  const at = 1_900_000_000_000;
  const result = runFormulaCapitalBacktest({
    trades: [
      trade("later-priority", at, 0.1, { priority: 2 }),
      trade("first-priority", at, 0.1, { priority: 1 }),
      trade("same-priority-z", at, 0.1, { priority: 1 }),
    ],
    config: {
      ...baseConfig,
      maximumConcurrentPositions: 1,
    },
  });
  assert.equal(result.executedTrades, 1);
  assert.equal(result.skippedByReason.concurrentLimit, 2);
  assert.equal(result.trades[0].id, "first-priority");
});

test("capital constraints resize positions and record true risk breaches", () => {
  const at = 1_900_000_000_000;
  const result = runFormulaCapitalBacktest({
    trades: [
      trade("loss", at, -0.2, {
        riskPerNotional: 0.1,
        capitalRequiredPerNotional: 1,
      }),
      trade("capacity", at, 0.1, {
        riskPerNotional: 0.1,
        capitalRequiredPerNotional: 1,
        priority: 1,
      }),
    ],
    config: {
      ...baseConfig,
      initialCapitalUsd: 1_000,
      sizing: { mode: "fixed-notional", notionalUsd: 800 },
      maximumGrossExposureFraction: 1,
      maximumNotionalUsd: 1_000,
    },
  });
  const loss = result.trades.find((row) => row.id === "loss");
  const capacity = result.trades.find((row) => row.id === "capacity");
  assert.equal(loss?.notionalUsd, 800);
  assert.equal(loss?.plannedRiskUsd, 80);
  assert.equal(loss?.pnlUsd, -160);
  assert.equal(result.riskBreaches, 1);
  assert.equal(capacity?.notionalUsd, 200);
  assert.equal(result.maximumGrossExposureUsd, 1_000);
  assert.equal(result.maximumCapitalReservedUsd, 1_000);
  assert.equal(result.finalEquityUsd, 860);
});

test("capital simulator contains no market-data, persistence, or execution dependency", () => {
  assert.deepEqual(FORMULAIC_CAPITAL_BACKTEST.invariants, {
    targetEconomicsRequired: true,
    riskBudgetIsMaximumPlannedLoss: true,
    realizedLossMayBreachRiskBudget: true,
    noSyntheticIntratradeDrawdown: true,
    createsStrategy: false,
    createsPaperBot: false,
    enablesExecution: false,
  });
  const source = readFileSync(
    new URL("./formulaic-capital-backtest.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /from\s+["'][^"']*(?:db|router|worker|paper-floor|crucible)/i,
  );
  assert.doesNotMatch(
    source,
    /\b(?:fetch\s*\(|placeOrder|submitOrder|privateKey|paperTrades|db\.)/i,
  );
});
