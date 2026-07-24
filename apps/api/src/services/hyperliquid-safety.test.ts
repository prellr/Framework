import assert from "node:assert/strict";
import test from "node:test";
import {
  HYPERLIQUID_INFO_ENDPOINT,
  hyperliquidInfoTypeAllowed,
} from "./hyperliquid.ts";

test("Hyperliquid client is pinned to the public info endpoint", () => {
  assert.equal(HYPERLIQUID_INFO_ENDPOINT, "https://api.hyperliquid.xyz/info");
  assert.equal(HYPERLIQUID_INFO_ENDPOINT.includes("/exchange"), false);
});

test("Hyperliquid query guard rejects trading and unknown request types", () => {
  for (const type of ["candleSnapshot", "l2Book", "recentTrades", "meta"]) {
    assert.equal(hyperliquidInfoTypeAllowed(type), true);
  }
  for (const type of ["exchange", "order", "placeOrder", "cancel", "withdraw", "", null, undefined]) {
    assert.equal(hyperliquidInfoTypeAllowed(type), false);
  }
});
