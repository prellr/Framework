import assert from "node:assert/strict";
import test from "node:test";
import {
  HISTORICAL_ALBERT_HORIZON_SENSITIVITY_KNOWLEDGE,
  renderHistoricalAlbertHorizonSensitivityKnowledge,
} from "./historical-albert-horizon-sensitivity-knowledge.ts";

test("Albert horizon sensitivity knowledge preserves the complete frozen family", () => {
  const record = HISTORICAL_ALBERT_HORIZON_SENSITIVITY_KNOWLEDGE;
  assert.deepEqual(record.receipt.target.requestedHoldMinutes, [30, 60, 240]);
  assert.equal(record.receipt.horizons.length, 3);
  assert.ok(record.receipt.horizons.every((horizon) => horizon.trials.length === 7));
  assert.ok(record.receipt.horizons.every((horizon) =>
    horizon.trials.every((trial) => trial.meanNetBps == null || trial.meanNetBps < 0)));
  assert.equal(record.invariants.createsStrategy, false);
  assert.equal(record.invariants.enablesExecution, false);
  const markdown = renderHistoricalAlbertHorizonSensitivityKnowledge(
    "2026-07-25T00:00:00.000Z",
  );
  assert.match(markdown, /30m/);
  assert.match(markdown, /1h/);
  assert.match(markdown, /4h/);
  assert.match(markdown, /No horizon or trial was selected/i);
});
