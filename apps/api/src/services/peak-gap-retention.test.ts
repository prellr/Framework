import assert from "node:assert/strict";
import test from "node:test";
import {
  BSM_PEAK_RETENTION,
  peakRetentionEligible,
  peakRetentionEligibleHorizon,
} from "./peak-gap-retention.ts";
import type { PeakGapRetentionStats } from "./rtds.ts";

const path: PeakGapRetentionStats = {
  currentPx: 108,
  currentGapLog: Math.log(1.08),
  peakAbsGapLog: Math.log(1.1),
  retention: Math.log(1.08) / Math.log(1.1),
  tickCount: 80,
  firstAtMs: 1,
  startCoverageSec: 1,
  maxIntertickGapSec: 2,
  peakAtMs: 1,
  sourceAtMs: 2,
  receivedAtMs: 3,
  sourceAgeSec: 1,
  receiveAgeSec: 1,
};

test("peak-retention constants preserve the preregistered boundary and 5m universe", () => {
  assert.equal(new Date(BSM_PEAK_RETENTION.evalStartMs).toISOString(), "2026-07-23T09:00:00.000Z");
  assert.equal(peakRetentionEligibleHorizon(5), true);
  assert.equal(peakRetentionEligibleHorizon(15), false);
});

test("peak-retention gate accepts only the frozen late-window band and retained path", () => {
  assert.equal(peakRetentionEligible(path, 60), true);
  assert.equal(peakRetentionEligible(path, 90), true);
  assert.equal(peakRetentionEligible(path, 59.999), false);
  assert.equal(peakRetentionEligible(path, 90.001), false);
  assert.equal(peakRetentionEligible({ ...path, retention: 0.75 }, 75), true);
  assert.equal(peakRetentionEligible({ ...path, retention: 0.749999 }, 75), false);
  assert.equal(peakRetentionEligible({ ...path, sourceAgeSec: 20 }, 75), false);
  assert.equal(peakRetentionEligible({ ...path, receiveAgeSec: -0.001 }, 75), false);
  assert.equal(peakRetentionEligible({ ...path, tickCount: 1 }, 75), false);
  assert.equal(peakRetentionEligible({ ...path, startCoverageSec: 20 }, 75), false);
  assert.equal(peakRetentionEligible({ ...path, maxIntertickGapSec: 20 }, 75), false);
  assert.equal(peakRetentionEligible({ ...path, retention: Number.NaN }, 75), false);
  assert.equal(peakRetentionEligible({ ...path, retention: 1.01 }, 75), false);
  assert.equal(peakRetentionEligible(null, 75), false);
});
