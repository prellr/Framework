import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../scripts/record-paper-familywise-day-one-checkpoint.ts", import.meta.url),
  "utf8",
);

test("familywise day-one checkpoint is time-bounded to the immature cohort", () => {
  assert.match(source, /2026-07-26T00:00:00\.000Z/);
  assert.match(source, /Date\.now\(\) >= evidenceHardStopMs/);
  assert.match(source, /state\.familywiseGate\.familySize !== 57/);
  assert.match(source, /allCollecting/);
  assert.match(source, /underOneDay/);
  assert.match(source, /BelowEveryVerdictFloor/);
  assert.match(source, /pricerMcStillImmature/);
  assert.match(source, /pricerMc5\.bets >= PAPER_FAMILYWISE_GATE\.minBets/);
  assert.match(source, /pricerMc5\.residual\.lo == null \|\| pricerMc5\.residual\.lo <= 0/);
  assert.match(source, /Object\.values\(checks\)\.every\(Boolean\)/);
});

test("checkpoint uses outcome-free dependence to reject a duplicate branch", () => {
  assert.match(source, /strategyIndependenceStatus/);
  assert.match(source, /sweepHasStrongObservedDependence/);
  assert.match(source, /idNr4NoStrongObservedDependence/);
  assert.match(source, /No Sweep child, filter, ensemble, or duplicate is admitted/);
  assert.match(source, /unexpectedExactCollisions/);
});

test("checkpoint keeps Bootstrap MC 5m as an unchanged existing cohort", () => {
  assert.match(source, /byKey\.get\("pricerMC:5"\)/);
  assert.match(source, /Existing watchlist cohort: Bootstrap MC 5m/);
  assert.match(source, /cleared the paired-bet and cluster counts/);
  assert.match(source, /No asset, side, time, price, regime, or freshness child is admitted/);
});

test("checkpoint preserves contamination, paper-only, and execution boundaries", () => {
  assert.match(source, /Outcomes were visible/);
  assert.match(source, /Admit no new strategy/);
  assert.match(source, /fresh prospective boundary/);
  assert.match(source, /Paper only/);
  assert.doesNotMatch(source, /PAPER_BOTS|paperTrades|paper_trade/);
  assert.doesNotMatch(source, /placeOrder|createOrder|signOrder|privateKey/);
});
