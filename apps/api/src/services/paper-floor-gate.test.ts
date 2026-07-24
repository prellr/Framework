import assert from "node:assert/strict";
import test from "node:test";
import {
  clusterBootstrap,
  computePaperGate,
  contemporaneousDownNet,
  contractNet,
  PAPER_GATE,
  studentTUpperTail,
  type PaperGateConfig,
  type PaperGateTrade,
} from "./paper-floor-gate.ts";

test("gate v3 has the preregistered fee-corrected boundary and unchanged statistical floors", () => {
  assert.equal(PAPER_GATE.version, "updown-verdict-gate-v3");
  assert.equal(PAPER_GATE.evalStartMs, 1_784_801_700_000);
  assert.equal(PAPER_GATE.minMarkets, 1_500);
  assert.equal(PAPER_GATE.minSpanDays, 5);
  assert.equal(PAPER_GATE.minBets, 200);
  assert.equal(PAPER_GATE.minResidual, 0.015);
  assert.equal(PAPER_GATE.bootIters, 1_000);
  assert.equal(PAPER_GATE.sessionMinBets, 50);
  assert.equal(PAPER_GATE.sessionsNeeded, 2);
});

test("contractNet measures per-contract net at the actual ask", () => {
  assert.equal(contractNet("won", 0.62), 0.38);
  assert.equal(contractNet("lost", 0.62), -0.62);
  assert.equal(contractNet("open", 0.62), null);
  assert.equal(contractNet("won", 1), null);
});

test("contemporaneous control infers the always-down outcome from the bot resolution", () => {
  const base = {
    id: 1,
    botKey: "candidate",
    conditionId: "m1",
    horizonMin: 5,
    windowStartMs: 0,
    decidedAtMs: 0,
    askPaid: 0.4,
    controlAskPaid: 0.7,
  };
  assert.equal(contemporaneousDownNet({ ...base, side: "up", status: "won" }), -0.7);
  assert.ok(Math.abs((contemporaneousDownNet({ ...base, side: "up", status: "lost" }) ?? 0) - 0.3) < 1e-12);
  assert.ok(Math.abs((contemporaneousDownNet({ ...base, side: "down", status: "won" }) ?? 0) - 0.3) < 1e-12);
  assert.equal(contemporaneousDownNet({ ...base, side: "down", status: "lost" }), -0.7);
  assert.equal(contemporaneousDownNet({ ...base, side: "up", status: "open" }), null);
  assert.equal(contemporaneousDownNet({ ...base, side: "up", status: "won", controlAskPaid: null }), null);
});

test("cluster bootstrap is deterministic and clusters same-window bets", () => {
  const values = [
    { value: 0.2, cluster: 1 },
    { value: 0.4, cluster: 1 },
    { value: -0.1, cluster: 2 },
    { value: 0.3, cluster: 3 },
  ];
  const a = clusterBootstrap(values, 200, "stable");
  const b = clusterBootstrap(values, 200, "stable");
  assert.deepEqual(a, b);
  assert.equal(a?.clusters, 3);
  assert.ok(Math.abs((a?.mean ?? 0) - 0.2) < 1e-12);
  assert.ok((a?.pOneSided ?? 1) < 0.5);
});

test("Student-t upper tail matches standard one-sided critical values", () => {
  assert.equal(studentTUpperTail(0, 10), 0.5);
  assert.ok(Math.abs((studentTUpperTail(1.812461, 10) ?? 0) - 0.05) < 0.0001);
  assert.ok(Math.abs((studentTUpperTail(-1.812461, 10) ?? 0) - 0.95) < 0.0001);
  assert.equal(studentTUpperTail(1, 0), null);
});

test("paper gate uses each bot's same-tick control and enforces sample/session requirements", () => {
  const start = Date.UTC(2026, 6, 23, 0, 0, 0);
  const config: PaperGateConfig = {
    ...PAPER_GATE,
    version: "test",
    evalStartMs: start,
    minMarkets: 6,
    minSpanDays: 0,
    minBets: 6,
    minResidual: 0.015,
    bootIters: 200,
    sessionMinBets: 2,
    sessionsNeeded: 2,
  };
  const hours = [1, 2, 8, 9, 20, 21]; // all three UK sessions; two bets each
  const trades: PaperGateTrade[] = [];
  hours.forEach((hour, index) => {
    const conditionId = `m${index}`;
    const t = start + hour * 3_600_000;
    // Deliberately make the observer's old window-open ask very different. Gate v3 must ignore it
    // for residual scoring and use the candidate row's contemporaneous controlAskPaid instead.
    trades.push({ id: index * 2 + 1, botKey: "drift", conditionId, horizonMin: 5, windowStartMs: t, decidedAtMs: t, side: "down", askPaid: 0.9, controlAskPaid: 0.9, status: "lost" });
    trades.push({ id: index * 2 + 2, botKey: "candidate", conditionId, horizonMin: 5, windowStartMs: t, decidedAtMs: t, side: "up", askPaid: 0.5, controlAskPaid: 0.5, status: "won" });
  });
  const gate = computePaperGate(
    trades,
    [
      { key: "candidate", name: "Candidate", evalStartMs: start },
      { key: "drift", name: "Drift", evalStartMs: start, control: true },
    ],
    start + 24 * 3_600_000,
    config,
  );
  const result = gate.bots[0];
  assert.equal(result.markets, 6);
  assert.equal(result.bets, 6);
  assert.equal(result.qualifyingSessions, 3);
  assert.equal(result.positiveQualifyingSessions, 3);
  assert.equal(result.residual?.mean, 1);
  assert.equal(result.state, "passing");
});

