import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../scripts/record-authoritative-trade-flow-capacity.ts", import.meta.url),
  "utf8",
);

test("trade-flow capacity checkpoint is pre-floor, outcome-blind, and non-executing", () => {
  assert.match(source, /2026-07-30T20:00:00\.000Z/);
  assert.match(source, /refusing a pre-readiness capacity checkpoint after the seven-day floor/);
  assert.match(source, /authoritativeTradeFlowTapeStatus/);
  assert.doesNotMatch(source, /paperTrades|paper_trade|pnlUsd|winRate|orderClient/);
  assert.match(source, /Do not admit a flow-derived bot/);
  assert.match(source, /prohibition on execution remain unchanged/);
});

test("capacity checkpoint records preservation rather than destructive retention", () => {
  assert.match(source, /Do not truncate or introduce a retention policy now/);
  assert.doesNotMatch(source, /\bdelete\s+from\b|\btruncate\s+table\b|\bdrop\s+table\b/i);
  assert.match(source, /roughly 67% reduction/);
  assert.match(source, /mapping violations/);
});
