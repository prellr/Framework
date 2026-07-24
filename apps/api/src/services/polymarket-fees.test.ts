import assert from "node:assert/strict";
import test from "node:test";
import {
  fillAskTotalUsd,
  PAPER_FILL_VERSION,
  takerFeeDescriptor,
  type TakerFeeDescriptor,
} from "./polymarket-fees.ts";
import type { ClobBook } from "./polymarket.ts";

const FEE: TakerFeeDescriptor = { rate: 0.07, exponent: 1, takerOnly: true };

function book(asks: Array<[number, number]>): ClobBook {
  return {
    market: "condition",
    asset_id: "token",
    bids: [],
    asks: asks.map(([price, size]) => ({ price: String(price), size: String(size) })),
  };
}

test("takerFeeDescriptor accepts only a valid taker-only CLOB-v2 curve", () => {
  assert.deepEqual(takerFeeDescriptor({ fd: { r: 0.07, e: 1, to: true } }), FEE);
  assert.equal(takerFeeDescriptor(undefined), null);
  assert.equal(takerFeeDescriptor({ fd: { r: -0.01, e: 1, to: true } }), null);
  assert.equal(takerFeeDescriptor({ fd: { r: 0.07, e: 0, to: true } }), null);
  assert.equal(takerFeeDescriptor({ fd: { r: 0.07, e: 1, to: false } }), null);
});

test("fillAskTotalUsd treats $5 as gross-plus-fee total outlay", () => {
  const fill = fillAskTotalUsd(book([[0.5, 100]]), 5, FEE);
  assert.ok(fill);
  assert.equal(fill.version, PAPER_FILL_VERSION);
  assert.ok(Math.abs(fill.shares - (5 / 0.5175)) < 1e-12);
  assert.ok(Math.abs(fill.grossCostUsd - (0.5 * 5 / 0.5175)) < 1e-12);
  assert.ok(Math.abs(fill.feeUsd - (0.0175 * 5 / 0.5175)) < 1e-12);
  assert.ok(Math.abs(fill.totalCostUsd - 5) < 1e-12);
  assert.ok(Math.abs(fill.grossVwap - 0.5) < 1e-12);
  assert.ok(Math.abs(fill.effectiveVwap - 0.5175) < 1e-12);
  assert.equal(fill.levelsConsumed, 1);
});

test("fillAskTotalUsd sorts asks and sizes the partial final level by effective cost", () => {
  const fill = fillAskTotalUsd(book([[0.6, 100], [0.4, 4]]), 5, FEE);
  assert.ok(fill);
  const perShareFee = 0.07 * 0.4 * 0.6;
  const firstLevelCost = 4 * (0.4 + perShareFee);
  const secondShares = (5 - firstLevelCost) / (0.6 + perShareFee);
  assert.ok(Math.abs(fill.shares - (4 + secondShares)) < 1e-12);
  assert.ok(Math.abs(fill.grossCostUsd - (4 * 0.4 + secondShares * 0.6)) < 1e-12);
  assert.ok(Math.abs(fill.feeUsd - ((4 + secondShares) * perShareFee)) < 1e-12);
  assert.ok(Math.abs(fill.totalCostUsd - 5) < 1e-12);
  assert.equal(fill.levelsConsumed, 2);
});

test("fillAskTotalUsd fails closed on thin books, malformed levels, or invalid fees", () => {
  assert.equal(fillAskTotalUsd(book([[0.5, 1]]), 5, FEE), null);
  assert.equal(fillAskTotalUsd(book([[0.5, 100], [1, 1]]), 5, FEE), null);
  assert.equal(fillAskTotalUsd(book([[0.5, 100]]), 5, { ...FEE, rate: -1 }), null);
  assert.equal(fillAskTotalUsd(book([[0.5, 100]]), 0, FEE), null);
});
