import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { PaperGateTrade } from "./paper-floor-gate.ts";
import {
  computeMacroDirectionVerdictGate,
  MACRO_DIRECTION_VERDICT_GATE,
  macroDirectionOppositeAsk,
} from "./macro-direction-verdict-gate.ts";

test("macro direction gate is future-dated, split by timeframe, and retains every v3 floor", () => {
  assert.equal(
    MACRO_DIRECTION_VERDICT_GATE.version,
    "updown-macro-direction-opposite-side-gate-v1",
  );
  assert.equal(
    MACRO_DIRECTION_VERDICT_GATE.evalStartMs,
    Date.parse("2026-07-24T09:30:00.000Z"),
  );
  assert.equal(MACRO_DIRECTION_VERDICT_GATE.minMarkets, 1_500);
  assert.equal(MACRO_DIRECTION_VERDICT_GATE.minSpanDays, 5);
  assert.equal(MACRO_DIRECTION_VERDICT_GATE.minBets, 200);
  assert.equal(MACRO_DIRECTION_VERDICT_GATE.minResidual, 0.015);
  assert.equal(MACRO_DIRECTION_VERDICT_GATE.bootIters, 1_000);
  assert.equal(MACRO_DIRECTION_VERDICT_GATE.sessionMinBets, 50);
  assert.equal(MACRO_DIRECTION_VERDICT_GATE.sessionsNeeded, 2);
});

test("opposite ask extraction is side-symmetric and fails closed", () => {
  const meta = {
    bookExecution: {
      up: { effectiveVwap: 0.41 },
      down: { effectiveVwap: 0.62 },
    },
  };
  assert.equal(macroDirectionOppositeAsk("up", meta), 0.62);
  assert.equal(macroDirectionOppositeAsk("down", meta), 0.41);
  assert.equal(macroDirectionOppositeAsk("flat", meta), null);
  assert.equal(macroDirectionOppositeAsk("down", { bookExecution: { up: {} } }), null);
  assert.equal(
    macroDirectionOppositeAsk("down", { bookExecution: { up: { effectiveVwap: 1 } } }),
    null,
  );
});

test("macro DOWN compares against same-tick UP instead of collapsing to zero", () => {
  const start = MACRO_DIRECTION_VERDICT_GATE.evalStartMs;
  const base = {
    pair: "BTC-USD",
    horizonMin: 5,
    windowStartMs: start,
    decidedAtMs: start,
    controlAskPaid: 0.55,
  } as const;
  const trades: PaperGateTrade[] = [
    {
      ...base,
      id: 1,
      botKey: "drift",
      conditionId: "down-wins",
      side: "down",
      askPaid: 0.55,
      status: "won",
    },
    {
      ...base,
      id: 2,
      botKey: "macroDownOnly",
      conditionId: "down-wins",
      side: "down",
      askPaid: 0.55,
      oppositeAskPaid: 0.46,
      status: "won",
    },
  ];
  const result = computeMacroDirectionVerdictGate(trades, start + 1);
  const down5 = result.bots.find((bot) => bot.key === "macroDownOnly:5");
  assert.equal(down5?.decisions, 1);
  assert.equal(down5?.pairedBookDecisions, 1);
  assert.equal(down5?.resolvedDecisions, 1);
  assert.equal(down5?.bets, 1);
  // DOWN net +0.45 less losing UP net -0.46.
  assert.ok(Math.abs((down5?.residual?.mean ?? 0) - 0.91) < 1e-12);
  assert.equal(result.bots.find((bot) => bot.key === "macroDownOnly:15")?.bets, 0);
});

