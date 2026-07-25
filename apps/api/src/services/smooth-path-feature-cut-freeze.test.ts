import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildSmoothPathFeatureCutEnvelope,
  nextSmoothPathStrategyBoundary,
  parseSmoothPathFeatureCutEnvelope,
  serializeSmoothPathFeatureCutEnvelope,
  SMOOTH_PATH_FEATURE_CUT_FREEZE,
  type SmoothPathFunnelReportLike,
} from "./smooth-path-feature-cut-freeze.ts";
import {
  SMOOTH_PATH_CAUSAL_DISPLACEMENT,
  SMOOTH_PATH_DISPLACEMENT,
} from "./smooth-path-displacement.ts";
import { SMOOTH_PATH_QUALITY_TAPE } from "./smooth-path-quality-tape.ts";

const quantiles = (p10: number, p50: number, p90: number) => ({ p10, p50, p90 });

function report(): SmoothPathFunnelReportLike {
  return {
    qualityTape: {
      version: SMOOTH_PATH_QUALITY_TAPE.version,
      allVersionsReadyForThresholdDesign: true,
    },
    versions: [
      SMOOTH_PATH_DISPLACEMENT.version,
      SMOOTH_PATH_CAUSAL_DISPLACEMENT.version,
    ].map((version) => ({
      version,
      quality: {
        metricRows: 5_100,
        weakestPairMetricRows: 820,
        spanDays: 3.1,
        coverage: 0.99,
        readyForThresholdDesign: true,
        absDisplacementLog: quantiles(0.0001, 0.0005, 0.001),
        pathR2: quantiles(0.1, 0.5, 0.9),
        pathEfficiency: quantiles(0.1, 0.4, 0.8),
        continuationSlopePerSec: quantiles(-0.00001, 0, 0.00002),
        continuationFreshLog: quantiles(-0.0002, 0, 0.0003),
      },
    })),
  };
}

test("Smooth Path cut plan fixes prerequisites, references, and later boundary", () => {
  assert.equal(
    SMOOTH_PATH_FEATURE_CUT_FREEZE.planVersion,
    "updown-smooth-path-feature-cut-freeze-plan-v1",
  );
  assert.equal(
    SMOOTH_PATH_FEATURE_CUT_FREEZE.artifactVersion,
    "updown-smooth-path-feature-cuts-v1",
  );
  assert.equal(SMOOTH_PATH_FEATURE_CUT_FREEZE.metrics.length, 5);
  assert.equal(SMOOTH_PATH_FEATURE_CUT_FREEZE.versions.length, 2);
  assert.equal(SMOOTH_PATH_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs, 30 * 60_000);
  assert.equal(SMOOTH_PATH_FEATURE_CUT_FREEZE.boundaryGridMs, 5 * 60_000);
  const frozenAtMs = Date.UTC(2026, 6, 27, 3, 2);
  assert.equal(nextSmoothPathStrategyBoundary(frozenAtMs), Date.UTC(2026, 6, 27, 3, 35));
});

test("Smooth Path cut artifact is deterministic, hashed, ordered, and round-trippable", () => {
  const input = { report: report(), frozenAtMs: Date.UTC(2026, 6, 27, 3, 2) };
  const first = buildSmoothPathFeatureCutEnvelope(input);
  const second = buildSmoothPathFeatureCutEnvelope(input);
  assert.deepEqual(first, second);
  assert.match(first.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    first.artifact.versions.map((row) => row.version),
    [
      SMOOTH_PATH_DISPLACEMENT.version,
      SMOOTH_PATH_CAUSAL_DISPLACEMENT.version,
    ],
  );
  assert.equal(first.artifact.versions[0]?.references.pathR2.p50, 0.5);
  assert.deepEqual(
    parseSmoothPathFeatureCutEnvelope(serializeSmoothPathFeatureCutEnvelope(first)),
    first,
  );
});

test("Smooth Path cut artifact fails closed before readiness or on invalid distributions", () => {
  const unready = report();
  unready.qualityTape.allVersionsReadyForThresholdDesign = false;
  assert.throws(
    () => buildSmoothPathFeatureCutEnvelope({
      report: unready,
      frozenAtMs: Date.UTC(2026, 6, 27, 3, 2),
    }),
    /both ready quality distributions/,
  );

  const under = report();
  under.versions[0]!.quality.weakestPairMetricRows = 799;
  assert.throws(
    () => buildSmoothPathFeatureCutEnvelope({
      report: under,
      frozenAtMs: Date.UTC(2026, 6, 27, 3, 2),
    }),
    /insufficient support/,
  );

  const nonMonotone = report();
  nonMonotone.versions[0]!.quality.pathR2 = quantiles(0.8, 0.5, 0.9);
  assert.throws(
    () => buildSmoothPathFeatureCutEnvelope({
      report: nonMonotone,
      frozenAtMs: Date.UTC(2026, 6, 27, 3, 2),
    }),
    /non-monotone/,
  );

  const valid = buildSmoothPathFeatureCutEnvelope({
    report: report(),
    frozenAtMs: Date.UTC(2026, 6, 27, 3, 2),
  });
  assert.throws(
    () => parseSmoothPathFeatureCutEnvelope(
      serializeSmoothPathFeatureCutEnvelope(valid).replace(valid.sha256, "0".repeat(64)),
    ),
    /hash mismatch/,
  );
});

test("Smooth Path preregistration is metadata-only and freeze remains readiness-gated", () => {
  const preregistration = readFileSync(
    new URL("../scripts/record-smooth-path-feature-cut-freeze-plan-v1.ts", import.meta.url),
    "utf8",
  );
  const freeze = readFileSync(
    new URL("../scripts/freeze-smooth-path-feature-cuts-v1.ts", import.meta.url),
    "utf8",
  );
  assert.match(preregistration, /Outcome-blind Smooth Path feature-cut freeze plan v1/);
  assert.doesNotMatch(
    preregistration,
    /smoothPathFunnelStatus|polymarket_smooth_path_funnel|db\.execute/,
  );
  assert.match(freeze, /smoothPathFunnelStatus/);
  assert.match(freeze, /allVersionsReadyForThresholdDesign/);
  assert.doesNotMatch(
    freeze,
    /\b(?:paper_trade|resolved_up|label_status|pnl_usd|raw_net|worst_case_net)\b/i,
  );
  for (const source of [preregistration, freeze]) {
    for (const prohibited of [
      "placeOrder",
      "submitOrder",
      "cancelOrder",
      "privateKey",
      "paperTrades",
      "polymarketStateSnapshots",
    ]) {
      assert.equal(source.includes(prohibited), false, `${prohibited} must not be reachable`);
    }
  }
});
