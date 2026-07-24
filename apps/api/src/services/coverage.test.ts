import assert from "node:assert/strict";
import test from "node:test";
import {
  COVERAGE_MAX_LOAD_PER_CPU,
  coverageLoadPerCpu,
  coverageStrategyRunnable,
} from "./coverage.ts";

test("coverage matrix excludes catalogued virtual programs with no backtest factory", () => {
  assert.equal(coverageStrategyRunnable({
    category: "TRIAD_ROTATION",
    description: "Virtual program (no direct instance).",
    features: ["Programs", "Virtual"],
  }), false);
  assert.equal(coverageStrategyRunnable({
    category: "VIRTUAL_ANYTHING",
    description: "Virtual program routing profitable strategies.",
    features: ["Virtual strategy"],
  }), false);
  assert.equal(coverageStrategyRunnable({
    category: "MOMENTUM",
    description: "Runnable momentum strategy.",
    features: ["Trend", "Breakout"],
  }), true);
});

test("lower-priority coverage work fails closed under normalized host pressure", () => {
  assert.equal(COVERAGE_MAX_LOAD_PER_CPU, 0.5);
  assert.equal(coverageLoadPerCpu(2.5, 10), 0.25);
  assert.equal(coverageLoadPerCpu(5, 10), 0.5);
  assert.equal(coverageLoadPerCpu(Number.NaN, 10), Number.POSITIVE_INFINITY);
  assert.equal(coverageLoadPerCpu(1, 0), Number.POSITIVE_INFINITY);
});
