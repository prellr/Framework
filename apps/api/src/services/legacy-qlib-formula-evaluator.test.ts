import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateLegacyQlibFormula,
  validateLegacyQlibFormula,
  type LegacyQlibFormulaRow,
} from "./legacy-qlib-formula-evaluator.ts";
import { parseLegacyFormula } from "./legacy-formula-research.ts";

const rows = (values: number[], segmentIds?: number[]): LegacyQlibFormulaRow[] =>
  values.map((value, index) => ({
    segmentId: segmentIds?.[index] ?? 1,
    open: value,
    high: value + 1,
    low: value - 1,
    close: value * 2,
    volume: value * 10,
  }));

const evaluate = (formula: string, inputRows = rows([1, 2, 3, 4, 5])) =>
  evaluateLegacyQlibFormula({
    expression: parseLegacyFormula(formula),
    rows: inputRows,
  }).values;

test("Qlib Less is numeric minimum and Max is a rolling maximum", () => {
  assert.deepEqual(evaluate("Less($open,$close)"), [1, 2, 3, 4, 5]);
  assert.deepEqual(evaluate("Max($open,3)"), [1, 2, 3, 4, 5]);
  assert.deepEqual(evaluate("Max(Sub(6,$open),3)"), [5, 5, 5, 4, 3]);
});

test("Qlib v0.9.5 legacy WMA scaling is reproduced exactly", () => {
  const actual = evaluate("WMA($open,3)", rows([3, 6, 9]));
  assert.deepEqual(actual, [
    3,
    (3 / 3 + 2 * 6 / 3) / 2,
    (3 / 6 + 2 * 6 / 6 + 3 * 9 / 6) / 3,
  ]);
});

test("Ref, covariance, and all rolling state reset at tape gaps", () => {
  const input = rows([1, 2, 3, 10, 11, 12], [1, 1, 1, 2, 2, 2]);
  assert.deepEqual(evaluate("Ref($open,0)", input), [1, 1, 1, 10, 10, 10]);
  const lag = evaluate("Ref($open,1)", input);
  assert.ok(Number.isNaN(lag[0]));
  assert.deepEqual(lag.slice(1, 3), [1, 2]);
  assert.ok(Number.isNaN(lag[3]));
  assert.deepEqual(lag.slice(4), [10, 11]);

  const covariance = evaluate("Cov($open,$close,3)", input);
  assert.ok(Number.isNaN(covariance[0]));
  assert.equal(covariance[1], 1);
  assert.equal(covariance[2], 2);
  assert.ok(Number.isNaN(covariance[3]));
  assert.equal(covariance[4], 1);
  assert.equal(covariance[5], 2);
});

test("the legacy evaluator rejects code expansion and future references", () => {
  assert.throws(
    () => validateLegacyQlibFormula(parseLegacyFormula("Lt($open,$close)")),
    /unsupported.*operator/i,
  );
  assert.throws(
    () => validateLegacyQlibFormula(parseLegacyFormula("Ref($close,-1)")),
    /Ref lag/i,
  );
  assert.throws(
    () => validateLegacyQlibFormula(parseLegacyFormula("WMA($close,0)")),
    /at least 1/i,
  );
});
