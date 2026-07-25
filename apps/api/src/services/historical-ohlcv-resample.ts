/**
 * Deterministic, gap-safe OHLCV aggregation for historical research tapes.
 *
 * Output bars are aligned to UTC clock boundaries and emitted only when every expected source bar
 * is present inside one source segment. Partial buckets are discarded rather than imputed.
 */
import { createHash } from "node:crypto";
import type { CanonicalOhlcvReplayRow } from "./historical-ohlcv-formula-replay.ts";

export const HISTORICAL_OHLCV_RESAMPLE = {
  version: "alchemy-historical-ohlcv-resample-v1",
  alignment: "UTC epoch boundaries",
  partialBuckets: "discard",
  missingBars: "discard bucket and begin a new output segment after the gap",
  invariants: {
    imputesBars: false,
    crossesSourceSegments: false,
    usesFutureBars: false,
    registersStrategy: false,
    enablesExecution: false,
  },
} as const;

export type HistoricalOhlcvResampleResult = {
  version: typeof HISTORICAL_OHLCV_RESAMPLE.version;
  sourceIntervalMs: number;
  targetIntervalMs: number;
  expectedSourceBarsPerTarget: number;
  rows: CanonicalOhlcvReplayRow[];
  contentHash: string;
  rejectedBuckets: {
    partial: number;
    nonContiguous: number;
  };
  invariants: typeof HISTORICAL_OHLCV_RESAMPLE.invariants;
};

const sha256 = (value: string) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

export function canonicalOhlcvReplayRowsContentHash(
  rows: readonly CanonicalOhlcvReplayRow[],
): string {
  return sha256(`${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

export function resampleCanonicalOhlcvReplayRows(input: {
  rows: readonly CanonicalOhlcvReplayRow[];
  sourceIntervalMs: number;
  targetIntervalMs: number;
  targetIntervalLabel: string;
}): HistoricalOhlcvResampleResult {
  const {
    rows,
    sourceIntervalMs,
    targetIntervalMs,
    targetIntervalLabel,
  } = input;
  if (
    !Number.isSafeInteger(sourceIntervalMs)
    || !Number.isSafeInteger(targetIntervalMs)
    || sourceIntervalMs <= 0
    || targetIntervalMs <= sourceIntervalMs
    || targetIntervalMs % sourceIntervalMs !== 0
  ) {
    throw new Error("resample intervals must be positive integer multiples");
  }
  if (!targetIntervalLabel.trim()) {
    throw new Error("resample target interval label is required");
  }
  const expected = targetIntervalMs / sourceIntervalMs;
  const buckets = new Map<string, CanonicalOhlcvReplayRow[]>();
  for (const row of rows) {
    const bucketStart = Math.floor(row.open_time_ms / targetIntervalMs) * targetIntervalMs;
    const key = `${row.segment_id}:${bucketStart}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  const aggregated: CanonicalOhlcvReplayRow[] = [];
  let partial = 0;
  let nonContiguous = 0;
  let outputSegment = 0;
  let previousOutputStart: number | null = null;
  let previousSourceSegment: number | null = null;
  for (const bucketRows of buckets.values()) {
    const first = bucketRows[0]!;
    const bucketStart =
      Math.floor(first.open_time_ms / targetIntervalMs) * targetIntervalMs;
    if (bucketRows.length !== expected) {
      partial += 1;
      continue;
    }
    const contiguous = bucketRows.every((row, index) =>
      row.segment_id === first.segment_id
      && row.open_time_ms === bucketStart + index * sourceIntervalMs
      && row.close_time_ms === row.open_time_ms + sourceIntervalMs - 1);
    if (!contiguous) {
      nonContiguous += 1;
      continue;
    }
    if (
      previousOutputStart == null
      || previousSourceSegment !== first.segment_id
      || bucketStart !== previousOutputStart + targetIntervalMs
    ) {
      outputSegment += 1;
    }
    const last = bucketRows.at(-1)!;
    aggregated.push({
      row_id: `${first.symbol}:${targetIntervalLabel}:${bucketStart}`,
      asset: first.asset,
      venue: first.venue,
      symbol: first.symbol,
      interval: targetIntervalLabel,
      segment_id: outputSegment,
      open_time_ms: bucketStart,
      close_time_ms: bucketStart + targetIntervalMs - 1,
      bar_available_at_ms: last.bar_available_at_ms,
      open: first.open,
      high: Math.max(...bucketRows.map((row) => row.high)),
      low: Math.min(...bucketRows.map((row) => row.low)),
      close: last.close,
      volume: bucketRows.reduce((sum, row) => sum + row.volume, 0),
    });
    previousOutputStart = bucketStart;
    previousSourceSegment = first.segment_id;
  }

  return {
    version: HISTORICAL_OHLCV_RESAMPLE.version,
    sourceIntervalMs,
    targetIntervalMs,
    expectedSourceBarsPerTarget: expected,
    rows: aggregated,
    contentHash: canonicalOhlcvReplayRowsContentHash(aggregated),
    rejectedBuckets: {
      partial,
      nonContiguous,
    },
    invariants: HISTORICAL_OHLCV_RESAMPLE.invariants,
  };
}
