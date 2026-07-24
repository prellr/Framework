import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeCrossAssetLeadLag,
  crossAssetDiagnosticReady,
  CROSS_ASSET_LEAD_LAG_REPORT,
  type CrossAssetPoint,
} from "./cross-asset-lead-lag.ts";

test("cross-asset report identifies a synthetic two-second BTC lead", () => {
  const btcLog: number[] = [Math.log(100)];
  for (let t = 1; t < 4_000; t++) {
    const innovation = (((t * 37) % 101) - 50) / 1_000_000;
    btcLog.push(btcLog[t - 1] + innovation);
  }
  const points: CrossAssetPoint[] = btcLog.map((logPrice, t) => ({
    t: CROSS_ASSET_LEAD_LAG_REPORT.evalStartMs + t * 1000,
    btc: Math.exp(logPrice),
    alt: Math.exp(btcLog[Math.max(0, t - 2)]),
  }));
  const result = analyzeCrossAssetLeadLag(points, "ETH-USD").find((row) => row.lagSec === 2)!;
  assert.ok((result.btcLeadCorrelation ?? 0) > 0.999);
  assert.ok((result.difference ?? 0) > 0.5);
  assert.equal(result.altPair, "ETH-USD");
  assert.equal(result.blocks, 14);
  assert.equal(result.ready, false);
});

test("cross-asset report is deterministic and does not interpolate missing seconds", () => {
  const points: CrossAssetPoint[] = [];
  for (let t = 0; t < 1_000; t++) {
    if (t === 500) continue;
    points.push({
      t: CROSS_ASSET_LEAD_LAG_REPORT.evalStartMs + t * 1000,
      btc: 100 + Math.sin((t + 1) / 9),
      alt: 100 + Math.sin(t / 9),
    });
  }
  assert.deepEqual(
    analyzeCrossAssetLeadLag(points, "SOL-USD"),
    analyzeCrossAssetLeadLag(points, "SOL-USD"),
  );
  const lagOne = analyzeCrossAssetLeadLag(points, "SOL-USD")[0];
  assert.ok(lagOne.observations < points.length - 1);
});

test("cross-asset readiness and boundary are frozen", () => {
  assert.equal(crossAssetDiagnosticReady(99_999, 3, 500), false);
  assert.equal(crossAssetDiagnosticReady(100_000, 2.999, 500), false);
  assert.equal(crossAssetDiagnosticReady(100_000, 3, 499), false);
  assert.equal(crossAssetDiagnosticReady(100_000, 3, 500), true);
  assert.equal(CROSS_ASSET_LEAD_LAG_REPORT.evalStartMs, Date.parse("2026-07-23T08:00:00.000Z"));
});
