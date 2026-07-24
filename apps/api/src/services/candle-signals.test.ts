import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregate5m,
  bollingerMfiSignal,
  idNr4BreakoutEligibleHorizon,
  idNr4BreakoutSignal,
  ID_NR4_BREAKOUT,
  stochAdxEligibleHorizon,
  stochAdxSnapbackSignal,
  STOCH_ADX_SNAPBACK,
  td9ExhaustionSignal,
  TD9_EXHAUSTION,
  type Bar5m,
} from "./candle-signals.ts";
import type { HlCandle } from "./hyperliquid.ts";

const bars = (closes: number[]): Bar5m[] =>
  closes.map((c, i) => ({ t: i * 300_000, o: c - 0.2, h: c + 0.5, l: c - 0.5, c, v: 100 + i }));

test("Bollinger MFI Method II emits the preregistered long signal", () => {
  const signal = bollingerMfiSignal(bars(Array.from({ length: 20 }, (_, i) => 100 + i)));
  assert.ok(signal);
  assert.equal(signal.pup, 0.75);
  assert.ok(signal.percentB > 0.8);
  assert.equal(signal.mfi, 100);
});

test("Bollinger MFI Method II emits the preregistered short signal", () => {
  const signal = bollingerMfiSignal(bars(Array.from({ length: 20 }, (_, i) => 120 - i)));
  assert.ok(signal);
  assert.equal(signal.pup, 0.25);
  assert.ok(signal.percentB < 0.2);
  assert.equal(signal.mfi, 0);
});

test("Bollinger MFI abstains when bands have no width", () => {
  assert.equal(bollingerMfiSignal(bars(Array(20).fill(100))), null);
});

test("5m aggregation sums volume and discards an incomplete trailing group", () => {
  const oneMin: HlCandle[] = Array.from({ length: 7 }, (_, i) => ({
    t: i * 60_000,
    o: 100 + i,
    h: 101 + i,
    l: 99 + i,
    c: 100.5 + i,
    v: i + 1,
  }));
  const result = aggregate5m(oneMin);
  assert.equal(result.length, 1);
  assert.equal(result[0].v, 15);
  assert.equal(result[0].c, 104.5);
});

test("5m aggregation rejects duplicate minutes masquerading as a complete group", () => {
  const oneMin: HlCandle[] = [0, 1, 2, 3, 3].map((minute, i) => ({
    t: minute * 60_000,
    o: 100 + i,
    h: 101 + i,
    l: 99 + i,
    c: 100.5 + i,
    v: i + 1,
  }));
  assert.deepEqual(aggregate5m(oneMin), []);
});

test("perfected TD-9 emits long exhaustion only on the exact ninth setup bar", () => {
  const signal = td9ExhaustionSignal(
    bars([100, 99, 98, 97, 101, 98, 97, 96, 95, 94, 93, 92, 91, 90]),
  );
  assert.deepEqual(signal, {
    pup: 0.75,
    direction: "long",
    setupCount: 9,
    perfected: true,
    completedBarAt: 13 * 300_000,
  });
});

test("perfected TD-9 emits the mirrored short exhaustion", () => {
  const signal = td9ExhaustionSignal(
    bars([100, 101, 102, 103, 99, 102, 103, 104, 105, 106, 107, 108, 109, 110]),
  );
  assert.equal(signal?.direction, "short");
  assert.equal(signal?.pup, 0.25);
});

test("TD-9 preserves the source OR perfection semantics", () => {
  const candidate = bars([100, 99, 98, 97, 101, 98, 97, 96, 95, 94, 93, 92, 91, 90]);
  // Setup bars 6/7 have very deep lows, so neither setup bar 8 nor 9 exceeds either one.
  candidate[10].l = 80;
  candidate[11].l = 81;
  assert.equal(td9ExhaustionSignal(candidate), null);

  // Exceeding either reference is sufficient under the source implementation's OR relation.
  candidate[13].l = 80.5;
  assert.equal(td9ExhaustionSignal(candidate)?.direction, "long");
});

test("TD-9 rejects a tenth-bar continuation and insufficient history", () => {
  const continuation = bars([100, 99, 98, 97, 101, 98, 97, 96, 95, 94, 93, 92, 91, 90, 89]);
  assert.equal(td9ExhaustionSignal(continuation), null);
  assert.equal(td9ExhaustionSignal(continuation.slice(-13)), null);
});

test("TD-9 forward boundary remains the preregistered instant", () => {
  assert.equal(TD9_EXHAUSTION.evalStartMs, Date.parse("2026-07-23T05:30:00.000Z"));
});

function directionalTrend(direction: 1 | -1): Bar5m[] {
  const result: Bar5m[] = [];
  for (let i = 0; i < 36; i++) {
    const center = 100 + direction * i;
    result.push({
      t: i * 300_000,
      o: center,
      h: center + 0.4,
      l: center - 0.4,
      c: center + direction * 0.2,
      v: 10,
    });
  }
  const lastCenter = 100 + direction * 36;
  result.push(direction === -1
    ? { t: 36 * 300_000, o: lastCenter - 1, h: lastCenter + 1, l: lastCenter - 1.5, c: lastCenter - 0.3, v: 10 }
    : { t: 36 * 300_000, o: lastCenter + 1, h: lastCenter + 1.5, l: lastCenter - 1, c: lastCenter + 0.3, v: 10 });
  return result;
}

