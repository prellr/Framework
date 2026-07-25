import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT,
  expectedClobChainPressureConcordanceBucketKeys,
} from "./clob-chain-pressure-concordance-contract.ts";
import {
  assertOutcomeFreeClobChainPressureConcordanceReport,
  clobChainPressureConcordanceReportFromRows,
  clobChainPressureMatchedReadinessFromRows,
} from "./clob-chain-pressure-concordance-audit.ts";

test("concordance contract freezes the near-synchronous clock without claiming exact alignment", () => {
  assert.equal(
    CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.version,
    "updown-clob-chain-pressure-concordance-audit-v1",
  );
  assert.equal(CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.anchorSampleMinute, 0);
  assert.equal(CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.anchorOffsetMinSec, 55);
  assert.equal(
    CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.anchorOffsetMaxExclusiveSec,
    60,
  );
  assert.equal(CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.minimumClockOverlapSec, 55);
  assert.equal(CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.maximumClockMismatchSec, 5);
  assert.equal(CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.expectedBuckets, 12);
  assert.equal(expectedClobChainPressureConcordanceBucketKeys().length, 12);
  assert.deepEqual(CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.horizons, [5, 15]);
});

test("matched readiness requires coverage, span, and all independent asset-horizon buckets", () => {
  const aggregate = {
    eligible_anchors: 1_300,
    usable_anchors: 1_250,
    matched_markets: 1_200,
    first_window_start: new Date("2026-07-24T07:00:00Z"),
    last_window_start: new Date("2026-07-29T07:00:00Z"),
  };
  const rows = expectedClobChainPressureConcordanceBucketKeys().map((key) => {
    const [pair, horizon] = key.split(":");
    return { pair, horizon_min: Number(horizon), matched_markets: 100 };
  });
  const ready = clobChainPressureMatchedReadinessFromRows(aggregate, rows);
  assert.equal(ready.anchorCoverage, 1_250 / 1_300);
  assert.equal(ready.weakestBucketMarkets, 100);
  assert.equal(ready.readyForAggregateConcordance, true);

  assert.equal(
    clobChainPressureMatchedReadinessFromRows(aggregate, rows.slice(0, -1))
      .readyForAggregateConcordance,
    false,
  );
  assert.equal(
    clobChainPressureMatchedReadinessFromRows(
      { ...aggregate, usable_anchors: 1_000 },
      rows,
    ).readyForAggregateConcordance,
    false,
  );
});

function concordanceRow(pair: string | null, horizonMin: number | null) {
  return {
    pair,
    horizon_min: horizonMin,
    matched_markets: pair == null ? 1_200 : 100,
    nonzero_pairs: pair == null ? 1_000 : 80,
    pearson_correlation: 0.2,
    spearman_correlation: 0.25,
    nonzero_sign_agreement: 0.56,
    proxy_zero_rate: 0.1,
    reference_zero_rate: 0.05,
  };
}

test("concordance report exposes pooled and complete twelve-bucket aggregates only", () => {
  const rows = [
    concordanceRow(null, null),
    ...expectedClobChainPressureConcordanceBucketKeys().map((key) => {
      const [pair, horizon] = key.split(":");
      return concordanceRow(pair, Number(horizon));
    }),
  ];
  const report = clobChainPressureConcordanceReportFromRows(rows);
  assert.equal(report.pooled.matchedMarkets, 1_200);
  assert.equal(report.buckets.length, 12);
  assert.equal(report.buckets[0].metrics.spearmanCorrelation, 0.25);
  assert.throws(
    () => clobChainPressureConcordanceReportFromRows(rows.slice(0, -1)),
    /omitted buckets/,
  );
});

test("concordance disclosure rejects outcome, performance, account, and order fields", () => {
  assert.doesNotThrow(() =>
    assertOutcomeFreeClobChainPressureConcordanceReport({
      spearmanCorrelation: 0.2,
      nonzeroSignAgreement: 0.55,
    }),
  );
  for (const forbidden of [
    { outcome: "UP" },
    { paperPnl: 1 },
    { chosenSide: "DOWN" },
    { transactionHash: "0x" },
    { wallet: "x" },
    { orderId: "y" },
  ]) {
    assert.throws(
      () => assertOutcomeFreeClobChainPressureConcordanceReport(forbidden),
      /disclosure blocked/,
    );
  }
});

test("source values stay behind both source gates and a count-only matched-panel gate", () => {
  const source = readFileSync(
    new URL("./clob-chain-pressure-concordance-audit.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /clobTape\.readyForOutcomeFreeDistributionAudit\s*&&\s*referenceTape\.readyForOutcomeFreeDistributionAudit/,
  );
  assert.match(
    source,
    /inheritedSourcesReady\s*\?\s*await readMatchedReadiness\(\)\s*:\s*null/,
  );
  assert.match(
    source,
    /matchedReadiness\?\.readyForAggregateConcordance\s*\?\s*await readAggregateConcordance\(\)\s*:\s*null/,
  );
  const readinessSection = source.slice(
    source.indexOf("const readinessPanelSql"),
    source.indexOf("const valuePanelSql"),
  );
  assert.doesNotMatch(readinessSection, /sum\(canonical_sign/);
  assert.doesNotMatch(readinessSection, /as reference_pressure/);
  assert.match(source, /sample_minute =/);
  assert.match(source, /extract\(epoch from \(captured_at - window_start\)\)/);
  assert.match(source, /chain_status = 'verified'/);
  assert.match(source, /chain_confirmations >= 20/);
  assert.match(source, /corr\(proxy_pressure, reference_pressure\)/);
  assert.match(source, /where proxy_pressure <> 0 and reference_pressure <> 0/);
  assert.doesNotMatch(source, /\bpaper_(?:bet|ledger|decision)\b/i);
  assert.doesNotMatch(source, /\b(placeOrder|submitOrder|cancelOrder|signTypedData)\b/);
});

test("preregistration is metadata-only and cannot inspect either value tape", () => {
  const source = readFileSync(
    new URL(
      "../scripts/record-clob-chain-pressure-concordance-audit-v1.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /Outcome-free CLOB\/chain pressure concordance audit v1/);
  assert.doesNotMatch(
    source,
    /polymarket_state_snapshot|polymarket_trade_flow_event|db\.execute/,
  );
  assert.doesNotMatch(source, /\b(placeOrder|submitOrder|cancelOrder|privateKey)\b/);

  const router = readFileSync(
    new URL("../routers/polymarket.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    router,
    /clobChainPressureConcordanceAudit:\s*protectedProcedure\.query/,
  );
});
