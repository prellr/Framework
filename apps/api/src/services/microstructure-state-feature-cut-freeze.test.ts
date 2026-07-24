import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedMicrostructureStateBucketKeys } from "./microstructure-state-distribution-contract.ts";
import {
  buildMicrostructureStateFeatureCutEnvelope,
  MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE,
  nextMicrostructureStateStrategyBoundary,
  parseMicrostructureStateFeatureCutEnvelope,
  serializeMicrostructureStateFeatureCutEnvelope,
  type StateDistributionReportLike,
} from "./microstructure-state-feature-cut-freeze.ts";

const metricNames = MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.metrics;

function report(): StateDistributionReportLike {
  const buckets = expectedMicrostructureStateBucketKeys().map((key) => {
    const [pair, horizon, minute] = key.split(":");
    return {
      pair,
      horizonMin: Number(horizon),
      sampleMinute: Number(minute),
      markets: 50,
      metrics: Object.fromEntries(metricNames.map((metric) => [
        metric,
        {
          n: 50,
          quantiles: {
            p05: -2,
            p25: -1,
            p50: 0,
            p75: 1,
            p95: 2,
          },
        },
      ])),
    };
  });
  return {
    expectedBuckets: 120,
    completeBuckets: 120,
    missingBuckets: [],
    minBucketMarkets: 50,
    readyForCutFreeze: true,
    buckets,
  };
}

test("state feature-cut plan freezes exact prerequisite, universe, and later boundary", () => {
  assert.equal(
    MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.planVersion,
    "updown-microstructure-state-feature-cut-freeze-plan-v1",
  );
  assert.equal(
    MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.artifactVersion,
    "updown-microstructure-state-feature-cuts-v1",
  );
  assert.equal(MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.requiredBuckets, 120);
  assert.equal(MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.minMarketsPerBucket, 50);
  assert.equal(MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs, 30 * 60_000);
  assert.equal(MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.boundaryGridMs, 15 * 60_000);
  const frozenAtMs = Date.UTC(2026, 6, 28, 12, 7);
  assert.equal(
    nextMicrostructureStateStrategyBoundary(frozenAtMs),
    Date.UTC(2026, 6, 28, 12, 45),
  );
});

test("state feature-cut artifact is deterministic, complete, hashed, and round-trippable", () => {
  const input = {
    distributionVersion: "updown-microstructure-state-distribution-audit-v1",
    tapeVersion: "polymarket-microstructure-tape-v1",
    report: report(),
    frozenAtMs: Date.UTC(2026, 6, 28, 12, 7),
  };
  const first = buildMicrostructureStateFeatureCutEnvelope(input);
  const second = buildMicrostructureStateFeatureCutEnvelope(input);
  assert.deepEqual(first, second);
  assert.match(first.sha256, /^[a-f0-9]{64}$/);
  assert.equal(first.artifact.buckets.length, 120);
  assert.deepEqual(
    first.artifact.buckets.map(
      (bucket) => `${bucket.pair}:${bucket.horizonMin}:${bucket.sampleMinute}`,
    ),
    expectedMicrostructureStateBucketKeys(),
  );
  assert.equal(first.artifact.buckets[0].metrics.micropriceSkew.iqr, 2);
  assert.equal(
    first.artifact.strategyNotBeforeMs,
    Date.UTC(2026, 6, 28, 12, 45),
  );
  assert.deepEqual(
    parseMicrostructureStateFeatureCutEnvelope(
      serializeMicrostructureStateFeatureCutEnvelope(first),
    ),
    first,
  );
});

test("state feature-cut artifact fails closed on incomplete, degenerate, or tampered input", () => {
  const incomplete = report();
  incomplete.readyForCutFreeze = false;
  assert.throws(
    () => buildMicrostructureStateFeatureCutEnvelope({
      distributionVersion: "updown-microstructure-state-distribution-audit-v1",
      tapeVersion: "polymarket-microstructure-tape-v1",
      report: incomplete,
      frozenAtMs: Date.UTC(2026, 6, 28, 12, 7),
    }),
    /complete ready distribution/,
  );

  const degenerate = report();
  degenerate.buckets[0].metrics.micropriceSkew.quantiles = {
    p05: 0,
    p25: 0,
    p50: 0,
    p75: 0,
    p95: 0,
  };
  assert.throws(
    () => buildMicrostructureStateFeatureCutEnvelope({
      distributionVersion: "updown-microstructure-state-distribution-audit-v1",
      tapeVersion: "polymarket-microstructure-tape-v1",
      report: degenerate,
      frozenAtMs: Date.UTC(2026, 6, 28, 12, 7),
    }),
    /degenerate microstructure-state distribution/,
  );

  const valid = buildMicrostructureStateFeatureCutEnvelope({
    distributionVersion: "updown-microstructure-state-distribution-audit-v1",
    tapeVersion: "polymarket-microstructure-tape-v1",
    report: report(),
    frozenAtMs: Date.UTC(2026, 6, 28, 12, 7),
  });
  const body = serializeMicrostructureStateFeatureCutEnvelope(valid)
    .replace(valid.sha256, "0".repeat(64));
  assert.throws(
    () => parseMicrostructureStateFeatureCutEnvelope(body),
    /hash mismatch/,
  );
});

test("state cut preregistration is metadata-only and freeze remains readiness-gated", () => {
  const preregistration = readFileSync(
    new URL("../scripts/record-microstructure-state-feature-cut-freeze-plan-v1.ts", import.meta.url),
    "utf8",
  );
  const freeze = readFileSync(
    new URL("../scripts/freeze-microstructure-state-feature-cuts-v1.ts", import.meta.url),
    "utf8",
  );
  assert.match(preregistration, /Outcome-blind microstructure state feature-cut freeze plan v1/);
  assert.doesNotMatch(
    preregistration,
    /microstructureStateDistributionAudit|polymarket_state_snapshot|db\.execute/,
  );
  assert.match(freeze, /microstructureStateDistributionAudit/);
  assert.match(freeze, /readyForCutFreeze/);
  assert.doesNotMatch(
    freeze,
    /\b(?:paper_trade|resolved_up|label_status|pnl_usd|raw_net|worst_case_net)\b/i,
  );
  for (const source of [preregistration, freeze]) {
    for (const prohibited of ["placeOrder", "submitOrder", "cancelOrder", "privateKey"]) {
      assert.equal(source.includes(prohibited), false, `${prohibited} must not be reachable`);
    }
  }
});