test("Stoch-ADX snapback emits the preregistered oversold reversal", () => {
  const result = stochAdxSnapbackSignal(directionalTrend(-1));
  assert.ok(result);
  assert.equal(result.direction, "long");
  assert.equal(result.pup, 0.75);
  assert.ok(result.fastK < 25 && result.fastD < 25 && result.adx > 25);
});

test("Stoch-ADX snapback mirrors the rule for an overbought DOWN reversal", () => {
  const result = stochAdxSnapbackSignal(directionalTrend(1));
  assert.ok(result);
  assert.equal(result.direction, "short");
  assert.equal(result.pup, 0.25);
  assert.ok(result.fastK > 75 && result.fastD > 75 && result.adx > 25);
});

test("Stoch-ADX snapback stays inside its frozen horizon and boundary", () => {
  assert.equal(stochAdxEligibleHorizon(5), true);
  assert.equal(stochAdxEligibleHorizon(15), true);
  assert.equal(stochAdxEligibleHorizon(60), false);
  assert.equal(STOCH_ADX_SNAPBACK.evalStartMs, Date.parse("2026-07-23T07:00:00.000Z"));
  assert.equal(stochAdxSnapbackSignal(directionalTrend(-1).slice(0, 27)), null);
});

const idNr4Bars = (): Bar5m[] => [
  { t: 0, o: 105, h: 110, l: 100, c: 106, v: 10 }, // range 10
  { t: 300_000, o: 103, h: 108, l: 99, c: 104, v: 10 }, // range 9
  { t: 600_000, o: 100, h: 106, l: 94, c: 101, v: 10 }, // range 12
  { t: 900_000, o: 100, h: 104, l: 96, c: 102, v: 10 }, // range 8, strict inside + NR4
];

test("ID/NR4 emits both strict immediate-next-bar breakout directions", () => {
  const nowMs = 1_260_000; // UTC-aligned 20m window, one minute after open
  const spotAtMs = nowMs - 30_000;
  const long = idNr4BreakoutSignal(idNr4Bars(), 105, spotAtMs, nowMs);
  assert.deepEqual(long, {
    pup: 0.75,
    direction: "long",
    setupHigh: 104,
    setupLow: 96,
    setupRange: 8,
    spot: 105,
    spotAgeSec: 30,
    completedBarAt: 900_000,
    nextWindowStartMs: 1_200_000,
  });
  const short = idNr4BreakoutSignal(idNr4Bars(), 95, spotAtMs, nowMs);
  assert.equal(short?.direction, "short");
  assert.equal(short?.pup, 0.25);
});

test("ID/NR4 abstains on no breakout, ties, equality, staleness, gaps, or a later window", () => {
  const nowMs = 1_260_000;
  const spotAtMs = nowMs - 30_000;
  assert.equal(idNr4BreakoutSignal(idNr4Bars(), 104, spotAtMs, nowMs), null);
  assert.equal(idNr4BreakoutSignal(idNr4Bars(), 100, spotAtMs, nowMs), null);

  const tie = idNr4Bars();
  tie[1] = { ...tie[1], h: 107, l: 99 }; // range 8 ties the setup range
  assert.equal(idNr4BreakoutSignal(tie, 105, spotAtMs, nowMs), null);

  const equality = idNr4Bars();
  equality[3] = { ...equality[3], h: equality[2].h };
  assert.equal(idNr4BreakoutSignal(equality, 107, spotAtMs, nowMs), null);

  assert.equal(idNr4BreakoutSignal(idNr4Bars(), 105, nowMs - 91_000, nowMs), null);
  assert.equal(idNr4BreakoutSignal(idNr4Bars(), 105, nowMs + 1, nowMs), null);

  const gap = idNr4Bars();
  gap[1] = { ...gap[1], t: 360_000 };
  assert.equal(idNr4BreakoutSignal(gap, 105, spotAtMs, nowMs), null);

  const laterWindowMs = 1_510_000;
  assert.equal(idNr4BreakoutSignal(idNr4Bars(), 105, laterWindowMs - 30_000, laterWindowMs), null);
});

test("ID/NR4 preserves the preregistered boundary and 5m-only universe", () => {
  assert.equal(ID_NR4_BREAKOUT.evalStartMs, Date.parse("2026-07-23T08:30:00.000Z"));
  assert.equal(idNr4BreakoutEligibleHorizon(5), true);
  assert.equal(idNr4BreakoutEligibleHorizon(15), false);
  assert.equal(idNr4BreakoutEligibleHorizon(60), false);
  assert.equal(idNr4BreakoutSignal(idNr4Bars().slice(1), 105, 1_230_000, 1_260_000), null);
});
