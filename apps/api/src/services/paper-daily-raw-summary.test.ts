import assert from "node:assert/strict";
import test from "node:test";
import { summarizeDailyRawRows } from "../../../web/src/pages/polymarket/polymarket-daily-raw-summary.ts";

test("daily RAW summary excludes the live Chicago day from completed-day evidence", () => {
  const summary = summarizeDailyRawRows([
    { day: "2026-07-21", n: 4, raw: 8 },
    { day: "2026-07-22", n: 3, raw: -2 },
    { day: "2026-07-23", n: 2, raw: 0 },
    { day: "2026-07-24", n: 5, raw: 12 },
  ], "2026-07-24");

  assert.deepEqual(summary, {
    observedDays: 4,
    completedDays: 3,
    positiveCompletedDays: 1,
    negativeCompletedDays: 1,
    flatCompletedDays: 1,
    medianCompletedRaw: 0,
    bestCompleted: { day: "2026-07-21", n: 4, raw: 8 },
    worstCompleted: { day: "2026-07-22", n: 3, raw: -2 },
    current: { day: "2026-07-24", n: 5, raw: 12 },
  });
});

test("daily RAW summary coalesces duplicate rows and computes an even-day median", () => {
  const summary = summarizeDailyRawRows([
    { day: "2026-07-22", n: 2, raw: 5 },
    { day: "2026-07-22", n: 3, raw: 2 },
    { day: "2026-07-23", n: 4, raw: -3 },
  ], "2026-07-24");

  assert.equal(summary.observedDays, 2);
  assert.equal(summary.completedDays, 2);
  assert.equal(summary.medianCompletedRaw, 2);
  assert.deepEqual(summary.bestCompleted, { day: "2026-07-22", n: 5, raw: 7 });
  assert.deepEqual(summary.worstCompleted, { day: "2026-07-23", n: 4, raw: -3 });
  assert.equal(summary.current, null);
});

test("daily RAW summary fails closed on malformed or non-trade rows", () => {
  const summary = summarizeDailyRawRows([
    { day: "not-a-day", n: 2, raw: 5 },
    { day: "2026-07-22", n: 0, raw: 4 },
    { day: "2026-07-23", n: 1, raw: Number.NaN },
  ], "2026-07-24");

  assert.equal(summary.observedDays, 0);
  assert.equal(summary.completedDays, 0);
  assert.equal(summary.medianCompletedRaw, null);
  assert.equal(summary.bestCompleted, null);
  assert.equal(summary.worstCompleted, null);
  assert.equal(summary.current, null);
});
