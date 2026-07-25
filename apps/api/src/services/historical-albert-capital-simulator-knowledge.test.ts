import assert from "node:assert/strict";
import test from "node:test";
import {
  HISTORICAL_ALBERT_CAPITAL_SIMULATOR_KNOWLEDGE,
  renderHistoricalAlbertCapitalSimulatorKnowledge,
} from "./historical-albert-capital-simulator-knowledge.ts";

test("capital simulator knowledge fixes the equity and Hyperliquid cost contracts", () => {
  const record = HISTORICAL_ALBERT_CAPITAL_SIMULATOR_KNOWLEDGE;
  const markdown = renderHistoricalAlbertCapitalSimulatorKnowledge(
    "2026-07-25T00:00:00.000Z",
  );
  assert.match(markdown, /start with \$10,000/i);
  assert.match(markdown, /45 trades: 27 wins and 18 losses/i);
  assert.match(markdown, /4\.5 bps on entry and 4\.5 bps on exit/i);
  assert.match(markdown, /funding accrues hourly/i);
  assert.match(markdown, /No stop-loss is simulated/i);
  assert.equal(record.invariants.changesFrozenReceipt, false);
  assert.equal(record.invariants.readsLiveAccount, false);
  assert.equal(record.invariants.enablesExecution, false);
});
