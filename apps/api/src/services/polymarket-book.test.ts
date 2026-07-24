import assert from "node:assert/strict";
import test from "node:test";
import { bookSummary, type ClobBook } from "./polymarket.ts";

const book = (bids: [number, number][], asks: [number, number][]): ClobBook => ({
  market: "test",
  asset_id: "up",
  bids: bids.map(([price, size]) => ({ price: String(price), size: String(size) })),
  asks: asks.map(([price, size]) => ({ price: String(price), size: String(size) })),
});

test("bookSummary computes order-independent touch microprice and imbalances", () => {
  const summary = bookSummary(book(
    [[0.48, 10], [0.47, 30]],
    [[0.55, 20], [0.52, 5]],
  ));
  assert.equal(summary.bestBid, 0.48);
  assert.equal(summary.bestAsk, 0.52);
  assert.equal(summary.bestBidSize, 10);
  assert.equal(summary.bestAskSize, 5);
  assert.ok(Math.abs(summary.microprice! - ((0.48 * 5 + 0.52 * 10) / 15)) < 1e-12);
  assert.ok(Math.abs(summary.touchImbalance! - (5 / 15)) < 1e-12);
  assert.ok(Math.abs(summary.bookImbalanceShares! - (15 / 65)) < 1e-12);
  assert.equal(summary.bidLevels, 2);
  assert.equal(summary.askLevels, 2);
});

test("bookSummary fails undefined microstructure fields to null", () => {
  const summary = bookSummary(book([[0.48, 10]], []));
  assert.equal(summary.bestAsk, null);
  assert.equal(summary.mid, null);
  assert.equal(summary.microprice, null);
  assert.equal(summary.touchImbalance, 1);
});

test("bookSummary drops malformed and negative-size levels", () => {
  const malformed: ClobBook = {
    market: "test",
    asset_id: "up",
    bids: [{ price: "0.49", size: "-10" }, { price: "bad", size: "2" }],
    asks: [{ price: "0.51", size: "3" }],
  };
  const summary = bookSummary(malformed);
  assert.equal(summary.bestBid, null);
  assert.equal(summary.bestAsk, 0.51);
  assert.equal(summary.bidLevels, 0);
  assert.equal(summary.askLevels, 1);
});
