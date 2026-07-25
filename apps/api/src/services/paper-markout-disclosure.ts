import { PAPER_MARKOUT_AUDIT } from "./paper-markout-model.ts";

/**
 * Frozen before the first value-bearing markout disclosure.
 *
 * This audit measures the value of an immediate $5 liquidation at the observed 30-second bid.
 * It is not settlement P&L and must never be subtracted from RAW paper P&L: the paper entry already
 * includes the captured fee-adjusted depth walk. Rows are deduplicated to one earliest captured
 * observation per market × side so a shared strategy decision cannot inflate execution evidence.
 */
export const PAPER_MARKOUT_DISCLOSURE = {
  version: "paper-fill-markout-disclosure-v1",
  auditVersion: PAPER_MARKOUT_AUDIT.version,
  evalStartMs: PAPER_MARKOUT_AUDIT.evalStartMs,
  stakeUsd: 5,
  quantileProbabilities: [0.1, 0.5, 0.9] as const,
  dimensions: ["overall", "horizon", "entryAsk", "asset"] as const,
  deduplication: "earliest-captured-market-side",
  cacheMs: 5 * 60_000,
  verdictInput: false,
  outcomeBlind: true,
} as const;

type Numeric = number | string | null;

export type RawMarkoutBucket = {
  dimension: string;
  segment_key: string;
  rows: Numeric;
  markets: Numeric;
  nonnegative_rows: Numeric;
  round_trip_q: unknown;
  mid_delta_q: unknown;
  liquidation_return_usd_q: unknown;
  capture_delay_sec_q: unknown;
};

export type PaperMarkoutQuantiles = {
  p10: number;
  p50: number;
  p90: number;
};

export type PaperMarkoutDisclosureBucket = {
  dimension: "overall" | "horizon" | "entryAsk" | "asset";
  segment: string;
  rows: number;
  markets: number;
  nonnegativeRate: number;
  contractMarkoutCents: PaperMarkoutQuantiles;
  midMoveCents: PaperMarkoutQuantiles;
  liquidationReturnUsd5: PaperMarkoutQuantiles;
  captureDelaySec: PaperMarkoutQuantiles;
};

const MARKOUT_DIMENSIONS = new Set<string>(PAPER_MARKOUT_DISCLOSURE.dimensions);
const FORBIDDEN_MARKOUT_REPORT_KEY =
  /(?:strategy|bot|signal|outcome|resolution|grade|win|loss|settlement|control|account|wallet|order)/i;

export function assertOutcomeBlindMarkoutDisclosure(value: unknown, path = "report"): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      assertOutcomeBlindMarkoutDisclosure(child, `${path}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_MARKOUT_REPORT_KEY.test(key)) {
      throw new Error(`paper markout disclosure blocked at ${path}.${key}`);
    }
    assertOutcomeBlindMarkoutDisclosure(child, `${path}.${key}`);
  }
}

function numericArray(value: unknown): number[] | null {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string" && value.startsWith("{") && value.endsWith("}")
      ? value.slice(1, -1).split(",")
      : null;
  if (!raw) return null;
  const numbers = raw.map(Number);
  return numbers.every(Number.isFinite) ? numbers : null;
}

export function paperMarkoutQuantiles(value: unknown, scale = 1): PaperMarkoutQuantiles {
  const values = numericArray(value);
  if (!values || values.length !== PAPER_MARKOUT_DISCLOSURE.quantileProbabilities.length) {
    throw new Error("invalid paper markout quantile array");
  }
  return {
    p10: values[0]! * scale,
    p50: values[1]! * scale,
    p90: values[2]! * scale,
  };
}

export function paperMarkoutDisclosureFromRows(rows: RawMarkoutBucket[]): {
  summary: PaperMarkoutDisclosureBucket;
  buckets: PaperMarkoutDisclosureBucket[];
} {
  const seen = new Set<string>();
  const mapped = rows.map((row): PaperMarkoutDisclosureBucket => {
    if (!MARKOUT_DIMENSIONS.has(row.dimension)) {
      throw new Error(`paper markout query returned unknown dimension ${row.dimension}`);
    }
    const key = `${row.dimension}:${row.segment_key}`;
    if (seen.has(key)) throw new Error(`paper markout query returned duplicate bucket ${key}`);
    seen.add(key);
    const rowCount = Number(row.rows);
    const markets = Number(row.markets);
    const nonnegativeRows = Number(row.nonnegative_rows);
    if (
      !Number.isSafeInteger(rowCount) ||
      rowCount < 1 ||
      !Number.isSafeInteger(markets) ||
      markets < 1 ||
      !Number.isSafeInteger(nonnegativeRows) ||
      nonnegativeRows < 0 ||
      nonnegativeRows > rowCount
    ) {
      throw new Error(`invalid paper markout counts for ${key}`);
    }
    return {
      dimension: row.dimension as PaperMarkoutDisclosureBucket["dimension"],
      segment: row.segment_key,
      rows: rowCount,
      markets,
      nonnegativeRate: nonnegativeRows / rowCount,
      contractMarkoutCents: paperMarkoutQuantiles(row.round_trip_q, 100),
      midMoveCents: paperMarkoutQuantiles(row.mid_delta_q, 100),
      liquidationReturnUsd5: paperMarkoutQuantiles(row.liquidation_return_usd_q),
      captureDelaySec: paperMarkoutQuantiles(row.capture_delay_sec_q),
    };
  });
  const summary = mapped.find((row) => row.dimension === "overall" && row.segment === "All");
  if (!summary) throw new Error("paper markout query omitted the overall row");
  const buckets = mapped
    .filter((row) => row !== summary)
    .sort(
      (left, right) =>
        PAPER_MARKOUT_DISCLOSURE.dimensions.indexOf(left.dimension) -
          PAPER_MARKOUT_DISCLOSURE.dimensions.indexOf(right.dimension) ||
        left.segment.localeCompare(right.segment, undefined, { numeric: true }),
    );
  const report = { summary, buckets };
  assertOutcomeBlindMarkoutDisclosure(report);
  return report;
}
