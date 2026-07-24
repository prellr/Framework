import assert from "node:assert/strict";
import test from "node:test";
import {
  STATE_TAPE_EXECUTION_V2,
  stateTapeBookFill,
} from "./state-tape-execution.ts";
import type { ClobBook } from "./polymarket.ts";

const book = (asks: [number, number][]): ClobBook => ({
  market: "test",
  asset_id: "test",
  asks: asks.map(([price, size]) => ({ price: String(price), size: String(size) })),
  bids: [],
});

test("state-tape v2 boundary and total budget are frozen", () => {
  assert.equal(STATE_TAPE_EXECUTION_V2.version, "polymarket-state-tape-fee-execution-v2");
  assert.equal(STATE_TAPE_EXECUTION_V2.evalStartMs, 1_784_808_000_000);
  assert.equal(STATE_TAPE_EXECUTION_V2.totalBudgetUsd, 5);
});

test("pre-boundary rows preserve legacy gross-budget semantics", () => {
  const fill = stateTapeBookFill(
    book([[0.4, 20]]),
    STATE_TAPE_EXECUTION_V2.evalStartMs - 1,
    null,
  );
  assert.equal(fill?.version, "legacy-gross-budget-v1");
  assert.equal(fill?.effectiveVwap, 0.4);
  assert.equal(fill?.grossVwap, 0.4);
  assert.equal(fill?.feeUsd, 0);
  assert.equal(fill?.totalCostUsd, 5);
});

test("boundary rows use fee-adjusted total-outlay semantics", () => {
  const fill = stateTapeBookFill(
    book([[0.4, 20]]),
    STATE_TAPE_EXECUTION_V2.evalStartMs,
    { rate: 0.07, exponent: 1, takerOnly: true },
  );
  assert.equal(fill?.version, "fee-adjusted-total-budget-v1");
  assert.ok((fill?.effectiveVwap ?? 0) > (fill?.grossVwap ?? 1));
  assert.ok(Math.abs((fill?.totalCostUsd ?? 0) - 5) < 1e-12);
  assert.ok((fill?.feeUsd ?? 0) > 0);
});

test("v2 fails closed without a valid fee or sufficient depth", () => {
  assert.equal(
    stateTapeBookFill(book([[0.4, 20]]), STATE_TAPE_EXECUTION_V2.evalStartMs, null),
    null,
  );
  assert.equal(
    stateTapeBookFill(
      book([[0.4, 1]]),
      STATE_TAPE_EXECUTION_V2.evalStartMs,
      { rate: 0.07, exponent: 1, takerOnly: true },
    ),
    null,
  );
  assert.equal(
    stateTapeBookFill(book([[0.4, 20]]), Number.NaN, null),
    null,
  );
});
