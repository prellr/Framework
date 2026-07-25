import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalOhlcvReplayRowsContentHash,
  resampleCanonicalOhlcvReplayRows,
} from "./historical-ohlcv-resample.ts";
import type { CanonicalOhlcvReplayRow } from "./historical-ohlcv-formula-replay.ts";

const fiveMinutes = 300_000;
const oneHour = 3_600_000;

function rows(
  count: number,
  startAtMs = 1_800_000_000_000,
  segmentId = 1,
): CanonicalOhlcvReplayRow[] {
  return Array.from({ length: count }, (_, index) => {
    const openTimeMs = startAtMs + index * fiveMinutes;
    const open = 100 + index;
    return {
      row_id: `row-${segmentId}-${index}`,
      asset: "BTC-USDC-PERP",
      venue: "hyperliquid",
      symbol: "BTCUSDC.P",
      interval: "5m",
      segment_id: segmentId,
      open_time_ms: openTimeMs,
      close_time_ms: openTimeMs + fiveMinutes - 1,
      bar_available_at_ms: openTimeMs + fiveMinutes - 1,
      open,
      high: open + 2,
      low: open - 2,
      close: open + 1,
      volume: index + 1,
    };
  });
}

test("1h resample emits exact UTC buckets with canonical OHLCV semantics", () => {
  const result = resampleCanonicalOhlcvReplayRows({
    rows: rows(24),
    sourceIntervalMs: fiveMinutes,
    targetIntervalMs: oneHour,
    targetIntervalLabel: "1h",
  });
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0]!.open, 100);
  assert.equal(result.rows[0]!.close, 112);
  assert.equal(result.rows[0]!.high, 113);
  assert.equal(result.rows[0]!.low, 98);
  assert.equal(result.rows[0]!.volume, 78);
  assert.equal(result.rows[0]!.bar_available_at_ms, result.rows[0]!.close_time_ms);
  assert.equal(result.rows[0]!.segment_id, 1);
  assert.equal(result.rows[1]!.segment_id, 1);
  assert.equal(
    result.contentHash,
    canonicalOhlcvReplayRowsContentHash(result.rows),
  );
});

test("1h resample discards partial edge buckets and never bridges a source gap", () => {
  const first = rows(13);
  const secondStart = first[0]!.open_time_ms + oneHour * 2;
  const second = rows(12, secondStart, 2);
  const result = resampleCanonicalOhlcvReplayRows({
    rows: [...first, ...second],
    sourceIntervalMs: fiveMinutes,
    targetIntervalMs: oneHour,
    targetIntervalLabel: "1h",
  });
  assert.equal(result.rows.length, 2);
  assert.ok(result.rejectedBuckets.partial >= 1);
  assert.equal(result.rows[0]!.segment_id, 1);
  assert.equal(result.rows[1]!.segment_id, 2);
  assert.equal(result.invariants.crossesSourceSegments, false);
  assert.equal(result.invariants.imputesBars, false);
});

test("resample is deterministic and rejects invalid interval ratios", () => {
  const source = rows(24);
  const first = resampleCanonicalOhlcvReplayRows({
    rows: source,
    sourceIntervalMs: fiveMinutes,
    targetIntervalMs: oneHour,
    targetIntervalLabel: "1h",
  });
  const second = resampleCanonicalOhlcvReplayRows({
    rows: source,
    sourceIntervalMs: fiveMinutes,
    targetIntervalMs: oneHour,
    targetIntervalLabel: "1h",
  });
  assert.equal(first.contentHash, second.contentHash);
  assert.throws(
    () => resampleCanonicalOhlcvReplayRows({
      rows: source,
      sourceIntervalMs: fiveMinutes,
      targetIntervalMs: 1_000_000,
      targetIntervalLabel: "bad",
    }),
    /integer multiples/i,
  );
});
