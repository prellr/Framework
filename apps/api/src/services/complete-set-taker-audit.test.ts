import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COMPLETE_SET_SEGMENTATION,
  COMPLETE_SET_TAKER_AUDIT,
  completeSetTakerReady,
  computeCompleteSetTakerReport,
  type CompleteSetAuditPoint,
} from "./complete-set-taker-audit.ts";

test("complete-set audit constants match the preregistered boundary and floors", () => {
  assert.equal(COMPLETE_SET_TAKER_AUDIT.evalStartMs, 1_784_818_800_000);
  assert.equal(COMPLETE_SET_TAKER_AUDIT.sharesPerLeg, 5);
  assert.equal(COMPLETE_SET_TAKER_AUDIT.maxRequestDurationMs, 1_000);
  assert.equal(COMPLETE_SET_TAKER_AUDIT.minRows, 1_500);
  assert.equal(COMPLETE_SET_TAKER_AUDIT.minMarkets, 500);
  assert.equal(COMPLETE_SET_TAKER_AUDIT.minSpanDays, 3);
  assert.equal(COMPLETE_SET_TAKER_AUDIT.readinessCacheMs, 60_000);
  assert.equal(COMPLETE_SET_TAKER_AUDIT.reportCacheMs, 15 * 60_000);
  assert.equal(COMPLETE_SET_SEGMENTATION.requiredBuckets, 120);
  assert.deepEqual(COMPLETE_SET_SEGMENTATION.persistenceRuns, [2, 3]);
});

test("complete-set readiness requires every frozen floor", () => {
  assert.equal(completeSetTakerReady(1_500, 500, 3), true);
  assert.equal(completeSetTakerReady(1_499, 500, 3), false);
  assert.equal(completeSetTakerReady(1_500, 499, 3), false);
  assert.equal(completeSetTakerReady(1_500, 500, 2.999), false);
});

test("complete-set report preserves market clustering and conservative pre-gas counts", () => {
  const points: CompleteSetAuditPoint[] = [
    {
      id: 1,
      conditionId: "a",
      pair: "BTC-USD",
      horizonMin: 5,
      sampleMinute: 0,
      capturedAtMs: 1,
      grossCost: 0.97,
      effectiveCost: 0.98,
      preGasEdge: 0.02,
    },
    {
      id: 2,
      conditionId: "a",
      pair: "BTC-USD",
      horizonMin: 5,
      sampleMinute: 1,
      capturedAtMs: 2,
      grossCost: 0.98,
      effectiveCost: 0.99,
      preGasEdge: 0.01,
    },
    {
      id: 3,
      conditionId: "b",
      pair: "SOL-USD",
      horizonMin: 15,
      sampleMinute: 4,
      capturedAtMs: 3,
      grossCost: 0.99,
      effectiveCost: 1.01,
      preGasEdge: -0.01,
    },
  ];
  const report = computeCompleteSetTakerReport(points);

  assert.equal(report.rows, 3);
  assert.equal(report.belowOne.rows, 2);
  assert.equal(report.belowOne.markets, 1);
  assert.equal(report.belowOne.maxTicksPerMarket, 2);
  assert.equal(report.atLeastTwoCentPreGasEdge.rows, 1);
  assert.equal(report.atLeastTwoCentPreGasEdge.markets, 1);
  assert.equal(report.effectiveCostPerShare.min, 0.98);
  assert.equal(report.effectiveCostPerShare.max, 1.01);
  assert.ok(report.belowOne.rateCi95.every((value) => value == null || (value >= 0 && value <= 1)));
  assert.equal(report.segmentation.version, COMPLETE_SET_SEGMENTATION.version);
  assert.equal(report.segmentation.buckets.length, 120);

  const btc5m0 = report.segmentation.buckets.find(
    (bucket) =>
      bucket.pair === "BTC-USD"
      && bucket.horizonMin === 5
      && bucket.sampleMinute === 0,
  );
  assert.equal(btc5m0?.rows, 1);
  assert.equal(btc5m0?.belowOne.rows, 1);
  assert.equal(btc5m0?.atLeastTwoCentPreGasEdge.rows, 1);

  const empty = report.segmentation.buckets.find(
    (bucket) =>
      bucket.pair === "BNB-USD"
      && bucket.horizonMin === 15
      && bucket.sampleMinute === 14,
  );
  assert.equal(empty?.rows, 0);
  assert.equal(empty?.belowOne.rate, null);
});

test("complete-set report measures consecutive-minute persistence per market", () => {
  const point = (
    id: number,
    conditionId: string,
    sampleMinute: number,
    preGasEdge: number,
  ): CompleteSetAuditPoint => ({
    id,
    conditionId,
    pair: "ETH-USD",
    horizonMin: 15,
    sampleMinute,
    capturedAtMs: id,
    grossCost: 1 - preGasEdge - 0.005,
    effectiveCost: 1 - preGasEdge,
    preGasEdge,
  });
  const report = computeCompleteSetTakerReport([
    point(1, "a", 0, 0.01),
    point(2, "a", 1, 0.02),
    point(3, "a", 2, -0.01),
    point(4, "a", 3, 0.03),
    point(5, "a", 4, 0.04),
    point(6, "a", 5, 0.05),
    point(7, "b", 0, 0.01),
    point(8, "b", 2, 0.01),
  ]);

  assert.deepEqual(report.persistence.belowOne, {
    markets: 2,
    marketsWithTwoConsecutive: 1,
    marketsWithThreeConsecutive: 1,
    maxConsecutive: 3,
  });
  assert.deepEqual(report.persistence.atLeastTwoCentPreGasEdge, {
    markets: 1,
    marketsWithTwoConsecutive: 1,
    marketsWithThreeConsecutive: 1,
    maxConsecutive: 3,
  });
});

test("complete-set segmentation plan is registered from count/time readiness only", () => {
  const source = readFileSync(
    new URL("../scripts/record-complete-set-segmentation-plan-v1.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /\bcompleteSetTakerReadiness\(\)/);
  assert.doesNotMatch(source, /\bcompleteSetTakerAudit\(\)/);
  assert.match(source, /refusing complete-set segmentation preregistration after result disclosure/);
  assert.match(source, /exactly \$\{COMPLETE_SET_SEGMENTATION\.requiredBuckets\}/);
  assert.match(source, /Empty buckets remain explicit/);
  assert.match(source, /Missing minutes break a run/);
  assert.match(source, /adds no key, wallet, order/);
});
