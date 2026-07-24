import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  expectedMicrostructureStateBucketKeys,
  MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT,
} from "./microstructure-state-distribution-contract.ts";
import {
  assertOutcomeFreeStateDistributionReport,
  stateDistributionReportFromRows,
  stateQuantileMetric,
} from "./microstructure-state-distribution-audit.ts";

const quantileColumns = {
  microprice_skew_n: 50,
  microprice_skew_q: "{-0.02,-0.01,0,0.01,0.02}",
  absolute_microprice_skew_n: 50,
  absolute_microprice_skew_q: "{0,0.002,0.005,0.01,0.02}",
  touch_pressure_n: 50,
  touch_pressure_q: "{-0.8,-0.4,0,0.4,0.8}",
  absolute_touch_pressure_n: 50,
  absolute_touch_pressure_q: "{0,0.1,0.3,0.5,0.8}",
  paired_spread_n: 50,
  paired_spread_q: "{0.01,0.02,0.03,0.04,0.05}",
  log_min_depth_usd_n: 50,
  log_min_depth_usd_q: "{1,2,3,4,5}",
  complement_error_n: 50,
  complement_error_q: "{0,0.002,0.005,0.01,0.02}",
};

test("state distribution contract freezes dimensions, metrics, and complete bucket universe", () => {
  assert.equal(
    MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.version,
    "updown-microstructure-state-distribution-audit-v1",
  );
  assert.deepEqual(MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.quantileProbabilities, [
    0.05,
    0.25,
    0.5,
    0.75,
    0.95,
  ]);
  assert.deepEqual(MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.dimensions, [
    "pair",
    "horizonMin",
    "sampleMinute",
  ]);
  assert.deepEqual(MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.metrics, [
    "micropriceSkew",
    "absoluteMicropriceSkew",
    "touchPressure",
    "absoluteTouchPressure",
    "pairedSpread",
    "logMinDepthUsd",
    "complementError",
  ]);
  assert.equal(MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.expectedBuckets, 120);
  assert.equal(expectedMicrostructureStateBucketKeys().length, 120);
  assert.equal(MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.minMarketsPerBucket, 50);
});

test("state quantile mapping is deterministic and fails closed", () => {
  assert.deepEqual(stateQuantileMetric(9, "{-1,-0.5,0,0.5,1}"), {
    n: 9,
    quantiles: { p05: -1, p25: -0.5, p50: 0, p75: 0.5, p95: 1 },
  });
  assert.deepEqual(stateQuantileMetric(0, null), { n: 0, quantiles: null });
  assert.throws(() => stateQuantileMetric(-1, []), /invalid.*count/);
  assert.throws(() => stateQuantileMetric(1, [1, 2]), /invalid.*array/);
});

test("state distribution requires every causal minute and minimum distinct-market support", () => {
  const expected = expectedMicrostructureStateBucketKeys();
  const rows = [
    {
      pair: null,
      horizon_min: null,
      sample_minute: null,
      rows: 6_000,
      markets: 1_000,
      ...quantileColumns,
    },
    ...expected.map((key) => {
      const [pair, horizon, minute] = key.split(":");
      return {
        pair,
        horizon_min: Number(horizon),
        sample_minute: Number(minute),
        rows: 50,
        markets: 50,
        ...quantileColumns,
      };
    }),
  ];
  const complete = stateDistributionReportFromRows(rows);
  assert.equal(complete.completeBuckets, 120);
  assert.deepEqual(complete.missingBuckets, []);
  assert.equal(complete.minBucketMarkets, 50);
  assert.equal(complete.readyForCutFreeze, true);

  const incomplete = stateDistributionReportFromRows(rows.slice(0, -1));
  assert.equal(incomplete.completeBuckets, 119);
  assert.equal(incomplete.missingBuckets.length, 1);
  assert.equal(incomplete.minBucketMarkets, 0);
  assert.equal(incomplete.readyForCutFreeze, false);
});

test("state distribution disclosure rejects outcome and strategy fields", () => {
  assert.doesNotThrow(() =>
    assertOutcomeFreeStateDistributionReport({
      pooled: { rows: 6_000, metrics: { pairedSpread: { n: 6_000 } } },
    }));
  for (const prohibited of [
    { outcome: "UP" },
    { resolution: true },
    { chosenSide: "DOWN" },
    { paperPnl: 10 },
  ]) {
    assert.throws(
      () => assertOutcomeFreeStateDistributionReport(prohibited),
      /disclosure blocked/,
    );
  }
});

test("state feature loader is private, cached, and unreachable before tape readiness", () => {
  const source = readFileSync(
    new URL("./microstructure-state-distribution-audit.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /tape\.readyForFrozenDiagnostic\s*\?\s*readMicrostructureStateDistribution\(\)\s*:\s*Promise\.resolve\(null\)/,
  );
  assert.match(source, /createAsyncTtlCache/);
  assert.match(source, /group by grouping sets \(\(\), \(pair, horizon_min, sample_minute\)\)/i);
  assert.doesNotMatch(
    source,
    /export\s+(?:async\s+)?function\s+loadMicrostructureStateDistribution/,
  );
  assert.doesNotMatch(
    source,
    /\b(?:paper_trade|resolved_up|label_status|pnl_usd|raw_net|worst_case_net)\b/i,
  );
});

test("state preregistration is metadata-only and contains no execution path", () => {
  const source = readFileSync(
    new URL("../scripts/record-microstructure-state-distribution-audit-v1.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /Outcome-free microstructure state distribution audit v1/);
  assert.doesNotMatch(source, /polymarketStateSnapshots|polymarket_state_snapshot|db\.execute/);
  for (const prohibited of ["placeOrder", "submitOrder", "cancelOrder", "privateKey"]) {
    assert.equal(source.includes(prohibited), false, `${prohibited} must not be reachable`);
  }
});
