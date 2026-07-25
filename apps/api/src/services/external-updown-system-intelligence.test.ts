import assert from "node:assert/strict";
import test from "node:test";
import {
  EXTERNAL_UPDOWN_SYSTEM_INTELLIGENCE,
  renderExternalUpdownSystemIntelligence,
} from "./external-updown-system-intelligence.ts";
import { LEGACY_ALBERT_FORMULA_SOURCE } from "./legacy-formula-research.ts";

test("external system intelligence retains evidence limits and the exact legacy formula", () => {
  const record = EXTERNAL_UPDOWN_SYSTEM_INTELLIGENCE;
  assert.ok(record.sources.some((source) => source.evidenceTier === "open-source"));
  assert.ok(record.sources.some((source) => source.evidenceTier === "community-anecdote"));
  assert.ok(record.sources.every((source) => source.limitation.length > 20));
  assert.equal(record.historicalFormula.source, LEGACY_ALBERT_FORMULA_SOURCE);
  assert.equal(record.invariants.readsMarketOutcomes, false);
  assert.equal(record.invariants.changesFeatureCuts, false);
  assert.equal(record.invariants.createsStrategy, false);
  assert.equal(record.invariants.startsSearch, false);
  assert.equal(record.invariants.enablesExecution, false);
  assert.equal(record.invariants.preservesVerdictGate, true);
});

test("rendered intelligence is explicit about screening and non-admission", () => {
  const body = renderExternalUpdownSystemIntelligence("2026-07-24T00:00:00.000Z");
  assert.match(body, /Information coefficient means a training-only/);
  assert.match(body, /Every generated, invalid, duplicate, zero-trade/);
  assert.match(body, /non-executable import\/AST fixture/);
  assert.match(body, /Do not add a strategy/);
  assert.ok(body.includes(LEGACY_ALBERT_FORMULA_SOURCE));
});
