import assert from "node:assert/strict";
import test from "node:test";
import {
  SMOOTH_PATH_CAUSAL_DISPLACEMENT,
  SMOOTH_PATH_DISPLACEMENT,
  smoothPathCausalEligible,
  smoothPathCausalObservation,
  smoothPathEligible,
  smoothPathObservation,
  smoothPathPaperDecision,
  type SmoothPathTick,
} from "./smooth-path-displacement.ts";

const start = 1_800_000_000_000;

function linearPath(direction: 1 | -1, count = 121): SmoothPathTick[] {
  return Array.from({ length: count }, (_, index) => {
    const sourceAtMs = start + index * 1_000;
    return {
      sourceAtMs,
      price: 100 * Math.exp(direction * index * 0.000012),
      receivedAtMs: sourceAtMs + 100,
    };
  });
}

test("smooth path contract is frozen at its own 5m minute-2 boundary", () => {
  assert.equal(SMOOTH_PATH_DISPLACEMENT.evalStartMs, 1_784_825_100_000);
  assert.equal(SMOOTH_PATH_DISPLACEMENT.minTicks, 90);
  assert.equal(SMOOTH_PATH_DISPLACEMENT.minAbsDisplacementLog, 0.0008);
  assert.equal(SMOOTH_PATH_DISPLACEMENT.minPathR2, 0.60);
  assert.equal(SMOOTH_PATH_DISPLACEMENT.minPathEfficiency, 0.55);
  assert.equal(SMOOTH_PATH_DISPLACEMENT.eventSideProbability, 0.70);
  assert.equal(SMOOTH_PATH_DISPLACEMENT.askEdge, 0.05);
  assert.equal(SMOOTH_PATH_DISPLACEMENT.maxAskDrift, 0.08);
  assert.equal(smoothPathEligible("BTC-USD", 5, 2), true);
  assert.equal(smoothPathEligible("BTC-USD", 15, 2), false);
  assert.equal(smoothPathEligible("ADA-USD", 5, 2), false);
});

test("causal-delivery child is future-dated and inherits every numerical gate", () => {
  assert.equal(SMOOTH_PATH_CAUSAL_DISPLACEMENT.version, "updown-smooth-path-causal-displacement-v2");
  assert.equal(SMOOTH_PATH_CAUSAL_DISPLACEMENT.evalStartMs, Date.UTC(2026, 6, 23, 22, 0, 0));
  assert.ok(SMOOTH_PATH_CAUSAL_DISPLACEMENT.evalStartMs > SMOOTH_PATH_DISPLACEMENT.evalStartMs);
  for (const key of [
    "horizonMin",
    "previousSampleMinute",
    "decisionSampleMinute",
    "minTicks",
    "maxStartCoverageSec",
    "maxIntertickGapSec",
    "maxSourceAgeSec",
    "maxReceiveAgeSec",
    "freshLookbackSec",
    "freshToleranceSec",
    "minAbsDisplacementLog",
    "minPathR2",
    "minPathEfficiency",
    "minSignedFreshReturnLog",
    "eventSideProbability",
    "askEdge",
    "maxAskDrift",
    "minFill",
    "maxFill",
    "maxBatchRequestMs",
  ] as const) {
    assert.equal(SMOOTH_PATH_CAUSAL_DISPLACEMENT[key], SMOOTH_PATH_DISPLACEMENT[key]);
  }
  assert.equal(smoothPathCausalEligible("BTC-USD", 5, 2), true);
  assert.equal(smoothPathCausalEligible("BTC-USD", 15, 2), false);
  assert.equal(smoothPathCausalEligible("ADA-USD", 5, 2), false);
});

test("smooth linear displacement qualifies symmetrically up and down", () => {
  const up = smoothPathObservation({
    windowStartMs: start,
    observedAtMs: start + 120_200,
    strike: 100,
    ticks: linearPath(1),
  });
  const down = smoothPathObservation({
    windowStartMs: start,
    observedAtMs: start + 120_200,
    strike: 100,
    ticks: linearPath(-1),
  });

  assert.equal(up?.side, "up");
  assert.equal(up?.pup, 0.70);
  assert.deepEqual(up?.rejectionReasons, []);
  assert.equal(down?.side, "down");
  assert.ok(Math.abs((down?.pup ?? 0) - 0.30) < 1e-12);
  assert.deepEqual(down?.rejectionReasons, []);
  assert.ok((up?.pathR2 ?? 0) > 0.999999);
  assert.ok((down?.pathR2 ?? 0) > 0.999999);
  assert.ok((up?.pathEfficiency ?? 0) > 0.999999);
  assert.ok((down?.pathEfficiency ?? 0) > 0.999999);
  assert.ok((up?.signedFreshReturnLog ?? 0) > SMOOTH_PATH_DISPLACEMENT.minSignedFreshReturnLog);
  assert.ok((down?.signedFreshReturnLog ?? 0) > SMOOTH_PATH_DISPLACEMENT.minSignedFreshReturnLog);
});

