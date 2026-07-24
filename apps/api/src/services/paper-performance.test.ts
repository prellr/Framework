import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  paperPerformanceStartMs,
} from "./paper-performance.ts";
import {
  PAPER_ENGINE_V3_START_MS,
  PAPER_GATE,
} from "./paper-floor-gate.ts";

test("performance periods never precede the selected ledger scope", () => {
  const now = PAPER_GATE.evalStartMs + 10 * 24 * 60 * 60_000;
  assert.equal(paperPerformanceStartMs("forward", "all", now), PAPER_GATE.evalStartMs);
  assert.equal(paperPerformanceStartMs("paper", "all", now), PAPER_ENGINE_V3_START_MS);
  assert.equal(paperPerformanceStartMs("history", "all", now), null);
  assert.equal(paperPerformanceStartMs("history", "3d", now), now - 3 * 24 * 60 * 60_000);
  assert.equal(paperPerformanceStartMs("forward", "3d", now), now - 3 * 24 * 60 * 60_000);
});

test("a short period cannot escape a newer forward boundary", () => {
  const now = PAPER_GATE.evalStartMs + 60 * 60_000;
  assert.equal(paperPerformanceStartMs("forward", "24h", now), PAPER_GATE.evalStartMs);
});

test("segmentation aligns causal macro context and retains repeated-day support", () => {
  const source = readFileSync(new URL("./paper-performance.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /macroBreadthSnapshots\.barEnd\}\s*=\s*\$\{paperTrades\.windowStart/,
  );
  assert.match(source, /count\(distinct local_day\)::int as days/);
  assert.match(source, /'session'/);
  assert.match(source, /'macro'/);
  assert.match(source, /'technical'/);
  assert.match(source, /'freshness'/);
  assert.match(
    source,
    /N and performance retain pooled-gate history for context; the Familywise gate column is the independent prospective 5m\/15m verdict/,
  );
});

test("performance exposes the centralized profit stress without calling it worst-case", () => {
  const source = readFileSync(new URL("./paper-performance.ts", import.meta.url), "utf8");
  assert.match(source, /PAPER_ACCOUNTING\.profitStress\.winnerProfitHaircut/);
  assert.match(source, /profitStress:/);
  assert.match(source, /accounting: PAPER_ACCOUNTING/);
  assert.doesNotMatch(source, /\bconst HAIRCUT\b/);
  assert.doesNotMatch(source, /\bworst(?:_case)?\b/i);
});
