import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  analyzeLeadLag,
  leadLagDiagnosticReady,
  LEAD_LAG_REPORT,
  type VenuePoint,
} from "./lead-lag-analysis.ts";

test("lead-lag report identifies a synthetic two-second Hyperliquid lead", () => {
  const hlLog: number[] = [Math.log(100)];
  for (let t = 1; t < 4_000; t++) {
    const innovation = (((t * 37) % 101) - 50) / 1_000_000;
    hlLog.push(hlLog[t - 1] + innovation);
  }
  const points: VenuePoint[] = hlLog.map((logPrice, t) => ({
    t: t * 1000,
    hyperliquid: Math.exp(logPrice),
    chainlink: Math.exp(hlLog[Math.max(0, t - 2)]),
  }));
  const result = analyzeLeadLag(points, "TEST-USD").find((row) => row.lagSec === 2)!;
  assert.ok((result.forwardCorrelation ?? 0) > 0.999);
  assert.ok((result.difference ?? 0) > 0.5);
  assert.equal(result.blocks, 14);
  assert.equal(result.ready, false);
});

test("lead-lag report is deterministic and does not interpolate missing seconds", () => {
  const points: VenuePoint[] = [];
  for (let t = 0; t < 1_000; t++) {
    if (t === 500) continue;
    points.push({ t: t * 1000, chainlink: 100 + Math.sin(t / 9), hyperliquid: 100 + Math.sin((t + 1) / 9) });
  }
  assert.deepEqual(analyzeLeadLag(points, "TEST-USD"), analyzeLeadLag(points, "TEST-USD"));
  const lagOne = analyzeLeadLag(points, "TEST-USD")[0];
  assert.ok(lagOne.observations < points.length - 1);
});

test("lead-lag diagnostic readiness requires every frozen sample floor", () => {
  assert.equal(leadLagDiagnosticReady(99_999, 3, 500), false);
  assert.equal(leadLagDiagnosticReady(100_000, 2.999, 500), false);
  assert.equal(leadLagDiagnosticReady(100_000, 3, 499), false);
  assert.equal(leadLagDiagnosticReady(100_000, 3, 500), true);
  assert.equal(LEAD_LAG_REPORT.evalStartMs, Date.parse("2026-07-23T02:21:29.910Z"));
});

test("external lead-lag repository screen is evidence-blind and changes no strategy", () => {
  const source = readFileSync(
    new URL("../scripts/record-venue-lead-lag-repository-screen.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /variable-rate aggregate trades/);
  assert.match(source, /fee-adjusted depth walk/);
  assert.match(source, /separate later prospective registration/);
  assert.doesNotMatch(
    source,
    /\b(?:venuePriceSnapshots|paperTrades|polymarketUpdownScores|pnlUsd|resolvedUp)\b/,
  );
  for (const prohibited of [
    "placeOrder",
    "submitOrder",
    "cancelOrder",
    "privateKey",
  ]) {
    assert.equal(source.includes(prohibited), false, `${prohibited} must not be reachable`);
  }
});
