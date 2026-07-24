import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../scripts/record-timeframe-gate-early-checkpoint.ts", import.meta.url),
  "utf8",
);

test("early split-gate checkpoint is time-bounded and fails closed on a mature result", () => {
  assert.match(source, /2026-07-25T00:00:00\.000Z/);
  assert.match(source, /Date\.now\(\) >= evidenceHardStopMs/);
  assert.match(source, /noSplitPass/);
  assert.match(source, /noPositiveSplitLowerBound/);
  assert.match(source, /noMacroPass/);
  assert.match(source, /Object\.values\(gateChecks\)\.every\(Boolean\)/);
});

test("checkpoint preserves contamination boundaries and admits no strategy", () => {
  assert.match(source, /Outcomes were already visible/);
  assert.match(source, /No additional bot, asset filter, threshold, or ensemble is admitted/);
  assert.match(source, /new future boundary/);
  assert.match(source, /paper-only/i);
  assert.doesNotMatch(source, /PAPER_BOTS|\\.insert\\(paperTrades\\)|\\.update\\(paperTrades\\)/);
  assert.doesNotMatch(source, /placeOrder|createOrder|privateKey|signOrder/);
});

test("checkpoint contrasts raw asset P&L with same-tick control residual", () => {
  assert.match(source, /bot_key = 'pricerMC'/);
  assert.match(source, /horizon_min = 5/);
  assert.match(source, /control_ask_paid/);
  assert.match(source, /same-tick-control residual/);
  assert.match(source, /pricerMC5mTrend:5/);
});
