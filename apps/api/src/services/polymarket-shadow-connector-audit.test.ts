import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  computeShadowConnectorAudit,
  POLYMARKET_SHADOW_CONNECTOR_AUDIT,
} from "./polymarket-shadow-connector-audit-model.ts";

const start = POLYMARKET_SHADOW_CONNECTOR_AUDIT.evalStartMs;
const telemetry = (
  accepted: boolean,
  preparationMicros: number,
  marketDataAgeMs: number | null,
  reason?: string,
) => ({
  version: "polymarket-shadow-connector-v1",
  mode: "shadow",
  accepted,
  preparationMicros,
  marketDataAgeMs,
  ...(accepted ? { orderType: "FOK" } : { reason }),
});

test("shadow connector latency audit is prospective and requires every frozen floor", () => {
  assert.equal(
    new Date(POLYMARKET_SHADOW_CONNECTOR_AUDIT.evalStartMs).toISOString(),
    "2026-07-25T00:00:00.000Z",
  );
  const rows = Array.from({ length: 500 }, (_, index) => ({
    pair: ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD", "BNB-USD"][
      index % 6
    ],
    horizonMin: index % 2 === 0 ? 5 : 15,
    windowStart: new Date(start + index * 180_000),
    decidedAt: new Date(start + index * 180_000),
    shadowConnector: {
      up: telemetry(true, 80, 400),
      down: telemetry(true, 100, 600),
    },
  }));
  const report = computeShadowConnectorAudit(rows, start + 25 * 3_600_000);
  assert.equal(report.markets, 500);
  assert.equal(report.expectedPlans, 1_000);
  assert.equal(report.telemetryPlans, 1_000);
  assert.equal(report.preparedCoverage, 1);
  assert.equal(report.readyForOperationalReview, true);
  assert.deepEqual(report.requirements, {
    boundary: true,
    markets: true,
    span: true,
    coverage: true,
    p95Preparation: true,
    p99Preparation: true,
    p95BookAge: true,
    registeredBucketsOnly: true,
  });
  assert.equal(report.buckets.length, 12);
  assert.equal(
    report.buckets.reduce((sum, bucket) => sum + bucket.markets, 0),
    500,
  );
  assert.equal(report.mappingViolations, 0);
});

test("missing, stale, mismatched, or invalid metadata fails coverage closed", () => {
  const rows = [
    {
      pair: "BTC-USD",
      horizonMin: 5,
      windowStart: new Date(start),
      decidedAt: new Date(start),
      shadowConnector: {
        up: telemetry(false, 30, null, "stale-book"),
        down: telemetry(false, 40, 100, "book-mismatch"),
      },
    },
    {
      pair: "BTC-USD",
      horizonMin: 5,
      windowStart: new Date(start + 60_000),
      decidedAt: new Date(start + 60_000),
      shadowConnector: {
        up: telemetry(false, 50, 100, "insufficient-depth"),
        down: { accepted: true },
      },
    },
  ];
  const report = computeShadowConnectorAudit(rows, start + 60_000);
  assert.equal(report.expectedPlans, 4);
  assert.equal(report.telemetryPlans, 3);
  assert.equal(report.preparedPlans, 1);
  assert.equal(report.preparedCoverage, 0.25);
  assert.deepEqual(report.rejectReasons, {
    "stale-book": 1,
    "book-mismatch": 1,
    "insufficient-depth": 1,
    "missing-telemetry": 1,
  });
  assert.equal(report.readyForOperationalReview, false);
});

test("all twelve connector buckets remain visible including zero-activity cells", () => {
  const report = computeShadowConnectorAudit([
    {
      pair: "SOL-USD",
      horizonMin: 5,
      windowStart: new Date(start),
      decidedAt: new Date(start),
      shadowConnector: {
        up: telemetry(true, 90, 250),
        down: telemetry(false, 110, 300, "minimum-size"),
      },
    },
  ], start);
  assert.equal(report.buckets.length, 12);
  const solFive = report.buckets.find(
    (bucket) => bucket.pair === "SOL-USD" && bucket.horizonMin === 5,
  );
  assert.equal(solFive?.markets, 1);
  assert.equal(solFive?.preparedCoverage, 1);
  assert.equal(solFive?.unavailablePlans, 0);
  const bnbFifteen = report.buckets.find(
    (bucket) => bucket.pair === "BNB-USD" && bucket.horizonMin === 15,
  );
  assert.equal(bnbFifteen?.markets, 0);
  assert.equal(bnbFifteen?.preparedCoverage, 0);
  assert.equal(bnbFifteen?.preparationMicros.p95, null);
});