test("jagged or stale paths expose quality but abstain", () => {
  const jagged = linearPath(1).map((tick, index) => ({
    ...tick,
    price: tick.price * Math.exp(index % 2 === 0 ? 0.001 : -0.001),
  }));
  const noisy = smoothPathObservation({
    windowStartMs: start,
    observedAtMs: start + 120_200,
    strike: 100,
    ticks: jagged,
  });
  const stale = smoothPathObservation({
    windowStartMs: start,
    observedAtMs: start + 160_000,
    strike: 100,
    ticks: linearPath(1),
  });

  assert.equal(noisy?.side, null);
  assert.ok((noisy?.pathEfficiency ?? 1) < SMOOTH_PATH_DISPLACEMENT.minPathEfficiency);
  assert.ok(noisy?.rejectionReasons.includes("path-efficiency"));
  assert.equal(stale?.side, null);
  assert.ok((stale?.sourceAgeSec ?? 0) > SMOOTH_PATH_DISPLACEMENT.maxSourceAgeSec);
  assert.ok(stale?.rejectionReasons.includes("source-stale"));
  assert.ok(stale?.rejectionReasons.includes("receive-stale"));
  assert.equal(stale?.rejectionReasons.includes("receive-after-observation"), false);
});

test("receive-time diagnostics distinguish future delivery from an old delivery", () => {
  const futureDelivered = linearPath(1).map((tick, index) => (
    index === 120
      ? { ...tick, receivedAtMs: start + 121_000 }
      : tick
  ));
  const result = smoothPathObservation({
    windowStartMs: start,
    observedAtMs: start + 120_200,
    strike: 100,
    ticks: futureDelivered,
  });

  assert.equal(result?.side, null);
  assert.ok(result?.receiveAgeSec != null && result.receiveAgeSec < 0);
  assert.ok(result?.rejectionReasons.includes("receive-after-observation"));
  assert.equal(result?.rejectionReasons.includes("receive-stale"), false);

  const causal = smoothPathCausalObservation({
    windowStartMs: start,
    observedAtMs: start + 120_200,
    strike: 100,
    ticks: futureDelivered,
  });
  assert.equal(causal?.causalDeliveriesOnly, true);
  assert.equal(causal?.sourceAtMs, start + 119_000);
  assert.equal(causal?.side, "up");
  assert.deepEqual(causal?.rejectionReasons, []);
});

test("outcome-blind diagnostics report every frozen path gate without changing the decision", () => {
  const sparse = smoothPathObservation({
    windowStartMs: start,
    observedAtMs: start + 120_200,
    strike: 100,
    ticks: linearPath(1, 30).map((tick, index) => ({
      ...tick,
      sourceAtMs: start + 10_000 + index * 3_000,
      receivedAtMs: start + 10_100 + index * 3_000,
    })),
  });

  assert.equal(sparse?.side, null);
  assert.ok(sparse?.rejectionReasons.includes("tick-count"));
  assert.ok(sparse?.rejectionReasons.includes("start-coverage"));
});

test("duplicate source timestamps keep the latest received delivery", () => {
  const ticks = linearPath(1);
  ticks.push({
    sourceAtMs: start + 120_000,
    price: 100 * Math.exp(120 * 0.000013),
    receivedAtMs: start + 120_500,
  });
  const result = smoothPathObservation({
    windowStartMs: start,
    observedAtMs: start + 120_600,
    strike: 100,
    ticks,
  });
  assert.equal(result?.tickCount, 121);
  assert.equal(result?.receivedAtMs, start + 120_500);
});

test("paper decision enforces strict fee-adjusted edge and minute-1 chase limit", () => {
  const observation = smoothPathObservation({
    windowStartMs: start,
    observedAtMs: start + 120_200,
    strike: 100,
    ticks: linearPath(1),
  });
  assert.ok(observation);

  const accepted = smoothPathPaperDecision(observation, 0.57, 0.43, 0.62, 0.38);
  assert.equal(accepted?.side, "up");
  assert.ok(Math.abs((accepted?.edgeAsk ?? 0) - 0.08) < 1e-12);
  assert.ok(Math.abs((accepted?.askDrift ?? 0) - 0.05) < 1e-12);
  assert.equal(smoothPathPaperDecision(observation, 0.54, 0.46, 0.63, 0.37), null);
  assert.equal(smoothPathPaperDecision(observation, 0.60, 0.40, 0.65, 0.35), null);
});
