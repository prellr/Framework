import assert from "node:assert/strict";
import test from "node:test";
import {
  HISTORICAL_ALBERT_REPLAY_KNOWLEDGE,
  renderHistoricalAlbertReplayKnowledge,
} from "./historical-albert-replay-knowledge.ts";

test("Albert replay knowledge preserves semantics, negative result, and safety disposition", () => {
  const rendered = renderHistoricalAlbertReplayKnowledge("2026-07-25T04:00:00.000Z");
  assert.match(rendered, /Less\(left,right\).*element-wise minimum/i);
  assert.match(rendered, /Max\(feature,N\).*rolling maximum/i);
  assert.match(rendered, /No strategy selected/i);
  assert.match(rendered, /No declared trial produced a positive net fold/i);
  assert.match(rendered, /sha256:f73f89915dc51a2c/);
  assert.equal(HISTORICAL_ALBERT_REPLAY_KNOWLEDGE.invariants.createsStrategy, false);
  assert.equal(HISTORICAL_ALBERT_REPLAY_KNOWLEDGE.invariants.enablesExecution, false);
  assert.equal(HISTORICAL_ALBERT_REPLAY_KNOWLEDGE.invariants.preservesVerdictGate, true);
});
