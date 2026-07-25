import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  expectedAuthoritativeTakerFlowBucketKeys,
} from "./authoritative-taker-flow-distribution-contract.ts";
import {
  AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE,
  assertAuthoritativeTakerFlowFeatureCutEnvelope,
  buildAuthoritativeTakerFlowFeatureCutEnvelope,
  nextAuthoritativeTakerFlowStrategyBoundary,
  parseAuthoritativeTakerFlowFeatureCutEnvelope,
  serializeAuthoritativeTakerFlowFeatureCutEnvelope,
  type AuthoritativeTakerFlowDistributionReportLike,
} from "./authoritative-taker-flow-feature-cut-freeze.ts";

function report(): AuthoritativeTakerFlowDistributionReportLike {
  const buckets = expectedAuthoritativeTakerFlowBucketKeys().map((key) => {
    const [pair, horizon] = key.split(":");
    const horizonMin = Number(horizon);
    return {
      pair,
      horizonMin,
      markets: 25,
      metrics: Object.fromEntries(
        AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.metrics.map((metricName) => [
          metricName,
          {
            n: 100,
            quantiles: metricName === "chainConfirmations"
              ? { p05: 20, p25: 20, p50: 21, p75: 22, p95: 25 }
              : metricName === "secondsFromWindowStart"
                ? {
                    p05: 1,
                    p25: horizonMin * 5,
                    p50: horizonMin * 10,
                    p75: horizonMin * 20,
                    p95: horizonMin * 40,
                  }
                : { p05: 0, p25: 1, p50: 2, p75: 3, p95: 4 },
          },
        ]),
      ),
    };
  });
  return {
    expectedBuckets: 12,
    completeBuckets: 12,
    missingBuckets: [],
    minBucketMarkets: 25,
    readyForCutFreeze: true,
    buckets,
  };
}

test("authoritative taker-flow feature-cut plan freezes a later boundary", () => {
  assert.equal(
    AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.planVersion,
    "updown-authoritative-taker-flow-feature-cut-freeze-plan-v1",
  );
  assert.equal(
    AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.artifactVersion,
    "updown-authoritative-taker-flow-feature-cuts-v1",
  );
  assert.equal(AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.requiredBuckets, 12);
  assert.equal(AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.minMarketsPerBucket, 25);
  assert.equal(
    AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs,
    30 * 60_000,
  );
  assert.equal(
    nextAuthoritativeTakerFlowStrategyBoundary(
      Date.parse("2026-07-31T12:07:00.000Z"),
    ),
    Date.parse("2026-07-31T12:45:00.000Z"),
  );
});

test("authoritative taker-flow cut artifact is deterministic, complete, and hashed", () => {
  const input = {
    distributionVersion: "updown-authoritative-taker-flow-distribution-audit-v1",
    tapeVersion: "polymarket-authoritative-taker-flow-tape-v1",
    report: report(),
    frozenAtMs: Date.parse("2026-07-31T12:07:00.000Z"),
  };
  const first = buildAuthoritativeTakerFlowFeatureCutEnvelope(input);
  const second = buildAuthoritativeTakerFlowFeatureCutEnvelope(input);
  assert.deepEqual(first, second);
  assert.match(first.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    first.artifact.buckets.map((bucket) => `${bucket.pair}:${bucket.horizonMin}`),
    expectedAuthoritativeTakerFlowBucketKeys(),
  );
  assert.equal(first.artifact.buckets[0].metrics.logChainNotionalUsd.iqr, 2);
  assert.equal(
    first.artifact.strategyNotBeforeMs,
    Date.parse("2026-07-31T12:45:00.000Z"),
  );
  assert.deepEqual(
    parseAuthoritativeTakerFlowFeatureCutEnvelope(
      serializeAuthoritativeTakerFlowFeatureCutEnvelope(first),
    ),
    first,
  );
});

test("authoritative taker-flow cut fails closed on incomplete, invalid, or tampered input", () => {
  const incomplete = report();
  incomplete.readyForCutFreeze = false;
  assert.throws(
    () => buildAuthoritativeTakerFlowFeatureCutEnvelope({
      distributionVersion: "updown-authoritative-taker-flow-distribution-audit-v1",
      tapeVersion: "polymarket-authoritative-taker-flow-tape-v1",
      report: incomplete,
      frozenAtMs: Date.parse("2026-07-31T12:07:00.000Z"),
    }),
    /complete ready distribution/,
  );

  const underConfirmed = report();
  underConfirmed.buckets[0].metrics.chainConfirmations.quantiles = {
    p05: 19,
    p25: 20,
    p50: 21,
    p75: 22,
    p95: 25,
  };
  assert.throws(
    () => buildAuthoritativeTakerFlowFeatureCutEnvelope({
      distributionVersion: "updown-authoritative-taker-flow-distribution-audit-v1",
      tapeVersion: "polymarket-authoritative-taker-flow-tape-v1",
      report: underConfirmed,
      frozenAtMs: Date.parse("2026-07-31T12:07:00.000Z"),
    }),
    /under-confirmed/,
  );

  const valid = buildAuthoritativeTakerFlowFeatureCutEnvelope({
    distributionVersion: "updown-authoritative-taker-flow-distribution-audit-v1",
    tapeVersion: "polymarket-authoritative-taker-flow-tape-v1",
    report: report(),
    frozenAtMs: Date.parse("2026-07-31T12:07:00.000Z"),
  });
  const body = serializeAuthoritativeTakerFlowFeatureCutEnvelope(valid)
    .replace(valid.sha256, "0".repeat(64));
  assert.throws(
    () => parseAuthoritativeTakerFlowFeatureCutEnvelope(body),
    /hash mismatch/,
  );

  const forged = structuredClone(valid);
  forged.artifact.buckets[0].metrics.logChainNotionalUsd.iqr = 999;
  forged.sha256 = createHash("sha256")
    .update(JSON.stringify(forged.artifact))
    .digest("hex");
  assert.throws(
    () => assertAuthoritativeTakerFlowFeatureCutEnvelope(forged),
    /metric contract/,
  );
});

test("cut preregistration is metadata-only and freeze remains readiness-gated", () => {
  const preregistration = readFileSync(
    new URL(
      "../scripts/record-authoritative-taker-flow-feature-cut-freeze-plan-v1.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const freeze = readFileSync(
    new URL(
      "../scripts/freeze-authoritative-taker-flow-feature-cuts-v1.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    preregistration,
    /Outcome-blind authoritative taker-flow feature-cut freeze plan v1/,
  );
  assert.doesNotMatch(
    preregistration,
    /authoritativeTakerFlowDistributionAudit|polymarket_trade_flow_event|db\.execute/,
  );
  assert.match(freeze, /authoritativeTakerFlowDistributionAudit/);
  assert.match(freeze, /readyForCutFreeze/);
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
    ]) {
      assert.equal(source.includes(prohibited), false, `${prohibited} must not be reachable`);
    }
  }
});
