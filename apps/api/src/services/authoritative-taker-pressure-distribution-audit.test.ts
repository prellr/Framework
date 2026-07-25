import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT,
  canonicalAuthoritativeTakerPressureSign,
  expectedAuthoritativeTakerPressureBucketKeys,
} from "./authoritative-taker-pressure-distribution-contract.ts";
import {
  assertOutcomeFreeAuthoritativeTakerPressureReport,
  authoritativeTakerPressureDistributionReportFromRows,
  authoritativeTakerPressureQuantileMetric,
} from "./authoritative-taker-pressure-distribution-audit.ts";

const q = "{1,2,3,4,5}";

function rawRow(pair: string | null, horizonMin: number | null, markets = 25) {
  return {
    pair,
    horizon_min: horizonMin,
    markets,
    log_gross_shares_n: markets,
    log_gross_shares_q: q,
    event_count_n: markets,
    event_count_q: q,
    unique_receipt_count_n: markets,
    unique_receipt_count_q: q,
    absolute_share_pressure_n: markets,
    absolute_share_pressure_q: "{0.05,0.2,0.4,0.7,0.95}",
    max_event_share_fraction_n: markets,
    max_event_share_fraction_q: "{0.1,0.2,0.3,0.4,0.8}",
  };
}

test("canonical pressure sign maps both complementary books into UP-probability space", () => {
  assert.equal(canonicalAuthoritativeTakerPressureSign("up", "buy"), 1);
  assert.equal(canonicalAuthoritativeTakerPressureSign("up", "sell"), -1);
  assert.equal(canonicalAuthoritativeTakerPressureSign("down", "buy"), -1);
  assert.equal(canonicalAuthoritativeTakerPressureSign("down", "sell"), 1);
});

test("pressure distribution freezes a first-minute, twelve-bucket unsigned contract", () => {
  assert.equal(
    AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.version,
    "updown-authoritative-taker-pressure-distribution-audit-v1",
  );
  assert.equal(AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.observationWindowSec, 60);
  assert.equal(AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.expectedBuckets, 12);
  assert.equal(AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.minMarketsPerBucket, 25);
  assert.equal(expectedAuthoritativeTakerPressureBucketKeys().length, 12);
  assert.deepEqual(AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.metrics, [
    "logGrossShares",
    "eventCount",
    "uniqueReceiptCount",
    "absoluteSharePressure",
    "maxEventShareFraction",
  ]);
});

test("pressure quantiles parse PostgreSQL arrays and fail malformed values closed", () => {
  assert.deepEqual(authoritativeTakerPressureQuantileMetric(25, q), {
    n: 25,
    quantiles: { p05: 1, p25: 2, p50: 3, p75: 4, p95: 5 },
  });
  assert.deepEqual(authoritativeTakerPressureQuantileMetric(0, null), {
    n: 0,
    quantiles: null,
  });
  assert.throws(
    () => authoritativeTakerPressureQuantileMetric(25, "{1,2}"),
    /invalid authoritative taker-pressure quantile array/,
  );
});

test("complete pressure reports require every asset by horizon bucket", () => {
  const rows = [
    rawRow(null, null, 300),
    ...expectedAuthoritativeTakerPressureBucketKeys().map((key) => {
      const [pair, horizon] = key.split(":");
      return rawRow(pair, Number(horizon));
    }),
  ];
  const complete = authoritativeTakerPressureDistributionReportFromRows(rows);
  assert.equal(complete.completeBuckets, 12);
  assert.equal(complete.minBucketMarkets, 25);
  assert.equal(complete.readyForCutFreeze, true);

  const incomplete = authoritativeTakerPressureDistributionReportFromRows(rows.slice(0, -1));
  assert.equal(incomplete.readyForCutFreeze, false);
  assert.equal(incomplete.missingBuckets.length, 1);
});

test("pressure disclosure fails closed on direction, token, outcome, or paper fields", () => {
  for (const forbidden of [
    { direction: "up" },
    { signedPressure: 0.5 },
    { tokenId: "x" },
    { outcome: true },
    { paperPnl: 1 },
    { chosenSide: "up" },
  ]) {
    assert.throws(
      () => assertOutcomeFreeAuthoritativeTakerPressureReport(forbidden),
      /disclosure blocked/,
    );
  }
});

test("private pressure query is readiness-gated, receipt-verified, bounded, and non-executing", () => {
  const source = readFileSync(
    new URL("./authoritative-taker-pressure-distribution-audit.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /tape\.readyForOutcomeFreeDistributionAudit\s*\?\s*readAuthoritativeTakerPressureDistribution\(\)\s*:\s*Promise\.resolve\(null\)/,
  );
  assert.match(source, /chain_status = 'verified'/);
  assert.match(source, /chain_transaction_hash is not null/);
  assert.match(source, /chain_confirmations >= 20/);
  assert.match(source, /event_at < window_start/);
  assert.match(source, /observationWindowSec/);
  assert.match(source, /outcome_side = 'up' and chain_side = 'buy'/);
  assert.match(source, /outcome_side = 'down' and chain_side = 'sell'/);
  assert.match(source, /abs\(sum\(canonical_sign \* chain_shares\)\)/);
  assert.doesNotMatch(source, /\b(insert|update|delete)\b[\s\S]*polymarket_trade_flow_event/i);
  assert.doesNotMatch(source, /\b(placeOrder|submitOrder|cancelOrder|signTypedData)\b/);
  assert.doesNotMatch(source, /\bpaper_(?:bet|ledger|decision)\b/i);
});
