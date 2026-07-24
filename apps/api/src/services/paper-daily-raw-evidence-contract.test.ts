import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PAPER_DAILY_LEDGER } from "./paper-daily-ledger.ts";

const source = readFileSync(
  new URL("../scripts/record-paper-daily-raw-evidence-v2.ts", import.meta.url),
  "utf8",
);

test("daily RAW review eligibility is frozen and remains descriptive only", () => {
  assert.equal(PAPER_DAILY_LEDGER.version, "updown-paper-daily-raw-ledger-v2");
  assert.equal(PAPER_DAILY_LEDGER.completedDayReviewFloor, 14);
  assert.equal(PAPER_DAILY_LEDGER.reviewPolicy, "descriptive_only_no_gate_effect");
  assert.match(source, /two full weekly cycles/);
  assert.match(source, /Eligibility is not a PASS/);
  assert.match(source, /later forward boundary/);
  assert.match(source, /2026-08-06T05:00:00\.000Z/);
  assert.match(source, /refusing to create the daily RAW review contract after its evidence floor/);
});

test("daily RAW evidence record cannot inspect outcomes or mutate runtime strategy state", () => {
  assert.doesNotMatch(source, /paperTrades|paper_trades|pnlUsd|winRate|status:\s*paper/i);
  assert.doesNotMatch(
    source,
    /from\s+["'][^"']*(?:worker|collector|strategy-config|execution|order-client)[^"']*["']/i,
  );
  assert.match(source, /Continue collection\. Do not admit a new bot/);
  assert.match(source, /Paper only/);
});
