import assert from "node:assert/strict";
import test from "node:test";
import {
  PAPER_BOTS,
  paperBotBucketUniverse,
  paperBotEffectiveStartMs,
  paperBotsForDecision,
} from "./paper-floor.ts";
import { PAPER_GATE } from "./paper-floor-gate.ts";
import { BSM_WINDOW_PROFILE } from "./bsm-window-profile.ts";
import { PAIRED_BOOK_OFI_CONTINUATION } from "./paired-book-ofi-continuation.ts";
import {
  SMOOTH_PATH_CAUSAL_DISPLACEMENT,
  SMOOTH_PATH_DISPLACEMENT,
} from "./smooth-path-displacement.ts";
import { MACRO_BREADTH_ROUTER } from "./macro-breadth-router.ts";
import { MACRO_DIRECTION_CONTROLS } from "./macro-direction-controls.ts";
import { PRICER_MC_5M_TREND } from "./pricer-mc-trend.ts";
import { COBRA_5M_NIGHT_PRICER } from "./cobra-session-pricer.ts";

const PEAK = "pricerBSMPeakRetention";

test("peak-retention cadence lane contains only its frozen bot", () => {
  assert.deepEqual(paperBotsForDecision({ onlyBotKeys: [PEAK] }).map((bot) => bot.key), [PEAK]);
});

test("general cadence lane excludes only peak retention", () => {
  const general = paperBotsForDecision({ excludeBotKeys: [PEAK] }).map((bot) => bot.key);
  assert.equal(general.includes(PEAK), false);
  assert.deepEqual([...general, PEAK].sort(), PAPER_BOTS.map((bot) => bot.key).sort());
});

test("unknown or contradictory cadence filters fail closed", () => {
  assert.deepEqual(paperBotsForDecision({ onlyBotKeys: ["not-a-bot"] }), []);
  assert.deepEqual(paperBotsForDecision({ onlyBotKeys: [PEAK], excludeBotKeys: [PEAK] }), []);
});

test("every existing bot restarts no earlier than the gate-v3 fee boundary", () => {
  for (const bot of PAPER_BOTS) {
    assert.equal(paperBotEffectiveStartMs(bot), Math.max(PAPER_GATE.evalStartMs, bot.evalStartMs));
    assert.ok(paperBotEffectiveStartMs(bot) >= PAPER_GATE.evalStartMs);
  }
});

test("window-profile child is frozen, future-dated, and BTC 5m only", () => {
  const bot = PAPER_BOTS.find((candidate) => candidate.key === "pricerBSMWindowProfile");
  assert.ok(bot);
  assert.equal(bot.evalStartMs, BSM_WINDOW_PROFILE.evalStartMs);
  assert.ok(bot.evalStartMs > PAPER_GATE.evalStartMs);
  assert.equal(bot.eligible?.({ pair: "BTC-USD", horizonMin: 5, decidedAtMs: bot.evalStartMs }), true);
  assert.equal(bot.eligible?.({ pair: "ETH-USD", horizonMin: 5, decidedAtMs: bot.evalStartMs }), false);
  assert.equal(bot.eligible?.({ pair: "BTC-USD", horizonMin: 15, decidedAtMs: bot.evalStartMs }), false);
});

test("bootstrap-MC trend child is registered only in its future 5m cohort", () => {
  const bot = PAPER_BOTS.find((candidate) => candidate.key === "pricerMC5mTrend");
  assert.ok(bot);
  assert.equal(bot.source, "pricer");
  assert.equal(bot.evalStartMs, PRICER_MC_5M_TREND.evalStartMs);
  assert.equal(bot.eligible?.({
    pair: "BTC-USD",
    horizonMin: 5,
    decidedAtMs: bot.evalStartMs,
  }), true);
  assert.equal(bot.eligible?.({
    pair: "BTC-USD",
    horizonMin: 15,
    decidedAtMs: bot.evalStartMs,
  }), false);
  assert.deepEqual(paperBotBucketUniverse(bot), [
    { pair: "BTC-USD", horizonMin: 5 },
    { pair: "ETH-USD", horizonMin: 5 },
    { pair: "SOL-USD", horizonMin: 5 },
    { pair: "XRP-USD", horizonMin: 5 },
    { pair: "DOGE-USD", horizonMin: 5 },
    { pair: "BNB-USD", horizonMin: 5 },
  ]);
});

