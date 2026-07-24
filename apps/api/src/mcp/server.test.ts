import { test } from "node:test";
import assert from "node:assert/strict";
import { createMcpApp } from "./server.ts";
import { getSetting } from "../services/config.ts";

// getSetting falls back to process.env when the DB is unavailable (as in this test).
process.env.AGENT_API_KEY ??= "test-agent-key-abcdef123456";
const agentApiKey = await getSetting("AGENT_API_KEY");
const app = createMcpApp();

const call = (body: unknown, key = agentApiKey) =>
  app.request("/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { "X-API-Key": key } : {}) },
    body: JSON.stringify(body),
  });

test("rejects requests without a valid API key", async () => {
  const res = await call({ jsonrpc: "2.0", id: 1, method: "initialize" }, "");
  assert.equal(res.status, 401);
});

test("initialize returns protocol + serverInfo", async () => {
  const res = await call({ jsonrpc: "2.0", id: 1, method: "initialize" });
  assert.equal(res.status, 200);
  const json: any = await res.json();
  assert.equal(json.result.protocolVersion, "2024-11-05");
  assert.equal(json.result.serverInfo.name, "jester-analysis");
});

test("tools/list exposes analysis tools and no mutate/trade tool", async () => {
  const json: any = await (await call({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
  const names: string[] = json.result.tools.map((t: any) => t.name);
  assert.ok(names.includes("analysis_query_results"));
  assert.ok(names.includes("analysis_run_sweep"));
  assert.ok(names.includes("analysis_venue_lead_lag_status"));
  assert.ok(names.includes("analysis_authoritative_trade_flow_status"));
  assert.ok(names.includes("analysis_hyperliquid_flow_status"));
  assert.ok(names.includes("analysis_polymarket_microstructure_state_distribution_audit"));
  assert.ok(names.includes("analysis_cross_asset_lead_lag_status"));
  assert.ok(names.includes("analysis_paper_markout_status"));
  assert.ok(names.includes("analysis_deribit_skew_status"));
  assert.ok(names.includes("analysis_pricer_calibration_audit"));
  assert.ok(names.includes("analysis_bsm_profile_calibration_audit"));
  assert.ok(names.includes("analysis_microstructure_absorption_audit"));
  assert.ok(names.includes("analysis_four_streak_reversal_audit"));
  assert.ok(names.includes("analysis_strategy_independence"));
  assert.ok(names.includes("analysis_complete_set_taker_audit"));
  assert.ok(names.includes("analysis_cross_horizon_bundle_audit"));
  // Nothing that trades or mutates Jester is exposed.
  assert.ok(!names.some((n) => /(^|_)(confirm|order|place|propose|close|mutate|withdraw)(_|$)/i.test(n)));
});

test("prompts/list ships the screening methodology prompt", async () => {
  const json: any = await (await call({ jsonrpc: "2.0", id: 3, method: "prompts/list" })).json();
  assert.ok(json.result.prompts.some((p: any) => p.name === "screen-strategy"));
});

test("unknown method returns JSON-RPC error", async () => {
  const json: any = await (await call({ jsonrpc: "2.0", id: 4, method: "bogus/method" })).json();
  assert.equal(json.error.code, -32601);
});
