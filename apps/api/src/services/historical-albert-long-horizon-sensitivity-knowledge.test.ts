import assert from "node:assert/strict";
import test from "node:test";
import {
  HISTORICAL_ALBERT_LONG_HORIZON_SENSITIVITY_KNOWLEDGE,
  renderHistoricalAlbertLongHorizonSensitivityKnowledge,
} from "./historical-albert-long-horizon-sensitivity-knowledge.ts";

test("Albert long-horizon knowledge retains all frozen rows without admitting one", () => {
  const record = HISTORICAL_ALBERT_LONG_HORIZON_SENSITIVITY_KNOWLEDGE;
  assert.deepEqual(record.receipt.target.requestedHoldMinutes, [480, 720, 1_440]);
  assert.equal(record.receipt.horizons.length, 3);
  assert.ok(record.receipt.horizons.every((item) => item.trials.length === 7));
  assert.ok(record.receipt.horizons
    .find((item) => item.holdMinutes === 1_440)!
    .trials.every((trial) => !trial.available));
  assert.equal(record.invariants.createsStrategy, false);
  assert.equal(record.invariants.enablesExecution, false);
  const markdown = renderHistoricalAlbertLongHorizonSensitivityKnowledge(
    "2026-07-25T00:00:00.000Z",
  );
  assert.match(markdown, /8h/);
  assert.match(markdown, /12h/);
  assert.match(markdown, /24h/);
  assert.match(markdown, /not a pass/i);
});
