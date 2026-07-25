import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT,
  expectedAuthoritativeTakerPressureBucketKeys,
} from "./authoritative-taker-pressure-distribution-contract.ts";
import {
  AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE,
  buildAuthoritativeTakerPressureFeatureCutEnvelope,
  nextAuthoritativeTakerPressureStrategyBoundary,
  parseAuthoritativeTakerPressureFeatureCutEnvelope,
  serializeAuthoritativeTakerPressureFeatureCutEnvelope,
} from "./authoritative-taker-pressure-feature-cut-freeze.ts";

const reference = (values = [1, 2, 3, 4, 5]) => ({
  n: 25,
  quantiles: {
    p05: values[0],
    p25: values[1],
    p50: values[2],
    p75: values[3],
    p95: values[4],
  },
});

function report() {
  return {
    expectedBuckets: 12,
    completeBuckets: 12,
    missingBuckets: [] as string[],
    minBucketMarkets: 25,
    readyForCutFreeze: true,
    buckets: expectedAuthoritativeTakerPressureBucketKeys().map((key) => {
      const [pair, horizonMin] = key.split(":");
      return {
        pair,
        horizonMin: Number(horizonMin),
        markets: 25,
        metrics: {
          logGrossShares: reference(),
          eventCount: reference(),
          uniqueReceiptCount: reference(),
          absoluteSharePressure: reference([0.05, 0.2, 0.4, 0.7, 0.95]),
          maxEventShareFraction: reference([0.1, 0.2, 0.3, 0.4, 0.8]),
        },
      };
    }),
  };
}

function build() {
  return buildAuthoritativeTakerPressureFeatureCutEnvelope({
    distributionVersion: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.version,
    tapeVersion: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.tapeVersion,
    observationWindowSec: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.observationWindowSec,
    report: report(),
    frozenAtMs: Date.UTC(2026, 6, 25, 15, 1),
  });
}

test("pressure cut plan freezes exact unsigned thresholds and a future grid boundary", () => {
  assert.equal(
    AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.artifactVersion,
    "updown-authoritative-taker-pressure-feature-cuts-v1",
  );
  assert.equal(AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.requiredBuckets, 12);
  assert.equal(AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.minMarketsPerBucket, 25);
  const envelope = build();
  assert.match(envelope.sha256, /^[a-f0-9]{64}$/);
  assert.equal(envelope.artifact.buckets.length, 12);
  assert.equal(envelope.artifact.strategyNotBeforeMs, Date.UTC(2026, 6, 25, 15, 45));
  assert.deepEqual(envelope.artifact.buckets[0].cuts, {
    logGrossSharesP25: 2,
    eventCountP25: 2,
    uniqueReceiptCountP25: 2,
    absoluteSharePressureP75: 0.7,
    maxEventShareFractionP95: 0.8,
  });
});

test("pressure cut envelopes round-trip and reject tampering", () => {
  const envelope = build();
  const serialized = serializeAuthoritativeTakerPressureFeatureCutEnvelope(envelope);
  assert.deepEqual(parseAuthoritativeTakerPressureFeatureCutEnvelope(serialized), envelope);
  const tampered = serialized.replace(
    '"absoluteSharePressureP75":0.7',
    '"absoluteSharePressureP75":0.6',
  );
  assert.throws(
    () => parseAuthoritativeTakerPressureFeatureCutEnvelope(tampered),
    /invalid authoritative taker-pressure feature cut|hash mismatch/,
  );

  const extended = structuredClone(envelope);
  Object.assign(extended.artifact, { extraReference: 1 });
  extended.sha256 = createHash("sha256").update(JSON.stringify(extended.artifact)).digest("hex");
  assert.throws(
    () =>
      parseAuthoritativeTakerPressureFeatureCutEnvelope(
        serializeAuthoritativeTakerPressureFeatureCutEnvelope(extended),
      ),
    /artifact schema/,
  );
});

