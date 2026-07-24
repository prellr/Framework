import assert from "node:assert/strict";
import test from "node:test";
import {
  computeCrossHorizonBundleReport,
  CROSS_HORIZON_BUNDLE_AUDIT,
  crossHorizonBundleReady,
  walkAskShares,
  type BundleAuditPoint,
} from "./cross-horizon-bundle.ts";
import type { ClobBook } from "./polymarket.ts";

function book(asks: Array<[number, number]>): ClobBook {
  return {
    market: "condition",
    asset_id: "token",
    bids: [],
    asks: asks.map(([price, size]) => ({ price: String(price), size: String(size) })),
  };
}

test("walkAskShares consumes cheapest levels and applies the captured fee curve per level", () => {
  const result = walkAskShares(book([[0.6, 5], [0.5, 3]]), 5, { rate: 0.07, exponent: 1 });
  assert.ok(result);
  assert.equal(result.shares, 5);
  assert.ok(Math.abs(result.grossCost - 2.7) < 1e-12);
  assert.ok(Math.abs(result.vwap - 0.54) < 1e-12);
  assert.ok(Math.abs(result.feeUsd - 0.0861) < 1e-12);
  assert.ok(Math.abs(result.effectiveCost - 2.7861) < 1e-12);
});

test("walkAskShares fails closed on thin books or invalid fee parameters", () => {
  assert.equal(walkAskShares(book([[0.5, 4.99]]), 5, { rate: 0.07, exponent: 1 }), null);
  assert.equal(walkAskShares(book([[0.5, 5]]), 5, { rate: -1, exponent: 1 }), null);
  assert.equal(walkAskShares(book([[0.5, 5]]), 5, { rate: 0.07, exponent: 0 }), null);
});

test("cross-horizon readiness requires every frozen floor", () => {
  assert.equal(crossHorizonBundleReady(
    CROSS_HORIZON_BUNDLE_AUDIT.minRows,
    CROSS_HORIZON_BUNDLE_AUDIT.minCommonCloses,
    CROSS_HORIZON_BUNDLE_AUDIT.minSpanDays,
  ), true);
  assert.equal(crossHorizonBundleReady(
    CROSS_HORIZON_BUNDLE_AUDIT.minRows - 1,
    CROSS_HORIZON_BUNDLE_AUDIT.minCommonCloses,
    CROSS_HORIZON_BUNDLE_AUDIT.minSpanDays,
  ), false);
  assert.equal(crossHorizonBundleReady(
    CROSS_HORIZON_BUNDLE_AUDIT.minRows,
    CROSS_HORIZON_BUNDLE_AUDIT.minCommonCloses - 1,
    CROSS_HORIZON_BUNDLE_AUDIT.minSpanDays,
  ), false);
  assert.equal(crossHorizonBundleReady(
    CROSS_HORIZON_BUNDLE_AUDIT.minRows,
    CROSS_HORIZON_BUNDLE_AUDIT.minCommonCloses,
    CROSS_HORIZON_BUNDLE_AUDIT.minSpanDays - 0.001,
  ), false);
});

test("bundle report uses fee-adjusted edge and common-close clusters", () => {
  const points: BundleAuditPoint[] = [
    { id: 1, pair: "BTC-USD", endDateMs: 1_000, capturedAtMs: 100, grossCost: 0.95, effectiveCost: 0.97, edge: 0.03 },
    { id: 2, pair: "BTC-USD", endDateMs: 1_000, capturedAtMs: 200, grossCost: 0.98, effectiveCost: 0.99, edge: 0.01 },
    { id: 3, pair: "ETH-USD", endDateMs: 2_000, capturedAtMs: 300, grossCost: 0.99, effectiveCost: 1.01, edge: -0.01 },
    { id: 4, pair: "ETH-USD", endDateMs: 2_000, capturedAtMs: 400, grossCost: 1, effectiveCost: 1.02, edge: -0.02 },
  ];
  const report = computeCrossHorizonBundleReport(points);
  assert.equal(report.rows, 4);
  assert.equal(report.belowOne.rows, 2);
  assert.equal(report.belowOne.rate, 0.5);
  assert.equal(report.belowOne.commonCloses, 1);
  assert.equal(report.belowOne.maxTicksPerClose, 2);
  assert.equal(report.atLeastTwoCentEdge.rows, 1);
  assert.ok(report.belowOne.rateCi95[0] != null);
  assert.ok(report.belowOne.rateCi95[1] != null);
});
