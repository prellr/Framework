import assert from "node:assert/strict";
import test from "node:test";
import {
  summarizeHistoricalFormulaCalendarMonths,
} from "./historical-formula-calendar-period.ts";

test("calendar periods group exact out-of-sample observations by UTC entry month", () => {
  const periods = summarizeHistoricalFormulaCalendarMonths({
    fixedNotionalUsd: 1_000,
    observations: [
      {
        id: "a",
        entryAtMs: Date.UTC(2026, 0, 31, 23, 55),
        exitAtMs: Date.UTC(2026, 1, 1, 0, 5),
        grossBps: 20,
        netBps: 10,
        netSimpleReturn: 0.001,
      },
      {
        id: "b",
        entryAtMs: Date.UTC(2026, 1, 1, 0, 5),
        exitAtMs: Date.UTC(2026, 1, 1, 0, 15),
        grossBps: 0,
        netBps: -10,
        netSimpleReturn: -0.001,
      },
    ],
  });
  assert.deepEqual(periods.map((period) => period.period), ["2026-01", "2026-02"]);
  assert.equal(periods[0]!.trades, 1);
  assert.equal(periods[0]!.hitRate, 1);
  assert.equal(periods[0]!.fixedNotionalPnlUsd, 1);
  assert.equal(periods[1]!.trades, 1);
  assert.equal(periods[1]!.hitRate, 0);
  assert.equal(periods[1]!.fixedNotionalPnlUsd, -1);
});
