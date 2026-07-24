import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  computePaperTimeframeGate,
  PAPER_TIMEFRAME_GATE,
  paperTimeframeGateKey,
} from "./paper-timeframe-gate.ts";
import type { PaperGateTrade } from "./paper-floor-gate.ts";

test("timeframe gate is future-dated and retains every pooled v3 statistical floor", () => {
  assert.equal(PAPER_TIMEFRAME_GATE.version, "updown-timeframe-verdict-gate-v1");
  assert.equal(PAPER_TIMEFRAME_GATE.evalStartMs, Date.parse("2026-07-24T04:00:00.000Z"));
  assert.equal(PAPER_TIMEFRAME_GATE.minMarkets, 1_500);
  assert.equal(PAPER_TIMEFRAME_GATE.minSpanDays, 5);
  assert.equal(PAPER_TIMEFRAME_GATE.minBets, 200);
  assert.equal(PAPER_TIMEFRAME_GATE.minResidual, 0.015);
  assert.equal(PAPER_TIMEFRAME_GATE.bootIters, 1_000);
  assert.equal(PAPER_TIMEFRAME_GATE.sessionMinBets, 50);
  assert.equal(PAPER_TIMEFRAME_GATE.sessionsNeeded, 2);
});

test("timeframe gate cannot mix 5m and 15m evidence", () => {
  const start = PAPER_TIMEFRAME_GATE.evalStartMs;
  const trades: PaperGateTrade[] = [
    {
      id: 1,
      botKey: "candidate",
      conditionId: "five",
      pair: "BTC-USD",
      horizonMin: 5,
      windowStartMs: start,
      decidedAtMs: start,
      side: "down",
      askPaid: 0.5,
      controlAskPaid: 0.5,
      status: "won",
    },
    {
      id: 2,
      botKey: "candidate",
      conditionId: "fifteen",
      pair: "BTC-USD",
      horizonMin: 15,
      windowStartMs: start,
      decidedAtMs: start,
      side: "up",
      askPaid: 0.5,
      controlAskPaid: 0.5,
      status: "lost",
    },
  ];
  const result = computePaperTimeframeGate(
    trades,
    [
      {
        key: paperTimeframeGateKey("candidate", 5),
        sourceKey: "candidate",
        horizonMin: 5,
        name: "Candidate · 5m",
        evalStartMs: start,
        eligible: ({ horizonMin }) => horizonMin === 5,
      },
      {
        key: paperTimeframeGateKey("candidate", 15),
        sourceKey: "candidate",
        horizonMin: 15,
        name: "Candidate · 15m",
        evalStartMs: start,
        eligible: ({ horizonMin }) => horizonMin === 15,
      },
    ],
    start + 60_000,
  );
  assert.deepEqual(result.bots.map((bot) => [bot.key, bot.bets]), [
    ["candidate:5", 1],
    ["candidate:15", 1],
  ]);
});

test("split-gate launch audit is outcome-blind", () => {
  const source = readFileSync(
    new URL("../scripts/record-paper-timeframe-gate-launch.ts", import.meta.url),
    "utf8",
  );
  for (const prohibited of [
    "paperTrades.side",
    "paperTrades.askPaid",
    "paperTrades.controlAskPaid",
    "paperTrades.status",
    "paperTrades.pnlUsd",
  ]) {
    assert.equal(source.includes(prohibited), false, `${prohibited} must not be read`);
  }
  assert.match(source, /registeredBotBucketsOnly/);
  assert.match(source, /noEarlyWindow/);
  assert.match(source, /noEarlyDecision/);
});
