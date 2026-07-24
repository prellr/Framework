import test from "node:test";
import assert from "node:assert/strict";
import { createHlFlowAccumulator, parseHlBbo, parseHlTrades } from "./hl-rtds.ts";

test("parseHlBbo retains exchange and receive timestamps", () => {
  const tick = parseHlBbo({
    channel: "bbo",
    data: { coin: "BTC", time: 1234, bbo: [{ px: "100", sz: "1" }, { px: "102", sz: "2" }] },
  }, 1300);
  assert.deepEqual(tick, { pair: "BTC-USD", px: 101, sourceAtMs: 1234, receivedAtMs: 1300 });
});

test("parseHlBbo rejects incomplete or crossed books", () => {
  assert.equal(parseHlBbo({ channel: "bbo", data: { coin: "BTC", time: 1234, bbo: [{ px: "100" }, null] } }, 1300), null);
  assert.equal(parseHlBbo({ channel: "bbo", data: { coin: "BTC", time: 1234, bbo: [{ px: "102" }, { px: "100" }] } }, 1300), null);
  assert.equal(parseHlBbo({ channel: "bbo", data: { coin: "UNKNOWN", time: 1234, bbo: [{ px: "1" }, { px: "2" }] } }, 1300), null);
});

test("parseHlTrades keeps aggressor side, notional, and both clocks", () => {
  const ticks = parseHlTrades({
    channel: "trades",
    data: [
      { coin: "SOL", side: "B", px: "150", sz: "2", time: 1_000, tid: 11 },
      { coin: "SOL", side: "A", px: "151", sz: "1", time: 1_001, tid: 12 },
    ],
  }, 1_100);
  assert.deepEqual(ticks, [
    {
      pair: "SOL-USD",
      side: "buy",
      px: 150,
      size: 2,
      notional: 300,
      sourceAtMs: 1_000,
      receivedAtMs: 1_100,
      tid: 11,
    },
    {
      pair: "SOL-USD",
      side: "sell",
      px: 151,
      size: 1,
      notional: 151,
      sourceAtMs: 1_001,
      receivedAtMs: 1_100,
      tid: 12,
    },
  ]);
});

test("parseHlTrades rejects unknown symbols, malformed sizes, and non-trade channels", () => {
  assert.deepEqual(parseHlTrades({ channel: "bbo", data: [] }, 2_000), []);
  assert.deepEqual(parseHlTrades({
    channel: "trades",
    data: [
      { coin: "UNKNOWN", side: "B", px: "1", sz: "1", time: 1_000, tid: 1 },
      { coin: "BTC", side: "B", px: "0", sz: "1", time: 1_000, tid: 2 },
      { coin: "BTC", side: "X", px: "1", sz: "1", time: 1_000, tid: 3 },
    ],
  }, 2_000), []);
});

test("flow accumulator deduplicates reconnect snapshots and uses causal rolling windows", () => {
  const flow = createHlFlowAccumulator();
  const ticks = parseHlTrades({
    channel: "trades",
    data: [
      { coin: "BTC", side: "B", px: "100", sz: "2", time: 95_500, tid: 1 },
      { coin: "BTC", side: "A", px: "100", sz: "1", time: 75_000, tid: 2 },
      { coin: "BTC", side: "A", px: "100", sz: "1", time: 45_000, tid: 3 },
    ],
  }, 96_000);
  flow.ingest(ticks);
  flow.ingest(ticks);
  const snapshot = flow.snapshot("BTC-USD", 100_000);
  assert.ok(snapshot);
  assert.equal(snapshot.tradeCount60s, 3);
  assert.equal(snapshot.notional60s, 400);
  assert.equal(snapshot.imbalance5s, 1);
  assert.equal(snapshot.imbalance30s, 1 / 3);
  assert.equal(snapshot.imbalance60s, 0);
  assert.equal(snapshot.maxTradeShare60s, 0.5);
  assert.equal(snapshot.receiveAgeSec, 4);
  assert.equal(snapshot.sourceAgeSec, 4.5);
  assert.equal(snapshot.maxTransportLagMs60s, 51_000);
});

test("flow accumulator excludes stale source events delivered by reconnect", () => {
  const flow = createHlFlowAccumulator();
  flow.ingest(parseHlTrades({
    channel: "trades",
    data: [
      { coin: "ETH", side: "B", px: "2", sz: "10", time: 1_000, tid: 1 },
      { coin: "ETH", side: "A", px: "2", sz: "5", time: 99_000, tid: 2 },
    ],
  }, 99_500));
  const snapshot = flow.snapshot("ETH-USD", 100_000);
  assert.ok(snapshot);
  assert.equal(snapshot.tradeCount60s, 1);
  assert.equal(snapshot.imbalance60s, -1);
});