test("unregistered asset or timeframe rows fail operational readiness closed", () => {
  const report = computeShadowConnectorAudit([
    {
      pair: "ARB-USD",
      horizonMin: 60,
      windowStart: new Date(start),
      decidedAt: new Date(start),
      shadowConnector: {
        up: telemetry(true, 90, 250),
        down: telemetry(true, 110, 300),
      },
    },
  ], start + 25 * 3_600_000);
  assert.equal(report.mappingViolations, 1);
  assert.equal(report.requirements.registeredBucketsOnly, false);
  assert.equal(report.readyForOperationalReview, false);
});

test("latency audit query is read-only and cannot inspect trading evidence", () => {
  const source = readFileSync(
    new URL("./polymarket-shadow-connector-audit.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /jsonb_build_object/);
  assert.match(source, /shadowConnector,up,preparationMicros/);
  assert.match(source, /shadowConnector,down,marketDataAgeMs/);
  assert.match(source, /eq\(paperTrades\.botKey, "drift"\)/);
  assert.match(source, /POLYMARKET_SHADOW_CONNECTOR_AUDIT\.evalStartMs/);
  for (const prohibited of [
    "paperTrades.side",
    "paperTrades.askPaid",
    "paperTrades.controlAskPaid",
    "paperTrades.status",
    "paperTrades.pnlUsd",
    "paperTrades.gradedAt",
    "effectiveVwap",
    "worstPrice",
    "levelsConsumed",
  ]) {
    assert.equal(source.includes(prohibited), false, `${prohibited} must not be read`);
  }
});

test("protected Polymarket router exposes only the read-only shadow connector audit", () => {
  const source = readFileSync(
    new URL("../routers/polymarket.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /shadowConnectorAudit:\s*protectedProcedure\.query\(\(\)\s*=>\s*polymarketShadowConnectorAudit\(\)\)/,
  );
  assert.doesNotMatch(source, /shadowConnector(?:Place|Submit|Cancel|Sign|Authenticate)/);
});

test("latency audit preregistration is prospective, metadata-only, and non-executing", () => {
  const source = readFileSync(
    new URL("../scripts/record-polymarket-shadow-connector-latency-audit-v1.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /2026-07-25T00:00:00\.000Z/);
  assert.match(source, /Date\.now\(\) >= POLYMARKET_SHADOW_CONNECTOR_AUDIT\.evalStartMs/);
  assert.match(source, /post-boundary shadow connector rows already exist/);
  assert.match(source, /kb\.preregistration\.record/);
  assert.match(source, /submissionEnabled/);
  for (const prohibited of [
    "paperTrades.side",
    "paperTrades.askPaid",
    "paperTrades.controlAskPaid",
    "paperTrades.status",
    "paperTrades.pnlUsd",
    "paperTrades.gradedAt",
    "paperTrades.modelMeta",
  ]) {
    assert.equal(source.includes(prohibited), false, `${prohibited} must not be read`);
  }
});

test("shadow connector launch receipt is post-boundary, telemetry-only, and non-executing", () => {
  const source = readFileSync(
    new URL("../scripts/record-polymarket-shadow-connector-latency-launch.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /2026-07-25T00:00:00\.000Z/);
  assert.match(
    source,
    /Date\.now\(\) < POLYMARKET_SHADOW_CONNECTOR_AUDIT\.evalStartMs \+ graceMs/,
  );
  assert.match(source, /kb\.launch-audit\.record/);
  assert.match(source, /allFiveMinutePairsPresent/);
  assert.match(source, /allFifteenMinutePairsPresent/);
  assert.match(source, /twoValidTelemetryRecordsPerMarket/);
  assert.match(source, /authenticationDisabled/);
  assert.match(source, /signingDisabled/);
  assert.match(source, /submissionDisabled/);
  for (const prohibited of [
    "paperTrades.side",
    "paperTrades.askPaid",
    "paperTrades.controlAskPaid",
    "paperTrades.status",
    "paperTrades.pnlUsd",
    "paperTrades.gradedAt",
    "effectiveVwap",
    "worstPrice",
    "levelsConsumed",
  ]) {
    assert.equal(source.includes(prohibited), false, `${prohibited} must not be read`);
  }
});
