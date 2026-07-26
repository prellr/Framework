import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { LeadLagResult } from "./lead-lag-analysis.ts";
import {
  RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE,
  buildResolutionSourceBasisFeatureCutEnvelope,
} from "./resolution-source-basis-feature-cut-freeze.ts";
import {
  RESOLUTION_SOURCE_BASIS_CATCHUP_PLAN,
  buildResolutionBasisCatchupPairManifest,
  parseResolutionBasisCatchupPairManifestEnvelope,
  resolutionBasisCatchupDecision,
  resolutionBasisCatchupPairManifestValid,
  resolutionBasisLeadLagSupported,
  serializeResolutionBasisCatchupPairManifestEnvelope,
  type ResolutionBasisCatchupObservation,
} from "./resolution-source-basis-catchup-plan.ts";

const metric = (p05: number, p25: number, p50: number, p75: number, p95: number) => ({
  n: 100_000,
  quantiles: { p05, p25, p50, p75, p95 },
});

const envelope = buildResolutionSourceBasisFeatureCutEnvelope({
  distributionVersion: RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.prerequisiteVersion,
  tapeVersion: RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.tapeVersion,
  frozenAtMs: Date.parse("2026-07-26T02:30:00.000Z"),
  report: {
    buckets: ["BNB-USD", "BTC-USD", "DOGE-USD", "ETH-USD", "SOL-USD", "XRP-USD"].map((pair) => ({
      pair,
      rows: 100_000,
      metrics: {
        basisBps: metric(-8, -3, 0, 3, 8),
        absoluteBasisBps: metric(0.1, 1, 2, 4, 9),
        basisChange1sBps: metric(-2, -0.5, 0, 0.5, 2),
        sameSignPersistence5s: metric(0.2, 0.4, 0.6, 0.8, 1),
        chainlinkAgeMs: metric(10, 50, 100, 250, 500),
        hlAgeMs: metric(10, 50, 100, 250, 500),
      },
    })),
  },
});

const baseObservation = (): ResolutionBasisCatchupObservation => ({
  pair: "BTC-USD",
  horizonMin: 5,
  windowStartMs: pairManifest.artifact.strategyNotBeforeMs,
  observedAtMs: pairManifest.artifact.strategyNotBeforeMs + 60_000,
  basisBps: 6,
  basisChange1sBps: 0.7,
  sameSignPersistence5s: 1,
  chainlinkAgeMs: 100,
  hlAgeMs: 100,
  upFill: 0.52,
  downFill: 0.49,
});

const leadLag = (overrides: Partial<LeadLagResult> = {}): LeadLagResult => ({
  pair: "BTC-USD",
  lagSec: 5,
  rows: 100_000,
  spanDays: 3,
  observations: 99_000,
  blocks: 500,
  ready: true,
  forwardCorrelation: 0.1,
  forwardCi: [0.05, 0.15],
  reverseCorrelation: 0.01,
  reverseCi: [-0.01, 0.03],
  difference: 0.09,
  differenceCi: [0.04, 0.14],
  ...overrides,
});

const pairManifest = buildResolutionBasisCatchupPairManifest({
  featureCuts: envelope,
  frozenAtMs: Date.parse("2026-07-26T02:31:00.000Z"),
  leadLagResults: ["BNB-USD", "BTC-USD", "DOGE-USD", "ETH-USD", "SOL-USD", "XRP-USD"].map((pair) =>
    leadLag({ pair }),
  ),
});

test("basis catch-up preregisters exactly one rule per timeframe before feature disclosure", () => {
  const plan = RESOLUTION_SOURCE_BASIS_CATCHUP_PLAN;
  assert.equal(plan.status, "preregistered");
  assert.deepEqual(
    plan.hypotheses.map(({ key, horizonMin }) => ({ key, horizonMin })),
    [
      { key: "resolutionBasisCatchup5m", horizonMin: 5 },
      { key: "resolutionBasisCatchup15m", horizonMin: 15 },
    ],
  );
  assert.equal(plan.fixedRule.leadLagSec, 5);
  assert.equal(plan.fixedRule.absoluteBasisReference, "p75");
  assert.equal(plan.fixedRule.persistenceReference, "p75");
  assert.deepEqual(plan.fixedRule.decisionElapsedSec, {
    minInclusive: 60,
    maxExclusive: 120,
  });
  assert.equal(plan.fixedRule.maxSourceAgeMs, 2_000);
  assert.equal(plan.fixedRule.maxSelectedAsk, 0.55);
  assert.equal(plan.validation.familywiseCorrection, "Holm");
  assert.equal(plan.validation.hypotheses.length, 2);
});

