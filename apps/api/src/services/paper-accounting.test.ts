import assert from "node:assert/strict";
import test from "node:test";
import {
  legacyWinnerProfitStressPnl,
  PAPER_ACCOUNTING,
} from "./paper-accounting.ts";

test("legacy winner stress is a display-only profit haircut, not a worst-case model", () => {
  assert.equal(PAPER_ACCOUNTING.profitStress.winnerProfitHaircut, 0.36);
  assert.equal(PAPER_ACCOUNTING.profitStress.calibrated, false);
  assert.equal(PAPER_ACCOUNTING.profitStress.executionModel, false);
  assert.equal(PAPER_ACCOUNTING.profitStress.verdictInput, false);
  assert.equal(PAPER_ACCOUNTING.conservativeComparison.verdictInput, true);
  assert.equal(legacyWinnerProfitStressPnl("won", 10), 6.4);
  assert.equal(legacyWinnerProfitStressPnl("lost", -5), -5);
});

test("RAW accounting remains the authoritative fee-adjusted binary settlement", () => {
  assert.equal(PAPER_ACCOUNTING.raw.version, "fee-adjusted-total-budget-v1");
  assert.equal(PAPER_ACCOUNTING.raw.totalOutlayUsd, 5);
  assert.equal(PAPER_ACCOUNTING.raw.authoritative, true);
});
