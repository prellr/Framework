import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  multiStakeCapacityCapture,
  multiStakeCapacityReady,
  POLYMARKET_MULTI_STAKE_CAPACITY,
} from "./polymarket-multi-stake-capacity.ts";
import type { ClobBook } from "./polymarket.ts";

const book = (asks: [number, number][]): ClobBook => ({
  market: "test",
  asset_id: "test",
  asks: asks.map(([price, size]) => ({ price: String(price), size: String(size) })),
  bids: [],
});
const noFee = { rate: 0, exponent: 1, takerOnly: true } as const;

test("multi-stake capacity v1 freezes a future boundary, budgets, and readiness floor", () => {
  assert.equal(POLYMARKET_MULTI_STAKE_CAPACITY.version, "polymarket-multi-stake-capacity-v1");
  assert.equal(
    new Date(POLYMARKET_MULTI_STAKE_CAPACITY.evalStartMs).toISOString(),
    "2026-07-25T22:00:00.000Z",
  );
  assert.deepEqual(POLYMARKET_MULTI_STAKE_CAPACITY.modeledStakeUsd, [5, 10, 20]);
  assert.deepEqual(POLYMARKET_MULTI_STAKE_CAPACITY.capturedStakeUsd, [10, 20]);
  assert.equal(POLYMARKET_MULTI_STAKE_CAPACITY.minMarkets, 1_500);
  assert.equal(POLYMARKET_MULTI_STAKE_CAPACITY.minSpanDays, 7);
  assert.equal(POLYMARKET_MULTI_STAKE_CAPACITY.minMarketsPerAssetTimeframe, 100);
  assert.equal(POLYMARKET_MULTI_STAKE_CAPACITY.minCoverage, 0.9);
});

test("capture stays empty before the boundary and fails closed without fee metadata", () => {
  const deep = book([[0.4, 100]]);
  assert.equal(
    multiStakeCapacityCapture(deep, deep, POLYMARKET_MULTI_STAKE_CAPACITY.evalStartMs - 1, noFee),
    null,
  );
  assert.equal(
    multiStakeCapacityCapture(deep, deep, POLYMARKET_MULTI_STAKE_CAPACITY.evalStartMs, null),
    null,
  );
});

test("$10 and $20 effective VWAPs use the same books and expose nonlinear depth", () => {
  const result = multiStakeCapacityCapture(
    book([
      [0.4, 25],
      [0.6, 100],
    ]),
    book([[0.3, 100]]),
    POLYMARKET_MULTI_STAKE_CAPACITY.evalStartMs,
    noFee,
  );
  assert.equal(result?.version, POLYMARKET_MULTI_STAKE_CAPACITY.version);
  assert.equal(result?.upFill10, 0.4);
  assert.ok((result?.upFill20 ?? 0) > 0.4);
  assert.equal(result?.downFill10, 0.3);
  assert.equal(result?.downFill20, 0.3);
});

test("thin $20 depth remains null without discarding a valid $10 observation", () => {
  const result = multiStakeCapacityCapture(
    book([[0.4, 30]]),
    book([[0.5, 30]]),
    POLYMARKET_MULTI_STAKE_CAPACITY.evalStartMs,
    noFee,
  );
  assert.equal(result?.upFill10, 0.4);
  assert.equal(result?.downFill10, 0.5);
  assert.equal(result?.upFill20, null);
  assert.equal(result?.downFill20, null);
});

test("readiness requires count, span, coverage, and every asset-timeframe bucket", () => {
  const passing = {
    markets: 1_500,
    spanDays: 7,
    coverage: 0.9,
    minBucketMarkets: 100,
  };
  assert.equal(multiStakeCapacityReady(passing), true);
  for (const failing of [
    { ...passing, markets: 1_499 },
    { ...passing, spanDays: 6.999 },
    { ...passing, coverage: 0.899 },
    { ...passing, minBucketMarkets: 99 },
  ])
    assert.equal(multiStakeCapacityReady(failing), false);
});

test("collector reuses exactly the two existing public books and adds no request path", () => {
  const stateTape = readFileSync(new URL("./polymarket-state-tape.ts", import.meta.url), "utf8");
  const capacityModule = readFileSync(
    new URL("./polymarket-multi-stake-capacity.ts", import.meta.url),
    "utf8",
  );
  assert.equal((stateTape.match(/await fetchClobBook\(/g) ?? []).length, 2);
  assert.match(stateTape, /multiStakeCapacityCapture\(upBook, downBook, now, fee\)/);
  assert.equal(capacityModule.includes("fetchClobBook"), false);
  assert.equal(capacityModule.includes("fetch("), false);
  assert.equal(capacityModule.includes("WebSocket"), false);
});

test("status and preregistration remain outcome-blind and non-executing", () => {
  const stateTape = readFileSync(new URL("./polymarket-state-tape.ts", import.meta.url), "utf8");
  const status = stateTape.slice(
    stateTape.indexOf("export async function polymarketMultiStakeCapacityStatus"),
  );
  const preregistration = readFileSync(
    new URL("../scripts/record-polymarket-multi-stake-capacity-v1.ts", import.meta.url),
    "utf8",
  );
  assert.match(status, /readyForCapacityDistribution/);
  assert.match(status, /addsExternalRequests: false/);
  assert.match(status, /executionCapability: false/);
  assert.match(preregistration, /Date\.now\(\) >= POLYMARKET_MULTI_STAKE_CAPACITY\.evalStartMs/);
  assert.match(preregistration, /readsOutcomes: false/);
  assert.match(preregistration, /addsExternalRequests: false/);
  for (const prohibited of [
    "resolvedUp",
    "labelStatus",
    "paperTrades",
    "paperDecisions",
    "pnlUsd",
    "botKey",
    "placeOrder",
    "submitOrder",
    "privateKey",
  ]) {
    assert.equal(status.includes(prohibited), false, `${prohibited} must not be read by status`);
    assert.equal(
      preregistration.includes(prohibited),
      false,
      `${prohibited} must not be read by preregistration`,
    );
  }
});

test("schema, protected router, and MCP expose only nullable capacity evidence/status", () => {
  const schema = readFileSync(
    new URL("../../../../packages/db/src/schema/polymarket-state-snapshots.ts", import.meta.url),
    "utf8",
  );
  const router = readFileSync(new URL("../routers/polymarket.ts", import.meta.url), "utf8");
  const mcp = readFileSync(new URL("../mcp/server.ts", import.meta.url), "utf8");
  for (const column of [
    'capacityVersion: text("capacity_version")',
    'upFill10: doublePrecision("up_fill_10")',
    'downFill10: doublePrecision("down_fill_10")',
    'upFill20: doublePrecision("up_fill_20")',
    'downFill20: doublePrecision("down_fill_20")',
  ])
    assert.ok(schema.includes(column), column);
  assert.match(
    router,
    /multiStakeCapacityTape:\s*protectedProcedure\.query\(\(\)\s*=>\s*polymarketMultiStakeCapacityStatus\(\)\)/,
  );
  assert.match(mcp, /analysis_polymarket_multi_stake_capacity_status/);
  assert.doesNotMatch(router, /multiStakeCapacity(?:Place|Submit|Cancel|Sign|Trade)/);
});
