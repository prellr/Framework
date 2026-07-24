import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, venuePriceSnapshots } from "@framework/db";
import { createAsyncTtlCache } from "./async-ttl-cache.ts";
import {
  analyzeCrossAssetLeadLag,
  crossAssetDiagnosticReady,
  CROSS_ASSET_ALT_PAIRS,
  CROSS_ASSET_LEAD_LAG_REPORT,
  type CrossAssetAltPair,
} from "./cross-asset-lead-lag.ts";

const btcSnapshot = alias(venuePriceSnapshots, "cross_asset_btc");
const altSnapshot = alias(venuePriceSnapshots, "cross_asset_alt");
export const CROSS_ASSET_STATUS_CACHE_MS = 15 * 60_000;

const asMs = (value: Date | string | null | undefined) =>
  value == null ? null : value instanceof Date ? value.getTime() : new Date(value).getTime();

/**
 * Exact-match count/span/block-only status. It deliberately withholds all correlations, signs, and
 * lag rankings until the frozen per-alt diagnostic floor has passed.
 */
async function loadCrossAssetLeadLagStatus() {
  const rows = await db
    .select({
      altPair: altSnapshot.pair,
      matchedRows: sql<number>`count(*)::int`,
      firstAt: sql<Date>`min(${altSnapshot.sampledAt})`,
      lastAt: sql<Date>`max(${altSnapshot.sampledAt})`,
      blocks: sql<number>`count(distinct floor(extract(epoch from ${altSnapshot.sampledAt}) / 300))::int`,
    })
    .from(altSnapshot)
    .innerJoin(
      btcSnapshot,
      and(
        eq(btcSnapshot.pair, "BTC-USD"),
        eq(btcSnapshot.sampledAt, altSnapshot.sampledAt),
      ),
    )
    .where(and(
      inArray(altSnapshot.pair, [...CROSS_ASSET_ALT_PAIRS]),
      gte(altSnapshot.sampledAt, new Date(CROSS_ASSET_LEAD_LAG_REPORT.evalStartMs)),
    ))
    .groupBy(altSnapshot.pair);

  const byPair = new Map(rows.map((row) => [row.altPair, row]));
  const pairs = CROSS_ASSET_ALT_PAIRS.map((altPair) => {
    const row = byPair.get(altPair);
    const firstAtMs = asMs(row?.firstAt);
    const lastAtMs = asMs(row?.lastAt);
    const matchedRows = Number(row?.matchedRows ?? 0);
    const blocks = Number(row?.blocks ?? 0);
    const spanDays =
      firstAtMs != null && lastAtMs != null && lastAtMs >= firstAtMs
        ? (lastAtMs - firstAtMs) / 86_400_000
        : 0;
    return {
      altPair,
      matchedRows,
      blocks,
      spanDays,
      firstAtMs,
      lastAtMs,
      readyForFrozenDiagnostic: crossAssetDiagnosticReady(matchedRows, spanDays, blocks),
    };
  });

  return {
    version: "updown-btc-alt-lead-lag-tape-v1",
    evalStartMs: CROSS_ASSET_LEAD_LAG_REPORT.evalStartMs,
    lagsSec: CROSS_ASSET_LEAD_LAG_REPORT.lagsSec,
    minRows: CROSS_ASSET_LEAD_LAG_REPORT.minRows,
    minSpanDays: CROSS_ASSET_LEAD_LAG_REPORT.minSpanDays,
    minBlocks: CROSS_ASSET_LEAD_LAG_REPORT.minBlocks,
    pairs,
    allPairsReadyForFrozenDiagnostic: pairs.every((pair) => pair.readyForFrozenDiagnostic),
  };
}

const readCrossAssetLeadLagStatus = createAsyncTtlCache(
  CROSS_ASSET_STATUS_CACHE_MS,
  loadCrossAssetLeadLagStatus,
);

/** Cached because this cumulative exact-match scan feeds readiness counters, not live health. */
export function crossAssetLeadLagStatus() {
  return readCrossAssetLeadLagStatus();
}

/**
 * Readiness-locked report. Before the floor it returns status only and never computes correlations.
 */
export async function crossAssetLeadLagReport(
  altPair: CrossAssetAltPair,
  fromMs = CROSS_ASSET_LEAD_LAG_REPORT.evalStartMs,
  toMs = Date.now(),
) {
  const status = await crossAssetLeadLagStatus();
  const pairStatus = status.pairs.find((pair) => pair.altPair === altPair)!;
  if (!pairStatus.readyForFrozenDiagnostic) {
    return { status: pairStatus, results: null };
  }

  const effectiveFromMs = Math.max(fromMs, CROSS_ASSET_LEAD_LAG_REPORT.evalStartMs);
  const rows = await db
    .select({
      t: altSnapshot.sampledAt,
      btc: btcSnapshot.hlMid,
      alt: altSnapshot.hlMid,
    })
    .from(altSnapshot)
    .innerJoin(
      btcSnapshot,
      and(
        eq(btcSnapshot.pair, "BTC-USD"),
        eq(btcSnapshot.sampledAt, altSnapshot.sampledAt),
      ),
    )
    .where(and(
      eq(altSnapshot.pair, altPair),
      gte(altSnapshot.sampledAt, new Date(effectiveFromMs)),
      lte(altSnapshot.sampledAt, new Date(toMs)),
    ))
    .orderBy(asc(altSnapshot.sampledAt));

  const results = analyzeCrossAssetLeadLag(
    rows.map((row) => ({ t: asMs(row.t)!, btc: row.btc, alt: row.alt })),
    altPair,
  );
  // A caller may request a narrower subrange than the mature full tape. Keep that range locked too.
  if (!results.length || results.some((result) => !result.ready)) {
    return { status: pairStatus, results: null };
  }
  return { status: pairStatus, results };
}
