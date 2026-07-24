import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FLOW_DISTRIBUTION_AUDIT } from "./flow-distribution-contract.ts";
import {
  assertOutcomeFreeDistributionReport,
  flowQuantileMetric,
} from "./flow-distribution-audit.ts";

test("flow distribution audit freezes exact sources, metrics, and quantiles", () => {
  assert.equal(FLOW_DISTRIBUTION_AUDIT.version, "updown-flow-distribution-audit-v1");
  assert.deepEqual(FLOW_DISTRIBUTION_AUDIT.quantileProbabilities, [
    0.05,
    0.25,
    0.5,
    0.75,
    0.95,
  ]);
  assert.deepEqual(FLOW_DISTRIBUTION_AUDIT.sources.hyperliquid.metrics, [
    "imbalance5s",
    "imbalance30s",
    "imbalance60s",
    "absoluteImbalance60s",
    "logNotional60s",
    "tradeCount60s",
    "maxTradeShare60s",
  ]);
  assert.deepEqual(FLOW_DISTRIBUTION_AUDIT.sources.clobEventOfi.metrics, [
    "canonical5s",
    "canonical30s",
    "canonical60s",
    "absoluteCanonical60s",
    "totalEvents60s",
    "receiveAgeSec",
    "maxTransportLagMs60s",
  ]);
});
test("flow quantile mapping is deterministic and fails closed", () => {
  assert.deepEqual(flowQuantileMetric(9, "{-1,-0.5,0,0.5,1}"), {
    n: 9,
    quantiles: { p05: -1, p25: -0.5, p50: 0, p75: 0.5, p95: 1 },
  });
  assert.deepEqual(flowQuantileMetric(0, null), { n: 0, quantiles: null });
  assert.throws(() => flowQuantileMetric(-1, []), /invalid.*count/);
  assert.throws(() => flowQuantileMetric(1, [1, 2]), /invalid.*array/);
});

test("flow distribution report rejects outcome or strategy fields", () => {
  assert.doesNotThrow(() =>
    assertOutcomeFreeDistributionReport({
      pooled: { rows: 20_000, metrics: { canonical60s: { n: 20_000 } } },
    }),
  );
  for (const prohibited of [
    { outcome: "UP" },
    { resolution: true },
    { chosenSide: "DOWN" },
    { paperPnl: 10 },
  ]) {
    assert.throws(
      () => assertOutcomeFreeDistributionReport(prohibited),
      /disclosure blocked/,
    );
  }
});

test("feature loaders are private, cached, and invoked only after independent readiness", () => {
  const source = readFileSync(new URL("./flow-distribution-audit.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /hyperliquidStatus\.readyForOutcomeFreeDistributionAudit\s*\?\s*readHyperliquidDistribution\(\)\s*:\s*null/,
  );
  assert.match(
    source,
    /clobEventStatus\.readyForOutcomeFreeDistributionAudit\s*\?\s*readClobEventDistribution\(\)\s*:\s*null/,
  );
  assert.match(source, /createAsyncTtlCache/);
  assert.doesNotMatch(source, /export\s+(?:async\s+)?function\s+load(?:Hyperliquid|ClobEvent)/);
  assert.doesNotMatch(
    source,
    /\b(?:paper_trade|resolved_up|label_status|pnl_usd|raw_net|worst_case_net)\b/i,
  );
});

test("preregistration is metadata-only and preserves paper-only execution constraints", () => {
  const source = readFileSync(
    new URL("../scripts/record-flow-distribution-audit-v1.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /Outcome-free flow distribution audit v1/);
  assert.doesNotMatch(source, /polymarketStateSnapshots|polymarket_state_snapshot|db\.execute/);
  for (const prohibited of ["placeOrder", "submitOrder", "cancelOrder", "privateKey"]) {
    assert.equal(source.includes(prohibited), false, `${prohibited} must not be reachable`);
  }
});
