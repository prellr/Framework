import assert from "node:assert/strict";
import test from "node:test";
import { empiricalKnnPup, EMPIRICAL_PRICER, type EmpiricalPricerConfig, type EmpiricalTrainingRow } from "./empirical-pricer-model.ts";

const small: EmpiricalPricerConfig = {
  ...EMPIRICAL_PRICER,
  neighbors: 3,
  minDistinctMarkets: 2,
};

test("empirical pricer keeps one nearest row per historical market", () => {
  const rows: EmpiricalTrainingRow[] = [
    { conditionId: "a", zDistance: 0.01, remainingSec: 120, resolvedUp: true },
    { conditionId: "a", zDistance: 2, remainingSec: 120, resolvedUp: true },
    { conditionId: "b", zDistance: 0.02, remainingSec: 120, resolvedUp: false },
    { conditionId: "c", zDistance: 0.03, remainingSec: 120, resolvedUp: true },
  ];
  const estimate = empiricalKnnPup(rows, { conditionId: "live", zDistance: 0, remainingSec: 120 }, small);
  assert.ok(estimate);
  assert.equal(estimate.neighbors, 3);
  assert.equal(estimate.upWins, 2);
  assert.equal(estimate.pup, 3 / 5); // Beta(1,1) smoothing
});

test("empirical pricer excludes the live condition and abstains below the distinct-market floor", () => {
  const rows: EmpiricalTrainingRow[] = [
    { conditionId: "live", zDistance: 0, remainingSec: 120, resolvedUp: true },
    { conditionId: "a", zDistance: 0.1, remainingSec: 120, resolvedUp: false },
  ];
  assert.equal(empiricalKnnPup(rows, { conditionId: "live", zDistance: 0, remainingSec: 120 }, small), null);
});

test("empirical pricer distance incorporates normalized moneyness and log time", () => {
  const rows: EmpiricalTrainingRow[] = [
    { conditionId: "same", zDistance: 0.35, remainingSec: 120, resolvedUp: true },
    { conditionId: "double-time", zDistance: 0, remainingSec: 240, resolvedUp: false },
  ];
  const estimate = empiricalKnnPup(rows, { conditionId: "live", zDistance: 0, remainingSec: 120 }, small);
  assert.ok(estimate);
  assert.ok(estimate.nearestDistance < estimate.farthestDistance);
});
