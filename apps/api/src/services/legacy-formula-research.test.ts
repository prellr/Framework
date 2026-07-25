import assert from "node:assert/strict";
import test from "node:test";
import {
  LEGACY_ALBERT_FORMULA_RESEARCH,
  LEGACY_ALBERT_FORMULA_SOURCE,
  legacyFormulaComplexity,
  legacyFormulaDepth,
  parseLegacyFormula,
  renderLegacyFormula,
} from "./legacy-formula-research.ts";

test("the user-supplied Albert formula round-trips without semantic transcription", () => {
  const parsed = parseLegacyFormula(LEGACY_ALBERT_FORMULA_SOURCE);
  assert.equal(renderLegacyFormula(parsed), LEGACY_ALBERT_FORMULA_SOURCE);
  assert.equal(parsed.kind, "call");
  if (parsed.kind !== "call") return;
  assert.equal(parsed.name, "Less");
  assert.equal(parsed.args.length, 2);

  const right = parsed.args[1];
  assert.equal(right.kind, "call");
  if (right.kind !== "call") return;
  assert.equal(right.name, "Mul");
  assert.equal(right.args.length, 2);

  const covariance = right.args[0];
  assert.equal(covariance.kind, "call");
  if (covariance.kind !== "call") return;
  assert.equal(covariance.name, "Cov");
  assert.equal(covariance.args.length, 3);
  assert.deepEqual(covariance.args[2], { kind: "constant", value: 50 });
});

test("legacy formula metadata is deterministic and non-authorizing", () => {
  const parsed = parseLegacyFormula(LEGACY_ALBERT_FORMULA_SOURCE);
  assert.equal(LEGACY_ALBERT_FORMULA_RESEARCH.complexity, legacyFormulaComplexity(parsed));
  assert.equal(LEGACY_ALBERT_FORMULA_RESEARCH.depth, legacyFormulaDepth(parsed));
  assert.deepEqual(LEGACY_ALBERT_FORMULA_RESEARCH.features, ["$close", "$low", "$open", "$volume"]);
  assert.equal(LEGACY_ALBERT_FORMULA_RESEARCH.invariants.evaluatesFormula, false);
  assert.equal(LEGACY_ALBERT_FORMULA_RESEARCH.invariants.createsStrategy, false);
  assert.equal(LEGACY_ALBERT_FORMULA_RESEARCH.invariants.startsSearch, false);
  assert.equal(LEGACY_ALBERT_FORMULA_RESEARCH.invariants.enablesExecution, false);
  assert.equal(LEGACY_ALBERT_FORMULA_RESEARCH.invariants.preservesVerdictGate, true);
});

test("legacy parser rejects code-like or trailing input", () => {
  assert.throws(() => parseLegacyFormula("process.exit(1)"));
  assert.throws(() => parseLegacyFormula("Add($open,$close) garbage"));
  assert.throws(() => parseLegacyFormula("bareIdentifier"));
});
