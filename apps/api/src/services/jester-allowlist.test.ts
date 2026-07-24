import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertAllowed,
  isAllowed,
  JesterForbiddenError,
  MUTATE_TOOLS,
  ANALYSIS_TOOLS,
} from "./jester-allowlist.ts";

/**
 * These tests ARE the Phase 0 acceptance criterion:
 * "trading paths provably rejected." If any of these fail, the safety
 * guarantee of the whole system is broken.
 */

test("allows the analysis read endpoints", () => {
  assert.ok(isAllowed("GET", "/api/delegated/whoami?include=summary"));
  assert.ok(isAllowed("GET", "/api/delegated/positions"));
  assert.ok(isAllowed("GET", "/api/delegated/pnl/summary"));
  assert.ok(isAllowed("GET", "/api/delegated/strategies/available"));
  assert.ok(isAllowed("GET", "/api/delegated/strategies/top-backtests?filter=good"));
  assert.ok(isAllowed("GET", "/api/delegated/backtests/2ea60a2e-1b61-441c-b3de"));
});

test("allows enqueuing a backtest", () => {
  assert.ok(isAllowed("POST", "/api/delegated/backtests", { strategyId: "x", pair: "BTC-USD" }));
});

test("BLOCKS every fund-moving / order endpoint", () => {
  for (const path of [
    "/api/delegated/confirm",
    "/api/v1/trades",
    "/api/delegated/propose",
    "/api/delegated/positions/close",
  ]) {
    assert.equal(isAllowed("POST", path, {}), false, `${path} must be blocked`);
    assert.throws(() => assertAllowed("POST", path, {}), JesterForbiddenError);
  }
});

test("BLOCKS all 19 mutate-tier MCP tools via /mcp/tool", () => {
  for (const name of MUTATE_TOOLS) {
    assert.equal(
      isAllowed("POST", "/api/delegated/mcp/tool", { name, args: {} }),
      false,
      `mutate tool ${name} must be blocked`,
    );
  }
});

test("allows curated analysis MCP tools via /mcp/tool", () => {
  for (const name of ["jester_positions", "jester_top_backtests", "jester_run_backtest"]) {
    assert.ok(ANALYSIS_TOOLS.has(name));
    assert.ok(isAllowed("POST", "/api/delegated/mcp/tool", { name, args: {} }));
  }
});

test("FAIL-CLOSED: unknown / never-seen tools are rejected", () => {
  assert.equal(isAllowed("POST", "/api/delegated/mcp/tool", { name: "jester_brand_new_tool" }), false);
  assert.equal(isAllowed("POST", "/api/delegated/mcp/tool", {}), false); // missing name
  // side-effectful experiment-tier tools we deliberately excluded:
  assert.equal(isAllowed("POST", "/api/delegated/mcp/tool", { name: "jester_qscript_deploy" }), false);
  assert.equal(isAllowed("POST", "/api/delegated/mcp/tool", { name: "jester_optimizer_enqueue" }), false);
});

test("mutate and analysis tool sets never overlap", () => {
  for (const name of ANALYSIS_TOOLS) {
    assert.equal(MUTATE_TOOLS.has(name), false, `${name} is in both sets`);
  }
});

test("unknown REST paths and methods are rejected", () => {
  assert.equal(isAllowed("GET", "/api/delegated/orders"), false);
  assert.equal(isAllowed("POST", "/api/delegated/subscribe", {}), false);
  // @ts-expect-error — exercising an invalid method at runtime
  assert.equal(isAllowed("DELETE", "/api/delegated/positions"), false);
});