test("pair eligibility freezes all six fixed-lag rows behind a later hashed boundary", () => {
  assert.equal(pairManifest.artifact.rows.length, 6);
  assert.deepEqual(
    pairManifest.artifact.rows.map(({ pair, qualified }) => ({ pair, qualified })),
    [
      { pair: "BNB-USD", qualified: true },
      { pair: "BTC-USD", qualified: true },
      { pair: "DOGE-USD", qualified: true },
      { pair: "ETH-USD", qualified: true },
      { pair: "SOL-USD", qualified: true },
      { pair: "XRP-USD", qualified: true },
    ],
  );
  assert.ok(pairManifest.artifact.strategyNotBeforeMs >= envelope.artifact.strategyNotBeforeMs);
  assert.equal(resolutionBasisCatchupPairManifestValid(pairManifest, envelope), true);
  assert.equal(
    resolutionBasisCatchupPairManifestValid({ ...pairManifest, sha256: "0".repeat(64) }, envelope),
    false,
  );
  assert.throws(
    () =>
      buildResolutionBasisCatchupPairManifest({
        featureCuts: envelope,
        frozenAtMs: Date.parse("2026-07-26T02:31:00.000Z"),
        leadLagResults: [leadLag()],
      }),
    /exactly six fixed-lag rows/,
  );
});

test("pair manifest serialization is strict, immutable, and bound to its feature cuts", () => {
  const serialized = serializeResolutionBasisCatchupPairManifestEnvelope(pairManifest, envelope);
  assert.deepEqual(
    parseResolutionBasisCatchupPairManifestEnvelope(serialized, envelope),
    pairManifest,
  );
  assert.throws(
    () =>
      parseResolutionBasisCatchupPairManifestEnvelope(
        serialized.replace(pairManifest.sha256, "0".repeat(64)),
        envelope,
      ),
    /hash mismatch/,
  );
  const forged = structuredClone(pairManifest);
  forged.artifact.rows[0].qualified = false;
  const forgedBody = serializeResolutionBasisCatchupPairManifestEnvelope(pairManifest, envelope)
    .replace(JSON.stringify(pairManifest, null, 2), JSON.stringify(forged, null, 2));
  assert.throws(
    () => parseResolutionBasisCatchupPairManifestEnvelope(forgedBody, envelope),
    /roster or eligibility/,
  );
});

test("fixed lead-lag support cannot search lags or accept uncertain precedence", () => {
  assert.equal(resolutionBasisLeadLagSupported(leadLag()), true);
  assert.equal(resolutionBasisLeadLagSupported(leadLag({ lagSec: 2 })), false);
  assert.equal(resolutionBasisLeadLagSupported(leadLag({ ready: false })), false);
  assert.equal(resolutionBasisLeadLagSupported(leadLag({ forwardCi: [0, 0.15] })), false);
  assert.equal(resolutionBasisLeadLagSupported(leadLag({ differenceCi: [-0.01, 0.14] })), false);
});

test("pure catch-up transform maps a persistent widening positive basis to UP", () => {
  assert.deepEqual(resolutionBasisCatchupDecision(envelope, pairManifest, baseObservation()), {
    side: "up",
    selectedAsk: 0.52,
    oppositeAsk: 0.49,
    stakeUsd: 5,
    basisBps: 6,
    basisChange1sBps: 0.7,
    sameSignPersistence5s: 1,
    featureCutsSha256: envelope.sha256,
    pairManifestSha256: pairManifest.sha256,
  });
});

