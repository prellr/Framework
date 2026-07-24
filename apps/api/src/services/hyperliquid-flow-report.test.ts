import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { HYPERLIQUID_FLOW_TAPE } from "./hl-rtds.ts";
import {
  assertOutcomeBlindFlowStatus,
  hyperliquidFlowReady,
  summarizeHyperliquidCoverage,
} from "./hyperliquid-flow-report.ts";

const readyInput = {
  usableRows: HYPERLIQUID_FLOW_TAPE.minUsableRows,
  resolvedMarkets: HYPERLIQUID_FLOW_TAPE.minResolvedMarkets,
  spanDays: HYPERLIQUID_FLOW_TAPE.minSpanDays,
  coverage: HYPERLIQUID_FLOW_TAPE.minCoverage,
  weakestBucketMarkets: HYPERLIQUID_FLOW_TAPE.minMarketsPerBucket,
  healthy: true,
};

test("Hyperliquid flow readiness requires every frozen floor", () => {
  assert.equal(hyperliquidFlowReady(readyInput), true);
  for (const [key, value] of Object.entries({
    usableRows: HYPERLIQUID_FLOW_TAPE.minUsableRows - 1,
    resolvedMarkets: HYPERLIQUID_FLOW_TAPE.minResolvedMarkets - 1,
    spanDays: HYPERLIQUID_FLOW_TAPE.minSpanDays - 0.001,
    coverage: HYPERLIQUID_FLOW_TAPE.minCoverage - Number.EPSILON,
    weakestBucketMarkets: HYPERLIQUID_FLOW_TAPE.minMarketsPerBucket - 1,
    healthy: false,
  })) {
    assert.equal(
      hyperliquidFlowReady({ ...readyInput, [key]: value }),
      false,
      `${key} must fail closed`,
    );
  }
});

test("Hyperliquid flow boundary is prospective and the tape has no directional rule", () => {
  assert.equal(
    new Date(HYPERLIQUID_FLOW_TAPE.evalStartMs).toISOString(),
    "2026-07-24T02:00:00.000Z",
  );
  assert.equal(HYPERLIQUID_FLOW_TAPE.version, "updown-hyperliquid-taker-flow-tape-v2");
  assert.equal("side" in HYPERLIQUID_FLOW_TAPE, false);
  assert.equal("threshold" in HYPERLIQUID_FLOW_TAPE, false);
  assert.equal(HYPERLIQUID_FLOW_TAPE.maxLastTradeAgeSec, 60);
  assert.equal(HYPERLIQUID_FLOW_TAPE.maxTransportLagMs, 5_000);
});

test("Hyperliquid readiness disclosure fails closed on signs, outcomes, or performance", () => {
  assert.doesNotThrow(() =>
    assertOutcomeBlindFlowStatus({
      usableRows: 20_000,
      resolvedMarkets: 1_500,
      operationalHealth: { maxTransportLagMs: 5_000 },
      readyForOutcomeFreeDistributionAudit: false,
    }),
  );
  for (const forbidden of [
    { imbalance60s: 0.2 },
    { nested: { outcome: "UP" } },
    { strategy: { chosenSide: "DOWN" } },
    { performance: { pnl: 10, winRate: 0.6 } },
  ]) {
    assert.throws(() => assertOutcomeBlindFlowStatus(forbidden), /readiness disclosure blocked/);
  }
});

test("Hyperliquid coverage decomposition is exact and preserves the frozen denominator", () => {
  const breakdown = summarizeHyperliquidCoverage({
    eligibleRows: 1_000,
    usableRows: 940,
    taggedRows: 970,
    missingSnapshotRows: 30,
    wrongVersionRows: 0,
    incompleteTaggedRows: 5,
    staleTradeRows: 10,
    delayedTransportRows: 15,
  });
  assert.deepEqual(breakdown, {
    taggedRows: 970,
    completeTaggedRows: 965,
    missingSnapshotRows: 30,
    wrongVersionRows: 0,
    incompleteTaggedRows: 5,
    staleTradeRows: 10,
    delayedTransportRows: 15,
    taggedCoverage: 0.97,
    completeTaggedUsableCoverage: 940 / 965,
    accountedRows: 1_000,
    exactAccounting: true,
  });
  assert.equal(
    summarizeHyperliquidCoverage({
      eligibleRows: 1_000,
      usableRows: 940,
      taggedRows: 970,
      missingSnapshotRows: 29,
      wrongVersionRows: 0,
      incompleteTaggedRows: 5,
      staleTradeRows: 10,
      delayedTransportRows: 15,
    }).exactAccounting,
    false,
  );
});

test("Hyperliquid v2 treats quiet subwindows as sparse flow while enforcing 60s timing", () => {
  const source = readFileSync(new URL("./hyperliquid-flow-report.ts", import.meta.url), "utf8");
  const usableBlock = source.match(/const usableFlow = and\([\s\S]*?\n  \);/)?.[0] ?? "";
  const completeBlock =
    source.match(/const completeFlowFields = and\([\s\S]*?\n  \);/)?.[0] ?? "";
  assert.doesNotMatch(usableBlock, /hlFlowImbalance5s/);
  assert.doesNotMatch(usableBlock, /hlFlowImbalance30s/);
  assert.match(completeBlock, /hlFlowImbalance60s/);
  assert.match(
    usableBlock,
    /completeTaggedFlow[\s\S]*?hlFlowReceiveAgeSec,[\s\S]*?HYPERLIQUID_FLOW_TAPE\.maxLastTradeAgeSec/,
  );
  assert.match(
    source,
    /resolvedMarkets:[\s\S]*?labelStatus} = 'resolved'[\s\S]*?and \$\{usableFlow\}/,
  );
  assert.match(source, /missingSnapshotRows/);
  assert.match(source, /wrongVersionRows/);
  assert.match(source, /incompleteTaggedRows/);
  assert.match(source, /staleTradeRows/);
  assert.match(source, /delayedTransportRows/);
  assert.match(source, /coverageBreakdown\.exactAccounting/);
});
