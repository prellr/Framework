import assert from "node:assert/strict";
import test from "node:test";
import {
  chainlinkPath,
  computePeakGapRetention,
  mergeRtdsTickBuffer,
  RTDS_BUFFER_MS,
} from "./rtds.ts";

test("RTDS reconnect history stays ordered, deduplicated, and bounded by source time", () => {
  const now = 10_000_000;
  const stale = now - RTDS_BUFFER_MS - 1;
  const existing = [
    { t: now - 1_000, px: 101, receivedAt: now - 900 },
    { t: stale, px: 1, receivedAt: now - 800 },
    { t: now - 3_000, px: 99, receivedAt: now - 700 },
  ];
  const merged = mergeRtdsTickBuffer(existing, [
    { t: now - 3_000, px: 100, receivedAt: now - 600 },
    { t: now - 2_000, px: 100.5, receivedAt: now - 500 },
    { t: now - 2_000, px: 900, receivedAt: now - 700 },
  ], now);

  assert.deepEqual(merged, [
    { t: now - 3_000, px: 100, receivedAt: now - 600 },
    { t: now - 2_000, px: 100.5, receivedAt: now - 500 },
    { t: now - 1_000, px: 101, receivedAt: now - 900 },
  ]);
});

test("replayed history cannot inflate RTDS path coverage", () => {
  const now = 20_000_000;
  const history = [
    { t: now - 2_000, px: 100, receivedAt: now - 2_000 },
    { t: now - 1_000, px: 101, receivedAt: now - 1_000 },
  ];
  const first = mergeRtdsTickBuffer([], history, now);
  const replay = mergeRtdsTickBuffer(first, history, now);
  assert.deepEqual(replay, first);
  assert.equal(replay.length, 2);
});

test("RTDS buffer rejects malformed ticks and invalid clock input", () => {
  const now = 30_000_000;
  assert.deepEqual(mergeRtdsTickBuffer([], [
    { t: Number.NaN, px: 100, receivedAt: now },
    { t: now, px: 0, receivedAt: now },
    { t: now, px: 100, receivedAt: Number.NaN },
  ], now), []);
  assert.deepEqual(mergeRtdsTickBuffer([], [
    { t: now, px: 100, receivedAt: now },
  ], Number.NaN), []);
});

test("peak-gap retention uses the latest source tick and maximum in-window log gap", () => {
  const start = 1_000_000;
  const now = start + 80_000;
  const result = computePeakGapRetention([
    { t: start + 80_000, px: 108, receivedAt: start + 79_900 },
    { t: start + 20_000, px: 110, receivedAt: start + 20_100 },
    { t: start, px: 100, receivedAt: start + 100 },
    { t: start - 1, px: 150, receivedAt: start - 1 },
  ], 100, start, now);

  assert.equal(result?.currentPx, 108);
  assert.equal(result?.tickCount, 3);
  assert.equal(result?.firstAtMs, start);
  assert.equal(result?.startCoverageSec, 0);
  assert.equal(result?.maxIntertickGapSec, 60);
  assert.equal(result?.peakAtMs, start + 20_000);
  assert.ok(Math.abs((result?.retention ?? 0) - Math.log(1.08) / Math.log(1.10)) < 1e-12);
  assert.equal(result?.sourceAgeSec, 0);
  assert.equal(result?.receiveAgeSec, 0.1);
});

test("peak-gap retention is symmetric below strike", () => {
  const start = 2_000_000;
  const result = computePeakGapRetention([
    { t: start, px: 100, receivedAt: start },
    { t: start + 10_000, px: 90, receivedAt: start + 10_000 },
    { t: start + 20_000, px: 92, receivedAt: start + 20_000 },
  ], 100, start, start + 20_000);

  assert.ok((result?.currentGapLog ?? 0) < 0);
  assert.ok(Math.abs((result?.retention ?? 0) - Math.abs(Math.log(0.92)) / Math.abs(Math.log(0.90))) < 1e-12);
});

test("peak-gap retention deduplicates source timestamps using the latest delivery", () => {
  const start = 3_000_000;
  const result = computePeakGapRetention([
    { t: start, px: 100, receivedAt: start },
    { t: start + 1_000, px: 110, receivedAt: start + 1_000 },
    { t: start + 1_000, px: 105, receivedAt: start + 2_000 },
  ], 100, start, start + 2_000);
  assert.equal(result?.tickCount, 2);
  assert.equal(result?.currentPx, 105);
  assert.equal(result?.peakAbsGapLog, Math.log(1.05));
});

test("peak-gap retention fails closed on an invalid or uninformative path", () => {
  const tick = { t: 1_000, px: 100, receivedAt: 1_000 };
  assert.equal(computePeakGapRetention([tick], 100, 1_000, 2_000), null);
  assert.equal(computePeakGapRetention([tick, { ...tick, t: 2_000 }], 100, 1_000, 2_000), null);
  assert.equal(computePeakGapRetention([tick, { ...tick, t: 2_000, px: 101 }], 0, 1_000, 2_000), null);
  assert.equal(computePeakGapRetention([tick, { ...tick, t: 2_000, px: 101 }], 100, 2_000, 1_000), null);
});

test("public path reader fails closed before the singleton has data", () => {
  assert.deepEqual(chainlinkPath("NOT-A-PAIR", 1_000, 2_000), []);
  assert.deepEqual(chainlinkPath("BTC-USD", 2_000, 1_000), []);
});