test("paper gate excludes exploration rows before a bot's own registration", () => {
  const globalStart = Date.UTC(2026, 6, 23, 0, 0, 0);
  const botStart = globalStart + 3_600_000;
  const trades: PaperGateTrade[] = [
    { id: 1, botKey: "drift", conditionId: "old", horizonMin: 5, windowStartMs: globalStart, decidedAtMs: globalStart, side: "down", askPaid: 0.5, controlAskPaid: 0.5, status: "lost" },
    { id: 2, botKey: "candidate", conditionId: "old", horizonMin: 5, windowStartMs: globalStart, decidedAtMs: globalStart, side: "up", askPaid: 0.5, controlAskPaid: 0.5, status: "won" },
    { id: 3, botKey: "drift", conditionId: "new", horizonMin: 5, windowStartMs: botStart, decidedAtMs: botStart, side: "down", askPaid: 0.5, controlAskPaid: 0.5, status: "lost" },
    { id: 4, botKey: "candidate", conditionId: "new", horizonMin: 5, windowStartMs: botStart, decidedAtMs: botStart, side: "up", askPaid: 0.5, controlAskPaid: 0.5, status: "won" },
  ];
  const result = computePaperGate(
    trades,
    [
      { key: "candidate", name: "Candidate", evalStartMs: botStart },
      { key: "drift", name: "Drift", evalStartMs: globalStart, control: true },
    ],
    botStart + 1,
    { ...PAPER_GATE, evalStartMs: globalStart },
  ).bots[0];
  assert.equal(result.markets, 1);
  assert.equal(result.bets, 1);
  assert.equal(result.pairedMarkets, 1);
});

test("paper gate counts only markets in a bot's preregistered eligibility universe", () => {
  const start = Date.UTC(2026, 6, 23, 4, 30, 0);
  const trades: PaperGateTrade[] = [
    { id: 1, botKey: "drift", conditionId: "five", horizonMin: 5, windowStartMs: start, decidedAtMs: start, side: "down", askPaid: 0.5, controlAskPaid: 0.5, status: "lost" },
    { id: 2, botKey: "drift", conditionId: "fifteen", horizonMin: 15, windowStartMs: start, decidedAtMs: start, side: "down", askPaid: 0.5, controlAskPaid: 0.5, status: "lost" },
    // Include both candidate rows to prove the evaluator itself enforces the registered universe,
    // rather than trusting the collector to have filtered perfectly.
    { id: 3, botKey: "candidate", conditionId: "five", horizonMin: 5, windowStartMs: start, decidedAtMs: start, side: "up", askPaid: 0.5, controlAskPaid: 0.5, status: "won" },
    { id: 4, botKey: "candidate", conditionId: "fifteen", horizonMin: 15, windowStartMs: start, decidedAtMs: start, side: "up", askPaid: 0.5, controlAskPaid: 0.5, status: "won" },
  ];
  const result = computePaperGate(
    trades,
    [
      {
        key: "candidate",
        name: "15m only",
        evalStartMs: start,
        eligible: ({ horizonMin }) => horizonMin === 15,
      },
      { key: "drift", name: "Drift", evalStartMs: start, control: true },
    ],
    start + 1,
    { ...PAPER_GATE, evalStartMs: start },
  ).bots[0];
  assert.equal(result.markets, 1);
  assert.equal(result.bets, 1);
  assert.equal(result.pairedMarkets, 1);
});

test("paper gate passes pair into a bot's frozen eligibility universe", () => {
  const start = Date.UTC(2026, 6, 23, 0, 0, 0);
  const trades: PaperGateTrade[] = [
    { id: 1, botKey: "drift", conditionId: "btc", pair: "BTC-USD", horizonMin: 5, windowStartMs: start, decidedAtMs: start, side: "down", askPaid: 0.5, controlAskPaid: 0.5, status: "lost" },
    { id: 2, botKey: "drift", conditionId: "eth", pair: "ETH-USD", horizonMin: 5, windowStartMs: start, decidedAtMs: start, side: "down", askPaid: 0.5, controlAskPaid: 0.5, status: "lost" },
    { id: 3, botKey: "candidate", conditionId: "btc", pair: "BTC-USD", horizonMin: 5, windowStartMs: start, decidedAtMs: start, side: "up", askPaid: 0.5, controlAskPaid: 0.5, status: "won" },
    { id: 4, botKey: "candidate", conditionId: "eth", pair: "ETH-USD", horizonMin: 5, windowStartMs: start, decidedAtMs: start, side: "up", askPaid: 0.5, controlAskPaid: 0.5, status: "won" },
  ];
  const result = computePaperGate(
    trades,
    [
      { key: "candidate", name: "BTC only", evalStartMs: start, eligible: ({ pair }) => pair === "BTC-USD" },
      { key: "drift", name: "Drift", evalStartMs: start, control: true },
    ],
    start + 1,
    { ...PAPER_GATE, version: "pair-test", evalStartMs: start },
  ).bots[0];
  assert.equal(result.markets, 1);
  assert.equal(result.bets, 1);
  assert.equal(result.pairedMarkets, 1);
});

