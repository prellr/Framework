import assert from "node:assert/strict";
import test from "node:test";
import {
  BSM_WINDOW_PROFILE_CALIBRATION,
  binaryBrierLoss,
  binaryLogLoss,
  bsmWindowProfileCalibrationReady,
  computeBsmWindowProfileCalibrationReport,
  type BsmProfileCalibrationPoint,
} from "./bsm-window-profile-calibration.ts";

const close = (actual: number, expected: number, tolerance = 1e-12) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test("calibration audit preserves the exact preregistered contract", () => {
  assert.equal(BSM_WINDOW_PROFILE_CALIBRATION.version, "updown-bsm-window-profile-calibration-v1");
  assert.equal(BSM_WINDOW_PROFILE_CALIBRATION.evalStartMs, 1_784_806_200_000);
  assert.equal(BSM_WINDOW_PROFILE_CALIBRATION.pair, "BTC-USD");
  assert.equal(BSM_WINDOW_PROFILE_CALIBRATION.horizonMin, 5);
  assert.equal(BSM_WINDOW_PROFILE_CALIBRATION.sampleMinute, 2);
  assert.equal(BSM_WINDOW_PROFILE_CALIBRATION.minObservations, 1_000);
  assert.equal(BSM_WINDOW_PROFILE_CALIBRATION.minSpanDays, 5);
  assert.equal(BSM_WINDOW_PROFILE_CALIBRATION.minClusters, 500);
  assert.equal(BSM_WINDOW_PROFILE_CALIBRATION.bootstrapIterations, 1_000);
});

test("readiness requires every frozen floor", () => {
  assert.equal(bsmWindowProfileCalibrationReady(1_000, 5, 500), true);
  assert.equal(bsmWindowProfileCalibrationReady(999, 5, 500), false);
  assert.equal(bsmWindowProfileCalibrationReady(1_000, 4.999, 500), false);
  assert.equal(bsmWindowProfileCalibrationReady(1_000, 5, 499), false);
});

test("proper scores use the frozen orientation and logarithmic clamp", () => {
  close(binaryBrierLoss(0.8, true), 0.04);
  close(binaryBrierLoss(0.2, false), 0.04);
  close(binaryLogLoss(0, true), -Math.log(0.005));
  close(binaryLogLoss(1, false), -Math.log(0.005));
});

const improvingPoints = (): BsmProfileCalibrationPoint[] =>
  Array.from({ length: 12 }, (_, index) => {
    const resolvedUp = index % 2 === 0;
    return {
      id: `m${index}`,
      windowStartMs: Date.UTC(2026, 6, 24, 0, index * 5, 0),
      parent: resolvedUp ? 0.6 : 0.4,
      profile: resolvedUp ? 0.8 : 0.2,
      book: 0.5,
      resolvedUp,
    };
  });

test("paired report is deterministic and supports only two upper bounds below zero", () => {
  const a = computeBsmWindowProfileCalibrationReport(improvingPoints());
  const b = computeBsmWindowProfileCalibrationReport(improvingPoints());
  assert.deepEqual(a, b);
  assert.equal(a.observations, 12);
  assert.equal(a.scoringConvention, "profile-minus-parent; negative is better");
  assert.ok((a.brier.difference?.mean ?? 0) < 0);
  assert.ok((a.brier.difference?.hi ?? 0) < 0);
  assert.ok((a.logarithmic.difference?.mean ?? 0) < 0);
  assert.ok((a.logarithmic.difference?.hi ?? 0) < 0);
  assert.equal(a.supported, true);

  const tied = computeBsmWindowProfileCalibrationReport(
    improvingPoints().map((point) => ({ ...point, profile: point.parent })),
  );
  assert.equal(tied.brier.difference?.hi, 0);
  assert.equal(tied.logarithmic.difference?.hi, 0);
  assert.equal(tied.supported, false);
});
