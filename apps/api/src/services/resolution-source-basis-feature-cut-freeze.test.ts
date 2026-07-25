import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE,
  buildResolutionSourceBasisFeatureCutEnvelope,
  nextResolutionSourceBasisStrategyBoundary,
  parseResolutionSourceBasisFeatureCutEnvelope,
  serializeResolutionSourceBasisFeatureCutEnvelope,
  type ResolutionSourceBasisDistributionReportLike,
} from "./resolution-source-basis-feature-cut-freeze.ts";

const PAIRS = ["BNB-USD", "BTC-USD", "DOGE-USD", "ETH-USD", "SOL-USD", "XRP-USD"];
const metric = (
  p05: number,
  p25: number,
  p50: number,
  p75: number,
  p95: number,
) => ({
  n: 100_000,
  quantiles: { p05, p25, p50, p75, p95 },
});
const report = (): ResolutionSourceBasisDistributionReportLike => ({
  buckets: PAIRS.map((pair, index) => ({
    pair,
    rows: 100_000 + index,
    metrics: {
      basisBps: metric(-5 - index, -2 - index / 10, 0, 2 + index / 10, 5 + index),
      absoluteBasisBps: metric(0.1, 0.5, 1, 2, 5 + index),
      basisChange1sBps: metric(-2, -0.5, 0, 0.5, 2),
      sameSignPersistence5s: metric(0.2, 0.4, 0.6, 0.8, 1),
      chainlinkAgeMs: metric(10, 50, 100, 250, 500),
      hlAgeMs: metric(5, 20, 50, 100, 300),
    },
  })),
});

test("basis feature-cut plan freezes pair references and a later boundary only", () => {
  const contract = RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE;
  assert.equal(
    contract.planVersion,
    "updown-resolution-source-basis-feature-cut-freeze-plan-v1",
  );
  assert.equal(contract.artifactVersion, "updown-resolution-source-basis-feature-cuts-v1");
  assert.equal(
    contract.prerequisiteVersion,
    "updown-resolution-source-basis-distribution-audit-v1",
  );
  assert.equal(contract.tapeVersion, "updown-venue-lead-lag-tape-v1");
  assert.equal(contract.requiredPairs, 6);
  assert.equal(contract.minimumBoundaryDelayMs, 30 * 60_000);
  assert.equal(contract.boundaryGridMs, 15 * 60_000);
  assert.equal(
    nextResolutionSourceBasisStrategyBoundary(Date.parse("2026-07-26T12:01:00.000Z")),
    Date.parse("2026-07-26T12:45:00.000Z"),
  );
});

test("basis feature-cut artifact is deterministic, complete, hashed, and round-trippable", () => {
  const frozenAtMs = Date.parse("2026-07-26T12:01:00.000Z");
  const input = {
    distributionVersion: "updown-resolution-source-basis-distribution-audit-v1",
    tapeVersion: "updown-venue-lead-lag-tape-v1",
    report: report(),
    frozenAtMs,
  };
  const first = buildResolutionSourceBasisFeatureCutEnvelope(input);
  const second = buildResolutionSourceBasisFeatureCutEnvelope(input);
  assert.deepEqual(second, first);
  assert.match(first.sha256, /^[a-f0-9]{64}$/);
  assert.equal(first.artifact.buckets.length, 6);
  assert.equal(first.artifact.strategyNotBeforeMs, Date.parse("2026-07-26T12:45:00.000Z"));
  assert.deepEqual(first.artifact.buckets[0], {
    pair: "BNB-USD",
    basisBps: {
      n: 100_000,
      p05: -5,
      p25: -2,
      p50: 0,
      p75: 2,
      p95: 5,
      iqr: 4,
    },
    absoluteBasisBps: {
      n: 100_000,
      p05: 0.1,
      p25: 0.5,
      p50: 1,
      p75: 2,
      p95: 5,
      iqr: 1.5,
    },
    basisChange1sBps: {
      n: 100_000,
      p05: -2,
      p25: -0.5,
      p50: 0,
      p75: 0.5,
      p95: 2,
      iqr: 1,
    },
    sameSignPersistence5s: {
      n: 100_000,
      p05: 0.2,
      p25: 0.4,
      p50: 0.6,
      p75: 0.8,
      p95: 1,
      iqr: 0.4,
    },
    chainlinkAgeMs: {
      n: 100_000,
      p05: 10,
      p25: 50,
      p50: 100,
      p75: 250,
      p95: 500,
      iqr: 200,
    },
    hlAgeMs: {
      n: 100_000,
      p05: 5,
      p25: 20,
      p50: 50,
      p75: 100,
      p95: 300,
      iqr: 80,
    },
  });
  assert.deepEqual(
    parseResolutionSourceBasisFeatureCutEnvelope(
      serializeResolutionSourceBasisFeatureCutEnvelope(first),
    ),
    first,
  );
});

