import assert from "node:assert/strict";
import test from "node:test";
import { normalizedDistance, surfaceSampleMinute } from "./polymarket-state-features.ts";

test("surfaceSampleMinute uses stable elapsed-minute buckets", () => {
  const start = Date.UTC(2026, 6, 23, 0, 0, 0);
  assert.equal(surfaceSampleMinute(start, start), 0);
  assert.equal(surfaceSampleMinute(start, start + 59_999), 0);
  assert.equal(surfaceSampleMinute(start, start + 60_000), 1);
});

test("normalizedDistance is zero at the strike and scales by remaining volatility", () => {
  assert.deepEqual(normalizedDistance(100, 100, 0.01, 240), { logMoneyness: 0, zDistance: 0 });
  const result = normalizedDistance(Math.exp(0.02) * 100, 100, 0.01, 240);
  assert.ok(result);
  assert.ok(Math.abs(result.logMoneyness - 0.02) < 1e-12);
  assert.ok(result.zDistance != null && Math.abs(result.zDistance - 1) < 1e-12);
});

test("normalizedDistance fails closed on invalid prices and keeps z null without vol", () => {
  assert.equal(normalizedDistance(0, 100, 0.01, 60), null);
  assert.deepEqual(normalizedDistance(101, 100, null, 60), {
    logMoneyness: Math.log(1.01),
    zDistance: null,
  });
});
