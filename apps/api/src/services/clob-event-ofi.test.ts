import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOB_EVENT_OFI_TAPE,
  ClobEventOfiAccumulator,
} from "./clob-event-ofi.ts";

const start = CLOB_EVENT_OFI_TAPE.evalStartMs;
const book = (
  assetId: string,
  timestamp: number,
  bid: number,
  bidSize: number,
  ask: number,
  askSize: number,
) => ({
  event_type: "book",
  asset_id: assetId,
  timestamp,
  bids: [{ price: String(bid), size: String(bidSize) }],
  asks: [{ price: String(ask), size: String(askSize) }],
});

test("event OFI tape has a frozen future boundary and readiness floors", () => {
  assert.equal(CLOB_EVENT_OFI_TAPE.version, "updown-clob-event-ofi-tape-v1");
  assert.equal(new Date(CLOB_EVENT_OFI_TAPE.evalStartMs).toISOString(), "2026-07-24T07:00:00.000Z");
  assert.deepEqual(CLOB_EVENT_OFI_TAPE.windowsSec, [5, 30, 60]);
  assert.equal(CLOB_EVENT_OFI_TAPE.minRows, 20_000);
  assert.equal(CLOB_EVENT_OFI_TAPE.minMarkets, 1_500);
  assert.equal(CLOB_EVENT_OFI_TAPE.minSpanDays, 5);
  assert.equal(CLOB_EVENT_OFI_TAPE.maxSourceClockLeadMs, 250);
});

test("book and price-change frames produce causal paired rolling OFI", () => {
  const tape = new ClobEventOfiAccumulator();
  tape.setConnected(true, start);
  assert.equal(tape.observe(book("up", start + 1_000, 0.49, 100, 0.51, 100), start + 1_010), true);
  assert.equal(tape.observe(book("down", start + 1_000, 0.49, 100, 0.51, 100), start + 1_012), true);
  assert.equal(
    tape.observe({
      event_type: "price_change",
      timestamp: start + 2_000,
      price_changes: [
        { asset_id: "up", price: "0.49", size: "200", side: "BUY" },
        { asset_id: "down", price: "0.49", size: "50", side: "BUY" },
      ],
    }, start + 2_015),
    true,
  );
  const observed = tape.now("up", "down", start + 2_500);
  assert.ok(observed);
  assert.equal(observed.version, CLOB_EVENT_OFI_TAPE.version);
  assert.ok(observed.canonical5s > 0);
  assert.equal(observed.canonical5s, observed.canonical30s);
  assert.equal(observed.canonical30s, observed.canonical60s);
  assert.equal(observed.upEvents60s, 1);
  assert.equal(observed.downEvents60s, 1);
  assert.equal(observed.maxTransportLagMs60s, 15);
  assert.deepEqual(tape.runtimeStats(start + 2_500), {
    connected: true,
    trackedTokens: 2,
    bookSnapshotTokens: 2,
    initializedTokens: 2,
    retainedEvents: 2,
    bookFrames: 2,
    priceChangeFrames: 1,
    lastMarketDataAgeSec: 0.485,
  });
});

test("quiet windows are valid zero flow after both books initialize", () => {
  const tape = new ClobEventOfiAccumulator();
  tape.setConnected(true, start);
  tape.observe(book("up", start + 1_000, 0.49, 100, 0.51, 100), start + 1_005);
  tape.observe(book("down", start + 1_000, 0.49, 100, 0.51, 100), start + 1_006);
  const observed = tape.now("up", "down", start + 10_000);
  assert.ok(observed);
  assert.equal(observed.canonical5s, 0);
  assert.equal(observed.canonical30s, 0);
  assert.equal(observed.canonical60s, 0);
  assert.equal(observed.upEvents60s + observed.downEvents60s, 0);
});

