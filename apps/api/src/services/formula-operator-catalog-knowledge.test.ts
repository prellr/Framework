import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  FORMULA_OPERATOR_CATALOG_KNOWLEDGE,
  renderFormulaOperatorCatalogKnowledge,
} from "./formula-operator-catalog-knowledge.ts";

test("operator catalog knowledge explains states, budget, and admission", () => {
  const body = renderFormulaOperatorCatalogKnowledge("2026-07-25T00:00:00.000Z");
  assert.equal(
    FORMULA_OPERATOR_CATALOG_KNOWLEDGE.version,
    "alchemy-formula-operator-catalog-v1",
  );
  for (const text of [
    "Active search grammar",
    "Pinned import evaluator",
    "Candidate operators",
    "Explicit exclusions",
    "configurable experiment budget",
    "10,000 is a benchmark example",
    "Future references and arbitrary code are always rejected",
    "new untouched forward boundary",
  ]) {
    assert.ok(body.includes(text), `missing operator knowledge text: ${text}`);
  }
  assert.ok(FORMULA_OPERATOR_CATALOG_KNOWLEDGE.sources.length >= 3);
  assert.equal(FORMULA_OPERATOR_CATALOG_KNOWLEDGE.invariants.enablesExecution, false);
});

test("operator catalog knowledge remains pure and non-executing", () => {
  const source = readFileSync(
    new URL("./formula-operator-catalog-knowledge.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /from\s+["'][^"']*(?:db|router|jobs|trading|paper-floor)[^"']*["']/);
  assert.doesNotMatch(source, /\b(?:fetch|createOrder|placeOrder|submitOrder|privateKey)\b/);
});
