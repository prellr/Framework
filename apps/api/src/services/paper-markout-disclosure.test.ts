import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertOutcomeBlindMarkoutDisclosure,
  paperMarkoutDisclosureFromRows,
  paperMarkoutQuantiles,
  PAPER_MARKOUT_DISCLOSURE,
  type RawMarkoutBucket,
} from "./paper-markout-disclosure.ts";

const row = (dimension: RawMarkoutBucket["dimension"], segment: string): RawMarkoutBucket => ({
  dimension,
  segment_key: segment,
  rows: 10,
  markets: 8,
  nonnegative_rows: 3,
  round_trip_q: [-0.08, -0.02, 0.03],
  mid_delta_q: "{-0.03,0.01,0.05}",
  liquidation_return_usd_q: [-1.2, -0.25, 0.4],
  capture_delay_sec_q: [31, 37, 55],
});

test("markout disclosure contract is fixed, outcome blind, and not a verdict input", () => {
  assert.equal(PAPER_MARKOUT_DISCLOSURE.version, "paper-fill-markout-disclosure-v1");
  assert.equal(PAPER_MARKOUT_DISCLOSURE.auditVersion, "paper-fill-markout-audit-v1");
  assert.equal(PAPER_MARKOUT_DISCLOSURE.stakeUsd, 5);
  assert.deepEqual(PAPER_MARKOUT_DISCLOSURE.quantileProbabilities, [0.1, 0.5, 0.9]);
  assert.deepEqual(PAPER_MARKOUT_DISCLOSURE.dimensions, [
    "overall",
    "horizon",
    "entryAsk",
    "asset",
  ]);
  assert.equal(PAPER_MARKOUT_DISCLOSURE.deduplication, "earliest-captured-market-side");
  assert.equal(PAPER_MARKOUT_DISCLOSURE.outcomeBlind, true);
  assert.equal(PAPER_MARKOUT_DISCLOSURE.verdictInput, false);
});

test("markout quantiles parse PostgreSQL arrays and apply presentation scale", () => {
  assert.deepEqual(paperMarkoutQuantiles("{-0.02,0.01,0.03}", 100), {
    p10: -2,
    p50: 1,
    p90: 3,
  });
  assert.throws(() => paperMarkoutQuantiles([1, 2]), /quantile array/);
  assert.throws(() => paperMarkoutQuantiles("{1,nope,3}"), /quantile array/);
});

test("markout disclosure requires one pooled row and preserves fixed segments", () => {
  const report = paperMarkoutDisclosureFromRows([
    row("asset", "BTC"),
    row("overall", "All"),
    row("entryAsk", "<35¢"),
    row("horizon", "5m"),
  ]);
  assert.equal(report.summary.dimension, "overall");
  assert.equal(report.summary.rows, 10);
  assert.equal(report.summary.nonnegativeRate, 0.3);
  assert.equal(report.summary.contractMarkoutCents.p50, -2);
  assert.equal(report.summary.liquidationReturnUsd5.p50, -0.25);
  assert.deepEqual(
    report.buckets.map((bucket) => `${bucket.dimension}:${bucket.segment}`),
    ["horizon:5m", "entryAsk:<35¢", "asset:BTC"],
  );

  assert.throws(() => paperMarkoutDisclosureFromRows([row("asset", "BTC")]), /overall row/);
  assert.throws(
    () => paperMarkoutDisclosureFromRows([row("overall", "All"), row("overall", "All")]),
    /duplicate bucket/,
  );
  assert.throws(
    () => paperMarkoutDisclosureFromRows([row("unexpected", "x"), row("overall", "All")]),
    /unknown dimension/,
  );
});

test("markout disclosure guard rejects strategy, outcome, and authority fields", () => {
  assert.doesNotThrow(() =>
    assertOutcomeBlindMarkoutDisclosure({
      rows: 10,
      contractMarkoutCents: { p50: -2 },
      liquidationReturnUsd5: { p50: -0.25 },
    }),
  );
  for (const key of [
    "strategyKey",
    "botKey",
    "signal",
    "outcome",
    "graded",
    "winRate",
    "controlAsk",
    "wallet",
    "orderId",
  ]) {
    assert.throws(() => assertOutcomeBlindMarkoutDisclosure({ [key]: 1 }), /disclosure blocked/);
  }
});

test("markout SQL stays outcome blind, deduplicated, and readiness gated", () => {
  const source = readFileSync(new URL("./paper-markout-report.ts", import.meta.url), "utf8");
  const readinessIndex = source.indexOf("if (!readiness.readyForDescriptiveAudit)");
  const valueQueryIndex = source.indexOf("with unique_samples as materialized");
  assert.ok(readinessIndex >= 0 && valueQueryIndex > readinessIndex);
  assert.match(source, /select distinct on \(/);
  assert.match(source, /conditionId.*side/s);
  assert.match(source, /order by[\s\S]*decidedAt[\s\S]*paperTrades\.id/);
  for (const forbidden of [
    "pnl_usd",
    "graded_at",
    "control_ask_paid",
    "edge_ask",
    "p_signal",
    "bot_key",
    "status in ('won'",
    "status in ('lost'",
    "wallet_id",
    "order_id",
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      `outcome-blind markout audit must not reference ${forbidden}`,
    );
  }
});
