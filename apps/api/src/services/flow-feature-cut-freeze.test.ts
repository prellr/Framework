import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  FLOW_FEATURE_CUT_FREEZE,
  buildFlowFeatureCutEnvelope,
  nextFlowFeatureStrategyBoundary,
  parseFlowFeatureCutEnvelope,
  serializeFlowFeatureCutEnvelope,
  type FlowDistributionReportLike,
} from "./flow-feature-cut-freeze.ts";

const PAIRS = ["BNB-USD", "BTC-USD", "DOGE-USD", "ETH-USD", "SOL-USD", "XRP-USD"];
const HORIZONS = [5, 15] as const;
const metric = (offset = 0) => ({
  n: 500,
  quantiles: {
    p05: -2 + offset,
    p25: -1 + offset,
    p50: 0 + offset,
    p75: 1 + offset,
    p95: 2 + offset,
  },
});
const report = (source: "hyperliquid" | "clob"): FlowDistributionReportLike => ({
  buckets: PAIRS.flatMap((pair, pairIndex) =>
    HORIZONS.map((horizonMin) => {
      const metrics: Record<string, ReturnType<typeof metric>> = source === "hyperliquid"
        ? {
            imbalance60s: metric(pairIndex / 100),
            absoluteImbalance60s: metric(3),
            logNotional60s: metric(5),
            tradeCount60s: metric(10),
            maxTradeShare60s: metric(1),
          }
        : {
            canonical60s: metric(pairIndex / 50),
            absoluteCanonical60s: metric(3),
            totalEvents60s: metric(10),
            receiveAgeSec: metric(2),
            maxTransportLagMs60s: metric(100),
          };
      return { pair, horizonMin, rows: 500, metrics };
    })
  ),
});

test("flow feature-cut plan freezes only preprocessing references and a later boundary", () => {
  assert.equal(FLOW_FEATURE_CUT_FREEZE.planVersion, "updown-flow-feature-cut-freeze-plan-v1");
  assert.equal(FLOW_FEATURE_CUT_FREEZE.artifactVersion, "updown-flow-feature-cuts-v1");
  assert.equal(FLOW_FEATURE_CUT_FREEZE.prerequisiteVersion, "updown-flow-distribution-audit-v1");
  assert.equal(FLOW_FEATURE_CUT_FREEZE.requiredBuckets, 12);
  assert.equal(FLOW_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs, 30 * 60_000);
  assert.equal(FLOW_FEATURE_CUT_FREEZE.boundaryGridMs, 15 * 60_000);
  assert.equal(
    nextFlowFeatureStrategyBoundary(Date.parse("2026-07-26T12:01:00.000Z")),
    Date.parse("2026-07-26T12:45:00.000Z"),
  );
});

test("flow feature-cut artifact is deterministic, complete, hashed, and round-trippable", () => {
  const frozenAtMs = Date.parse("2026-07-26T12:01:00.000Z");
  const input = {
    distributionVersion: "updown-flow-distribution-audit-v1",
    tapeVersions: {
      hyperliquid: "updown-hyperliquid-taker-flow-tape-v2",
      clobEventOfi: "updown-clob-event-ofi-tape-v1",
    },
    hyperliquidReport: report("hyperliquid"),
    clobEventOfiReport: report("clob"),
    frozenAtMs,
  };
  const first = buildFlowFeatureCutEnvelope(input);
  const second = buildFlowFeatureCutEnvelope(input);
  assert.deepEqual(second, first);
  assert.match(first.sha256, /^[a-f0-9]{64}$/);
  assert.equal(first.artifact.buckets.length, 12);
  assert.equal(first.artifact.strategyNotBeforeMs, Date.parse("2026-07-26T12:45:00.000Z"));
  assert.deepEqual(first.artifact.buckets[0], {
    pair: "BNB-USD",
    horizonMin: 5,
    hyperliquid: {
      imbalance60s: {
        n: 500,
        p05: -2,
        p25: -1,
        p50: 0,
        p75: 1,
        p95: 2,
        iqr: 2,
      },
      absoluteImbalance60sP75: 4,
      logNotional60sP25: 4,
      tradeCount60sP25: 9,
      maxTradeShare60sP95: 3,
    },
    clobEventOfi: {
      canonical60s: {
        n: 500,
        p05: -2,
        p25: -1,
        p50: 0,
        p75: 1,
        p95: 2,
        iqr: 2,
      },
      absoluteCanonical60sP75: 4,
      totalEvents60sP25: 9,
      receiveAgeSecP95: 4,
      maxTransportLagMs60sP95: 102,
    },
  });
  assert.deepEqual(parseFlowFeatureCutEnvelope(serializeFlowFeatureCutEnvelope(first)), first);
});

test("flow feature-cut artifact fails closed on incomplete, degenerate, or tampered inputs", () => {
  const frozenAtMs = Date.parse("2026-07-26T12:01:00.000Z");
  const validInput = {
    distributionVersion: "updown-flow-distribution-audit-v1",
    tapeVersions: { hyperliquid: "hl-v2", clobEventOfi: "clob-v1" },
    hyperliquidReport: report("hyperliquid"),
    clobEventOfiReport: report("clob"),
    frozenAtMs,
  };
  assert.throws(
    () => buildFlowFeatureCutEnvelope({
      ...validInput,
      hyperliquidReport: { buckets: validInput.hyperliquidReport.buckets.slice(1) },
    }),
    /expected 12 buckets/,
  );
  const degenerate = report("clob");
  degenerate.buckets[0].metrics.canonical60s = {
    n: 500,
    quantiles: { p05: 0, p25: 0, p50: 0, p75: 0, p95: 0 },
  };
  assert.throws(
    () => buildFlowFeatureCutEnvelope({ ...validInput, clobEventOfiReport: degenerate }),
    /degenerate flow feature distribution/,
  );
  const envelope = buildFlowFeatureCutEnvelope(validInput);
  const serialized = serializeFlowFeatureCutEnvelope(envelope)
    .replace(envelope.sha256, "0".repeat(64));
  assert.throws(() => parseFlowFeatureCutEnvelope(serialized), /hash mismatch/);
});

test("preregistration is metadata-only and the freeze script is readiness-gated and non-executing", () => {
  const preregistration = readFileSync(
    new URL("../scripts/record-flow-feature-cut-freeze-plan-v1.ts", import.meta.url),
    "utf8",
  );
  assert.match(preregistration, /Outcome-blind flow feature-cut freeze plan v1/);
  assert.doesNotMatch(
    preregistration,
    /flowDistributionAudit|polymarket_state_snapshot|polymarketStateSnapshots|db\.execute/,
  );

  const freeze = readFileSync(
    new URL("../scripts/freeze-flow-feature-cuts-v1.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    freeze,
    /distribution\.readySources !== distribution\.totalSources/,
  );
  assert.match(freeze, /!distribution\.sources\.hyperliquid\.report/);
  assert.match(freeze, /!distribution\.sources\.clobEventOfi\.report/);
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
