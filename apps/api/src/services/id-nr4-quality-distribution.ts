/**
 * Readiness-gated, outcome-blind distributions for the prospective ID/NR4 quality tape.
 *
 * The readiness query reads only strategy identity, immutable market identity/time, asset, and the
 * versioned causal quality object stored at entry. It never selects side, quote, fill, resolution,
 * grade, return, P&L, control performance, account, wallet, or order data. Feature values remain
 * locked until every frozen support floor passes.
 */
import { sql } from "drizzle-orm";
import { createAsyncTtlCache } from "./async-ttl-cache.ts";
import { ID_NR4_BREAKOUT_QUALITY_TAPE } from "./candle-signals.ts";

const PAIRS = ["BNB-USD", "BTC-USD", "DOGE-USD", "ETH-USD", "SOL-USD", "XRP-USD"] as const;

export const ID_NR4_QUALITY_DISTRIBUTION = {
  version: "updown-id-nr4-breakout-quality-distribution-v1",
  tapeVersion: ID_NR4_BREAKOUT_QUALITY_TAPE.version,
  evalStartMs: ID_NR4_BREAKOUT_QUALITY_TAPE.evalStartMs,
  botKey: "idNr4Breakout",
  horizonMin: 5,
  pairs: PAIRS,
  quantileProbabilities: [0.1, 0.25, 0.5, 0.75, 0.9] as const,
  metrics: ID_NR4_BREAKOUT_QUALITY_TAPE.metrics,
  floors: {
    rows: 300,
    marketsPerPair: 40,
    spanDays: 5,
  },
  cacheMs: 15 * 60_000,
} as const;

const FORBIDDEN_DISCLOSURE_KEY =
  /(?:outcome|resolution|label|grade|pnl|winRate|profit|loss|chosenSide|fill|return|control|account|wallet|order)/i;

