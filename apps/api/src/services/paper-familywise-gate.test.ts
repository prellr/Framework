import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  applyPaperFamilywiseGate,
  holmAdjust,
  PAPER_FAMILYWISE_GATE,
  PAPER_FAMILYWISE_HYPOTHESES,
  PAPER_FAMILYWISE_OPPOSITE_KEYS,
} from "./paper-familywise-gate.ts";
import type { PaperGateBotResult } from "./paper-floor-gate.ts";

const MACRO_KEYS = new Set([
  "macroUpOnly:5",
  "macroUpOnly:15",
  "macroDownOnly:5",
  "macroDownOnly:15",
]);

function row(key: string, pOneSided = 1): PaperGateBotResult {
  return {
    key,
    name: key,
    evalStartMs: PAPER_FAMILYWISE_GATE.evalStartMs,
    markets: 1_500,
    spanDays: 5,
    decisions: 200,
    pairedBookDecisions: 200,
    resolvedDecisions: 200,
    bets: 200,
    pairedMarkets: 200,
    residual: {
      mean: 0.02,
      lo: 0.005,
      hi: 0.035,
      clusters: 100,
      pOneSided,
    },
    sessions: [
      { key: "night23-07", label: "night", bets: 100, mean: 0.02, qualifies: true },
      { key: "day07-19", label: "day", bets: 100, mean: 0.02, qualifies: true },
      { key: "eve19-23", label: "evening", bets: 0, mean: null, qualifies: false },
    ],
    positiveQualifyingSessions: 2,
    qualifyingSessions: 2,
    requirements: { markets: true, span: true, bets: true, sessions: true },
    state: "passing",
  };
}

test("familywise v1 freezes the complete pre-boundary strategy × timeframe family", () => {
  assert.equal(PAPER_FAMILYWISE_GATE.version, "updown-familywise-verdict-gate-v1");
  assert.equal(new Date(PAPER_FAMILYWISE_GATE.evalStartMs).toISOString(), "2026-07-25T00:00:00.000Z");
  assert.equal(PAPER_FAMILYWISE_HYPOTHESES.length, 57);
  assert.equal(new Set(PAPER_FAMILYWISE_HYPOTHESES).size, 57);
  assert.ok(PAPER_FAMILYWISE_HYPOTHESES.includes("pricerMC5mCobraNight:5"));
  assert.deepEqual(PAPER_FAMILYWISE_OPPOSITE_KEYS, [...MACRO_KEYS]);
});

test("Holm adjustment is monotone and controls against the full frozen family", () => {
  const adjusted = holmAdjust([
    { key: "a", p: 0.01 },
    { key: "b", p: 0.03 },
    { key: "c", p: 0.04 },
  ]);
  assert.deepEqual(adjusted.map((item) => item.key), ["a", "b", "c"]);
  assert.deepEqual(adjusted.map((item) => item.adjustedP), [0.03, 0.06, 0.06]);
  assert.ok(adjusted.every((item, index) => index === 0 || item.adjustedP >= adjusted[index - 1].adjustedP));
});

test("familywise verdict replaces macro comparators and requires Holm-adjusted significance", () => {
  const strongestKey = "pricerMC:5";
  const ordinary = PAPER_FAMILYWISE_HYPOTHESES
    .filter((key) => !MACRO_KEYS.has(key))
    .map((key) => row(key, key === strongestKey ? 0.0001 : 1));
  const macro = PAPER_FAMILYWISE_HYPOTHESES
    .filter((key) => MACRO_KEYS.has(key))
    .map((key) => row(key, 1));
  const gate = applyPaperFamilywiseGate(
    ordinary,
    macro,
    PAPER_FAMILYWISE_GATE.evalStartMs + 1,
  );
  assert.equal(gate.familySize, 57);
  const strongest = gate.hypotheses.find((item) => item.key === strongestKey);
  assert.ok(strongest);
  assert.ok(Math.abs((strongest.holmAdjustedP ?? 0) - 0.0057) < 1e-12);
  assert.equal(strongest.state, "passing");
  assert.equal(strongest.comparator, "same-tick Always Down");
  const macroUp = gate.hypotheses.find((item) => item.key === "macroUpOnly:5");
  assert.equal(macroUp?.comparator, "same-tick opposite side");
  assert.equal(macroUp?.state, "failing");
});

test("familywise gate fails closed on a missing or unregistered hypothesis", () => {
  const ordinary = PAPER_FAMILYWISE_HYPOTHESES
    .filter((key) => !MACRO_KEYS.has(key))
    .map((key) => row(key));
  const macro = PAPER_FAMILYWISE_HYPOTHESES
    .filter((key) => MACRO_KEYS.has(key))
    .map((key) => row(key));
  assert.throws(
    () => applyPaperFamilywiseGate(ordinary.slice(1), macro),
    /missing frozen hypothesis/,
  );
  assert.throws(
    () => applyPaperFamilywiseGate([...ordinary, row("lateChild:5")], macro),
    /unregistered hypotheses/,
  );
});

test("familywise launch receipt is opportunity-complete and outcome-blind", () => {
  const source = readFileSync(
    new URL("../scripts/record-paper-familywise-gate-launch.ts", import.meta.url),
    "utf8",
  );
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
  assert.match(source, /graceMs = 16 \* 60_000/);
  assert.match(source, /everyFrozenHypothesisHasOpportunity/);
  assert.match(source, /registeredControlBucketsOnly/);
  assert.match(source, /registeredFrozenBucketsOnly/);
  assert.match(source, /row\.decidedAt\.getTime\(\) < PAPER_FAMILYWISE_GATE\.evalStartMs/);
  assert.match(source, /no malformed or pre-boundary decision metadata/);
  assert.match(source, /cobraChildHadNoPreBoundaryRows/);
  assert.match(source, /No candidate was required to trade/);
});
