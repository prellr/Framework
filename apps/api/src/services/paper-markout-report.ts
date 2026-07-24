import { gte, sql } from "drizzle-orm";
import { db, paperTrades } from "@framework/db";
import { PAPER_MARKOUT_AUDIT } from "./paper-markout-model.ts";

const marked = sql<boolean>`coalesce(${paperTrades.modelMeta}, '{}'::jsonb) ? 'markout30'`;
const markoutStatus = sql<string>`${paperTrades.modelMeta}->'markout30'->>'status'`;
const asMs = (value: Date | string | null | undefined) =>
  value == null ? null : value instanceof Date ? value.getTime() : new Date(value).getTime();

/**
 * Count/data-quality readiness only. Directional markouts, signs, bot rankings, and asset/session
 * cuts stay inaccessible before the frozen floor (and are intentionally absent from this endpoint).
 */
export async function paperMarkoutStatus() {
  const boundary = new Date(PAPER_MARKOUT_AUDIT.evalStartMs);
  const [summaryRows, statusRows] = await Promise.all([
    db
      .select({
        eligibleRows: sql<number>`count(*)::int`,
        terminalRows: sql<number>`count(*) filter (where ${marked})::int`,
        markets: sql<number>`count(distinct ${paperTrades.conditionId}) filter (where ${marked})::int`,
        firstAt: sql<Date | null>`min(${paperTrades.decidedAt}) filter (where ${marked})`,
        lastAt: sql<Date | null>`max(${paperTrades.decidedAt}) filter (where ${marked})`,
      })
      .from(paperTrades)
      .where(gte(paperTrades.decidedAt, boundary)),
    db
      .select({
        status: markoutStatus,
        rows: sql<number>`count(*)::int`,
      })
      .from(paperTrades)
      .where(sql`${paperTrades.decidedAt} >= ${boundary} and ${marked}`)
      .groupBy(markoutStatus),
  ]);
  const summary = summaryRows[0];
  const firstAtMs = asMs(summary?.firstAt);
  const lastAtMs = asMs(summary?.lastAt);
  const spanDays = firstAtMs != null && lastAtMs != null && lastAtMs >= firstAtMs
    ? (lastAtMs - firstAtMs) / 86_400_000
    : 0;
  const counts = new Map(statusRows.map((row) => [row.status, Number(row.rows)]));
  const terminalRows = Number(summary?.terminalRows ?? 0);
  const markets = Number(summary?.markets ?? 0);
  return {
    version: PAPER_MARKOUT_AUDIT.version,
    evalStartMs: PAPER_MARKOUT_AUDIT.evalStartMs,
    targetDelaySec: PAPER_MARKOUT_AUDIT.targetDelaySec,
    maxDelaySec: PAPER_MARKOUT_AUDIT.maxDelaySec,
    minimums: {
      terminalRows: PAPER_MARKOUT_AUDIT.minTerminalRows,
      markets: PAPER_MARKOUT_AUDIT.minMarkets,
      spanDays: PAPER_MARKOUT_AUDIT.minSpanDays,
    },
    eligibleRows: Number(summary?.eligibleRows ?? 0),
    terminalRows,
    markets,
    captured: counts.get("captured") ?? 0,
    unavailable: counts.get("unavailable") ?? 0,
    stale: counts.get("stale") ?? 0,
    firstAtMs,
    lastAtMs,
    spanDays,
    readyForDescriptiveAudit:
      terminalRows >= PAPER_MARKOUT_AUDIT.minTerminalRows
      && markets >= PAPER_MARKOUT_AUDIT.minMarkets
      && spanDays >= PAPER_MARKOUT_AUDIT.minSpanDays,
    resultsLocked: true,
  };
}