test("macro UP uses the mirrored opposite-side comparison and excludes pre-boundary rows", () => {
  const start = MACRO_DIRECTION_VERDICT_GATE.evalStartMs;
  const trades: PaperGateTrade[] = [
    {
      id: 1,
      botKey: "macroUpOnly",
      conditionId: "old",
      pair: "BTC-USD",
      horizonMin: 5,
      windowStartMs: start - 1,
      decidedAtMs: start - 1,
      side: "up",
      askPaid: 0.42,
      controlAskPaid: 0.59,
      oppositeAskPaid: 0.59,
      status: "won",
    },
    {
      id: 2,
      botKey: "drift",
      conditionId: "new",
      pair: "ETH-USD",
      horizonMin: 15,
      windowStartMs: start,
      decidedAtMs: start,
      side: "down",
      askPaid: 0.57,
      controlAskPaid: 0.57,
      status: "lost",
    },
    {
      id: 3,
      botKey: "macroUpOnly",
      conditionId: "new",
      pair: "ETH-USD",
      horizonMin: 15,
      windowStartMs: start,
      decidedAtMs: start,
      side: "up",
      askPaid: 0.44,
      controlAskPaid: 0.57,
      oppositeAskPaid: 0.57,
      status: "won",
    },
  ];
  const result = computeMacroDirectionVerdictGate(trades, start + 1);
  assert.equal(result.bots.find((bot) => bot.key === "macroUpOnly:5")?.bets, 0);
  assert.equal(result.bots.find((bot) => bot.key === "macroUpOnly:15")?.bets, 1);
});

test("macro direction gate preregistration is outcome-blind and contains no execution path", () => {
  const source = readFileSync(
    new URL("../scripts/record-macro-direction-verdict-gate-v1.ts", import.meta.url),
    "utf8",
  );
  for (const prohibited of [
    "paperTrades",
    "paper_trade",
    "pnlUsd",
    "resolvedUp",
    "placeOrder",
    "submitOrder",
    "cancelOrder",
    "privateKey",
  ]) {
    assert.equal(source.includes(prohibited), false, `${prohibited} must not be read`);
  }
  assert.match(source, /same[- ]tick/i);
  assert.match(source, /5m and 15m/i);
});

test("macro direction gate launch receipt is outcome-blind and proves paired-book provenance", () => {
  const source = readFileSync(
    new URL("../scripts/record-macro-direction-verdict-gate-launch.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /bookExecution/);
  assert.match(source, /effectiveVwap/);
  assert.match(source, /totalBudgetUsd/);
  assert.match(
    source,
    /totalCostUsd'\)::double precision\s+- 5\s+\)\s+<= 0\.00000001/g,
  );
  assert.doesNotMatch(
    source,
    /totalCostUsd'\)::double precision\s*=\s*5/,
  );
  assert.match(source, /completedAtMs/);
  assert.match(source, /evaluatedAtMs/);
  assert.match(source, /maxCompletedBarAgeSec/);
  assert.match(source, /decided_at/);
  assert.match(source, /allFourCohortsObserved/);
  assert.match(source, /onlyRegisteredCohortsObserved/);
  assert.doesNotMatch(
    source,
    /\b(?:resolved_up|label_status|pnl_usd|raw_net|worst_case_net)\b/i,
  );
  for (const prohibited of [
    "placeOrder",
    "submitOrder",
    "cancelOrder",
    "privateKey",
  ]) {
    assert.equal(source.includes(prohibited), false, `${prohibited} must not be reachable`);
  }
});

test("evaluation-clock clarification is frozen before evidence and reads no outcome ledger", () => {
  const source = readFileSync(
    new URL(
      "../scripts/record-macro-direction-verdict-evaluation-clock.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /evaluatedAtMs/);
  assert.match(source, /decidedAt/);
  assert.match(source, /Date\.now\(\)\s*>=\s*MACRO_DIRECTION_VERDICT_GATE\.evalStartMs/);
  assert.doesNotMatch(source, /\bpaperTrades?\b|\bpaper_trade\b/);
  assert.doesNotMatch(
    source,
    /\b(?:resolved_up|label_status|pnl_usd|raw_net|worst_case_net)\b/i,
  );
  for (const prohibited of [
    "placeOrder",
    "submitOrder",
    "cancelOrder",
    "privateKey",
  ]) {
    assert.equal(source.includes(prohibited), false, `${prohibited} must not be reachable`);
  }
});