test("pressure cut construction fails incomplete, degenerate, and out-of-range reports closed", () => {
  const incomplete = report();
  incomplete.readyForCutFreeze = false;
  assert.throws(
    () =>
      buildAuthoritativeTakerPressureFeatureCutEnvelope({
        distributionVersion: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.version,
        tapeVersion: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.tapeVersion,
        observationWindowSec: 60,
        report: incomplete,
        frozenAtMs: Date.now(),
      }),
    /complete ready report/,
  );

  const degenerate = report();
  degenerate.buckets[0].metrics.absoluteSharePressure = reference([0.5, 0.5, 0.5, 0.5, 0.5]);
  assert.throws(
    () =>
      buildAuthoritativeTakerPressureFeatureCutEnvelope({
        distributionVersion: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.version,
        tapeVersion: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.tapeVersion,
        observationWindowSec: 60,
        report: degenerate,
        frozenAtMs: Date.now(),
      }),
    /degenerate/,
  );

  const invalid = report();
  invalid.buckets[0].metrics.maxEventShareFraction = reference([0.1, 0.2, 0.3, 0.4, 1.1]);
  assert.throws(
    () =>
      buildAuthoritativeTakerPressureFeatureCutEnvelope({
        distributionVersion: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.version,
        tapeVersion: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.tapeVersion,
        observationWindowSec: 60,
        report: invalid,
        frozenAtMs: Date.now(),
      }),
    /out-of-range/,
  );

  const countMismatch = report();
  countMismatch.buckets[0].metrics.eventCount.n = 24;
  assert.throws(
    () =>
      buildAuthoritativeTakerPressureFeatureCutEnvelope({
        distributionVersion: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.version,
        tapeVersion: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.tapeVersion,
        observationWindowSec: 60,
        report: countMismatch,
        frozenAtMs: Date.now(),
      }),
    /metric count mismatch/,
  );

  const impossibleReceipts = report();
  impossibleReceipts.buckets[0].metrics.uniqueReceiptCount = reference([2, 3, 4, 5, 6]);
  assert.throws(
    () =>
      buildAuthoritativeTakerPressureFeatureCutEnvelope({
        distributionVersion: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.version,
        tapeVersion: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.tapeVersion,
        observationWindowSec: 60,
        report: impossibleReceipts,
        frozenAtMs: Date.now(),
      }),
    /receipt count exceeds event count/,
  );

  const nonPositiveGrossShares = report();
  nonPositiveGrossShares.buckets[0].metrics.logGrossShares = reference([0, 1, 2, 3, 4]);
  assert.throws(
    () =>
      buildAuthoritativeTakerPressureFeatureCutEnvelope({
        distributionVersion: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.version,
        tapeVersion: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.tapeVersion,
        observationWindowSec: 60,
        report: nonPositiveGrossShares,
        frozenAtMs: Date.now(),
      }),
    /non-positive authoritative taker-pressure gross shares/,
  );
});

test("pressure boundary calculation rejects invalid timestamps", () => {
  assert.throws(
    () => nextAuthoritativeTakerPressureStrategyBoundary(0),
    /invalid authoritative taker-pressure freeze timestamp/,
  );
});

test("pressure feature-cut implementation has no paper or execution path", () => {
  const source = readFileSync(
    new URL("./authoritative-taker-pressure-feature-cut-freeze.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /\b(placeOrder|submitOrder|cancelOrder|signTypedData)\b/);
  assert.doesNotMatch(source, /\bpaper_(?:bet|ledger|decision)\b/i);
  assert.doesNotMatch(source, /\bdb\.(?:insert|update|delete)\s*\(/i);
});

test("pressure preregistration is metadata-only and the later freeze is readiness-gated", () => {
  const distributionPreregistration = readFileSync(
    new URL(
      "../scripts/record-authoritative-taker-pressure-distribution-audit-v1.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const cutPreregistration = readFileSync(
    new URL(
      "../scripts/record-authoritative-taker-pressure-feature-cut-freeze-plan-v1.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const freeze = readFileSync(
    new URL("../scripts/freeze-authoritative-taker-pressure-feature-cuts-v1.ts", import.meta.url),
    "utf8",
  );
  const router = readFileSync(new URL("../routers/polymarket.ts", import.meta.url), "utf8");

  assert.doesNotMatch(
    distributionPreregistration,
    /authoritativeTakerPressureDistributionAudit|polymarket_trade_flow_event|db\.execute/,
  );
  assert.doesNotMatch(
    cutPreregistration,
    /authoritativeTakerPressureDistributionAudit|polymarket_trade_flow_event|db\.execute/,
  );
  assert.match(freeze, /authoritativeTakerPressureDistributionAudit/);
  assert.match(freeze, /inheritedTapeReady/);
  assert.match(freeze, /readyForCutFreeze/);
  assert.match(router, /authoritativeTakerPressureDistributionAudit:\s*protectedProcedure\.query/);

  for (const source of [distributionPreregistration, cutPreregistration, freeze, router]) {
    assert.doesNotMatch(source, /\b(placeOrder|submitOrder|cancelOrder|signTypedData)\b/);
    assert.doesNotMatch(
      source,
      /\b(?:paper_trade|resolved_up|label_status|pnl_usd|raw_net|worst_case_net)\b/i,
    );
  }
});
