import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MACRO_BREADTH_ROUTER,
  type MacroBreadthObservation,
} from "./macro-breadth-router.ts";
import {
  MACRO_DIRECTION_CONTROLS,
  macroDirectionControlSide,
} from "./macro-direction-controls.ts";
import {
  MACRO_DIRECTION_COVERAGE,
  macroDirectionCoverageMetadata,
} from "./macro-direction-coverage.ts";

const observation = (state: MacroBreadthObservation["state"]): MacroBreadthObservation => ({
  version: MACRO_BREADTH_ROUTER.version,
  state,
  cmoByAnchor: {
    "BTC-USD": 0,
    "ETH-USD": 0,
    "SOL-USD": 0,
  },
  medianCmo: 0,
  medianAbsCmo: 0,
  asOfMs: MACRO_DIRECTION_CONTROLS.evalStartMs - MACRO_BREADTH_ROUTER.barMs,
  completedAtMs: MACRO_DIRECTION_CONTROLS.evalStartMs,
  ageSec: 0,
});

test("macro direction controls freeze a later independent paper boundary", () => {
  assert.equal(
    new Date(MACRO_DIRECTION_CONTROLS.evalStartMs).toISOString(),
    "2026-07-24T06:00:00.000Z",
  );
  assert.equal(MACRO_DIRECTION_CONTROLS.macroVersion, MACRO_BREADTH_ROUTER.version);
  assert.deepEqual(MACRO_DIRECTION_CONTROLS.horizonsMin, [5, 15]);
  assert.deepEqual(MACRO_DIRECTION_CONTROLS.pairs, [
    "BTC-USD",
    "ETH-USD",
    "SOL-USD",
    "XRP-USD",
    "DOGE-USD",
    "BNB-USD",
  ]);
});

test("UP and DOWN controls enter only their exact live macro direction", () => {
  assert.equal(macroDirectionControlSide("up", observation("up")), "up");
  assert.equal(macroDirectionControlSide("down", observation("down")), "down");
  for (const state of ["range", "neutral"] as const) {
    assert.equal(macroDirectionControlSide("up", observation(state)), null);
    assert.equal(macroDirectionControlSide("down", observation(state)), null);
  }
  assert.equal(macroDirectionControlSide("up", observation("down")), null);
  assert.equal(macroDirectionControlSide("down", observation("up")), null);
  assert.equal(macroDirectionControlSide("up", null), null);
  assert.equal(
    macroDirectionControlSide("up", {
      ...observation("up"),
      version: "unregistered-macro-version",
    } as unknown as MacroBreadthObservation),
    null,
  );
});

test("macro direction launch audit is outcome- and performance-blind", () => {
  const source = readFileSync(
    new URL("../scripts/record-macro-direction-controls-launch.ts", import.meta.url),
    "utf8",
  );
  const floorSource = readFileSync(
    new URL("./paper-floor.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /macroDirectionControl/);
  assert.match(source, /completedAtMs/);
  assert.match(floorSource, /evaluatedAtMs:\s*now/);
  assert.doesNotMatch(
    source,
    /\b(?:resolved_up|label_status|pnl_usd|raw_net|worst_case_net)\b/i,
  );
});

test("macro direction coverage freezes a future outcome-blind denominator", () => {
  assert.equal(
    new Date(MACRO_DIRECTION_COVERAGE.evalStartMs).toISOString(),
    "2026-07-24T12:20:00.000Z",
  );
  assert.equal(MACRO_DIRECTION_COVERAGE.denominatorBotKey, "drift");
  assert.equal(MACRO_DIRECTION_COVERAGE.controlVersion, MACRO_DIRECTION_CONTROLS.version);
  assert.equal(MACRO_DIRECTION_COVERAGE.macroVersion, MACRO_BREADTH_ROUTER.version);
});

test("macro direction coverage distinguishes matching, abstaining, and unavailable ticks", () => {
  const windowStartMs = MACRO_DIRECTION_COVERAGE.evalStartMs;
  const atWindow = (state: MacroBreadthObservation["state"]): MacroBreadthObservation => ({
    ...observation(state),
    asOfMs: windowStartMs - MACRO_BREADTH_ROUTER.barMs,
    completedAtMs: windowStartMs,
  });
  const up = macroDirectionCoverageMetadata(atWindow("up"), windowStartMs, windowStartMs);
  assert.equal(up.available, true);
  assert.equal(up.causalAligned, true);
  assert.equal(up.expectedChildKey, MACRO_DIRECTION_CONTROLS.upBotKey);

  const down = macroDirectionCoverageMetadata(
    atWindow("down"),
    windowStartMs,
    windowStartMs,
  );
  assert.equal(down.expectedChildKey, MACRO_DIRECTION_CONTROLS.downBotKey);

  for (const state of ["range", "neutral"] as const) {
    assert.equal(
      macroDirectionCoverageMetadata(
        atWindow(state),
        windowStartMs,
        windowStartMs,
      ).expectedChildKey,
      null,
    );
  }
  assert.deepEqual(
    macroDirectionCoverageMetadata(null, windowStartMs, windowStartMs),
    {
      version: MACRO_DIRECTION_COVERAGE.version,
      evaluatedAtMs: windowStartMs,
      windowStartMs,
      available: false,
      causalAligned: false,
      macroVersion: MACRO_BREADTH_ROUTER.version,
      state: null,
      completedAtMs: null,
      expectedChildKey: null,
    },
  );
  const stale = {
    ...atWindow("up"),
    completedAtMs: windowStartMs - MACRO_BREADTH_ROUTER.barMs,
  };
  assert.equal(
    macroDirectionCoverageMetadata(stale, windowStartMs, windowStartMs).expectedChildKey,
    null,
  );
});

test("coverage preregistration reads no paper evidence and contains no execution path", () => {
  const source = readFileSync(
    new URL("../scripts/record-macro-direction-coverage-v1.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /Prospective instrumentation/);
  assert.match(source, /Date\.now\(\) >= MACRO_DIRECTION_COVERAGE\.evalStartMs/);
  assert.doesNotMatch(source, /\bpaperTrades?\b|\bpaper_trade\b/);
  assert.doesNotMatch(
    source,
    /\b(?:resolved_up|label_status|pnl_usd|raw_net|worst_case_net)\b/i,
  );
  for (const prohibited of ["placeOrder", "submitOrder", "cancelOrder", "privateKey"]) {
    assert.equal(source.includes(prohibited), false, `${prohibited} must not be reachable`);
  }
});

test("coverage launch audit reads only opportunity metadata and child presence", () => {
  const source = readFileSync(
    new URL("../scripts/record-macro-direction-coverage-launch.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /bothHorizonsObserved/);
  assert.match(source, /noMissingChildren/);
  assert.match(source, /noUnexpectedChildren/);
  assert.match(source, /noPreBoundaryMetadata/);
  assert.match(source, /expectedChildKey/);
  assert.doesNotMatch(
    source,
    /\b(?:resolved_up|label_status|pnl_usd|raw_net|worst_case_net)\b/i,
  );
  for (const prohibited of ["placeOrder", "submitOrder", "cancelOrder", "privateKey"]) {
    assert.equal(source.includes(prohibited), false, `${prohibited} must not be reachable`);
  }
});
