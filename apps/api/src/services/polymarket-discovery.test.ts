import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CURRENT_UPDOWN_DISCOVERY,
  currentUpdownDiscoveryNextOffset,
} from "./polymarket.ts";

test("current Up/Down discovery has a tight, bounded, cached pagination contract", () => {
  assert.deepEqual(CURRENT_UPDOWN_DISCOVERY, {
    lookaheadMin: 15,
    tagId: 102_127,
    pageSize: 100,
    maxPages: 3,
    cacheMs: 20_000,
  });
  assert.equal(currentUpdownDiscoveryNextOffset(0, 99), null);
  assert.equal(currentUpdownDiscoveryNextOffset(0, 100), 100);
  assert.throws(
    () => currentUpdownDiscoveryNextOffset(2, 100),
    /exceeded bounded pagination/,
  );
  assert.throws(() => currentUpdownDiscoveryNextOffset(0, 101), /invalid/);
});

test("current discovery requests active pages and fails closed instead of returning truncation", () => {
  const source = readFileSync(new URL("./polymarket.ts", import.meta.url), "utf8");
  assert.match(source, /active:\s*"true"/);
  assert.match(source, /tag_id:\s*String\(CURRENT_UPDOWN_DISCOVERY\.tagId\)/);
  assert.match(source, /offset:\s*String\(offset\)/);
  assert.match(source, /currentUpdownDiscoveryNextOffset\(pageIndex, page\.length\)/);
  assert.match(source, /current Up\/Down discovery exceeded bounded pagination/);
  assert.match(source, /currentUpdownCache === entry/);
});

test("paper collectors share complete current discovery instead of the truncated generic page", () => {
  for (const file of [
    "./paper-floor.ts",
    "./polymarket-state-tape.ts",
    "./polymarket-trade-flow-tape.ts",
    "./complete-set-taker-audit.ts",
    "./cross-horizon-bundle.ts",
    "./polymarket-updown.ts",
  ]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /fetchCurrentCryptoUpDown\(\)/, file);
  }
});

test("tag repair verifies all 12 current buckets without reading strategy evidence", () => {
  const source = readFileSync(
    new URL("../scripts/record-current-updown-discovery-tag-repair.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /tagId !== 102_127/);
  assert.match(source, /\bfetchCurrentCryptoUpDown\(\)/);
  assert.match(source, /expectedBuckets\.length/);
  assert.match(source, /bucketCounts\.get\(bucket\) !== 1/);
  assert.doesNotMatch(source, /from ["'][^"']*(?:paper-floor|paper-performance|trading)\.ts["']/);
  assert.doesNotMatch(
    source,
    /\b(?:paperTrades|paper_trade|resolvedUp|pnlUsd|placeOrder|submitOrder|privateKey)\b/,
  );
});
