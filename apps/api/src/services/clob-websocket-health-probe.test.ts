import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../scripts/probe-clob-websocket-health.ts", import.meta.url),
  "utf8",
);
const recordSource = readFileSync(
  new URL("../scripts/record-clob-websocket-combined-scope-probe.ts", import.meta.url),
  "utf8",
);

test("CLOB health probe is bounded, current-scope-only, and outcome blind", () => {
  assert.match(source, /MAX_DURATION_SEC = 300/);
  assert.match(source, /horizon !== "5" && horizon !== "15" && horizon !== "both"/);
  assert.match(source, /targetHorizons\.has\(horizon\)/);
  assert.match(source, /expectedTokens = targetHorizons\.size \* 12/);
  assert.match(source, /TARGET_PAIRS = new Set/);
  assert.match(source, /pair != null/);
  assert.match(source, /TARGET_PAIRS\.has\(pair\)/);
  assert.match(source, /startMs <= discoveredAtMs/);
  assert.match(source, /discoveredAtMs < endMs/);
  assert.match(source, /subscriptionFrame\(tokenIds\)/);
  assert.match(source, /HEARTBEAT_MS = 10_000/);
  assert.match(source, /outcomeBlind: true/);
  assert.match(source, /writesData: false/);
  assert.doesNotMatch(source, /@framework\/db/);
  assert.doesNotMatch(source, /polymarket-trade-flow-tape/);
  assert.doesNotMatch(
    source,
    /\b(?:paperTrades|paper_trade|resolvedUp|labelStatus|pnlUsd|chosenSide|canonical60s)\b/,
  );
  assert.doesNotMatch(source, /\b(?:root|frame|decoded)\.(?:price|size|side)\b/);
});

test("combined-scope probe disposition is evidence-blind and authorizes no collector change", () => {
  assert.match(recordSource, /12 current tokens for 60 seconds/);
  assert.match(recordSource, /exact 24 current 5m \+ 15m tokens for 120 seconds/);
  assert.match(recordSource, /3 abnormal code-1006 closes/);
  assert.match(recordSource, /No collector change is authorized/);
  assert.match(recordSource, /longer outcome-blind shadow comparison/);
  assert.match(recordSource, /execution prohibition remain unchanged/);
  assert.doesNotMatch(
    recordSource,
    /\b(?:paperTrades|paper_trade|resolvedUp|labelStatus|pnlUsd|chosenSide|canonical60s)\b/,
  );
  assert.doesNotMatch(recordSource, /from ["'][^"']*(?:paper-floor|paper-performance|trading)\.ts["']/);
});
