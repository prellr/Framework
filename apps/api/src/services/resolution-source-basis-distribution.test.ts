import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  RESOLUTION_SOURCE_BASIS_DISTRIBUTION_AUDIT,
} from "./resolution-source-basis-distribution-contract.ts";
import {
  assertOutcomeFreeBasisDistributionReport,
  basisDistributionReportFromRows,
  basisQuantileMetric,
} from "./resolution-source-basis-distribution.ts";

const metricColumns = (values: readonly number[]) => ({
  basis_n: 10,
  basis_q: values,
  absolute_basis_n: 10,
  absolute_basis_q: values,
  basis_change_1s_n: 9,
  basis_change_1s_q: values,
  same_sign_persistence_5s_n: 6,
  same_sign_persistence_5s_q: values,
  chainlink_age_n: 10,
  chainlink_age_q: values,
  hl_age_n: 10,
  hl_age_q: values,
});

test("basis distribution contract freezes exact pair-level metrics and quantiles", () => {
  const contract = RESOLUTION_SOURCE_BASIS_DISTRIBUTION_AUDIT;
  assert.equal(contract.version, "updown-resolution-source-basis-distribution-audit-v1");
  assert.equal(contract.tapeVersion, "updown-venue-lead-lag-tape-v1");
  assert.deepEqual(contract.quantileProbabilities, [0.05, 0.25, 0.5, 0.75, 0.95]);
  assert.deepEqual(contract.metrics, [
    "basisBps",
    "absoluteBasisBps",
    "basisChange1sBps",
    "sameSignPersistence5s",
    "chainlinkAgeMs",
    "hlAgeMs",
  ]);
  assert.equal(contract.pairs.length, 6);
});

test("basis distribution mapping requires pooled and all six unique pairs", () => {
  const quantiles = [-2, -1, 0, 1, 2] as const;
  const rows = [
    { pair: null, rows: 60, ...metricColumns(quantiles) },
    ...RESOLUTION_SOURCE_BASIS_DISTRIBUTION_AUDIT.pairs.map((pair) => ({
      pair,
      rows: 10,
      ...metricColumns(quantiles),
    })),
  ];
  const report = basisDistributionReportFromRows(rows);
  assert.equal(report.pooled.rows, 60);
  assert.deepEqual(
    report.buckets.map((bucket) => bucket.pair),
    [...RESOLUTION_SOURCE_BASIS_DISTRIBUTION_AUDIT.pairs].sort(),
  );
  assert.equal(report.buckets[0].metrics.basisChange1sBps.n, 9);
  assert.throws(
    () => basisDistributionReportFromRows(rows.slice(0, -1)),
    /omitted pairs/,
  );
  assert.throws(
    () => basisDistributionReportFromRows([...rows, rows[1]]),
    /duplicate pair/,
  );
});

test("basis quantile mapping and disclosure guard fail closed", () => {
  assert.deepEqual(basisQuantileMetric(5, "{-2,-1,0,1,2}"), {
    n: 5,
    quantiles: { p05: -2, p25: -1, p50: 0, p75: 1, p95: 2 },
  });
  assert.deepEqual(basisQuantileMetric(0, null), { n: 0, quantiles: null });
  assert.throws(() => basisQuantileMetric(-1, []), /invalid.*count/);
  assert.throws(() => basisQuantileMetric(2, [1, 2]), /invalid.*array/);
  assert.doesNotThrow(() =>
    assertOutcomeFreeBasisDistributionReport({ pooled: { rows: 100 } }));
  for (const prohibited of [
    { outcome: "UP" },
    { paperPnl: 4 },
    { marketReturn: 0.1 },
    { chosenSide: "DOWN" },
  ]) {
    assert.throws(
      () => assertOutcomeFreeBasisDistributionReport(prohibited),
      /disclosure blocked/,
    );
  }
});

test("basis feature query remains private, cached, and unreachable before readiness", () => {
  const source = readFileSync(
    new URL("./resolution-source-basis-distribution.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /tape\.allPairsReadyForFrozenDiagnostic\s*\?\s*await readResolutionSourceBasisDistribution\(\)\s*:\s*null/,
  );
  assert.match(source, /createAsyncTtlCache/);
  assert.doesNotMatch(
    source,
    /export\s+(?:async\s+)?function\s+loadResolutionSourceBasisDistribution/,
  );
  assert.doesNotMatch(
    source,
    /\b(?:paper_trade|resolved_up|label_status|pnl_usd|raw_net|worst_case_net)\b/i,
  );
});

test("basis preregistration is metadata-only and non-executing", () => {
  const source = readFileSync(
    new URL("../scripts/record-resolution-source-basis-distribution-audit.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /Outcome-free resolution-source basis distribution audit v1/);
  assert.doesNotMatch(source, /venuePriceSnapshots|venue_price_snapshot|db\.execute/);
  assert.doesNotMatch(
    source,
    /paperTrades|placeOrder|submitOrder|privateKey|crucible_start/i,
  );
});