test("paper gate excludes a descriptive bot row without a fillable same-tick control", () => {
  const start = Date.UTC(2026, 6, 23, 0, 0, 0);
  const trades: PaperGateTrade[] = [
    { id: 1, botKey: "drift", conditionId: "m1", horizonMin: 5, windowStartMs: start, decidedAtMs: start, side: "down", askPaid: 0.5, controlAskPaid: 0.5, status: "lost" },
    { id: 2, botKey: "candidate", conditionId: "m1", horizonMin: 5, windowStartMs: start, decidedAtMs: start, side: "up", askPaid: 0.4, controlAskPaid: null, status: "won" },
  ];
  const result = computePaperGate(
    trades,
    [
      { key: "candidate", name: "Candidate", evalStartMs: start },
      { key: "drift", name: "Drift", evalStartMs: start, control: true },
    ],
    start + 1,
    { ...PAPER_GATE, evalStartMs: start },
  ).bots[0];
  assert.equal(result.markets, 1);
  assert.equal(result.decisions, 1);
  assert.equal(result.pairedBookDecisions, 0);
  assert.equal(result.resolvedDecisions, 1);
  assert.equal(result.bets, 0);
  assert.equal(result.residual, null);
});

test("paper gate reports open collection separately from graded verdict pairs", () => {
  const start = Date.UTC(2026, 6, 24, 9, 30, 0);
  const trades: PaperGateTrade[] = [
    { id: 1, botKey: "drift", conditionId: "ready", horizonMin: 5, windowStartMs: start, decidedAtMs: start, side: "down", askPaid: 0.52, controlAskPaid: 0.52, status: "open" },
    { id: 2, botKey: "candidate", conditionId: "ready", horizonMin: 5, windowStartMs: start, decidedAtMs: start, side: "up", askPaid: 0.49, controlAskPaid: 0.52, status: "open" },
    { id: 3, botKey: "drift", conditionId: "unpaired", horizonMin: 5, windowStartMs: start + 300_000, decidedAtMs: start + 300_000, side: "down", askPaid: 0.51, controlAskPaid: 0.51, status: "open" },
    { id: 4, botKey: "candidate", conditionId: "unpaired", horizonMin: 5, windowStartMs: start + 300_000, decidedAtMs: start + 300_000, side: "up", askPaid: 0.5, controlAskPaid: null, status: "open" },
    // A pre-boundary row must not inflate live collection.
    { id: 5, botKey: "candidate", conditionId: "old", horizonMin: 5, windowStartMs: start - 1, decidedAtMs: start - 1, side: "up", askPaid: 0.5, controlAskPaid: 0.5, status: "won" },
  ];
  const result = computePaperGate(
    trades,
    [
      { key: "candidate", name: "Candidate", evalStartMs: start },
      { key: "drift", name: "Drift", evalStartMs: start, control: true },
    ],
    start + 300_001,
    { ...PAPER_GATE, evalStartMs: start },
  ).bots[0];
  assert.equal(result.markets, 2);
  assert.equal(result.decisions, 2);
  assert.equal(result.pairedBookDecisions, 1);
  assert.equal(result.resolvedDecisions, 0);
  assert.equal(result.bets, 0);
  assert.equal(result.pairedMarkets, 0);
});

test("paper gate assigns UK session from the actual decision time, not market open", () => {
  const start = Date.UTC(2026, 6, 23, 17, 59, 0); // 18:59 UK: day session
  const decided = start + 2 * 60_000; // 19:01 UK: evening session
  const trades: PaperGateTrade[] = [
    { id: 1, botKey: "drift", conditionId: "m1", horizonMin: 5, windowStartMs: start, decidedAtMs: start, side: "down", askPaid: 0.5, controlAskPaid: 0.5, status: "lost" },
    { id: 2, botKey: "candidate", conditionId: "m1", horizonMin: 5, windowStartMs: start, decidedAtMs: decided, side: "up", askPaid: 0.5, controlAskPaid: 0.5, status: "won" },
  ];
  const result = computePaperGate(
    trades,
    [
      { key: "candidate", name: "Candidate", evalStartMs: start },
      { key: "drift", name: "Drift", evalStartMs: start, control: true },
    ],
    decided + 1,
    { ...PAPER_GATE, evalStartMs: start, sessionMinBets: 1 },
  ).bots[0];
  assert.equal(result.sessions.find((session) => session.key === "day07-19")?.bets, 0);
  assert.equal(result.sessions.find((session) => session.key === "eve19-23")?.bets, 1);
});
