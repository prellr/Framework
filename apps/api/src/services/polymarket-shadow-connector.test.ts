import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ClobBook } from "./polymarket.ts";
import {
  ceilToTick,
  POLYMARKET_SHADOW_CONNECTOR,
  prepareLiveShadowMarketBuy,
  prepareShadowMarketBuy,
} from "./polymarket-shadow-connector.ts";

const conditionId = "0xcondition";
const tokenId = "123456789";
const observedAtMs = Date.parse("2026-07-24T18:00:00.000Z");
const fee = { rate: 0.07, exponent: 1, takerOnly: true } as const;
const book: ClobBook = {
  market: conditionId,
  asset_id: tokenId,
  bids: [{ price: "0.49", size: "20" }],
  asks: [
    { price: "0.51", size: "3" },
    { price: "0.52", size: "20" },
  ],
};
const intent = {
  conditionId,
  tokenId,
  totalBudgetUsd: 5,
  tickSize: 0.01,
  minOrderShares: 5,
};
const snapshot = {
  book,
  sourceAtMs: observedAtMs - 40,
  receivedAtMs: observedAtMs - 20,
  observedAtMs,
};

test("shadow connector is structurally incapable of authentication, signing, or submission", () => {
  assert.deepEqual(POLYMARKET_SHADOW_CONNECTOR, {
    version: "polymarket-shadow-connector-v1",
    mode: "shadow",
    orderType: "FOK",
    orderSide: "BUY",
    maxBookAgeMs: 20_000,
    maxBudgetUsd: 25,
    authenticationEnabled: false,
    signingEnabled: false,
    submissionEnabled: false,
  });
  const source = readFileSync(
    new URL("./polymarket-shadow-connector.ts", import.meta.url),
    "utf8",
  );
  for (const prohibited of [
    "fetch(",
    "createAndPost",
    "postOrder",
    "privateKey",
    "process.env",
    "POLY_API_KEY",
    "POLY_SIGNATURE",
  ]) {
    assert.equal(source.includes(prohibited), false, `${prohibited} must not enter the shadow path`);
  }
});

test("hot path produces a fee-aware FOK simulation from an in-memory public book", () => {
  const times = [10, 10.015];
  const prepared = prepareShadowMarketBuy(intent, snapshot, fee, () => times.shift() ?? 10.015);
  assert.equal(prepared.accepted, true);
  if (!prepared.accepted) return;
  assert.equal(prepared.plan.mode, "shadow");
  assert.equal(prepared.plan.side, "BUY");
  assert.equal(prepared.plan.orderType, "FOK");
  assert.equal(prepared.plan.amountUsd, 5);
  assert.equal(prepared.plan.worstPrice, 0.52);
  assert.equal(prepared.plan.marketDataAgeMs, 20);
  assert.ok(Math.abs(prepared.plan.quote.totalCostUsd - 5) < 1e-8);
  assert.ok(prepared.plan.quote.feeUsd > 0);
  assert.ok(prepared.plan.preparationMicros >= 14.9);
});

test("tick rounding is conservative for a BUY ceiling", () => {
  assert.equal(ceilToTick(0.521, 0.01), 0.53);
  assert.equal(ceilToTick(0.52, 0.01), 0.52);
  assert.equal(ceilToTick(0.5211, 0.001), 0.522);
  assert.equal(ceilToTick(1, 0.01), null);
});

test("shadow preparation fails closed on stale, mismatched, thin, small, or expensive books", () => {
  const stale = prepareShadowMarketBuy(intent, {
    ...snapshot,
    receivedAtMs: observedAtMs - POLYMARKET_SHADOW_CONNECTOR.maxBookAgeMs - 1,
  }, fee);
  assert.deepEqual(stale.accepted ? null : stale.reason, "stale-book");

  const mismatch = prepareShadowMarketBuy(intent, {
    ...snapshot,
    book: { ...book, asset_id: "other" },
  }, fee);
  assert.deepEqual(mismatch.accepted ? null : mismatch.reason, "book-mismatch");

  const thin = prepareShadowMarketBuy(intent, {
    ...snapshot,
    book: { ...book, asks: [{ price: "0.51", size: "0.1" }] },
  }, fee);
  assert.deepEqual(thin.accepted ? null : thin.reason, "insufficient-depth");

  const small = prepareShadowMarketBuy({ ...intent, minOrderShares: 100 }, snapshot, fee);
  assert.deepEqual(small.accepted ? null : small.reason, "minimum-size");

  const expensive = prepareShadowMarketBuy(
    { ...intent, maxEffectiveVwap: 0.5 },
    snapshot,
    fee,
  );
  assert.deepEqual(expensive.accepted ? null : expensive.reason, "slippage-limit");
});

test("worker adapter consumes the existing WebSocket cache without a network fallback", () => {
  let reads = 0;
  const times = [10, 10.005, 10.015, 10.02];
  const prepared = prepareLiveShadowMarketBuy(
    intent,
    fee,
    observedAtMs,
    (readToken, readCondition, readAt, maxAge) => {
      reads++;
      assert.equal(readToken, tokenId);
      assert.equal(readCondition, conditionId);
      assert.equal(readAt, observedAtMs);
      assert.equal(maxAge, POLYMARKET_SHADOW_CONNECTOR.maxBookAgeMs);
      return {
        market: conditionId,
        assetId: tokenId,
        sourceAtMs: observedAtMs - 40,
        receivedAtMs: observedAtMs - 20,
        ageMs: 20,
        bids: book.bids,
        asks: book.asks,
      };
    },
    () => times.shift() ?? 10.02,
  );
  assert.equal(reads, 1);
  assert.equal(prepared.accepted, true);
  if (prepared.accepted) {
    assert.ok(Math.abs(prepared.plan.preparationMicros - 20) < 1e-6);
  }

  const unavailable = prepareLiveShadowMarketBuy(
    intent,
    fee,
    observedAtMs,
    () => null,
  );
  assert.equal(unavailable.accepted, false);
  if (!unavailable.accepted) assert.equal(unavailable.reason, "stale-book");
});
