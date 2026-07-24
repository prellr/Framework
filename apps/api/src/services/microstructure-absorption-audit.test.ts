import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MICROSTRUCTURE_ABSORPTION_AUDIT,
  computeMicrostructureAbsorptionReport,
  microstructureAbsorptionClusterCount,
  microstructureAbsorptionObservation,
  microstructureAbsorptionReady,
  type AbsorptionCandidatePoint,
  type AbsorptionFeatureInput,
} from "./microstructure-absorption-audit.ts";

const close = (actual: number | null, expected: number, tolerance = 1e-9) => {
  assert.ok(actual != null);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};

const baseInput = (): AbsorptionFeatureInput => ({
  previousCapturedAtMs: Date.UTC(2026, 6, 23, 13, 1, 0),
  currentCapturedAtMs: Date.UTC(2026, 6, 23, 13, 2, 0),
  previousUp: { bid: 0.49, ask: 0.51, bidSize: 10, askSize: 10 },
  previousDown: { bid: 0.49, ask: 0.51, bidSize: 10, askSize: 10 },
  currentUp: { bid: 0.49, ask: 0.51, bidSize: 50, askSize: 0 },
  currentDown: { bid: 0.49, ask: 0.51, bidSize: 0, askSize: 50 },
  upFill: 0.53,
  downFill: 0.49,
});

test("absorption audit boundary, scope, formula, and floors are frozen", () => {
  assert.equal(MICROSTRUCTURE_ABSORPTION_AUDIT.evalStartMs, 1_784_811_600_000);
  assert.equal(MICROSTRUCTURE_ABSORPTION_AUDIT.horizonMin, 5);
  assert.equal(MICROSTRUCTURE_ABSORPTION_AUDIT.previousSampleMinute, 1);
  assert.equal(MICROSTRUCTURE_ABSORPTION_AUDIT.currentSampleMinute, 2);
  assert.equal(MICROSTRUCTURE_ABSORPTION_AUDIT.minEffort, 1);
  assert.equal(MICROSTRUCTURE_ABSORPTION_AUDIT.maxSameDirectionResponse, 0.01);
  assert.equal(MICROSTRUCTURE_ABSORPTION_AUDIT.minMarkets, 1_500);
  assert.equal(MICROSTRUCTURE_ABSORPTION_AUDIT.minSpanDays, 5);
  assert.equal(MICROSTRUCTURE_ABSORPTION_AUDIT.minBets, 200);
  assert.equal(MICROSTRUCTURE_ABSORPTION_AUDIT.minClusters, 500);
  assert.equal(MICROSTRUCTURE_ABSORPTION_AUDIT.bootstrapIterations, 1_000);
});

test("large UP pressure with no UP-price response is faded DOWN", () => {
  const observation = microstructureAbsorptionObservation(baseInput());
  assert.ok(observation);
  assert.ok(observation.canonicalOfi >= 1);
  close(observation.response, 0);
  assert.equal(observation.side, "down");
  close(observation.ask, 0.49);
  close(observation.controlAsk, 0.49);
});

test("mirrored failed DOWN pressure is faded UP", () => {
  const input = baseInput();
  [input.currentUp, input.currentDown] = [input.currentDown, input.currentUp];
  const observation = microstructureAbsorptionObservation(input);
  assert.ok(observation);
  assert.ok(observation.canonicalOfi <= -1);
  assert.equal(observation.side, "up");
  close(observation.ask, 0.53);
});

test("pressure that receives more than one cent of same-direction response abstains", () => {
  const input = baseInput();
  input.currentUp.bid += 0.02;
  input.currentUp.ask += 0.02;
  input.currentDown.bid -= 0.02;
  input.currentDown.ask -= 0.02;
  const observation = microstructureAbsorptionObservation(input);
  assert.ok(observation);
  assert.ok(observation.signedResponse > 0.01);
  assert.equal(observation.side, null);
  assert.equal(observation.ask, null);
});

test("zero pressure remains a valid observed-market abstention", () => {
  const input = baseInput();
  input.currentUp = { ...input.previousUp };
  input.currentDown = { ...input.previousDown };
  const observation = microstructureAbsorptionObservation(input);
  assert.ok(observation);
  close(observation.canonicalOfi, 0);
  close(observation.effort, 0);
  assert.equal(observation.side, null);
  assert.equal(observation.ask, null);
});

test("stale gaps, invalid fills, and thin books fail closed", () => {
  const stale = baseInput();
  stale.currentCapturedAtMs += 31_000;
  assert.equal(microstructureAbsorptionObservation(stale), null);

  const invalidFill = baseInput();
  invalidFill.upFill = 0.99;
  assert.equal(microstructureAbsorptionObservation(invalidFill), null);

  const invalidBook = baseInput();
  invalidBook.currentDown.bid = 0.6;
  invalidBook.currentDown.ask = 0.4;
  assert.equal(microstructureAbsorptionObservation(invalidBook), null);
});

test("readiness requires every frozen floor", () => {
  assert.equal(microstructureAbsorptionReady(1_500, 5, 200, 500, 2), true);
  assert.equal(microstructureAbsorptionReady(1_499, 5, 200, 500, 2), false);
  assert.equal(microstructureAbsorptionReady(1_500, 4.999, 200, 500, 2), false);
  assert.equal(microstructureAbsorptionReady(1_500, 5, 199, 500, 2), false);
  assert.equal(microstructureAbsorptionReady(1_500, 5, 200, 499, 2), false);
  assert.equal(microstructureAbsorptionReady(1_500, 5, 200, 500, 1), false);
});

test("cluster readiness counts unique candidate windows rather than asset rows", () => {
  const t = Date.UTC(2026, 6, 23, 13, 0);
  assert.equal(microstructureAbsorptionClusterCount([
    { windowStartMs: t },
    { windowStartMs: t },
    { windowStartMs: t + 5 * 60_000 },
  ]), 2);
});

test("report uses the same-tick DOWN control and requires two positive sessions", () => {
  const points: AbsorptionCandidatePoint[] = [];
  for (let i = 0; i < 100; i++) {
    const hour = i < 50 ? 8 : 20;
    const t = Date.UTC(2026, 6, 23 + Math.floor(i / 24), hour, (i % 12) * 5);
    points.push({
      id: i + 1,
      conditionId: `condition-${i}`,
      pair: "BTC-USD",
      windowStartMs: t,
      decidedAtMs: t + 2 * 60_000,
      side: "up",
      ask: 0.5,
      controlAsk: 0.5,
      resolvedUp: true,
    });
  }
  const report = computeMicrostructureAbsorptionReport(points);
  assert.equal(report.bets, 100);
  assert.equal(report.pairedMarkets, 100);
  assert.equal(report.wins, 100);
  close(report.candidateMeanNet, 0.5);
  close(report.controlMeanNet, -0.5);
  close(report.residual?.mean ?? null, 1);
  assert.ok((report.residual?.lo ?? 0) > 0);
  assert.equal(report.positiveQualifyingSessions, 2);
  assert.equal(report.supported, true);
});
