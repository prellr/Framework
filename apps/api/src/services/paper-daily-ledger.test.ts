import assert from "node:assert/strict";
import test from "node:test";
import { PAPER_DAILY_LEDGER, paperDailyLedgerDayKey } from "./paper-daily-ledger.ts";

test("daily RAW ledger freezes Chicago calendar attribution at grade time", () => {
  assert.equal(PAPER_DAILY_LEDGER.version, "updown-paper-daily-raw-ledger-v2");
  assert.equal(PAPER_DAILY_LEDGER.timeZone, "America/Chicago");
  assert.equal(PAPER_DAILY_LEDGER.attributionClock, "graded_at");
  assert.equal(PAPER_DAILY_LEDGER.defaultVisibleDays, 14);
  assert.deepEqual(PAPER_DAILY_LEDGER.rangeOptions, [7, 14, 30]);
  assert.equal(PAPER_DAILY_LEDGER.completedDayReviewFloor, 14);
  assert.equal(PAPER_DAILY_LEDGER.reviewPolicy, "descriptive_only_no_gate_effect");
});

test("daily ledger rolls at Chicago midnight rather than UTC midnight", () => {
  // July is CDT (UTC-5): 04:59:59Z is still July 23 locally; 05:00:00Z is July 24.
  assert.equal(paperDailyLedgerDayKey(Date.UTC(2026, 6, 24, 4, 59, 59)), "2026-07-23");
  assert.equal(paperDailyLedgerDayKey(Date.UTC(2026, 6, 24, 5, 0, 0)), "2026-07-24");
});

test("daily ledger respects the winter CST boundary and fails closed on invalid time", () => {
  // January is CST (UTC-6).
  assert.equal(paperDailyLedgerDayKey(Date.UTC(2026, 0, 15, 5, 59, 59)), "2026-01-14");
  assert.equal(paperDailyLedgerDayKey(Date.UTC(2026, 0, 15, 6, 0, 0)), "2026-01-15");
  assert.throws(() => paperDailyLedgerDayKey(Number.NaN), /must be finite/);
});
