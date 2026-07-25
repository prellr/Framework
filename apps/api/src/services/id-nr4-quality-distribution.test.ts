import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertOutcomeBlindIdNr4QualityDisclosure,
  idNr4QualityDistributionReportFromRows,
  idNr4QualityMetric,
  ID_NR4_QUALITY_DISTRIBUTION,
} from "./id-nr4-quality-distribution.ts";

const metricFields = {
  setup_range_bps_n: 10,
  setup_range_bps_q: [1, 2, 3, 4, 5],
  range_compression_n: 10,
  range_compression_q: [0.1, 0.2, 0.3, 0.4, 0.5],
  inside_range_ratio_n: 10,
  inside_range_ratio_q: [0.2, 0.3, 0.4, 0.5, 0.6],
  absolute_close_location_n: 10,
  absolute_close_location_q: [0.3, 0.4, 0.5, 0.6, 0.7],
  breakout_extension_n: 10,
  breakout_extension_q: [0.4, 0.5, 0.6, 0.7, 0.8],
  relative_volume_n: 9,
  relative_volume_q: [0.5, 0.6, 0.7, 0.8, 0.9],
};

test("ID/NR4 quality distribution contract is exact and prospective", () => {
  assert.equal(
    ID_NR4_QUALITY_DISTRIBUTION.version,
    "updown-id-nr4-breakout-quality-distribution-v1",
  );
  assert.equal(
    new Date(ID_NR4_QUALITY_DISTRIBUTION.evalStartMs).toISOString(),
    "2026-07-25T22:00:00.000Z",
  );
  assert.deepEqual(ID_NR4_QUALITY_DISTRIBUTION.floors, {
    rows: 300,
    marketsPerPair: 40,
    spanDays: 5,
  });
  assert.deepEqual(ID_NR4_QUALITY_DISTRIBUTION.quantileProbabilities, [0.1, 0.25, 0.5, 0.75, 0.9]);
  assert.equal(ID_NR4_QUALITY_DISTRIBUTION.pairs.length, 6);
});

test("ID/NR4 quality metric parses PostgreSQL arrays and fails closed", () => {
  assert.deepEqual(idNr4QualityMetric("7", "{1,2,3,4,5}"), {
    n: 7,
    quantiles: { p10: 1, p25: 2, p50: 3, p75: 4, p90: 5 },
  });
  assert.deepEqual(idNr4QualityMetric(0, null), { n: 0, quantiles: null });
  assert.throws(() => idNr4QualityMetric(2, [1, 2]), /quantile array/);
  assert.throws(() => idNr4QualityMetric(-1, [1, 2, 3, 4, 5]), /count/);
});

test("ID/NR4 quality report requires a pooled row and all frozen pairs", () => {
  const rows = [
    { pair: null, rows: 60, markets: 60, ...metricFields },
    ...ID_NR4_QUALITY_DISTRIBUTION.pairs.map((pair) => ({
      pair,
      rows: 10,
      markets: 10,
      ...metricFields,
    })),
  ];
  const report = idNr4QualityDistributionReportFromRows(rows);
  assert.equal(report.pooled.rows, 60);
  assert.deepEqual(
    report.buckets.map((bucket) => bucket.pair),
    [...ID_NR4_QUALITY_DISTRIBUTION.pairs],
  );
  assert.deepEqual(report.missingPairs, []);
  assert.equal(report.pooled.metrics.relativeVolume.n, 9);
  assert.equal(report.pooled.metrics.breakoutExtension.quantiles?.p75, 0.7);

  assert.throws(() => idNr4QualityDistributionReportFromRows(rows.slice(1)), /pooled row/);
  assert.throws(
    () => idNr4QualityDistributionReportFromRows(rows.slice(0, -1)),
    /omitted required pairs/,
  );
  assert.throws(
    () =>
      idNr4QualityDistributionReportFromRows([
        ...rows,
        { pair: "ADA-USD", rows: 1, markets: 1, ...metricFields },
      ]),
    /out-of-scope pair/,
  );
});

test("ID/NR4 disclosure guard rejects outcome, execution, and account keys", () => {
  assert.doesNotThrow(() =>
    assertOutcomeBlindIdNr4QualityDisclosure({
      rows: 3,
      metrics: { setupRangeBps: { p50: 42 } },
    }),
  );
  for (const key of ["outcome", "pnlUsd", "winRate", "fillPrice", "walletId", "orderId"]) {
    assert.throws(
      () => assertOutcomeBlindIdNr4QualityDisclosure({ [key]: 1 }),
      /disclosure blocked/,
    );
  }
});

test("ID/NR4 distribution SQL cannot select result or execution fields", () => {
  const source = readFileSync(new URL("./id-nr4-quality-distribution.ts", import.meta.url), "utf8");
  for (const forbidden of [
    "pnl_usd",
    "ask_paid",
    "control_ask_paid",
    "graded_at",
    "resolution_value",
    "chosen_side",
    "account_id",
    "wallet_id",
    "order_id",
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      `outcome-blind service must not reference ${forbidden}`,
    );
  }
});
