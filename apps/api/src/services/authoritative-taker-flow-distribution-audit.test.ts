import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT,
  expectedAuthoritativeTakerFlowBucketKeys,
} from "./authoritative-taker-flow-distribution-contract.ts";
import {
  assertOutcomeFreeAuthoritativeTakerFlowReport,
  authoritativeTakerFlowDistributionReportFromRows,
  authoritativeTakerFlowQuantileMetric,
} from "./authoritative-taker-flow-distribution-audit.ts";

const quantileColumns = {
  log_chain_notional_usd_n: 30,
  log_chain_notional_usd_q: "{1,2,3,4,5}",
  log_chain_shares_n: 30,
  log_chain_shares_q: "{1,2,3,4,5}",
  absolute_chain_price_distance_bps_n: 30,
  absolute_chain_price_distance_bps_q: "{10,50,100,250,500}",
  seconds_from_window_start_n: 30,
  seconds_from_window_start_q: "{1,15,30,60,120}",
  ingestion_latency_ms_n: 30,
  ingestion_latency_ms_q: "{1,2,3,4,5}",
  chain_confirmations_n: 30,
  chain_confirmations_q: "{20,20,21,22,25}",
  absolute_source_receipt_price_error_bps_n: 30,
  absolute_source_receipt_price_error_bps_q: "{0,0,1,5,25}",
  absolute_source_receipt_share_error_ppm_n: 30,
  absolute_source_receipt_share_error_ppm_q: "{0,0,0,0.1,1}",
};

test("authoritative taker-flow contract freezes unsigned metrics and complete universe", () => {
  assert.equal(
    AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.version,
    "updown-authoritative-taker-flow-distribution-audit-v1",
  );
  assert.deepEqual(
    AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.quantileProbabilities,
    [0.05, 0.25, 0.5, 0.75, 0.95],
  );
  assert.deepEqual(
    AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.dimensions,
    ["pair", "horizonMin"],
  );
  assert.deepEqual(AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.metrics, [
    "logChainNotionalUsd",
    "logChainShares",
    "absoluteChainPriceDistanceBps",
    "secondsFromWindowStart",
    "ingestionLatencyMs",
    "chainConfirmations",
    "absoluteSourceReceiptPriceErrorBps",
    "absoluteSourceReceiptShareErrorPpm",
  ]);
  assert.equal(AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.expectedBuckets, 12);
  assert.equal(expectedAuthoritativeTakerFlowBucketKeys().length, 12);
  assert.equal(AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.minMarketsPerBucket, 25);
});

test("authoritative taker-flow quantile mapping is deterministic and fails closed", () => {
  assert.deepEqual(
    authoritativeTakerFlowQuantileMetric(9, "{0,1,2,3,4}"),
    { n: 9, quantiles: { p05: 0, p25: 1, p50: 2, p75: 3, p95: 4 } },
  );
  assert.deepEqual(authoritativeTakerFlowQuantileMetric(0, null), {
    n: 0,
    quantiles: null,
  });
  assert.throws(
    () => authoritativeTakerFlowQuantileMetric(-1, []),
    /invalid.*count/,
  );
  assert.throws(
    () => authoritativeTakerFlowQuantileMetric(1, [1, 2]),
    /invalid.*array/,
  );
});

test("authoritative taker-flow report requires every horizon bucket and support", () => {
  const expected = expectedAuthoritativeTakerFlowBucketKeys();
  const rows = [
    {
      pair: null,
      horizon_min: null,
      rows: 5_000,
      markets: 600,
      ...quantileColumns,
    },
    ...expected.map((key) => {
      const [pair, horizon] = key.split(":");
      return {
        pair,
        horizon_min: Number(horizon),
        rows: 300,
        markets: 25,
        ...quantileColumns,
      };
    }),
  ];
  const complete = authoritativeTakerFlowDistributionReportFromRows(rows);
  assert.equal(complete.completeBuckets, 12);
  assert.deepEqual(complete.missingBuckets, []);
  assert.equal(complete.minBucketMarkets, 25);
  assert.equal(complete.readyForCutFreeze, true);

  const incomplete = authoritativeTakerFlowDistributionReportFromRows(
    rows.slice(0, -1),
  );
  assert.equal(incomplete.completeBuckets, 11);
  assert.equal(incomplete.missingBuckets.length, 1);
  assert.equal(incomplete.readyForCutFreeze, false);
});

test("authoritative taker-flow disclosure rejects directional or performance fields", () => {
  assert.doesNotThrow(() =>
    assertOutcomeFreeAuthoritativeTakerFlowReport({
      pooled: { rows: 5_000, metrics: { logChainNotionalUsd: { n: 5_000 } } },
    }));
  for (const prohibited of [
    { outcome: "UP" },
    { chainSide: "buy" },
    { tokenId: "1" },
    { chosenSide: "DOWN" },
    { tradeDirection: "short" },
    { walletAddress: "0x0" },
    { orderId: "1" },
    { paperPnl: 10 },
  ]) {
    assert.throws(
      () => assertOutcomeFreeAuthoritativeTakerFlowReport(prohibited),
      /disclosure blocked/,
    );
  }
});

test("verified feature query is private, cached, unsigned, and readiness-gated", () => {
  const source = readFileSync(
    new URL("./authoritative-taker-flow-distribution-audit.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /tape\.readyForOutcomeFreeDistributionAudit\s*\?\s*readAuthoritativeTakerFlowDistribution\(\)\s*:\s*Promise\.resolve\(null\)/,
  );
  assert.match(source, /chain_status = 'verified'/);
  assert.match(source, /and shares > 0/);
  assert.match(source, /createAsyncTtlCache/);
  assert.match(
    source,
    /group by grouping sets \(\(\), \(pair, horizon_min\)\)/i,
  );
  assert.doesNotMatch(
    source,
    /export\s+(?:async\s+)?function\s+loadAuthoritativeTakerFlowDistribution/,
  );
  assert.doesNotMatch(
    source,
    /\b(?:outcome_side|reported_side|chain_side|token_id)\b/i,
  );
  assert.doesNotMatch(
    source,
    /\b(?:paper_trade|resolved_up|label_status|pnl_usd|raw_net|worst_case_net)\b/i,
  );
});

test("authoritative taker-flow preregistration is metadata-only and non-executing", () => {
  const source = readFileSync(
    new URL(
      "../scripts/record-authoritative-taker-flow-distribution-audit-v1.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    source,
    /Outcome-free authoritative taker-flow distribution audit v1/,
  );
  assert.doesNotMatch(
    source,
    /polymarket_trade_flow_event|authoritativeTakerFlowDistributionAudit|db\.execute/,
  );
  for (const prohibited of [
    "placeOrder",
    "submitOrder",
    "cancelOrder",
    "privateKey",
  ]) {
    assert.equal(source.includes(prohibited), false, `${prohibited} must not be reachable`);
  }
});
