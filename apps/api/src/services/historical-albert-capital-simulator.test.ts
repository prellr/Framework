import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  HISTORICAL_ALBERT_CAPITAL_SIMULATOR,
  simulateHistoricalAlbertCapital,
  type HistoricalAlbertCapitalSimulationInput,
} from "./historical-albert-capital-simulator.ts";

const selectedTrial: HistoricalAlbertCapitalSimulationInput = {
  chartIntervalMinutes: 60,
  holdMinutes: 1_440,
  trialId: "albert-short-low:z1",
  initialCapitalUsd: 10_000,
  sizingMode: "fixed-notional",
  sizingValue: 1_000,
  compoundSizing: false,
  leverage: 1,
  plannedLossPct: 100,
  takerFeeBpsPerSide: 4.5,
  slippageBpsPerSide: 0.5,
  fundingBpsPerDay: 0,
  page: 1,
  pageSize: 50,
};

test("historical simulator exposes the exact scored period and paginated trade path", () => {
  const result = simulateHistoricalAlbertCapital(selectedTrial);
  assert.equal(result.summary.startingCapitalUsd, 10_000);
  assert.equal(result.summary.executedTrades, 45);
  assert.equal(result.summary.wins, 27);
  assert.equal(result.summary.losses, 18);
  assert.equal(result.summary.winRate, 0.6);
  assert.equal(result.summary.finalEquityUsd, 10_131.577053107298);
  assert.equal(result.period.sourceStartAtMs, 1_742_641_200_000);
  assert.equal(result.period.sourceEndAtMs, 1_784_948_399_999);
  assert.equal(result.period.scoredStartAtMs, 1_761_073_200_000);
  assert.equal(result.period.scoredEndAtMs, 1_784_660_400_000);
  assert.equal(result.period.foldTestStartAtMs.length, 4);
  assert.equal(result.trades.total, 45);
  assert.equal(result.trades.rows[0]?.entryPrice, 111_940);
  assert.equal(result.trades.rows[0]?.exitPrice, 107_978);
  assert.equal(result.trades.rows[0]?.equityAfterUsd, 10_034.411658031087);
  assert.equal(result.equityCurve[0]?.equityUsd, 10_000);
  assert.equal(result.equityCurve.at(-1)?.equityUsd, result.summary.finalEquityUsd);
});

test("Hyperliquid fees, slippage, and funding are explicit economic deductions", () => {
  const zeroCosts = simulateHistoricalAlbertCapital({
    ...selectedTrial,
    takerFeeBpsPerSide: 0,
    slippageBpsPerSide: 0,
  });
  const hyperliquidCosts = simulateHistoricalAlbertCapital(selectedTrial);
  const withFunding = simulateHistoricalAlbertCapital({
    ...selectedTrial,
    fundingBpsPerDay: 2,
  });
  assert.equal(zeroCosts.summary.finalEquityUsd, 10_176.488808702943);
  assert.ok(
    hyperliquidCosts.summary.finalEquityUsd
    < zeroCosts.summary.finalEquityUsd,
  );
  assert.ok(
    withFunding.summary.finalEquityUsd
    < hyperliquidCosts.summary.finalEquityUsd,
  );
  assert.equal(hyperliquidCosts.feeModel.takerFeeBpsPerSide, 4.5);
  assert.equal(hyperliquidCosts.feeModel.slippageBpsPerSide, 0.5);
  assert.equal(hyperliquidCosts.feeModel.holdDays, 1);
  assert.match(
    hyperliquidCosts.feeModel.disclosure.sourceUrl,
    /hyperliquid/i,
  );
});

test("capital assumptions change position size without changing the frozen observations", () => {
  const fixedRisk = simulateHistoricalAlbertCapital({
    ...selectedTrial,
    sizingMode: "fixed-risk",
    sizingValue: 100,
    plannedLossPct: 5,
    leverage: 3,
  });
  assert.equal(fixedRisk.trades.rows[0]?.plannedRiskUsd, 100);
  assert.equal(fixedRisk.trades.rows[0]?.notionalUsd, 2_000);
  assert.equal(fixedRisk.summary.executedTrades, 45);
  assert.equal(fixedRisk.period.scoredStartAtMs, 1_761_073_200_000);
  assert.equal(fixedRisk.sizing.disclosure.includes("No stop is simulated"), true);
});

test("historical trade-ledger adapter remains read-only and fail-closed", () => {
  assert.deepEqual(HISTORICAL_ALBERT_CAPITAL_SIMULATOR.invariants, {
    observationsAreHoldoutOnly: true,
    onePositionAtATime: true,
    riskBudgetIsSizingOnly: true,
    stopLossSimulated: false,
    selectsWinner: false,
    registersStrategy: false,
    createsPaperBot: false,
    enablesExecution: false,
  });
  const source = readFileSync(
    new URL("./historical-albert-capital-simulator.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /\b(?:fetch\s*\(|placeOrder|submitOrder|privateKey|paperTrades|db\.)/i,
  );
});