export function assertOutcomeBlindIdNr4QualityDisclosure(value: unknown, path = "report"): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      assertOutcomeBlindIdNr4QualityDisclosure(child, `${path}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_DISCLOSURE_KEY.test(key)) {
      throw new Error(`ID/NR4 quality disclosure blocked at ${path}.${key}`);
    }
    assertOutcomeBlindIdNr4QualityDisclosure(child, `${path}.${key}`);
  }
}

type ReadinessRow = {
  pair: string | null;
  rows: number | string;
  markets: number | string;
  first_at: Date | string | null;
  last_at: Date | string | null;
};

type RawDistributionRow = Record<string, unknown> & {
  pair: string | null;
  rows: number | string;
  markets: number | string;
};

export type IdNr4QualityMetric = {
  n: number;
  quantiles: {
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
  } | null;
};

function numericArray(value: unknown): number[] | null {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string" && value.startsWith("{") && value.endsWith("}")
      ? value.slice(1, -1).split(",")
      : null;
  if (!raw) return null;
  const values = raw.map(Number);
  return values.every(Number.isFinite) ? values : null;
}

export function idNr4QualityMetric(nValue: unknown, quantileValue: unknown): IdNr4QualityMetric {
  const n = Number(nValue);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error("invalid ID/NR4 quality metric count");
  }
  if (!n) return { n, quantiles: null };
  const values = numericArray(quantileValue);
  if (values?.length !== ID_NR4_QUALITY_DISTRIBUTION.quantileProbabilities.length) {
    throw new Error("invalid ID/NR4 quality quantile array");
  }
  return {
    n,
    quantiles: {
      p10: values[0]!,
      p25: values[1]!,
      p50: values[2]!,
      p75: values[3]!,
      p90: values[4]!,
    },
  };
}

const metric = (row: RawDistributionRow, key: string) =>
  idNr4QualityMetric(row[`${key}_n`], row[`${key}_q`]);

function mapDistributionRow(row: RawDistributionRow) {
  return {
    pair: row.pair,
    rows: Number(row.rows),
    markets: Number(row.markets),
    metrics: {
      setupRangeBps: metric(row, "setup_range_bps"),
      rangeCompression: metric(row, "range_compression"),
      insideRangeRatio: metric(row, "inside_range_ratio"),
      absoluteCloseLocation: metric(row, "absolute_close_location"),
      breakoutExtension: metric(row, "breakout_extension"),
      relativeVolume: metric(row, "relative_volume"),
    },
  };
}

export function idNr4QualityDistributionReportFromRows(rows: RawDistributionRow[]) {
  const mapped = rows.map(mapDistributionRow);
  const pooled = mapped.find((row) => row.pair == null);
  if (!pooled) throw new Error("ID/NR4 quality query omitted its pooled row");
  const expected = new Set<string>(ID_NR4_QUALITY_DISTRIBUTION.pairs);
  const seen = new Set<string>();
  const buckets = mapped
    .filter(
      (row): row is ReturnType<typeof mapDistributionRow> & { pair: string } => row.pair != null,
    )
    .map((row) => {
      if (!expected.has(row.pair)) {
        throw new Error(`ID/NR4 quality query returned out-of-scope pair ${row.pair}`);
      }
      if (seen.has(row.pair)) {
        throw new Error(`ID/NR4 quality query returned duplicate pair ${row.pair}`);
      }
      seen.add(row.pair);
      return row;
    })
    .sort((left, right) => left.pair.localeCompare(right.pair));
  const missingPairs = ID_NR4_QUALITY_DISTRIBUTION.pairs.filter((pair) => !seen.has(pair));
  if (missingPairs.length) {
    throw new Error(`ID/NR4 quality query omitted required pairs: ${missingPairs.join(", ")}`);
  }
  const report = { pooled, buckets, missingPairs };
  assertOutcomeBlindIdNr4QualityDisclosure(report);
  return report;
}

const timeMs = (value: Date | string | null | undefined) =>
  value == null ? null : new Date(value).getTime();

async function loadIdNr4QualityDistribution() {
  if (Date.now() < ID_NR4_QUALITY_DISTRIBUTION.evalStartMs) {
    const result = {
      version: ID_NR4_QUALITY_DISTRIBUTION.version,
      tapeVersion: ID_NR4_QUALITY_DISTRIBUTION.tapeVersion,
      evalStartMs: ID_NR4_QUALITY_DISTRIBUTION.evalStartMs,
      metrics: [...ID_NR4_QUALITY_DISTRIBUTION.metrics],
      floors: ID_NR4_QUALITY_DISTRIBUTION.floors,
      rows: 0,
      markets: 0,
      firstAtMs: null,
      lastAtMs: null,
      spanDays: 0,
      weakestPairMarkets: 0,
      pairs: ID_NR4_QUALITY_DISTRIBUTION.pairs.map((pair) => ({
        pair,
        markets: 0,
      })),
      readyForDistribution: false,
      report: null,
    };
    assertOutcomeBlindIdNr4QualityDisclosure(result);
    return result;
  }
  const { db } = await import("@framework/db");
  const readinessResult = await db.execute<ReadinessRow>(sql`
    with usable as (
      select
        condition_id,
        pair,
        window_start
      from paper_trade
      where bot_key = ${ID_NR4_QUALITY_DISTRIBUTION.botKey}
        and horizon_min = ${ID_NR4_QUALITY_DISTRIBUTION.horizonMin}
        and window_start >= ${new Date(ID_NR4_QUALITY_DISTRIBUTION.evalStartMs)}
        and pair in ('BNB-USD','BTC-USD','DOGE-USD','ETH-USD','SOL-USD','XRP-USD')
        and model_meta #>> '{idNr4Breakout,quality,version}'
          = ${ID_NR4_QUALITY_DISTRIBUTION.tapeVersion}
    )
    select
      pair,
      count(*)::int as rows,
      count(distinct condition_id)::int as markets,
      min(window_start) as first_at,
      max(window_start) as last_at
    from usable
    group by grouping sets ((pair), ())
  `);
  const readinessRows = readinessResult.rows as ReadinessRow[];
  const pooled = readinessRows.find((row) => row.pair == null);
  const observedByPair = new Map(
    readinessRows
      .filter((row): row is ReadinessRow & { pair: string } => row.pair != null)
      .map((row) => [row.pair, Number(row.markets)]),
  );
  const pairs = ID_NR4_QUALITY_DISTRIBUTION.pairs.map((pair) => ({
    pair,
    markets: observedByPair.get(pair) ?? 0,
  }));
  const rows = Number(pooled?.rows ?? 0);
  const markets = Number(pooled?.markets ?? 0);
  const firstAtMs = timeMs(pooled?.first_at);
  const lastAtMs = timeMs(pooled?.last_at);
  const spanDays =
    firstAtMs == null || lastAtMs == null ? 0 : Math.max(0, lastAtMs - firstAtMs) / 86_400_000;
  const weakestPairMarkets = Math.min(...pairs.map((pair) => pair.markets));
  const readyForDistribution =
    Date.now() >= ID_NR4_QUALITY_DISTRIBUTION.evalStartMs &&
    rows >= ID_NR4_QUALITY_DISTRIBUTION.floors.rows &&
    weakestPairMarkets >= ID_NR4_QUALITY_DISTRIBUTION.floors.marketsPerPair &&
    spanDays >= ID_NR4_QUALITY_DISTRIBUTION.floors.spanDays;

  let report: ReturnType<typeof idNr4QualityDistributionReportFromRows> | null = null;
  if (readyForDistribution) {
    const valueResult = await db.execute<RawDistributionRow>(sql`
      with usable as (
        select
          condition_id,
          pair,
          (model_meta #>> '{idNr4Breakout,quality,setupRangeBps}')::double precision
            as setup_range_bps,
          (model_meta #>> '{idNr4Breakout,quality,rangeCompression}')::double precision
            as range_compression,
          (model_meta #>> '{idNr4Breakout,quality,insideRangeRatio}')::double precision
            as inside_range_ratio,
          (model_meta #>> '{idNr4Breakout,quality,absoluteCloseLocation}')::double precision
            as absolute_close_location,
          (model_meta #>> '{idNr4Breakout,quality,breakoutExtension}')::double precision
            as breakout_extension,
          (model_meta #>> '{idNr4Breakout,quality,relativeVolume}')::double precision
            as relative_volume
        from paper_trade
        where bot_key = ${ID_NR4_QUALITY_DISTRIBUTION.botKey}
          and horizon_min = ${ID_NR4_QUALITY_DISTRIBUTION.horizonMin}
          and window_start >= ${new Date(ID_NR4_QUALITY_DISTRIBUTION.evalStartMs)}
          and pair in ('BNB-USD','BTC-USD','DOGE-USD','ETH-USD','SOL-USD','XRP-USD')
          and model_meta #>> '{idNr4Breakout,quality,version}'
            = ${ID_NR4_QUALITY_DISTRIBUTION.tapeVersion}
      )
      select
        pair,
        count(*)::int as rows,
        count(distinct condition_id)::int as markets,
        count(setup_range_bps)::int as setup_range_bps_n,
        percentile_cont(array[0.1,0.25,0.5,0.75,0.9])
          within group (order by setup_range_bps) as setup_range_bps_q,
        count(range_compression)::int as range_compression_n,
        percentile_cont(array[0.1,0.25,0.5,0.75,0.9])
          within group (order by range_compression) as range_compression_q,
        count(inside_range_ratio)::int as inside_range_ratio_n,
        percentile_cont(array[0.1,0.25,0.5,0.75,0.9])
          within group (order by inside_range_ratio) as inside_range_ratio_q,
        count(absolute_close_location)::int as absolute_close_location_n,
        percentile_cont(array[0.1,0.25,0.5,0.75,0.9])
          within group (order by absolute_close_location) as absolute_close_location_q,
        count(breakout_extension)::int as breakout_extension_n,
        percentile_cont(array[0.1,0.25,0.5,0.75,0.9])
          within group (order by breakout_extension) as breakout_extension_q,
        count(relative_volume)::int as relative_volume_n,
        percentile_cont(array[0.1,0.25,0.5,0.75,0.9])
          within group (order by relative_volume) as relative_volume_q
      from usable
      group by grouping sets ((pair), ())
    `);
    report = idNr4QualityDistributionReportFromRows(valueResult.rows as RawDistributionRow[]);
  }

  const result = {
    version: ID_NR4_QUALITY_DISTRIBUTION.version,
    tapeVersion: ID_NR4_QUALITY_DISTRIBUTION.tapeVersion,
    evalStartMs: ID_NR4_QUALITY_DISTRIBUTION.evalStartMs,
    metrics: [...ID_NR4_QUALITY_DISTRIBUTION.metrics],
    floors: ID_NR4_QUALITY_DISTRIBUTION.floors,
    rows,
    markets,
    firstAtMs,
    lastAtMs,
    spanDays,
    weakestPairMarkets,
    pairs,
    readyForDistribution,
    report,
  };
  assertOutcomeBlindIdNr4QualityDisclosure(result);
  return result;
}

const cachedIdNr4QualityDistribution = createAsyncTtlCache(
  ID_NR4_QUALITY_DISTRIBUTION.cacheMs,
  loadIdNr4QualityDistribution,
);

export async function idNr4QualityDistributionAudit() {
  return cachedIdNr4QualityDistribution();
}
