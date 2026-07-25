import assert from "node:assert/strict";
import test from "node:test";
import {
  HISTORICAL_ALBERT_ONE_HOUR_CHART_SENSITIVITY_KNOWLEDGE,
  renderHistoricalAlbertOneHourChartSensitivityKnowledge,
} from "./historical-albert-one-hour-chart-sensitivity-knowledge.ts";

test("Albert 1h-chart knowledge retains all trials and marks the weakened 24h lead under-sampled", () => {
  const record = HISTORICAL_ALBERT_ONE_HOUR_CHART_SENSITIVITY_KNOWLEDGE;
  assert.deepEqual(record.receipt.target.requestedHoldMinutes, [60, 240, 720, 1_440]);
  assert.equal(record.receipt.horizons.length, 4);
  assert.ok(record.receipt.horizons.every((item) => item.trials.length === 7));
  const lead = record.receipt.horizons
    .find((item) => item.holdMinutes === 1_440)!
    .trials.find((trial) => trial.id === "albert-short-low:z1")!;
  assert.equal(lead.trades, 45);
  assert.equal(lead.positiveFolds, 3);
  assert.equal(lead.available, false);
  assert.ok(lead.lowerConfidenceBoundNetBps! < 0);
  assert.equal(record.invariants.createsStrategy, false);
  assert.equal(record.invariants.enablesExecution, false);
  const markdown = renderHistoricalAlbertOneHourChartSensitivityKnowledge(
    "2026-07-25T00:00:00.000Z",
  );
  assert.match(markdown, /1h-chart/i);
  assert.match(markdown, /45 trades/i);
  assert.match(markdown, /not a pass/i);
});