test("basis feature-cut artifact fails closed on incomplete, invalid, or tampered input", () => {
  const frozenAtMs = Date.parse("2026-07-26T12:01:00.000Z");
  const validInput = {
    distributionVersion: "updown-resolution-source-basis-distribution-audit-v1",
    tapeVersion: "updown-venue-lead-lag-tape-v1",
    report: report(),
    frozenAtMs,
  };
  assert.throws(
    () => buildResolutionSourceBasisFeatureCutEnvelope({
      ...validInput,
      report: { buckets: validInput.report.buckets.slice(1) },
    }),
    /expected 6 pair buckets/,
  );
  const degenerate = report();
  degenerate.buckets[0].metrics.basisChange1sBps = metric(0, 0, 0, 0, 0);
  assert.throws(
    () => buildResolutionSourceBasisFeatureCutEnvelope({
      ...validInput,
      report: degenerate,
    }),
    /degenerate resolution-source distribution/,
  );
  const invalidPersistence = report();
  invalidPersistence.buckets[0].metrics.sameSignPersistence5s =
    metric(0.2, 0.4, 0.6, 0.8, 1.2);
  assert.throws(
    () => buildResolutionSourceBasisFeatureCutEnvelope({
      ...validInput,
      report: invalidPersistence,
    }),
    /invalid persistence reference/,
  );
  const staleAge = report();
  staleAge.buckets[0].metrics.chainlinkAgeMs = metric(10, 50, 100, 250, 10_001);
  assert.throws(
    () => buildResolutionSourceBasisFeatureCutEnvelope({
      ...validInput,
      report: staleAge,
    }),
    /stale resolution-source age reference/,
  );
  const envelope = buildResolutionSourceBasisFeatureCutEnvelope(validInput);
  const serialized = serializeResolutionSourceBasisFeatureCutEnvelope(envelope)
    .replace(envelope.sha256, "0".repeat(64));
  assert.throws(
    () => parseResolutionSourceBasisFeatureCutEnvelope(serialized),
    /hash mismatch/,
  );
});

test("basis plan is metadata-only and freeze remains readiness-gated and non-executing", () => {
  const preregistration = readFileSync(
    new URL(
      "../scripts/record-resolution-source-basis-feature-cut-freeze-plan-v1.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    preregistration,
    /Outcome-blind resolution-source basis feature-cut freeze plan v1/,
  );
  assert.doesNotMatch(
    preregistration,
    /resolutionSourceBasisDistributionAudit|venue_price_snapshot|db\.execute/,
  );

  const freeze = readFileSync(
    new URL(
      "../scripts/freeze-resolution-source-basis-feature-cuts-v1.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(freeze, /!distribution\.inheritedTapeReady/);
  assert.match(
    freeze,
    /distribution\.tape\.pairs\.some\(\(pair\) => !pair\.readyForFrozenDiagnostic\)/,
  );
  assert.match(freeze, /!distribution\.report/);
  assert.match(freeze, /immutable_artifact_already_exists/);
  for (const prohibited of [
    "placeOrder",
    "submitOrder",
    "cancelOrder",
    "privateKey",
    "paperTrades",
  ]) {
    assert.equal(freeze.includes(prohibited), false, `${prohibited} must not be reachable`);
  }
});
