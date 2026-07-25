/**
 * Immutable import for TradingView OHLCV CSV exports.
 *
 * Only the source time/OHLCV columns enter the canonical tape. Any chart, indicator, strategy,
 * stop, target, or signal columns remain preserved in content-addressed raw CSV artifacts and
 * are deliberately excluded from the research feature surface.
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
};

const REQUIRED_COLUMNS = ["time", "open", "high", "low", "close", "volume"] as const;

interface TradingViewSource {
  sourcePath: string;
  fileName: string;
  rawBytes: Buffer;
  rawContentHash: string;
  rawPath: string;
  header: string[];
  excludedColumns: string[];
  rowCount: number;
  firstOpenTimeMs: number;
  lastOpenTimeMs: number;
}

interface ParsedTradingViewRow {
  openTimeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sourceHash: string;
  sourceRowNumber: number;
}

interface CanonicalTradingViewOhlcvRow {
  row_id: string;
  asset: string;
  venue: string;
  symbol: string;
  interval: string;
  segment_id: number;
  open_time_ms: number;
  close_time_ms: number;
  bar_available_at_ms: number;
  source_content_hash: string;
  source_row_number: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TradingViewOhlcvGap {
  afterOpenTime: string;
  nextOpenTime: string;
  missingBars: number;
}

export interface TradingViewOhlcvValidation {
  inputFiles: number;
  inputRows: number;
  rows: number;
  segments: number;
  gapCount: number;
  missingBars: number;
  coverageRatio: number;
  duplicateOpenTimes: number;
  identicalDuplicatesRemoved: number;
  conflictingDuplicates: number;
  invalidRows: number;
  zeroVolumeRows: number;
  excludedDerivedColumns: string[];
  firstOpenTime: string;
  lastCloseTime: string;
  gaps: TradingViewOhlcvGap[];
}

export interface TradingViewOhlcvDatasetResult {
  manifest: ResearchDatasetManifest;
  manifestPath: string;
  canonicalPath: string;
  rawPaths: string[];
  validation: TradingViewOhlcvValidation;
}

const sha256Buffer = (value: Uint8Array) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const sha256Text = (value: string) =>
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

const iso = (value: number) => new Date(value).toISOString();

const slug = (value: string) =>
  value.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");

const intervalMsFor = (interval: string) => {
  const intervalMs = INTERVAL_MS[interval];
  if (!intervalMs) {
    throw new Error(`TradingView OHLCV importer does not support interval "${interval}"`);
  }
  return intervalMs;
};

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]!;
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("CSV ended inside a quoted field");
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

async function writeImmutableBytes(filePath: string, contents: Uint8Array) {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    const existing = await readFile(filePath);
    if (!existing.equals(contents)) {
      throw new Error(`content-address collision at ${filePath}`);
    }
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, contents, { flag: "wx" });
  await rename(temporaryPath, filePath);
}

async function writeImmutableText(filePath: string, contents: string) {
  await writeImmutableBytes(filePath, Buffer.from(contents, "utf8"));
}

const sameBar = (left: ParsedTradingViewRow, right: ParsedTradingViewRow) =>
  left.open === right.open
  && left.high === right.high
  && left.low === right.low
  && left.close === right.close
  && left.volume === right.volume;

export async function importTradingViewOhlcvDataset(input: {
  sourcePaths: string[];
  asset: string;
  venue: string;
  symbol: string;
  interval: string;
  outputDir: string;
  importedAtMs?: number;
}): Promise<TradingViewOhlcvDatasetResult> {
  if (input.sourcePaths.length < 1) {
    throw new Error("TradingView OHLCV import requires at least one CSV path");
  }
  if (!path.isAbsolute(input.outputDir)) {
    throw new Error("TradingView OHLCV outputDir must be an absolute path");
  }
  const importedAtMs = input.importedAtMs ?? Date.now();
  if (!Number.isSafeInteger(importedAtMs) || importedAtMs <= 0) {
    throw new Error("TradingView OHLCV importedAtMs must be a positive epoch millisecond");
  }

  const intervalMs = intervalMsFor(input.interval);
  const venue = input.venue.trim().toLowerCase();
  const symbol = input.symbol.trim().toUpperCase();
  const asset = input.asset.trim().toUpperCase();
  if (!venue || !symbol || !asset) {
    throw new Error("TradingView OHLCV asset, venue, and symbol are required");
  }

  const datasetDir = path.join(
    input.outputDir,
    "tradingview",
    slug(venue),
    slug(symbol),
    input.interval,
  );
  const rawDir = path.join(datasetDir, "raw");
  const sources: TradingViewSource[] = [];
  const parsedRows: ParsedTradingViewRow[] = [];
  let expectedHeader: string[] | null = null;
  let invalidRows = 0;
  let zeroVolumeRows = 0;
  const excludedColumns = new Set<string>();

  for (const sourcePath of input.sourcePaths) {
    if (!path.isAbsolute(sourcePath)) {
      throw new Error(`TradingView OHLCV source path must be absolute: ${sourcePath}`);
    }
    const rawBytes = await readFile(sourcePath);
    const rawContentHash = sha256Buffer(rawBytes);
    const rawHashHex = rawContentHash.slice("sha256:".length);
    const rawPath = path.join(rawDir, `${rawHashHex}.csv`);
    const parsed = parseCsv(rawBytes.toString("utf8"));
    const header = (parsed.shift() ?? []).map((value, index) =>
      index === 0 ? value.replace(/^\uFEFF/, "").trim() : value.trim()
    );
    const normalizedHeader = header.map((value) => value.toLowerCase());
    if (header.length < REQUIRED_COLUMNS.length) {
      throw new Error(`TradingView CSV has too few columns: ${path.basename(sourcePath)}`);
    }
    if (expectedHeader && JSON.stringify(header) !== JSON.stringify(expectedHeader)) {
      throw new Error(`TradingView CSV header mismatch: ${path.basename(sourcePath)}`);
    }
    expectedHeader ??= header;

    const indexes = Object.fromEntries(
      REQUIRED_COLUMNS.map((column) => [column, normalizedHeader.indexOf(column)]),
    ) as Record<(typeof REQUIRED_COLUMNS)[number], number>;
    for (const column of REQUIRED_COLUMNS) {
      if (indexes[column] < 0) {
        throw new Error(
          `TradingView CSV is missing required column "${column}": ${path.basename(sourcePath)}`,
        );
      }
    }
    const sourceExcludedColumns = header.filter(
      (_column, index) => !Object.values(indexes).includes(index),
    );
    sourceExcludedColumns.forEach((column) => excludedColumns.add(column));

    let firstOpenTimeMs = Number.POSITIVE_INFINITY;
    let lastOpenTimeMs = Number.NEGATIVE_INFINITY;
    let priorOpenTimeMs: number | null = null;
    parsed.forEach((row, rowIndex) => {
      const timeSeconds = Number(row[indexes.time]);
      const openTimeMs = timeSeconds * 1_000;
      const open = Number(row[indexes.open]);
      const high = Number(row[indexes.high]);
      const low = Number(row[indexes.low]);
      const close = Number(row[indexes.close]);
      const volume = Number(row[indexes.volume]);
      const valid =
        Number.isSafeInteger(timeSeconds)
        && openTimeMs % intervalMs === 0
        && [open, high, low, close, volume].every(Number.isFinite)
        && open > 0
        && high > 0
        && low > 0
        && close > 0
        && volume >= 0
        && low <= Math.min(open, close)
        && high >= Math.max(open, close)
        && high >= low
        && (priorOpenTimeMs === null || openTimeMs > priorOpenTimeMs);
      if (!valid) {
        invalidRows += 1;
        return;
      }
      if (volume === 0) zeroVolumeRows += 1;
      firstOpenTimeMs = Math.min(firstOpenTimeMs, openTimeMs);
      lastOpenTimeMs = Math.max(lastOpenTimeMs, openTimeMs);
      priorOpenTimeMs = openTimeMs;
      parsedRows.push({
        openTimeMs,
        open,
        high,
        low,
        close,
        volume,
        sourceHash: rawContentHash,
        sourceRowNumber: rowIndex + 2,
      });
    });
    if (!Number.isFinite(firstOpenTimeMs) || !Number.isFinite(lastOpenTimeMs)) {
      throw new Error(`TradingView CSV contains no valid OHLCV rows: ${path.basename(sourcePath)}`);
    }
    sources.push({
      sourcePath,
      fileName: path.basename(sourcePath),
      rawBytes,
      rawContentHash,
      rawPath,
      header,
      excludedColumns: sourceExcludedColumns,
      rowCount: parsed.length,
      firstOpenTimeMs,
      lastOpenTimeMs,
    });
  }

  if (invalidRows > 0) {
    throw new Error(`TradingView OHLCV validation failed: invalidRows=${invalidRows}`);
  }
  parsedRows.sort((left, right) => left.openTimeMs - right.openTimeMs);

  const uniqueRows: ParsedTradingViewRow[] = [];
  let duplicateOpenTimes = 0;
  let identicalDuplicatesRemoved = 0;
  let conflictingDuplicates = 0;
  for (const row of parsedRows) {
    const prior = uniqueRows.at(-1);
    if (prior?.openTimeMs === row.openTimeMs) {
      duplicateOpenTimes += 1;
      if (sameBar(prior, row)) {
        identicalDuplicatesRemoved += 1;
      } else {
        conflictingDuplicates += 1;
      }
      continue;
    }
    uniqueRows.push(row);
  }
  if (conflictingDuplicates > 0) {
    throw new Error(
      `TradingView OHLCV validation failed: conflictingDuplicates=${conflictingDuplicates}`,
    );
  }

  const gaps: TradingViewOhlcvGap[] = [];
  let segmentId = 1;
  let missingBars = 0;
  const canonicalRows: CanonicalTradingViewOhlcvRow[] = uniqueRows.map((row, index) => {
    const prior = uniqueRows[index - 1];
    if (prior && row.openTimeMs !== prior.openTimeMs + intervalMs) {
      const missing = Math.max(0, (row.openTimeMs - prior.openTimeMs) / intervalMs - 1);
      missingBars += missing;
      gaps.push({
        afterOpenTime: iso(prior.openTimeMs),
        nextOpenTime: iso(row.openTimeMs),
        missingBars: missing,
      });
      segmentId += 1;
    }
    return {
      row_id: `tradingview:${venue}:${symbol}:${input.interval}:${row.openTimeMs}`,
      asset,
      venue,
      symbol,
      interval: input.interval,
      segment_id: segmentId,
      open_time_ms: row.openTimeMs,
      close_time_ms: row.openTimeMs + intervalMs - 1,
      bar_available_at_ms: row.openTimeMs + intervalMs - 1,
      source_content_hash: row.sourceHash,
      source_row_number: row.sourceRowNumber,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
    };
  });
  if (canonicalRows.length < 1) {
    throw new Error("TradingView OHLCV import produced no canonical rows");
  }

  const canonicalContents = `${canonicalRows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  const contentHash = sha256Text(canonicalContents);
  const hashHex = contentHash.slice("sha256:".length);
  const first = canonicalRows[0]!;
  const last = canonicalRows.at(-1)!;
  const coverageDenominator = canonicalRows.length + missingBars;
  const validation: TradingViewOhlcvValidation = {
    inputFiles: sources.length,
    inputRows: parsedRows.length,
    rows: canonicalRows.length,
    segments: segmentId,
    gapCount: gaps.length,
    missingBars,
    coverageRatio: coverageDenominator > 0 ? canonicalRows.length / coverageDenominator : 0,
    duplicateOpenTimes,
    identicalDuplicatesRemoved,
    conflictingDuplicates,
    invalidRows,
    zeroVolumeRows,
    excludedDerivedColumns: [...excludedColumns],
    firstOpenTime: iso(first.open_time_ms),
    lastCloseTime: iso(last.close_time_ms),
    gaps,
  };

  const canonicalPath = path.join(datasetDir, `${hashHex}.jsonl`);
  const datasetVersion = [
    iso(first.open_time_ms).replaceAll(/[-:.TZ]/g, ""),
    iso(last.close_time_ms).replaceAll(/[-:.TZ]/g, ""),
    hashHex.slice(0, 12),
    `imported-${iso(importedAtMs).replaceAll(/[-:.TZ]/g, "")}`,
  ].join("-");
  const manifestPath = path.join(datasetDir, `${datasetVersion}.manifest.json`);
  const manifest: ResearchDatasetManifest = {
    protocolVersion: RESEARCH_PROTOCOL_VERSION,
    datasetId: `tradingview-${slug(venue)}-${slug(symbol)}-${input.interval}-ohlcv`,
    datasetVersion,
    contentHash,
    artifact: {
      contentHash,
      uri: pathToFileURL(canonicalPath).href,
      format: "jsonl",
      byteSize: Buffer.byteLength(canonicalContents, "utf8"),
      schemaVersion: "tradingview-ohlcv-source-v1",
    },
    rowCount: canonicalRows.length,
    assets: [asset],
    eventStart: iso(first.open_time_ms),
    eventEnd: iso(last.close_time_ms),
    frozenAt: iso(importedAtMs),
    availabilityClock: "receive_clock",
    columns: [
      { name: "row_id", dataType: "utf8", role: "id", nullable: false },
      { name: "asset", dataType: "utf8", role: "id", nullable: false },
      { name: "venue", dataType: "utf8", role: "id", nullable: false },
      { name: "symbol", dataType: "utf8", role: "id", nullable: false },
      { name: "interval", dataType: "utf8", role: "id", nullable: false },
      { name: "segment_id", dataType: "int32", role: "id", nullable: false },
      { name: "open_time_ms", dataType: "timestamp_ms", role: "event_clock", nullable: false },
      { name: "close_time_ms", dataType: "timestamp_ms", role: "source_clock", nullable: false },
      {
        name: "bar_available_at_ms",
        dataType: "timestamp_ms",
        role: "receive_clock",
        nullable: false,
      },
      { name: "source_content_hash", dataType: "utf8", role: "id", nullable: false },
      { name: "source_row_number", dataType: "int32", role: "id", nullable: false },
      { name: "open", dataType: "float64", role: "feature", nullable: false },
      { name: "high", dataType: "float64", role: "feature", nullable: false },
      { name: "low", dataType: "float64", role: "feature", nullable: false },
      { name: "close", dataType: "float64", role: "feature", nullable: false },
      { name: "volume", dataType: "float64", role: "feature", nullable: false },
    ],
    boundary: {
      discoveryStart: iso(first.open_time_ms),
      discoveryEnd: iso(last.close_time_ms),
      embargoMs: 0,
    },
    labelSpec: {
      kind: "none",
      purpose: "source-only historical TradingView OHLCV import",
      labelColumns: [],
    },
    sourceSpecs: sources.map((source) => ({
      id: `tradingview-csv-${source.rawContentHash.slice(
        "sha256:".length,
        "sha256:".length + 12,
      )}`,
      fileName: source.fileName,
      rawContentHash: source.rawContentHash,
      rawArtifactUri: pathToFileURL(source.rawPath).href,
      sourceHeader: source.header,
      excludedColumns: source.excludedColumns,
      rowCount: source.rowCount,
      firstOpenTime: iso(source.firstOpenTimeMs),
      lastOpenTime: iso(source.lastOpenTimeMs),
      importedAtMs,
      historicalAvailabilityClock: "bar close; not an observed network receipt clock",
    })),
    targetSpecs: [
      {
        id: "source-only",
        kind: "none",
        executionAllowed: false,
      },
    ],
  };
  assertDatasetManifest(manifest);

  await Promise.all(
    sources.map((source) => writeImmutableBytes(source.rawPath, source.rawBytes)),
  );
  await writeImmutableText(canonicalPath, canonicalContents);
  await writeImmutableText(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    manifest,
    manifestPath,
    canonicalPath,
    rawPaths: sources.map((source) => source.rawPath),
    validation,
  };
}
