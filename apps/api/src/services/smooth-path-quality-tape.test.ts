import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SMOOTH_PATH_QUALITY_TAPE,
  smoothPathQualityReady,
} from "./smooth-path-quality-tape.ts";

const readyInput = {
  metricRows: SMOOTH_PATH_QUALITY_TAPE.minMetricRowsPerVersion,
  weakestPairMetricRows: SMOOTH_PATH_QUALITY_TAPE.minMetricRowsPerPair,
  spanDays: SMOOTH_PATH_QUALITY_TAPE.minSpanDays,
  coverage: SMOOTH_PATH_QUALITY_TAPE.minCoverage,
};

test("Smooth Path quality tape has the exact prospective outcome-blind contract", () => {
  assert.equal(
    new Date(SMOOTH_PATH_QUALITY_TAPE.evalStartMs).toISOString(),
    "2026-07-24T03:00:00.000Z",
  );
  assert.equal(SMOOTH_PATH_QUALITY_TAPE.version, "updown-smooth-path-quality-tape-v1");
  assert.equal("side" in SMOOTH_PATH_QUALITY_TAPE, false);
  assert.equal("threshold" in SMOOTH_PATH_QUALITY_TAPE, false);
  assert.equal(smoothPathQualityReady(readyInput), true);
});

test("Smooth Path quality readiness requires every frozen floor", () => {
  for (const [key, value] of Object.entries({
    metricRows: SMOOTH_PATH_QUALITY_TAPE.minMetricRowsPerVersion - 1,
    weakestPairMetricRows: SMOOTH_PATH_QUALITY_TAPE.minMetricRowsPerPair - 1,
    spanDays: SMOOTH_PATH_QUALITY_TAPE.minSpanDays - 0.001,
    coverage: SMOOTH_PATH_QUALITY_TAPE.minCoverage - Number.EPSILON,
  })) {
    assert.equal(
      smoothPathQualityReady({ ...readyInput, [key]: value }),
      false,
      `${key} must fail closed`,
    );
  }
});

test("quality launch audit reads no outcome ledger or directional feature value", () => {
  const source = readFileSync(
    new URL("../scripts/record-smooth-path-quality-launch-success.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /\bpaperTrades\b/);
  assert.doesNotMatch(source, /\bpaper_trade\b/);
  assert.doesNotMatch(source, /\bpolymarketStateSnapshots\b/);
  assert.doesNotMatch(source, /\bpolymarket_state_snapshot\b/);
  assert.match(source, /not \(\$\{completeMetrics\}\)/);
  assert.match(source, /quantilesRemainLocked/);
});
