import { gte, sql } from "drizzle-orm";
import { db, paperTrades } from "@framework/db";
import { createAsyncTtlCache } from "./async-ttl-cache.ts";
import {
  paperMarkoutDisclosureFromRows,
  PAPER_MARKOUT_DISCLOSURE,
  type RawMarkoutBucket,
} from "./paper-markout-disclosure.ts";
import { PAPER_MARKOUT_AUDIT } from "./paper-markout-model.ts";

const marked = sql<boolean>`coalesce(${paperTrades.modelMeta}, '{}'::jsonb) ? 'markout30'`;
const markoutStatus = sql<string>`${paperTrades.modelMeta}->'markout30'->>'status'`;
const asMs = (value: Date | string | null | undefined) =>
  value == null ? null : value instanceof Date ? value.getTime() : new Date(value).getTime();

/**
 * Count/data-quality readiness only. Directional markouts, signs, bot rankings, and asset/session
 * cuts stay inaccessible before the frozen floor and are absent from this status projection.
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
  const spanDays =
    firstAtMs != null && lastAtMs != null && lastAtMs >= firstAtMs
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
      terminalRows >= PAPER_MARKOUT_AUDIT.minTerminalRows &&
      markets >= PAPER_MARKOUT_AUDIT.minMarkets &&
      spanDays >= PAPER_MARKOUT_AUDIT.minSpanDays,
    resultsLocked: true,
  };
}

async function loadPaperMarkoutAudit() {
  const readiness = await paperMarkoutStatus();
  if (!readiness.readyForDescriptiveAudit) {
    return {
      ...readiness,
      disclosure: PAPER_MARKOUT_DISCLOSURE,
      resultsLocked: true as const,
      report: null,
    };
  }

  const result = await db.execute<RawMarkoutBucket>(sql`
    with unique_samples as materialized (
      select distinct on (${paperTrades.conditionId}, ${paperTrades.side})
        ${paperTrades.conditionId} as condition_id,
        ${paperTrades.pair} as pair,
        ${paperTrades.horizonMin} as horizon_min,
        ${paperTrades.side} as side,
        ${paperTrades.askPaid} as ask_paid,
        nullif(${paperTrades.modelMeta} #>> '{markout30,sideBestBid}', '')::double precision
          as side_best_bid,
        nullif(${paperTrades.modelMeta} #>> '{markout30,midDelta}', '')::double precision
          as mid_delta,
        nullif(${paperTrades.modelMeta} #>> '{markout30,roundTripPerContract}', '')::double precision
          as round_trip_per_contract,
        nullif(${paperTrades.modelMeta} #>> '{markout30,delaySec}', '')::double precision
          as capture_delay_sec
      from ${paperTrades}
      where ${paperTrades.decidedAt} >= ${new Date(PAPER_MARKOUT_DISCLOSURE.evalStartMs)}
        and ${paperTrades.modelMeta} #>> '{markout30,version}'
          = ${PAPER_MARKOUT_DISCLOSURE.auditVersion}
        and ${paperTrades.modelMeta} #>> '{markout30,status}' = 'captured'
        and ${paperTrades.side} in ('up', 'down')
        and ${paperTrades.askPaid} > 0
        and ${paperTrades.askPaid} < 1
        and nullif(${paperTrades.modelMeta} #>> '{markout30,sideBestBid}', '')::double precision
          > 0
        and nullif(${paperTrades.modelMeta} #>> '{markout30,sideBestBid}', '')::double precision
          < 1
        and nullif(${paperTrades.modelMeta} #>> '{markout30,midDelta}', '')::double precision
          is not null
        and nullif(${paperTrades.modelMeta} #>> '{markout30,roundTripPerContract}', '')::double precision
          is not null
        and nullif(${paperTrades.modelMeta} #>> '{markout30,delaySec}', '')::double precision
          between ${PAPER_MARKOUT_AUDIT.targetDelaySec} and ${PAPER_MARKOUT_AUDIT.maxDelaySec}
      order by
        ${paperTrades.conditionId},
        ${paperTrades.side},
        ${paperTrades.decidedAt},
        ${paperTrades.id}
    ),
    bucketed as (
      select
        condition_id,
        'overall'::text as dimension,
        'All'::text as segment_key,
        round_trip_per_contract,
        mid_delta,
        ${PAPER_MARKOUT_DISCLOSURE.stakeUsd}
          * (side_best_bid / ask_paid - 1) as liquidation_return_usd,
        capture_delay_sec
      from unique_samples
      union all
      select
        condition_id,
        'horizon'::text,
        horizon_min::text || 'm',
        round_trip_per_contract,
        mid_delta,
        ${PAPER_MARKOUT_DISCLOSURE.stakeUsd}
          * (side_best_bid / ask_paid - 1),
        capture_delay_sec
      from unique_samples
      union all
      select
        condition_id,
        'entryAsk'::text,
        case
          when ask_paid < 0.35 then '<35¢'
          when ask_paid < 0.50 then '35–49¢'
          when ask_paid < 0.65 then '50–64¢'
          else '65¢+'
        end,
        round_trip_per_contract,
        mid_delta,
        ${PAPER_MARKOUT_DISCLOSURE.stakeUsd}
          * (side_best_bid / ask_paid - 1),
        capture_delay_sec
      from unique_samples
      union all
      select
        condition_id,
        'asset'::text,
        replace(pair, '-USD', ''),
        round_trip_per_contract,
        mid_delta,
        ${PAPER_MARKOUT_DISCLOSURE.stakeUsd}
          * (side_best_bid / ask_paid - 1),
        capture_delay_sec
      from unique_samples
    )
    select
      dimension,
      segment_key,
      count(*)::int as rows,
      count(distinct condition_id)::int as markets,
      count(*) filter (where round_trip_per_contract >= 0)::int as nonnegative_rows,
      percentile_cont(array[0.1,0.5,0.9])
        within group (order by round_trip_per_contract) as round_trip_q,
      percentile_cont(array[0.1,0.5,0.9])
        within group (order by mid_delta) as mid_delta_q,
      percentile_cont(array[0.1,0.5,0.9])
        within group (order by liquidation_return_usd) as liquidation_return_usd_q,
      percentile_cont(array[0.1,0.5,0.9])
        within group (order by capture_delay_sec) as capture_delay_sec_q
    from bucketed
    group by dimension, segment_key
  `);
  const report = paperMarkoutDisclosureFromRows(result.rows);
  return {
    ...readiness,
    disclosure: PAPER_MARKOUT_DISCLOSURE,
    resultsLocked: false as const,
    report,
  };
}

const readPaperMarkoutAudit = createAsyncTtlCache(
  PAPER_MARKOUT_DISCLOSURE.cacheMs,
  loadPaperMarkoutAudit,
);

/** Readiness first; fixed outcome-blind liquidation summaries only after every floor passes. */
export function paperMarkoutAudit() {
  return readPaperMarkoutAudit();
}
