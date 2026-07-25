import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FORMULAIC_FIXED_HORIZON_POC } from "./formulaic-fixed-horizon-contract.ts";
import {
  FORMULA_OPERATOR_CATALOG,
  formulaOperatorCatalogStatus,
} from "./formula-operator-catalog.ts";

test("operator catalog is unique, bounded, and separates availability from ideas", () => {
  const status = formulaOperatorCatalogStatus();
  assert.equal(status.version, "alchemy-formula-operator-catalog-v1");
  assert.equal(
    new Set(FORMULA_OPERATOR_CATALOG.map((operator) => operator.id)).size,
    FORMULA_OPERATOR_CATALOG.length,
  );
  assert.deepEqual(
    [...status.activeOperatorIds].sort(),
    [
      "feature",
      "constant",
      ...FORMULAIC_FIXED_HORIZON_POC.grammar.unaryOperators,
      ...FORMULAIC_FIXED_HORIZON_POC.grammar.binaryOperators,
    ].sort(),
  );
  assert.deepEqual(
    FORMULA_OPERATOR_CATALOG
      .filter((operator) => operator.state === "active-search")
      .map((operator) => operator.id)
      .sort(),
    [...status.activeOperatorIds].sort(),
  );
  assert.ok(status.counts.candidate >= 10);
  assert.ok(status.counts.importEvaluator >= 5);
  assert.ok(status.counts.excluded >= 2);
  assert.equal(
    status.counts.activeSearch
      + status.counts.importEvaluator
      + status.counts.candidate
      + status.counts.excluded,
    status.counts.total,
  );
  assert.ok(
    FORMULA_OPERATOR_CATALOG
      .flatMap((operator) => operator.parameters)
      .every((parameter) =>
        Number.isFinite(parameter.minimum)
        && Number.isFinite(parameter.maximum)
        && parameter.minimum <= parameter.default
        && parameter.default <= parameter.maximum),
  );
});

test("noncausal and arbitrary constructs are excluded, not candidate or active", () => {
  const noncausal = FORMULA_OPERATOR_CATALOG.filter((operator) => !operator.causal);
  assert.ok(noncausal.length >= 2);
  assert.ok(noncausal.every((operator) => operator.state === "excluded"));
  assert.equal(
    FORMULA_OPERATOR_CATALOG.find((operator) => operator.id === "futureReference")?.state,
    "excluded",
  );
  assert.equal(
    FORMULA_OPERATOR_CATALOG.find((operator) => operator.id === "arbitraryCode")?.state,
    "excluded",
  );
  assert.equal(formulaOperatorCatalogStatus().invariants.futureReferencesAllowed, false);
  assert.equal(formulaOperatorCatalogStatus().invariants.arbitraryCodeAllowed, false);
});

test("operator catalog remains static metadata with no mutable-system dependency", () => {
  const source = readFileSync(
    new URL("./formula-operator-catalog.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /from\s+["'][^"']*(?:db|router|jobs|trading|paper-floor)[^"']*["']/);
  assert.doesNotMatch(source, /\b(?:fetch|createOrder|placeOrder|submitOrder|privateKey)\b/);
});
