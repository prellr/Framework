import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  computeStrategyIndependence,
  expectedStrategyStructuralRelation,
  type StrategyDecision,
  type StrategyIdentity,
} from "./strategy-independence-model.ts";

const identities: StrategyIdentity[] = [
  { key: "a", name: "A", color: "#111111" },
  { key: "b", name: "B", color: "#222222" },
  { key: "c", name: "C", color: "#333333" },
];

const pair = (decisions: StrategyDecision[], leftKey: string, rightKey: string) =>
  computeStrategyIndependence(decisions, identities).pairs.find(
    (row) => row.leftKey === leftKey && row.rightKey === rightKey,
  )!;

test("identical subset decisions are classified as same and fully dependent", () => {
  const row = pair([
    { botKey: "a", conditionId: "m1", side: "up" },
    { botKey: "a", conditionId: "m2", side: "down" },
    { botKey: "a", conditionId: "m3", side: "up" },
    { botKey: "b", conditionId: "m1", side: "up" },
    { botKey: "b", conditionId: "m2", side: "down" },
  ], "a", "b");

  assert.equal(row.sharedMarkets, 2);
  assert.equal(row.agreement, 1);
  assert.equal(row.leftCoverage, 2 / 3);
  assert.equal(row.rightCoverage, 1);
  assert.equal(row.subsetOverlap, 1);
  assert.equal(row.dependencyStrength, 1);
  assert.equal(row.relation, "same");
});

test("exact mirrored decisions are classified as inverse, not independent", () => {
  const row = pair([
    { botKey: "a", conditionId: "m1", side: "up" },
    { botKey: "a", conditionId: "m2", side: "down" },
    { botKey: "b", conditionId: "m1", side: "down" },
    { botKey: "b", conditionId: "m2", side: "up" },
  ], "a", "b");

  assert.equal(row.agreement, 0);
  assert.equal(row.dependencyStrength, 1);
  assert.equal(row.relation, "inverse");
});

test("duplicate and invalid rows cannot inflate decision or overlap counts", () => {
  const report = computeStrategyIndependence([
    { botKey: "a", conditionId: "m1", side: "up" },
    { botKey: "a", conditionId: "m1", side: "up" },
    { botKey: "a", conditionId: "m2", side: "abstain" },
    { botKey: "unknown", conditionId: "m3", side: "down" },
    { botKey: "b", conditionId: "m1", side: "up" },
  ], identities);
  const row = report.pairs.find((item) => item.leftKey === "a" && item.rightKey === "b")!;

  assert.equal(report.decisions, 2);
  assert.equal(row.sharedMarkets, 1);
  assert.equal(row.agreement, 1);
  assert.equal(row.relation, "same");
});

test("implementation lineage is horizon-specific and independent of observed overlap", () => {
  assert.equal(
    expectedStrategyStructuralRelation("fade:5", "fadeStrong:5"),
    "expected-filter",
  );
  assert.equal(
    expectedStrategyStructuralRelation("macroRegimeRouter:15", "macroTrendSleeve:15"),
    "expected-router",
  );
  assert.equal(
    expectedStrategyStructuralRelation("drift:5", "alwaysUp:5"),
    "expected-mirror",
  );
  assert.equal(
    expectedStrategyStructuralRelation("fade:5", "fadeStrong:15"),
    null,
  );
  assert.equal(
    expectedStrategyStructuralRelation("pricerBSM:5", "pricerBSMWindowProfile:5"),
    null,
  );
});

test("an unregistered exact identity is flagged as a potential collision", () => {
  const report = computeStrategyIndependence([
    { botKey: "a", conditionId: "m1", side: "up" },
    { botKey: "a", conditionId: "m2", side: "down" },
    { botKey: "a", conditionId: "m3", side: "up" },
    { botKey: "b", conditionId: "m1", side: "up" },
    { botKey: "b", conditionId: "m2", side: "down" },
    { botKey: "b", conditionId: "m3", side: "up" },
  ], identities);
  const row = report.pairs.find((item) => item.leftKey === "a" && item.rightKey === "b")!;

  assert.equal(row.structuralRelation, null);
  assert.equal(row.unexpectedExactCollision, true);
  assert.equal(report.unexpectedExactCollisions, 1);
});

test("registered exact mirrors remain expected dependence, not collision defects", () => {
  const mirrorIdentities: StrategyIdentity[] = [
    { key: "alwaysUp:5", name: "Always up", color: "#111111" },
    { key: "drift:5", name: "Always down", color: "#222222" },
  ];
  const report = computeStrategyIndependence([
    { botKey: "alwaysUp:5", conditionId: "m1", side: "up" },
    { botKey: "alwaysUp:5", conditionId: "m2", side: "up" },
    { botKey: "alwaysUp:5", conditionId: "m3", side: "up" },
    { botKey: "drift:5", conditionId: "m1", side: "down" },
    { botKey: "drift:5", conditionId: "m2", side: "down" },
    { botKey: "drift:5", conditionId: "m3", side: "down" },
  ], mirrorIdentities);

  assert.equal(report.pairs[0]?.structuralRelation, "expected-mirror");
  assert.equal(report.pairs[0]?.unexpectedExactCollision, false);
  assert.equal(report.unexpectedExactCollisions, 0);
});

test("production independence surface is outcome-free and strategy × timeframe scoped", () => {
  const source = readFileSync(
    new URL("./strategy-independence.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /PAPER_TIMEFRAME_GATE\.evalStartMs/);
  assert.match(source, /paperTimeframeGateKey\(row\.botKey, row\.horizonMin\)/);
  assert.match(source, /paperBotBucketUniverse/);
  for (const prohibited of [
    "paperTrades.status",
    "paperTrades.askPaid",
    "paperTrades.controlAskPaid",
    "paperTrades.pnlUsd",
    "paperTrades.gradedAt",
  ]) {
    assert.equal(source.includes(prohibited), false, `${prohibited} must not be read`);
  }
});

test("strategy × timeframe independence preregistration is prospective and outcome-blind", () => {
  const source = readFileSync(
    new URL("../scripts/record-strategy-timeframe-independence.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /2026-07-24T04:00:00\.000Z/);
  assert.match(source, /Date\.now\(\) >= PAPER_TIMEFRAME_GATE\.evalStartMs/);
  assert.match(source, /post-boundary ledger rows already exist/);
  assert.match(source, /kb\.preregistration\.record/);
  for (const prohibited of [
    "paperTrades.botKey",
    "paperTrades.side",
    "paperTrades.status",
    "paperTrades.askPaid",
    "paperTrades.controlAskPaid",
    "paperTrades.pnlUsd",
    "paperTrades.gradedAt",
  ]) {
    assert.equal(source.includes(prohibited), false, `${prohibited} must not be read`);
  }
});

test("strategy × timeframe independence launch receipt remains outcome-blind", () => {
  const source = readFileSync(
    new URL("../scripts/record-strategy-timeframe-independence-launch.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /2026-07-24T04:00:00\.000Z/);
  assert.match(source, /strategyIndependenceStatus\(\)/);
  assert.match(source, /activeFiveMinute/);
  assert.match(source, /activeFifteenMinute/);
  assert.match(source, /kb\.launch-audit\.record/);
  assert.equal(source.includes("paperTrades"), false);
  for (const prohibited of [
    "status === \"won\"",
    "askPaid",
    "controlAskPaid",
    "pnlUsd",
    "gradedAt",
  ]) {
    assert.equal(source.includes(prohibited), false, `${prohibited} must not be read`);
  }
});
