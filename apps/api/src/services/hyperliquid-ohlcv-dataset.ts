/**
 * Immutable, source-only Hyperliquid OHLCV dataset import.
 *
 * The importer makes one bounded public `/info` request, rejects partial/gapped/malformed
 * candles, and writes both the parsed upstream payload and a canonical JSONL artifact. It does
 * not create labels, formulas, experiments, strategies, orders, or execution routes.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  RESEARCH_PROTOCOL_VERSION,
  assertDatasetManifest,
  type ResearchDatasetManifest,
} from "@alchemy/research-protocol";
import {
  HYPERLIQUID_INFO_ENDPOINT,
  getCandleSnapshot,
  type HlCandleSnapshot,
} from "./hyperliquid.ts";

const MAX_SNAPSHOT_CANDLES = 4_900;

const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000,
  "3m": 3 * 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "2h": 2 * 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "8h": 8 * 60 * 60_000,
  "12h": 12 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "3d": 3 * 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
};

export interface HyperliquidOhlcvValidation {
  expectedRows: number;
  rows: number;
  gaps: number;
  duplicateOpenTimes: number;
  invalidOhlcv: number;
  zeroVolumeRows: number;
  firstOpenTime: string;
  lastCloseTime: string;
}

export interface HyperliquidOhlcvDatasetResult {
  manifest: ResearchDatasetManifest;
  manifestPath: string;
  canonicalPath: string;
  rawPath: string;
  rawContentHash: string;
  validation: HyperliquidOhlcvValidation;
}

interface CanonicalOhlcvRow {
  row_id: string;
  asset: string;
  venue: "hyperliquid";
  interval: string;
  open_time_ms: number;
  close_time_ms: number;
  snapshot_received_at_ms: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trade_count: number;
}

const sha256 = (value: string) =>
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

const intervalMsFor = (interval: string) => {
  const intervalMs = INTERVAL_MS[interval];
  if (!intervalMs) {
    throw new Error(`OHLCV importer does not support interval "${interval}"`);
  }
  return intervalMs;
};

const iso = (value: number) => new Date(value).toISOString();

export function validateHyperliquidOhlcv(input: {
  candles: HlCandleSnapshot[];
  coin: string;
  interval: string;
  startTime: number;
  endExclusive: number;
}): HyperliquidOhlcvValidation {
  const intervalMs = intervalMsFor(input.interval);
  const expectedRows = (input.endExclusive - input.startTime) / intervalMs;
  if (!Number.isSafeInteger(expectedRows) || expectedRows < 1) {
    throw new Error("OHLCV range is not aligned to the requested interval");
  }
  if (input.candles.length !== expectedRows) {
    throw new Error(
      `OHLCV snapshot is incomplete: expected ${expectedRows} rows, received ${input.candles.length}`,
    );
  }

  let gaps = 0;
  let duplicateOpenTimes = 0;
  let invalidOhlcv = 0;
  let zeroVolumeRows = 0;
  const seen = new Set<number>();

  input.candles.forEach((candle, index) => {
    const expectedOpen = input.startTime + index * intervalMs;
    if (candle.t !== expectedOpen) gaps += 1;
    if (seen.has(candle.t)) duplicateOpenTimes += 1;
    seen.add(candle.t);

    const validPrices =
      candle.o > 0
      && candle.h > 0
      && candle.l > 0
      && candle.c > 0
      && candle.l <= Math.min(candle.o, candle.c)
      && candle.h >= Math.max(candle.o, candle.c)
      && candle.h >= candle.l;
    if (
      !validPrices
      || candle.v < 0
      || candle.n < 0
      || candle.T !== candle.t + intervalMs - 1
      || candle.s !== input.coin
      || candle.i !== input.interval
    ) {
      invalidOhlcv += 1;
    }
    if (candle.v === 0) zeroVolumeRows += 1;
  });

  if (gaps > 0 || duplicateOpenTimes > 0 || invalidOhlcv > 0) {
    throw new Error(
      `OHLCV validation failed: gaps=${gaps}, duplicates=${duplicateOpenTimes}, invalid=${invalidOhlcv}`,
    );
  }

  const first = input.candles[0]!;
  const last = input.candles.at(-1)!;
  return {
    expectedRows,
    rows: input.candles.length,
    gaps,
    duplicateOpenTimes,
    invalidOhlcv,
    zeroVolumeRows,
    firstOpenTime: iso(first.t),
    lastCloseTime: iso(last.T),
  };
}

async function writeImmutable(filePath: string, contents: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    const existing = await readFile(filePath, "utf8");
    if (existing !== contents) {
      throw new Error(`content-address collision at ${filePath}`);
    }
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, contents, { encoding: "utf8", flag: "wx" });
  await rename(temporaryPath, filePath);
}

export async function pullHyperliquidOhlcvDataset(input: {
  coin: string;
  interval: string;
  lookbackDays: number;
  outputDir: string;
  nowMs?: number;
  fetcher?: typeof fetch;
}): Promise<HyperliquidOhlcvDatasetResult> {
  const coin = input.coin.trim().toUpperCase();
  const intervalMs = intervalMsFor(input.interval);
  if (!Number.isSafeInteger(input.lookbackDays) || input.lookbackDays < 1) {
    throw new Error("OHLCV lookbackDays must be a positive integer");
  }
  if (!path.isAbsolute(input.outputDir)) {
    throw new Error("OHLCV outputDir must be an absolute path");
  }

  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) {
    throw new Error("OHLCV nowMs must be a positive epoch millisecond");
  }
  const endExclusive = Math.floor(nowMs / intervalMs) * intervalMs;
  const startTime = endExclusive - input.lookbackDays * 86_400_000;
  const expectedRows = (endExclusive - startTime) / intervalMs;
  if (!Number.isSafeInteger(expectedRows) || expectedRows > MAX_SNAPSHOT_CANDLES) {
    throw new Error(
      `OHLCV request would require ${expectedRows} candles; maximum is ${MAX_SNAPSHOT_CANDLES}`,
    );
  }

  const snapshot = await getCandleSnapshot({
    coin,
    interval: input.interval,
    startTime,
    endTime: endExclusive - 1,
    fetcher: input.fetcher,
  });
  const validation = validateHyperliquidOhlcv({
    candles: snapshot.candles,
    coin,
    interval: input.interval,
    startTime,
    endExclusive,
  });

  const asset = `${coin}-USD`;
  const canonicalRows: CanonicalOhlcvRow[] = snapshot.candles.map((candle) => ({
    row_id: `hyperliquid:${coin}:${input.interval}:${candle.t}`,
    asset,
    venue: "hyperliquid",
    interval: input.interval,
    open_time_ms: candle.t,
    close_time_ms: candle.T,
    snapshot_received_at_ms: snapshot.receivedAtMs,
    open: candle.o,
    high: candle.h,
    low: candle.l,
    close: candle.c,
    volume: candle.v,
    trade_count: candle.n,
  }));
  const canonicalContents = `${canonicalRows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  const contentHash = sha256(canonicalContents);

  const rawContents = `${JSON.stringify({
    source: HYPERLIQUID_INFO_ENDPOINT,
    request: {
      type: "candleSnapshot",
      req: {
        coin,
        interval: input.interval,
        startTime,
        endTime: endExclusive - 1,
      },
    },
    receivedAtMs: snapshot.receivedAtMs,
    candles: snapshot.rawCandles,
  })}\n`;
  const rawContentHash = sha256(rawContents);

  const hashHex = contentHash.slice("sha256:".length);
  const rawHashHex = rawContentHash.slice("sha256:".length);
  const datasetDir = path.join(input.outputDir, "hyperliquid", coin.toLowerCase(), input.interval);
  const canonicalPath = path.join(datasetDir, `${hashHex}.jsonl`);
  const rawPath = path.join(datasetDir, "raw", `${rawHashHex}.json`);
  const datasetVersion = [
    iso(startTime).replaceAll(/[-:.TZ]/g, ""),
    iso(endExclusive - 1).replaceAll(/[-:.TZ]/g, ""),
    hashHex.slice(0, 12),
  ].join("-");
  const manifestPath = path.join(datasetDir, `${datasetVersion}.manifest.json`);
  const first = snapshot.candles[0]!;
  const last = snapshot.candles.at(-1)!;

  const manifest: ResearchDatasetManifest = {
    protocolVersion: RESEARCH_PROTOCOL_VERSION,
    datasetId: `hyperliquid-${coin.toLowerCase()}-${input.interval}-ohlcv`,
    datasetVersion,
    contentHash,
    artifact: {
      contentHash,
      uri: pathToFileURL(canonicalPath).href,
      format: "jsonl",
      byteSize: Buffer.byteLength(canonicalContents, "utf8"),
      schemaVersion: "hyperliquid-ohlcv-source-v1",
    },
    rowCount: canonicalRows.length,
    assets: [asset],
    eventStart: iso(first.t),
    eventEnd: iso(last.T),
    frozenAt: iso(snapshot.receivedAtMs),
    availabilityClock: "receive_clock",
    columns: [
      { name: "row_id", dataType: "utf8", role: "id", nullable: false },
      { name: "asset", dataType: "utf8", role: "id", nullable: false },
      { name: "venue", dataType: "utf8", role: "id", nullable: false },
      { name: "interval", dataType: "utf8", role: "id", nullable: false },
      { name: "open_time_ms", dataType: "timestamp_ms", role: "event_clock", nullable: false },
      { name: "close_time_ms", dataType: "timestamp_ms", role: "source_clock", nullable: false },
      {
        name: "snapshot_received_at_ms",
        dataType: "timestamp_ms",
        role: "receive_clock",
        nullable: false,
      },
      { name: "open", dataType: "float64", role: "feature", nullable: false },
      { name: "high", dataType: "float64", role: "feature", nullable: false },
      { name: "low", dataType: "float64", role: "feature", nullable: false },
      { name: "close", dataType: "float64", role: "feature", nullable: false },
      { name: "volume", dataType: "float64", role: "feature", nullable: false },
      { name: "trade_count", dataType: "int64", role: "feature", nullable: false },
    ],
    boundary: {
      discoveryStart: iso(first.t),
      discoveryEnd: iso(last.T),
      embargoMs: 0,
    },
    labelSpec: {
      kind: "none",
      purpose: "source-only historical OHLCV import",
      labelColumns: [],
    },
    sourceSpecs: [
      {
        id: "hyperliquid-public-candle-snapshot",
        endpoint: HYPERLIQUID_INFO_ENDPOINT,
        queryType: "candleSnapshot",
        coin,
        interval: input.interval,
        startTime,
        endTime: endExclusive - 1,
        snapshotReceivedAtMs: snapshot.receivedAtMs,
        rawContentHash,
        rawArtifactUri: pathToFileURL(rawPath).href,
        validation,
      },
    ],
    targetSpecs: [
      {
        id: "source-only",
        kind: "none",
        executionAllowed: false,
      },
    ],
  };
  assertDatasetManifest(manifest);

  await writeImmutable(canonicalPath, canonicalContents);
  await writeImmutable(rawPath, rawContents);
  await writeImmutable(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    manifest,
    manifestPath,
    canonicalPath,
    rawPath,
    rawContentHash,
    validation,
  };
}