test("Cobra night child is an independently registered 5m-only bootstrap-MC cohort", () => {
  const bot = PAPER_BOTS.find((candidate) => candidate.key === "pricerMC5mCobraNight");
  assert.ok(bot);
  assert.equal(bot.source, "pricer");
  assert.equal(bot.evalStartMs, COBRA_5M_NIGHT_PRICER.evalStartMs);
  assert.equal(bot.eligible?.({
    pair: "BTC-USD",
    horizonMin: 5,
    decidedAtMs: Date.parse("2026-07-25T00:30:00Z"),
  }), true);
  assert.equal(bot.eligible?.({
    pair: "BTC-USD",
    horizonMin: 5,
    decidedAtMs: Date.parse("2026-07-25T12:00:00Z"),
  }), false);
  assert.equal(bot.eligible?.({
    pair: "BTC-USD",
    horizonMin: 15,
    decidedAtMs: Date.parse("2026-07-25T00:30:00Z"),
  }), false);
  assert.deepEqual(
    paperBotBucketUniverse(bot).map((bucket) => bucket.horizonMin),
    Array(6).fill(5),
  );
});

test("paired-book OFI continuation is registered at its own future 5m boundary", () => {
  const bot = PAPER_BOTS.find((candidate) => candidate.key === "pairedBookOfiContinuation");
  assert.ok(bot);
  assert.equal(bot.source, "pairedBookOfi");
  assert.equal(bot.evalStartMs, PAIRED_BOOK_OFI_CONTINUATION.evalStartMs);
  assert.ok(bot.evalStartMs > PAPER_GATE.evalStartMs);
  assert.equal(bot.eligible?.({ pair: "BTC-USD", horizonMin: 5, decidedAtMs: bot.evalStartMs }), true);
  assert.equal(bot.eligible?.({ pair: "ETH-USD", horizonMin: 15, decidedAtMs: bot.evalStartMs }), false);
  assert.equal(bot.eligible?.({ pair: "ADA-USD", horizonMin: 5, decidedAtMs: bot.evalStartMs }), false);
});

test("smooth path displacement is registered at its own future 5m boundary", () => {
  const bot = PAPER_BOTS.find((candidate) => candidate.key === "smoothPathDisplacement");
  assert.ok(bot);
  assert.equal(bot.source, "smoothPath");
  assert.equal(bot.evalStartMs, SMOOTH_PATH_DISPLACEMENT.evalStartMs);
  assert.ok(bot.evalStartMs > PAIRED_BOOK_OFI_CONTINUATION.evalStartMs);
  assert.equal(bot.eligible?.({ pair: "BTC-USD", horizonMin: 5, decidedAtMs: bot.evalStartMs }), true);
  assert.equal(bot.eligible?.({ pair: "ETH-USD", horizonMin: 15, decidedAtMs: bot.evalStartMs }), false);
  assert.equal(bot.eligible?.({ pair: "ADA-USD", horizonMin: 5, decidedAtMs: bot.evalStartMs }), false);
});

test("causal smooth-path child is independently registered at a later prospective boundary", () => {
  const bot = PAPER_BOTS.find((candidate) => candidate.key === "smoothPathCausalDisplacement");
  assert.ok(bot);
  assert.equal(bot.source, "smoothPathCausal");
  assert.equal(bot.evalStartMs, SMOOTH_PATH_CAUSAL_DISPLACEMENT.evalStartMs);
  assert.ok(bot.evalStartMs > SMOOTH_PATH_DISPLACEMENT.evalStartMs);
  assert.equal(bot.eligible?.({ pair: "BTC-USD", horizonMin: 5, decidedAtMs: bot.evalStartMs }), true);
  assert.equal(bot.eligible?.({ pair: "ETH-USD", horizonMin: 15, decidedAtMs: bot.evalStartMs }), false);
  assert.equal(bot.eligible?.({ pair: "ADA-USD", horizonMin: 5, decidedAtMs: bot.evalStartMs }), false);
});