test("pure catch-up transform maps a persistent widening negative basis to DOWN", () => {
  const observation = {
    ...baseObservation(),
    horizonMin: 15 as const,
    basisBps: -6,
    basisChange1sBps: -0.7,
    upFill: 0.48,
    downFill: 0.51,
  };
  assert.deepEqual(resolutionBasisCatchupDecision(envelope, pairManifest, observation), {
    side: "down",
    selectedAsk: 0.51,
    oppositeAsk: 0.48,
    stakeUsd: 5,
    basisBps: -6,
    basisChange1sBps: -0.7,
    sameSignPersistence5s: 1,
    featureCutsSha256: envelope.sha256,
    pairManifestSha256: pairManifest.sha256,
  });
});

test("catch-up transform abstains outside every frozen causal and execution guard", () => {
  const base = baseObservation();
  const cases: ResolutionBasisCatchupObservation[] = [
    { ...base, windowStartMs: pairManifest.artifact.strategyNotBeforeMs - 1 },
    { ...base, observedAtMs: base.windowStartMs + 59_999 },
    { ...base, observedAtMs: base.windowStartMs + 120_000 },
    { ...base, basisBps: 3.99 },
    { ...base, basisChange1sBps: 0.49 },
    { ...base, sameSignPersistence5s: 0.79 },
    { ...base, chainlinkAgeMs: 2_001 },
    { ...base, hlAgeMs: 2_001 },
    { ...base, upFill: 0.09 },
    { ...base, upFill: 0.551 },
    { ...base, downFill: 0.02 },
    { ...base, basisBps: Number.NaN },
  ];
  for (const observation of cases) {
    assert.equal(resolutionBasisCatchupDecision(envelope, pairManifest, observation), null);
  }

  const unsupportedManifest = buildResolutionBasisCatchupPairManifest({
    featureCuts: envelope,
    frozenAtMs: Date.parse("2026-07-26T02:31:00.000Z"),
    leadLagResults: ["BNB-USD", "BTC-USD", "DOGE-USD", "ETH-USD", "SOL-USD", "XRP-USD"].map(
      (pair) => leadLag(pair === "BTC-USD" ? { pair, differenceCi: [-0.01, 0.14] } : { pair }),
    ),
  });
  assert.equal(resolutionBasisCatchupDecision(envelope, unsupportedManifest, base), null);
  assert.equal(
    resolutionBasisCatchupDecision(envelope, { ...pairManifest, sha256: "0".repeat(64) }, base),
    null,
  );
});

test("basis catch-up plan is disconnected from evidence and execution systems", () => {
  assert.deepEqual(RESOLUTION_SOURCE_BASIS_CATCHUP_PLAN.invariants, {
    readsFeatureValuesNow: false,
    readsLeadLagValuesNow: false,
    readsOutcomes: false,
    readsPaperResults: false,
    createsPaperBot: false,
    changesCollector: false,
    startsCrucibleRun: false,
    enablesExecution: false,
    preservesExistingFamilywiseGate: true,
  });
  const source = readFileSync(
    new URL("./resolution-source-basis-catchup-plan.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /\b(?:venuePriceSnapshots|paperTrades|polymarketUpdownScores|resolvedUp|pnlUsd|placeOrder|submitOrder|privateKey|fetch\s*\(|db\.)/i,
  );
  const recorderSource = readFileSync(
    new URL("../scripts/record-resolution-source-basis-catchup-plan-v1.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    recorderSource,
    /\b(?:venuePriceSnapshots|paperTrades|polymarketUpdownScores|resolvedUp|pnlUsd|placeOrder|submitOrder|privateKey|fetch\s*\()/i,
  );
  const manifestRecorderSource = readFileSync(
    new URL(
      "../scripts/freeze-resolution-basis-catchup-pair-manifest-v1.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(manifestRecorderSource, /for \(const pair of VENUE_REPORT_PAIRS\)/);
  assert.match(
    manifestRecorderSource,
    /row\.lagSec === plan\.fixedRule\.leadLagSec/,
  );
  assert.doesNotMatch(
    manifestRecorderSource,
    /\b(?:paperTrades|polymarketUpdownScores|resolvedUp|pnlUsd|placeOrder|submitOrder|privateKey|signOrder|fetch\s*\()/i,
  );
});
