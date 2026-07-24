import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FOUR_STREAK_REVERSAL_AUDIT,
  computeFourStreakReversalReport,
  fourStreakReversalClusterCount,
  fourStreakReversalObservation,
  fourStreakReversalReady,
  type FourStreakCandidatePoint,
} from "./four-streak-reversal-audit.ts";

const close = (actual: number | null, expected: number, tolerance = 1e-9) => {
  assert.ok(actual != null);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};

test("four-streak boundary, scope, rule, and floors are frozen", () => {
  assert.equal(FOUR_STREAK_REVERSAL_AUDIT.evalStartMs, 1_784_815_200_000);
  assert.equal(FOUR_STREAK_REVERSAL_AUDIT.horizonMin, 5);
  assert.equal(FOUR_STREAK_REVERSAL_AUDIT.sampleMinute, 0);
  assert.equal(FOUR_STREAK_REVERSAL_AUDIT.streakLength, 4);
  assert.equal(FOUR_STREAK_REVERSAL_AUDIT.minMarkets, 1_500);
  assert.equal(FOUR_STREAK_REVERSAL_AUDIT.minSpanDays, 5);
  assert.equal(FOUR_STREAK_REVERSAL_AUDIT.minBets, 200);
  assert.equal(FOUR_STREAK_REVERSAL_AUDIT.minClusters, 500);
  assert.equal(FOUR_STREAK_REVERSAL_AUDIT.bootstrapIterations, 1_000);
});

test("four prior UP outcomes are faded DOWN", () => {
  const observation = fourStreakReversalObservation(
    [true, true, true, true],
    0.54,
    0.48,
  );
  assert.ok(observation);
  assert.equal(observation.priorDirection, "up");
  assert.equal(observation.side, "down");
  close(observation.ask, 0.48);
  close(observation.controlAsk, 0.48);
});

test("four prior DOWN outcomes are faded UP", () => {
  const observation = fourStreakReversalObservation(
    [false, false, false, false],
    0.54,
    0.48,
  );
  assert.ok(observation);
  assert.equal(observation.priorDirection, "down");
  assert.equal(observation.side, "up");
  close(observation.ask, 0.54);
});

test("mixed history abstains and incomplete or invalid inputs fail closed", () => {
  const mixed = fourStreakReversalObservation(
    [true, true, false, true],
    0.54,
    0.48,
  );
  assert.ok(mixed);
  assert.equal(mixed.priorDirection, null);
  assert.equal(mixed.side, null);
  assert.equal(mixed.ask, null);

  assert.equal(fourStreakReversalObservation([true, true, true], 0.54, 0.48), null);
  assert.equal(
    fourStreakReversalObservation([true, true, true, true], 0.99, 0.48),
    null,
  );
});

test("readiness requires every frozen floor", () => {
  assert.equal(fourStreakReversalReady(1_500, 5, 200, 500, 2), true);
  assert.equal(fourStreakReversalReady(1_499, 5, 200, 500, 2), false);
  assert.equal(fourStreakReversalReady(1_500, 4.999, 200, 500, 2), false);
  assert.equal(fourStreakReversalReady(1_500, 5, 199, 500, 2), false);
  assert.equal(fourStreakReversalReady(1_500, 5, 200, 499, 2), false);
  assert.equal(fourStreakReversalReady(1_500, 5, 200, 500, 1), false);
});

test("cluster readiness deduplicates multi-asset bets in the same target window", () => {
  const t = Date.UTC(2026, 6, 23, 14, 0);
  assert.equal(fourStreakReversalClusterCount([
    { windowStartMs: t },
    { windowStartMs: t },
    { windowStartMs: t + 5 * 60_000 },
  ]), 2);
});

test("report uses fee-adjusted asks, same-tick DOWN control, and two sessions", () => {
  const points: FourStreakCandidatePoint[] = [];
  for (let i = 0; i < 100; i++) {
    const hour = i < 50 ? 8 : 20;
    const t = Date.UTC(2026, 6, 23 + Math.floor(i / 24), hour, (i % 12) * 5);
    points.push({
      id: i + 1,
      conditionId: `condition-${i}`,
      pair: "BTC-USD",
      windowStartMs: t,
      decidedAtMs: t + 60_000,
      side: "up",
      ask: 0.5,
      controlAsk: 0.5,
      resolvedUp: true,
    });
  }
  const report = computeFourStreakReversalReport(points);
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
