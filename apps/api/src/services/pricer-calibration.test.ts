import assert from "node:assert/strict";
import test from "node:test";
import {
  brierLoss,
  calibrationSampleMinute,
  computePricerCalibrationReport,
  logLoss,
  PRICER_CALIBRATION_AUDIT,
  pricerCalibrationReady,
  type CalibrationPoint,
} from "./pricer-calibration.ts";

test("calibration sample is the exact prespecified midpoint minute", () => {
  assert.equal(calibrationSampleMinute(5), 2);
  assert.equal(calibrationSampleMinute(15), 7);
  assert.equal(calibrationSampleMinute(60), 30);
  assert.equal(PRICER_CALIBRATION_AUDIT.evalStartMs, Date.parse("2026-07-23T06:30:00.000Z"));
});

test("proper scores use the registered orientation and logarithmic clamp", () => {
  assert.ok(Math.abs(brierLoss(0.8, true) - 0.04) < 1e-12);
  assert.ok(Math.abs(brierLoss(0.2, false) - 0.04) < 1e-12);
  assert.equal(logLoss(1, true), -Math.log(0.995));
  assert.equal(logLoss(0, false), -Math.log(0.995));
});

test("readiness requires every frozen floor", () => {
  assert.equal(pricerCalibrationReady(999, 5, 500), false);
  assert.equal(pricerCalibrationReady(1_000, 4.999, 500), false);
  assert.equal(pricerCalibrationReady(1_000, 5, 499), false);
  assert.equal(pricerCalibrationReady(1_000, 5, 500), true);
});

test("pooled report is deterministic, paired, and uses fixed reliability deciles", () => {
  const points: CalibrationPoint[] = [
    { id: "a", windowStartMs: 0, pModel: 0.8, pBook: 0.6, resolvedUp: true },
    { id: "b", windowStartMs: 300_000, pModel: 0.2, pBook: 0.4, resolvedUp: false },
    { id: "c", windowStartMs: 600_000, pModel: 0.7, pBook: 0.55, resolvedUp: true },
  ];
  const first = computePricerCalibrationReport(points);
  const second = computePricerCalibrationReport([...points].reverse());
  assert.deepEqual(first, second);
  assert.ok(first.brier.difference != null && first.brier.difference < 0);
  assert.ok(first.logarithmic.difference != null && first.logarithmic.difference < 0);
  assert.equal(first.modelReliability.length, 10);
  assert.equal(first.bookReliability.length, 10);
  assert.equal(first.modelReliability[8].observations, 1);
});