test("macro leader benchmarks and sleeves share one frozen future boundary and target universe", () => {
  const expected = new Map([
    ["alwaysUp", null],
    ["macroTrendSleeve", "macroTrend"],
    ["macroRangeFade", "macroRange"],
    ["macroRegimeRouter", "macroRouter"],
  ]);
  for (const [key, source] of expected) {
    const bot = PAPER_BOTS.find((candidate) => candidate.key === key);
    assert.ok(bot);
    assert.equal(bot.source, source);
    assert.equal(bot.evalStartMs, MACRO_BREADTH_ROUTER.evalStartMs);
    assert.equal(bot.eligible?.({ pair: "BTC-USD", horizonMin: 5, decidedAtMs: bot.evalStartMs }), true);
    assert.equal(bot.eligible?.({ pair: "BNB-USD", horizonMin: 15, decidedAtMs: bot.evalStartMs }), true);
    assert.equal(bot.eligible?.({ pair: "ADA-USD", horizonMin: 5, decidedAtMs: bot.evalStartMs }), false);
    assert.equal(bot.eligible?.({ pair: "BTC-USD", horizonMin: 60, decidedAtMs: bot.evalStartMs }), false);
  }
  assert.ok(MACRO_BREADTH_ROUTER.evalStartMs > SMOOTH_PATH_DISPLACEMENT.evalStartMs);
});

test("macro-filtered side controls remain independent and start only at their later boundary", () => {
  const expected = new Map([
    ["macroUpOnly", "macroUpControl"],
    ["macroDownOnly", "macroDownControl"],
  ]);
  for (const [key, source] of expected) {
    const bot = PAPER_BOTS.find((candidate) => candidate.key === key);
    assert.ok(bot);
    assert.equal(bot.source, source);
    assert.equal(bot.evalStartMs, MACRO_DIRECTION_CONTROLS.evalStartMs);
    assert.equal(
      bot.eligible?.({ pair: "BTC-USD", horizonMin: 5, decidedAtMs: bot.evalStartMs }),
      true,
    );
    assert.equal(
      bot.eligible?.({ pair: "BNB-USD", horizonMin: 15, decidedAtMs: bot.evalStartMs }),
      true,
    );
    assert.equal(
      bot.eligible?.({ pair: "ADA-USD", horizonMin: 5, decidedAtMs: bot.evalStartMs }),
      false,
    );
    assert.equal(paperBotBucketUniverse(bot).length, 12);
  }
  assert.ok(MACRO_DIRECTION_CONTROLS.evalStartMs > MACRO_BREADTH_ROUTER.evalStartMs);
});

test("bucket universe includes zero-activity cells and respects frozen narrow scopes", () => {
  const byKey = (key: string) => {
    const bot = PAPER_BOTS.find((candidate) => candidate.key === key);
    assert.ok(bot);
    return paperBotBucketUniverse(bot);
  };
  assert.equal(byKey("alwaysUp").length, 12);
  assert.equal(byKey("macroRegimeRouter").length, 12);
  assert.deepEqual(byKey("pricerBSMWindowProfile"), [{ pair: "BTC-USD", horizonMin: 5 }]);
  assert.deepEqual(
    byKey("pairedBookOfiContinuation").map((bucket) => bucket.horizonMin),
    Array(6).fill(5),
  );
  assert.deepEqual(
    byKey("smoothPathCausalDisplacement").map((bucket) => bucket.horizonMin),
    Array(6).fill(5),
  );
  assert.deepEqual(
    byKey("pricerBSMOffHours15").map((bucket) => bucket.horizonMin),
    Array(6).fill(15),
  );
  assert.deepEqual(
    byKey("pricerMC5mCobraNight").map((bucket) => bucket.horizonMin),
    Array(6).fill(5),
  );
});