test("the shadow connector can read a fresh defensive full-book copy only for the same condition", () => {
  const tape = new ClobEventOfiAccumulator();
  tape.setConnected(true, start);
  tape.observe({
    ...book("up", start + 1_000, 0.49, 100, 0.51, 80),
    market: "0xcondition",
    bids: [
      { price: "0.48", size: "50" },
      { price: "0.49", size: "100" },
    ],
    asks: [
      { price: "0.52", size: "70" },
      { price: "0.51", size: "80" },
    ],
  }, start + 1_010);
  const snapshot = tape.bookSnapshot("up", "0xcondition", start + 1_020, 100);
  assert.ok(snapshot);
  assert.equal(snapshot.market, "0xcondition");
  assert.equal(snapshot.assetId, "up");
  assert.equal(snapshot.ageMs, 10);
  assert.deepEqual(snapshot.bids.map((level) => level.price), ["0.49", "0.48"]);
  assert.deepEqual(snapshot.asks.map((level) => level.price), ["0.51", "0.52"]);
  snapshot.asks.length = 0;
  assert.equal(tape.bookSnapshot("up", "0xcondition", start + 1_020, 100)?.asks.length, 2);
  assert.equal(tape.bookSnapshot("up", "other", start + 1_020, 100), null);
  assert.equal(tape.bookSnapshot("up", "0xcondition", start + 2_000, 100), null);
  tape.setConnected(false);
  assert.equal(tape.bookSnapshot("up", "0xcondition", start + 1_020, 100), null);
});

test("non-book traffic cannot make a silent queue stream look fresh", () => {
  const tape = new ClobEventOfiAccumulator();
  tape.setConnected(true, start);
  tape.observe(book("up", start + 1_000, 0.49, 100, 0.51, 100), start + 1_005);
  tape.observe(book("down", start + 1_000, 0.49, 100, 0.51, 100), start + 1_006);
  assert.equal(
    tape.observe(
      { event_type: "last_trade_price", asset_id: "up", timestamp: start + 19_000 },
      start + 19_005,
    ),
    false,
  );
  assert.equal(tape.now("up", "down", start + 22_000), null);
});

test("the first queue transition after a long socket-proven quiet interval is retained", () => {
  const tape = new ClobEventOfiAccumulator();
  tape.setConnected(true, start);
  tape.observe(book("up", start + 1_000, 0.49, 100, 0.51, 100), start + 1_005);
  tape.observe(book("down", start + 1_000, 0.49, 100, 0.51, 100), start + 1_006);
  tape.heartbeat(start + 120_000);
  tape.observe(book("up", start + 120_000, 0.50, 100, 0.52, 100), start + 120_005);
  const observed = tape.now("up", "down", start + 120_010);
  assert.ok(observed);
  assert.ok(observed.canonical5s > 0);
  assert.equal(observed.upEvents60s, 1);
});

test("the tape fails closed before boundary, while disconnected, stale, or late", () => {
  const tape = new ClobEventOfiAccumulator();
  tape.setConnected(true, start);
  tape.observe(book("up", start + 1_000, 0.49, 100, 0.51, 100), start + 1_005);
  tape.observe(book("down", start + 1_000, 0.49, 100, 0.51, 100), start + 1_006);
  assert.equal(tape.now("up", "down", start - 1), null);
  assert.equal(tape.now("up", "down", start + 100_000), null);
  tape.setConnected(false);
  assert.equal(tape.now("up", "down", start + 2_000), null);

  const late = new ClobEventOfiAccumulator();
  late.setConnected(true, start);
  late.observe(book("up", start + 1_000, 0.49, 100, 0.51, 100), start + 1_005);
  late.observe(book("down", start + 1_000, 0.49, 100, 0.51, 100), start + 1_006);
  late.observe(book("up", start + 2_000, 0.50, 100, 0.52, 100), start + 40_000);
  assert.equal(late.now("up", "down", start + 40_001), null);
});

test("bounded source-clock lead clamps diagnostic age while larger future time fails closed", () => {
  const jittered = new ClobEventOfiAccumulator();
  jittered.setConnected(true, start);
  jittered.observe(book("up", start + 1_035, 0.49, 100, 0.51, 100), start + 1_005);
  jittered.observe(book("down", start + 1_036, 0.49, 100, 0.51, 100), start + 1_006);
  const observed = jittered.now("up", "down", start + 1_010);
  assert.ok(observed);
  assert.equal(observed.sourceAgeSec, 0);

  const future = new ClobEventOfiAccumulator();
  future.setConnected(true, start);
  future.observe(book("up", start + 1_261, 0.49, 100, 0.51, 100), start + 1_005);
  future.observe(book("down", start + 1_262, 0.49, 100, 0.51, 100), start + 1_006);
  assert.equal(future.now("up", "down", start + 1_010), null);
});

