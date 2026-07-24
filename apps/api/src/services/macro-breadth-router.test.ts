import assert from "node:assert/strict";
import test from "node:test";
import type { Bar5m } from "./candle-signals.ts";
import {
  MACRO_BREADTH_ROUTER,
  cmo14,
  macroBreadthCompletedBarFresh,
  macroBreadthObservation,
  macroPaperDecision,
  macroSleevePup,
  macroTargetEligible,
  type MacroAnchor,
} from "./macro-breadth-router.ts";

const T = MACRO_BREADTH_ROUTER.evalStartMs - MACRO_BREADTH_ROUTER.barMs;

function bars(direction: "up" | "down" | "flat" | "zigzag", latestT = T): Bar5m[] {
  return Array.from({ length: 15 }, (_, i) => {
    const c = direction === "up" ? 100 + i
      : direction === "down" ? 100 - i
      : direction === "zigzag" ? 100 + (i % 2 ? 1 : 0)
      : 100;
    return { t: latestT - (14 - i) * MACRO_BREADTH_ROUTER.barMs, o: c, h: c + 1, l: c - 1, c };
  });
}

const anchors = (
  btc: ReturnType<typeof bars>,
  eth: ReturnType<typeof bars>,
  sol: ReturnType<typeof bars>,
): Record<MacroAnchor, Bar5m[]> => ({
  "BTC-USD": btc,
  "ETH-USD": eth,
  "SOL-USD": sol,
});

test("frozen macro constants retain the preregistered boundary and universe", () => {
  assert.equal(MACRO_BREADTH_ROUTER.version, "updown-macro-breadth-router-v1");
  assert.equal(MACRO_BREADTH_ROUTER.evalStartMs, Date.UTC(2026, 6, 23, 18, 0, 0));
  assert.deepEqual(MACRO_BREADTH_ROUTER.anchors, ["BTC-USD", "ETH-USD", "SOL-USD"]);
  assert.deepEqual(MACRO_BREADTH_ROUTER.eligibleHorizonsMin, [5, 15]);
});

test("CMO and macro breadth classify mirrored UP, DOWN, RANGE, and NEUTRAL states", () => {
  assert.equal(cmo14(bars("up")), 1);
  assert.equal(cmo14(bars("down")), -1);
  assert.equal(cmo14(bars("flat")), 0);

  const now = MACRO_BREADTH_ROUTER.evalStartMs + 30_000;
  assert.equal(macroBreadthObservation(anchors(bars("up"), bars("up"), bars("flat")), now)?.state, "up");
  assert.equal(macroBreadthObservation(anchors(bars("down"), bars("down"), bars("flat")), now)?.state, "down");
  assert.equal(macroBreadthObservation(anchors(bars("flat"), bars("flat"), bars("zigzag")), now)?.state, "range");
  assert.equal(macroBreadthObservation(anchors(bars("up"), bars("down"), bars("flat")), now)?.state, "neutral");
});

test("macro breadth fails closed on insufficient, desynchronized, future, or stale bars", () => {
  const now = MACRO_BREADTH_ROUTER.evalStartMs + 30_000;
  assert.equal(macroBreadthObservation(anchors(bars("up").slice(1), bars("up"), bars("up")), now), null);
  assert.equal(
    macroBreadthObservation(anchors(bars("up"), bars("up", T - 300_000), bars("up")), now),
    null,
  );
  assert.equal(macroBreadthObservation(anchors(bars("up"), bars("up"), bars("up")), T + 299_000), null);
  assert.equal(
    macroBreadthObservation(
      anchors(bars("up"), bars("up"), bars("up")),
      T + MACRO_BREADTH_ROUTER.barMs + 121_000,
    ),
    null,
  );
});

test("macro status freshness uses the exact trading-time boundary", () => {
  const completedAtMs = MACRO_BREADTH_ROUTER.evalStartMs;
  assert.equal(macroBreadthCompletedBarFresh(completedAtMs, completedAtMs), true);
  assert.equal(
    macroBreadthCompletedBarFresh(
      completedAtMs,
      completedAtMs + MACRO_BREADTH_ROUTER.maxCompletedBarAgeSec * 1_000,
    ),
    true,
  );
  assert.equal(macroBreadthCompletedBarFresh(completedAtMs, completedAtMs - 1), false);
  assert.equal(
    macroBreadthCompletedBarFresh(
      completedAtMs,
      completedAtMs + MACRO_BREADTH_ROUTER.maxCompletedBarAgeSec * 1_000 + 1,
    ),
    false,
  );
});

test("trend, range, and router sleeves remain independently observable and symmetric", () => {
  const now = MACRO_BREADTH_ROUTER.evalStartMs + 30_000;
  const up = macroBreadthObservation(anchors(bars("up"), bars("up"), bars("flat")), now);
  const down = macroBreadthObservation(anchors(bars("down"), bars("down"), bars("flat")), now);
  const range = macroBreadthObservation(anchors(bars("flat"), bars("flat"), bars("zigzag")), now);
  assert.equal(macroSleevePup("trend", up, 0), 0.65);
  assert.ok(Math.abs((macroSleevePup("trend", down, 0) ?? 0) - 0.35) < 1e-12);
  assert.equal(macroSleevePup("trend", range, 0.4), null);
  assert.equal(macroSleevePup("range", range, -0.2), 0.65);
  assert.ok(Math.abs((macroSleevePup("range", range, 0.2) ?? 0) - 0.35) < 1e-12);
  assert.equal(macroSleevePup("range", range, 0.19), null);
  assert.equal(macroSleevePup("router", up, -1), 0.65);
  assert.ok(Math.abs((macroSleevePup("router", range, 0.5) ?? 0) - 0.35) < 1e-12);
});

test("paper decision uses strict real-ask edge and requires both coherent fills", () => {
  assert.deepEqual(macroPaperDecision(0.65, 0.59, 0.41), {
    side: "up",
    pup: 0.65,
    selectedAsk: 0.59,
    controlAsk: 0.41,
    edgeAsk: 0.06000000000000005,
  });
  assert.equal(macroPaperDecision(0.65, 0.60, 0.40), null);
  const down = macroPaperDecision(0.35, 0.41, 0.59);
  assert.equal(down?.side, "down");
  assert.ok(Math.abs((down?.edgeAsk ?? 0) - 0.06) < 1e-12);
  assert.equal(macroPaperDecision(0.65, 0.59, 0.99), null);
});

test("target eligibility is the frozen six-asset 5m/15m universe", () => {
  assert.equal(macroTargetEligible("BTC-USD", 5), true);
  assert.equal(macroTargetEligible("BNB-USD", 15), true);
  assert.equal(macroTargetEligible("ADA-USD", 5), false);
  assert.equal(macroTargetEligible("BTC-USD", 60), false);
});
