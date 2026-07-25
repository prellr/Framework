import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  summarizeTradeFlowCapacity,
  summarizeTradeFlowStorage,
  summarizeTradeFlowOperationalHealth,
  summarizeTradeFlowTerminalVerification,
  TRADE_FLOW_CUMULATIVE_CACHE_MS,
  TRADE_FLOW_OPERATIONAL_HEALTH,
} from "./polymarket-trade-flow-report.ts";

test("trade-flow cumulative readiness is cached without weakening live health", () => {
  assert.equal(TRADE_FLOW_CUMULATIVE_CACHE_MS, 15 * 60_000);
});

test("trade-flow cumulative rollup uses one outcome-blind per-market scan", () => {
  const source = readFileSync(
    new URL("./polymarket-trade-flow-report.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /with per_market as materialized/);
  assert.match(source, /group by grouping sets \(\(\), \(pair\)\)/);
  assert.match(source, /min\(pair\) <> max\(pair\)/);
  assert.equal((source.match(/from polymarket_trade_flow_event/g) ?? []).length, 1);
});

test("trade-flow live health keeps its timestamp indexable as the tape grows", () => {
  const source = readFileSync(
    new URL("./polymarket-trade-flow-report.ts", import.meta.url),
    "utf8",
  );
  assert.ok(source.includes("statement_timestamp()"));
  assert.equal(source.includes("clock_timestamp()"), false);
});

test("trade-flow storage telemetry reports outcome-blind table growth", () => {
  const storage = summarizeTradeFlowStorage({
    rawEvents: 120_000,
    relationBytes: 150_000_000,
    spanDays: 0.125,
  });
  assert.equal(storage.relationBytes, 150_000_000);
  assert.equal(storage.bytesPerRow, 1_250);
  assert.equal(storage.rowsPerDay, 960_000);
  assert.equal(storage.bytesPerDay, 1_200_000_000);
});

test("trade-flow storage telemetry fails safe on empty or malformed inputs", () => {
  const storage = summarizeTradeFlowStorage({
    rawEvents: -1,
    relationBytes: Number.NaN,
    spanDays: 0,
  });
  assert.deepEqual(storage, {
    relationBytes: 0,
    bytesPerRow: 0,
    rowsPerDay: 0,
    bytesPerDay: 0,
  });
});

test("trade-flow capacity projects only storage growth needed to reach the frozen span floor", () => {
  const capacity = summarizeTradeFlowCapacity({
    availableBytes: 80_000_000_000,
    relationBytes: 1_000_000_000,
    bytesPerDay: 1_200_000_000,
    spanDays: 1,
    floorSpanDays: 7,
  });
  assert.deepEqual(capacity, {
    availableBytes: 80_000_000_000,
    runwayDays: 80_000_000_000 / 1_200_000_000,
    remainingSpanDays: 6,
    projectedAdditionalBytesToFloor: 7_200_000_000,
    projectedRelationBytesAtFloor: 8_200_000_000,
    projectedAvailableBytesAtFloor: 72_800_000_000,
  });
});

test("trade-flow capacity remains neutral when filesystem telemetry is unavailable", () => {
  const capacity = summarizeTradeFlowCapacity({
    availableBytes: Number.NaN,
    relationBytes: -1,
    bytesPerDay: 0,
    spanDays: 8,
    floorSpanDays: 7,
  });
  assert.deepEqual(capacity, {
    availableBytes: null,
    runwayDays: null,
    remainingSpanDays: 0,
    projectedAdditionalBytesToFloor: 0,
    projectedRelationBytesAtFloor: 0,
    projectedAvailableBytesAtFloor: null,
  });
});

test("trade-flow operational health stays separate from readiness and passes a fresh caught-up tape", () => {
  const health = summarizeTradeFlowOperationalHealth({
    lastEventAgeSec: 2,
    recentRawEvents: 1_000,
    p95IngestionLatencyMs: 1_200,
    p99IngestionLatencyMs: 8_700,
    slowIngestionEvents: 3,
    oldPendingEvents: 0,
    overduePendingEvents: 0,
    retryDeferredPendingEvents: 0,
    oldestPendingAgeSec: 45,
  });
  assert.equal(health.healthy, true);
  assert.equal(health.collectionFresh, true);
  assert.equal(health.latencyHealthy, true);
  assert.equal(health.verifierCaughtUp, true);
  assert.equal(health.slowIngestionMs, 10_000);
});

test("trade-flow operational health fails closed on stale collection, latency, or old receipts", () => {
  const health = summarizeTradeFlowOperationalHealth({
    lastEventAgeSec: TRADE_FLOW_OPERATIONAL_HEALTH.maxLastEventAgeSec + 1,
    recentRawEvents: 100,
    p95IngestionLatencyMs: 10_000,
    p99IngestionLatencyMs: TRADE_FLOW_OPERATIONAL_HEALTH.maxP99IngestionMs + 1,
    slowIngestionEvents: 20,
    oldPendingEvents: 1,
    overduePendingEvents: 1,
    retryDeferredPendingEvents: 0,
    oldestPendingAgeSec: TRADE_FLOW_OPERATIONAL_HEALTH.pendingAgeWarningSec + 1,
  });
  assert.equal(health.healthy, false);
  assert.equal(health.collectionFresh, false);
  assert.equal(health.latencyHealthy, false);
  assert.equal(health.verifierCaughtUp, false);
});

test("trade-flow operational health rejects missing or malformed telemetry", () => {
  const health = summarizeTradeFlowOperationalHealth({
    lastEventAgeSec: Number.NaN,
    recentRawEvents: -1,
    p95IngestionLatencyMs: Number.NaN,
    p99IngestionLatencyMs: null,
    slowIngestionEvents: -1,
    oldPendingEvents: -1,
    overduePendingEvents: -1,
    retryDeferredPendingEvents: -1,
    oldestPendingAgeSec: -1,
  });
  assert.equal(health.healthy, false);
  assert.equal(health.lastEventAgeSec, null);
  assert.equal(health.p95IngestionLatencyMs, null);
  assert.equal(health.p99IngestionLatencyMs, null);
  assert.equal(health.recentRawEvents, 0);
  assert.equal(health.oldPendingEvents, 0);
});

test("trade-flow health distinguishes a caught-up verifier from unavailable source receipts", () => {
  const health = summarizeTradeFlowOperationalHealth({
    lastEventAgeSec: 2,
    recentRawEvents: 1_000,
    p95IngestionLatencyMs: 1_200,
    p99IngestionLatencyMs: 8_700,
    slowIngestionEvents: 3,
    oldPendingEvents: 12,
    overduePendingEvents: 0,
    retryDeferredPendingEvents: 12,
    oldestPendingAgeSec: 4_000,
  });
  assert.equal(health.verifierCaughtUp, true);
  assert.equal(health.sourceReceiptsHealthy, false);
  assert.equal(health.healthy, false);
  assert.equal(health.verificationInitialDelaySec, 60);
  assert.equal(health.verificationRetryBaseSec, 600);
  assert.equal(health.verificationRetryMaxSec, 21_600);
});

test("ambiguous provenance remains in the frozen terminal verification denominator", () => {
  assert.deepEqual(summarizeTradeFlowTerminalVerification({
    verifiedEvents: 95,
    mismatchEvents: 1,
    revertedEvents: 1,
    ambiguousHashEvents: 3,
  }), {
    terminalEvents: 100,
    chainVerificationRate: 0.95,
  });
});

test("terminal verification summary fails safe on malformed counts", () => {
  assert.deepEqual(summarizeTradeFlowTerminalVerification({
    verifiedEvents: Number.NaN,
    mismatchEvents: -1,
    revertedEvents: Number.POSITIVE_INFINITY,
    ambiguousHashEvents: -5,
  }), {
    terminalEvents: 0,
    chainVerificationRate: 0,
  });
});

test("trade-flow schema permits explicit ambiguous quarantine without weakening verification", () => {
  const source = readFileSync(
    new URL("../../../../packages/db/src/schema/polymarket-trade-flow-events.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /'ambiguous_hash'/);
  assert.match(source, /pm_trade_flow_chain_status_chk/);
  const methodConstraint = source.match(
    /"pm_trade_flow_verification_method_chk",([\s\S]*?)\n\s*\),/,
  )?.[1] ?? "";
  assert.match(methodConstraint, /'source_hash','data_api_replacement'/);
  assert.doesNotMatch(methodConstraint, /ambiguous/);
});