test("reconnect snapshots initialize a new baseline instead of bridging an unobserved gap", () => {
  const tape = new ClobEventOfiAccumulator();
  tape.setConnected(true, start);
  tape.observe(book("up", start + 1_000, 0.49, 100, 0.51, 100), start + 1_005);
  tape.observe(book("down", start + 1_000, 0.49, 100, 0.51, 100), start + 1_006);
  tape.observe(book("up", start + 2_000, 0.50, 150, 0.52, 100), start + 2_005);
  assert.equal(tape.now("up", "down", start + 2_010)?.upEvents60s, 1);

  tape.setConnected(false, start + 3_000);
  tape.setConnected(true, start + 10_000);
  tape.observe(book("up", start + 10_000, 0.60, 500, 0.62, 500), start + 10_005);
  tape.observe(book("down", start + 10_000, 0.38, 500, 0.40, 500), start + 10_006);

  const afterReconnect = tape.now("up", "down", start + 10_010);
  assert.ok(afterReconnect);
  assert.equal(afterReconnect.canonical5s, 0);
  assert.equal(afterReconnect.canonical30s, 0);
  assert.equal(afterReconnect.canonical60s, 0);
  assert.equal(afterReconnect.upEvents60s, 0);
  assert.equal(afterReconnect.downEvents60s, 0);
});

test("runtime telemetry reports parsed-market-data age without exposing flow values", () => {
  const tape = new ClobEventOfiAccumulator();
  const now = CLOB_EVENT_OFI_TAPE.evalStartMs + 10_000;
  assert.deepEqual(tape.runtimeStats(now), {
    connected: false,
    trackedTokens: 0,
    bookSnapshotTokens: 0,
    initializedTokens: 0,
    retainedEvents: 0,
    bookFrames: 0,
    priceChangeFrames: 0,
    lastMarketDataAgeSec: null,
  });
  tape.setConnected(true, now);
  tape.observe(book("up", now + 1_000, 0.49, 100, 0.51, 100), now + 1_010);
  const status = tape.runtimeStats(now + 3_010);
  assert.equal(status.connected, true);
  assert.equal(status.trackedTokens, 1);
  assert.equal(status.bookSnapshotTokens, 1);
  assert.equal(status.initializedTokens, 1);
  assert.equal(status.bookFrames, 1);
  assert.equal(status.lastMarketDataAgeSec, 2);
  assert.deepEqual(Object.keys(status).sort(), [
    "bookFrames",
    "bookSnapshotTokens",
    "connected",
    "initializedTokens",
    "lastMarketDataAgeSec",
    "priceChangeFrames",
    "retainedEvents",
    "trackedTokens",
  ]);
});

test("initialization telemetry counts only full queue baselines for the requested tokens", () => {
  const tape = new ClobEventOfiAccumulator();
  tape.setConnected(true, start);
  assert.deepEqual(tape.initializationStats(["up", "down", "up"]), {
    expectedTokens: 2,
    bookSnapshotTokens: 0,
    initializedTokens: 0,
  });
  tape.observe(book("up", start + 1_000, 0.49, 100, 0.51, 100), start + 1_005);
  assert.deepEqual(tape.initializationStats(["up", "down"]), {
    expectedTokens: 2,
    bookSnapshotTokens: 1,
    initializedTokens: 1,
  });
  tape.observe(book("down", start + 1_000, 0.49, 100, 0.51, 100), start + 1_006);
  assert.deepEqual(tape.initializationStats(["up", "down"]), {
    expectedTokens: 2,
    bookSnapshotTokens: 2,
    initializedTokens: 2,
  });
  tape.setConnected(false, start + 2_000);
  assert.deepEqual(tape.initializationStats(["up", "down"]), {
    expectedTokens: 2,
    bookSnapshotTokens: 0,
    initializedTokens: 0,
  });
});

test("snapshot receipt remains distinct from a valid two-sided quote", () => {
  const tape = new ClobEventOfiAccumulator();
  tape.setConnected(true, start);
  tape.observe({
    event_type: "book",
    asset_id: "up",
    timestamp: start + 1_000,
    bids: [],
    asks: [{ price: "0.51", size: "100" }],
  }, start + 1_005);
  assert.deepEqual(tape.initializationStats(["up"]), {
    expectedTokens: 1,
    bookSnapshotTokens: 1,
    initializedTokens: 0,
  });
  assert.equal(tape.now("up", "down", start + 2_000), null);
});

test("retaining the active universe removes stale token state", () => {
  const tape = new ClobEventOfiAccumulator();
  tape.setConnected(true, start);
  tape.observe(book("up", start + 1_000, 0.49, 100, 0.51, 100), start + 1_005);
  tape.observe(book("down", start + 1_000, 0.49, 100, 0.51, 100), start + 1_006);
  tape.retainTokens(new Set(["up"]));
  assert.equal(tape.now("up", "down", start + 2_000), null);
});
