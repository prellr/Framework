import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db, venuePriceSnapshots } from "@framework/db";
import { createAsyncTtlCache } from "./async-ttl-cache.ts";
import { analyzeLeadLag, leadLagDiagnosticReady, LEAD_LAG_REPORT } from "./lead-lag-analysis.ts";

export const VENUE_REPORT_PAIRS = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD", "BNB-USD"] as const;
export const VENUE_STATUS_CACHE_MS = 15 * 60_000;

/**
 * Count/span/block-only collection status. Deliberately excludes correlations, lags, and signs so
 * monitoring cannot leak the hypothesis-generating report before its preregistered readiness floor.
 */
async function loadVenueLeadLagTapeStatus() {
  const rows = await db
    .select({
      pair: venuePriceSnapshots.pair,
      rows: sql<number>`count(*)::int`,
      firstAt: sql<Date>`min(${venuePriceSnapshots.sampledAt})`,
      lastAt: sql<Date>`max(${venuePriceSnapshots.sampledAt})`,
      blocks: sql<number>`count(distinct floor(extract(epoch from ${venuePriceSnapshots.sampledAt}) / 300))::int`,
    })
    .from(venuePriceSnapshots)
    .where(gte(venuePriceSnapshots.sampledAt, new Date(LEAD_LAG_REPORT.evalStartMs)))
    .groupBy(venuePriceSnapshots.pair);

  const byPair = new Map(rows.map((row) => [row.pair, row]));
  const asMs = (value: Date | string | null | undefined) =>
    value == null ? null : value instanceof Date ? value.getTime() : new Date(value).getTime();
  const pairs = VENUE_REPORT_PAIRS.map((pair) => {
    const row = byPair.get(pair);
    const firstAtMs = asMs(row?.firstAt), lastAtMs = asMs(row?.lastAt);
    const count = Number(row?.rows ?? 0), blocks = Number(row?.blocks ?? 0);
    const spanDays =
      firstAtMs != null && lastAtMs != null && lastAtMs >= firstAtMs
        ? (lastAtMs - firstAtMs) / 86_400_000
        : 0;
    return {
      pair,
      rows: count,
      blocks,
      spanDays,
      firstAtMs,
      lastAtMs,
      readyForFrozenDiagnostic: leadLagDiagnosticReady(count, spanDays, blocks),
    };
  });
  return {
    version: "updown-venue-lead-lag-tape-v1",
    evalStartMs: LEAD_LAG_REPORT.evalStartMs,
    minRows: LEAD_LAG_REPORT.minRows,
    minSpanDays: LEAD_LAG_REPORT.minSpanDays,
    minBlocks: LEAD_LAG_REPORT.minBlocks,
    pairs,
    allPairsReadyForFrozenDiagnostic: pairs.every((pair) => pair.readyForFrozenDiagnostic),
  };
}

const readVenueLeadLagTapeStatus = createAsyncTtlCache(
  VENUE_STATUS_CACHE_MS,
  loadVenueLeadLagTapeStatus,
);

/** Cached because every readiness field is cumulative and changes only on multi-day floors. */
export function venueLeadLagTapeStatus() {
  return readVenueLeadLagTapeStatus();
}

/** Load and analyze one pair at a time so a mature multi-million-row tape is never duplicated in RAM. */
export async function venueLeadLagReport(pair: string, fromMs: number, toMs = Date.now()) {
  const rows = await db
    .select({
      t: venuePriceSnapshots.sampledAt,
      chainlink: venuePriceSnapshots.chainlinkPrice,
      hyperliquid: venuePriceSnapshots.hlMid,
    })
    .from(venuePriceSnapshots)
    .where(and(
      eq(venuePriceSnapshots.pair, pair),
      gte(venuePriceSnapshots.sampledAt, new Date(fromMs)),
      lte(venuePriceSnapshots.sampledAt, new Date(toMs)),
    ))
    .orderBy(asc(venuePriceSnapshots.sampledAt));
  return analyzeLeadLag(rows.map((row) => ({ t: row.t.getTime(), chainlink: row.chainlink, hyperliquid: row.hyperliquid })), pair);
}
