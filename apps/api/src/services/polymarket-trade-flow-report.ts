/**
 * Outcome-free readiness report for the authoritative trade-flow tape.
 *
 * This query intentionally exposes only collection, chain-verification, mapping-integrity, and
 * elapsed-time facts. Trade direction, price distributions, outcomes, fills, and P&L remain locked.
 */
import { statfs } from "node:fs/promises";
import { db, polymarketTradeFlowEvents } from "@framework/db";
import { sql } from "drizzle-orm";
import { AUTHORITATIVE_TRADE_FLOW_TAPE } from "./polymarket-trade-flow-tape.ts";

const start = new Date(AUTHORITATIVE_TRADE_FLOW_TAPE.evalStartMs);

export const TRADE_FLOW_OPERATIONAL_HEALTH = {
  recentWindowMin: 15,
  slowIngestionMs: 10_000,
  maxP99IngestionMs: 30_000,
  pendingAgeWarningSec: 180,
  maxLastEventAgeSec: 90,
} as const;

/**
 * Exact cumulative floors change slowly and become increasingly expensive to recount as the
 * append-only tape grows. Cache only those outcome-blind totals; live collection/latency/pending
 * health is queried separately on every request and remains fail-closed.
 */
export const TRADE_FLOW_CUMULATIVE_CACHE_MS = 15 * 60_000;

export function summarizeTradeFlowStorage(input: {
  rawEvents: number;
  relationBytes: number;
  spanDays: number;
}) {
  const rawEvents = Math.max(0, Number(input.rawEvents) || 0);
  const relationBytes = Math.max(0, Number(input.relationBytes) || 0);
  const spanDays = Math.max(0, Number(input.spanDays) || 0);
  const rowsPerDay = spanDays > 0 ? rawEvents / spanDays : 0;
  const bytesPerDay = spanDays > 0 ? relationBytes / spanDays : 0;

  return {
    relationBytes,
    bytesPerRow: rawEvents > 0 ? relationBytes / rawEvents : 0,
    rowsPerDay,
    bytesPerDay,
  };
}

export function summarizeTradeFlowCapacity(input: {
  availableBytes: number | null;
  relationBytes: number;
  bytesPerDay: number;
  spanDays: number;
  floorSpanDays: number;
}) {
  const availableBytes =
    input.availableBytes == null || !Number.isFinite(input.availableBytes)
      ? null
      : Math.max(0, input.availableBytes);
  const relationBytes = Math.max(0, Number(input.relationBytes) || 0);
  const bytesPerDay = Math.max(0, Number(input.bytesPerDay) || 0);
  const spanDays = Math.max(0, Number(input.spanDays) || 0);
  const floorSpanDays = Math.max(0, Number(input.floorSpanDays) || 0);
  const remainingSpanDays = Math.max(0, floorSpanDays - spanDays);
  const projectedAdditionalBytesToFloor = bytesPerDay * remainingSpanDays;

  return {
    availableBytes,
    runwayDays: availableBytes != null && bytesPerDay > 0
      ? availableBytes / bytesPerDay
      : null,
    remainingSpanDays,
    projectedAdditionalBytesToFloor,
    projectedRelationBytesAtFloor: relationBytes + projectedAdditionalBytesToFloor,
    projectedAvailableBytesAtFloor: availableBytes == null
      ? null
      : Math.max(0, availableBytes - projectedAdditionalBytesToFloor),
  };
}

function timeMs(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

async function tradeFlowFilesystemAvailableBytes(): Promise<number | null> {
  try {
    const filesystem = await statfs(".");
    const availableBytes = Number(filesystem.bavail) * Number(filesystem.bsize);
    return Number.isFinite(availableBytes) && availableBytes >= 0 ? availableBytes : null;
  } catch {
    return null;
  }
}

export function summarizeTradeFlowOperationalHealth(input: {
  lastEventAgeSec: number | null;
  recentRawEvents: number;
  p95IngestionLatencyMs: number | null;
  p99IngestionLatencyMs: number | null;
  slowIngestionEvents: number;
  oldPendingEvents: number;
  overduePendingEvents: number;
  retryDeferredPendingEvents: number;
  oldestPendingAgeSec: number;
}) {
  const lastEventAgeSec =
    input.lastEventAgeSec == null || !Number.isFinite(input.lastEventAgeSec)
      ? null
      : Math.max(0, input.lastEventAgeSec);
  const p95IngestionLatencyMs =
    input.p95IngestionLatencyMs == null || !Number.isFinite(input.p95IngestionLatencyMs)
      ? null
      : Math.max(0, input.p95IngestionLatencyMs);
  const p99IngestionLatencyMs =
    input.p99IngestionLatencyMs == null || !Number.isFinite(input.p99IngestionLatencyMs)
      ? null
      : Math.max(0, input.p99IngestionLatencyMs);
  const recentRawEvents = Math.max(0, Number(input.recentRawEvents) || 0);
  const slowIngestionEvents = Math.max(0, Number(input.slowIngestionEvents) || 0);
  const oldPendingEvents = Math.max(0, Number(input.oldPendingEvents) || 0);
  const overduePendingEvents = Math.max(0, Number(input.overduePendingEvents) || 0);
  const retryDeferredPendingEvents = Math.max(
    0,
    Number(input.retryDeferredPendingEvents) || 0,
  );
  const oldestPendingAgeSec = Math.max(0, Number(input.oldestPendingAgeSec) || 0);
  const collectionFresh =
    recentRawEvents > 0 &&
    lastEventAgeSec != null &&
    lastEventAgeSec <= TRADE_FLOW_OPERATIONAL_HEALTH.maxLastEventAgeSec;
  const latencyHealthy =
    p99IngestionLatencyMs != null &&
    p99IngestionLatencyMs <= TRADE_FLOW_OPERATIONAL_HEALTH.maxP99IngestionMs;
  // Keep two separate questions visible. A due row means the verifier itself is behind; a
  // retry-deferred old row means the public source hash is still unavailable. Either remains
  // fail-closed, but durable backoff must not mislabel source unavailability as queue starvation.
  const verifierCaughtUp = overduePendingEvents === 0;
  const sourceReceiptsHealthy = oldPendingEvents === 0;

  return {
    healthy:
      collectionFresh &&
      latencyHealthy &&
      verifierCaughtUp &&
      sourceReceiptsHealthy,
    collectionFresh,
    latencyHealthy,
    verifierCaughtUp,
    sourceReceiptsHealthy,
    recentWindowMin: TRADE_FLOW_OPERATIONAL_HEALTH.recentWindowMin,
    recentRawEvents,
    lastEventAgeSec,
    p95IngestionLatencyMs,
    p99IngestionLatencyMs,
    slowIngestionEvents,
    slowIngestionMs: TRADE_FLOW_OPERATIONAL_HEALTH.slowIngestionMs,
    oldPendingEvents,
    overduePendingEvents,
    retryDeferredPendingEvents,
    oldestPendingAgeSec,
    pendingAgeWarningSec: TRADE_FLOW_OPERATIONAL_HEALTH.pendingAgeWarningSec,
    verificationInitialDelaySec:
      AUTHORITATIVE_TRADE_FLOW_TAPE.verifyInitialDelayMs / 1_000,
    verificationRetryBaseSec:
      AUTHORITATIVE_TRADE_FLOW_TAPE.verifyRetryBaseMs / 1_000,
    verificationRetryMaxSec:
      AUTHORITATIVE_TRADE_FLOW_TAPE.verifyRetryMaxMs / 1_000,
    maxLastEventAgeSec: TRADE_FLOW_OPERATIONAL_HEALTH.maxLastEventAgeSec,
    maxP99IngestionMs: TRADE_FLOW_OPERATIONAL_HEALTH.maxP99IngestionMs,
  };
}

type CumulativeRollupRow = {
  pair: string | null;
  is_total: number;
  raw_events: number;
  verified_events: number;
  replacement_verified_events: number;
  missing_hash_events: number;
  mismatch_events: number;
  reverted_events: number;
  hashed_events: number;
  distinct_markets: number;
  first_event_at: Date | string | null;
  last_event_at: Date | string | null;
  mapping_violations: number;
};

async function loadCumulativeTradeFlowStatus() {
  // First reduce the append-only tape to one row per immutable condition. PostgreSQL can
  // parallel-hash this cardinality without an external distinct sort. The final grouping sets then
  // produce the exact pooled and six pair rows from that same scan. At 720k rows this replaced two
  // full-table sort scans (~606ms combined) with one ~199ms exact plan.
  const [rollup, size] = await Promise.all([
    db.execute<CumulativeRollupRow>(sql`
      with per_market as materialized (
        select
          condition_id,
          min(pair) as pair,
          count(*)::int as raw_events,
          count(*) filter (where chain_status = 'verified')::int as verified_events,
          count(*) filter (
            where chain_status = 'verified'
              and verification_method = 'data_api_replacement'
          )::int as replacement_verified_events,
          count(*) filter (where chain_status = 'missing_hash')::int as missing_hash_events,
          count(*) filter (where chain_status = 'mismatch')::int as mismatch_events,
          count(*) filter (where chain_status = 'reverted')::int as reverted_events,
          count(*) filter (where transaction_hash is not null)::int as hashed_events,
          min(event_at) as first_event_at,
          max(event_at) as last_event_at,
          count(*) filter (where
            pair not in ('BTC-USD','ETH-USD','SOL-USD','XRP-USD','DOGE-USD','BNB-USD')
            or horizon_min not in (5,15)
            or outcome_side not in ('up','down')
            or window_start < ${start}
            or end_date <> window_start + (horizon_min * interval '1 minute')
          )::int as row_mapping_violations,
          (
            min(pair) <> max(pair)
            or min(horizon_min) <> max(horizon_min)
            or min(window_start) <> max(window_start)
            or min(end_date) <> max(end_date)
          ) as market_mapping_conflict
        from polymarket_trade_flow_event
        where event_at >= ${start}
        group by condition_id
      )
      select
        case when grouping(pair) = 1 then null else pair end as pair,
        grouping(pair)::int as is_total,
        coalesce(sum(raw_events), 0)::int as raw_events,
        coalesce(sum(verified_events), 0)::int as verified_events,
        coalesce(sum(replacement_verified_events), 0)::int as replacement_verified_events,
        coalesce(sum(missing_hash_events), 0)::int as missing_hash_events,
        coalesce(sum(mismatch_events), 0)::int as mismatch_events,
        coalesce(sum(reverted_events), 0)::int as reverted_events,
        coalesce(sum(hashed_events), 0)::int as hashed_events,
        count(*)::int as distinct_markets,
        min(first_event_at) as first_event_at,
        max(last_event_at) as last_event_at,
        (
          coalesce(sum(row_mapping_violations), 0)
          + count(*) filter (where market_mapping_conflict)
        )::int as mapping_violations
      from per_market
      group by grouping sets ((), (pair))
    `),
    db.execute<{ relation_bytes: number }>(sql`
      select pg_total_relation_size('polymarket_trade_flow_event')::bigint as relation_bytes
    `),
  ]);
  const total = rollup.rows.find((row) => Number(row.is_total) === 1);
  if (!total) throw new Error("authoritative flow cumulative rollup omitted its pooled row");
  const summary = {
    rawEvents: Number(total.raw_events),
    relationBytes: Number(size.rows[0]?.relation_bytes ?? 0),
    verifiedEvents: Number(total.verified_events),
    replacementVerifiedEvents: Number(total.replacement_verified_events),
    missingHashEvents: Number(total.missing_hash_events),
    mismatchEvents: Number(total.mismatch_events),
    revertedEvents: Number(total.reverted_events),
    hashedEvents: Number(total.hashed_events),
    distinctMarkets: Number(total.distinct_markets),
    firstEventAt: total.first_event_at,
    lastEventAt: total.last_event_at,
    mappingViolations: Number(total.mapping_violations),
  };
  const grouped = rollup.rows
    .filter((row) => Number(row.is_total) === 0 && row.pair != null)
    .map((row) => ({
      pair: row.pair!,
      rawEvents: Number(row.raw_events),
      verifiedEvents: Number(row.verified_events),
      distinctMarkets: Number(row.distinct_markets),
    }));
  return { summary, grouped };
}

type CumulativeTradeFlowStatus = Awaited<ReturnType<typeof loadCumulativeTradeFlowStatus>>;
let cumulativeCache:
  | { expiresAtMs: number; value: CumulativeTradeFlowStatus }
  | null = null;
let cumulativeInflight: Promise<CumulativeTradeFlowStatus> | null = null;

async function cumulativeTradeFlowStatus() {
  const now = Date.now();
  if (cumulativeCache && cumulativeCache.expiresAtMs > now) return cumulativeCache.value;
  if (cumulativeInflight) return cumulativeInflight;
  cumulativeInflight = loadCumulativeTradeFlowStatus()
    .then((value) => {
      cumulativeCache = {
        expiresAtMs: Date.now() + TRADE_FLOW_CUMULATIVE_CACHE_MS,
        value,
      };
      return value;
    })
    .finally(() => {
      cumulativeInflight = null;
    });
  return cumulativeInflight;
}

async function liveTradeFlowHealth() {
  const recent = sql`${polymarketTradeFlowEvents.eventAt}
    >= statement_timestamp()::timestamp - interval '15 minutes'`;
  const pending = sql`${polymarketTradeFlowEvents.chainStatus} = 'pending'`;
  const oldPending = sql`${polymarketTradeFlowEvents.eventAt}
    < statement_timestamp()::timestamp
      - ${TRADE_FLOW_OPERATIONAL_HEALTH.pendingAgeWarningSec} * interval '1 second'`;
  const retryDelayMs = sql`least(
    ${AUTHORITATIVE_TRADE_FLOW_TAPE.verifyRetryMaxMs},
    ${AUTHORITATIVE_TRADE_FLOW_TAPE.verifyRetryBaseMs}
      * power(
        2,
        least(
          greatest(${polymarketTradeFlowEvents.verificationAttempts} - 1, 0),
          16
        )
      )
  )`;
  const retryDue = sql`(
    (
      ${polymarketTradeFlowEvents.verificationAttemptedAt} is null
      and ${polymarketTradeFlowEvents.eventAt}
        < statement_timestamp()::timestamp
          - ${AUTHORITATIVE_TRADE_FLOW_TAPE.verifyInitialDelayMs}
            * interval '1 millisecond'
    )
    or (
      ${polymarketTradeFlowEvents.verificationAttemptedAt} is not null
      and ${polymarketTradeFlowEvents.verificationAttemptedAt}
        < statement_timestamp()::timestamp - ${retryDelayMs} * interval '1 millisecond'
    )
  )`;
  const [row] = await db
    .select({
      pendingEvents: sql<number>`count(*) filter (where ${pending})::int`,
      recentRawEvents: sql<number>`count(*) filter (where ${recent})::int`,
      lastEventAgeSec: sql<number | null>`extract(epoch from (
        statement_timestamp()::timestamp - max(${polymarketTradeFlowEvents.eventAt})
          filter (where ${recent})
      ))`,
      p95IngestionLatencyMs: sql<number | null>`percentile_cont(0.95) within group (
        order by ${polymarketTradeFlowEvents.ingestionLatencyMs}
      ) filter (where ${recent})`,
      p99IngestionLatencyMs: sql<number | null>`percentile_cont(0.99) within group (
        order by ${polymarketTradeFlowEvents.ingestionLatencyMs}
      ) filter (where ${recent})`,
      slowIngestionEvents: sql<number>`count(*) filter (
        where ${recent}
          and ${polymarketTradeFlowEvents.ingestionLatencyMs}
            > ${TRADE_FLOW_OPERATIONAL_HEALTH.slowIngestionMs}
      )::int`,
      oldPendingEvents: sql<number>`count(*) filter (
        where ${pending}
          and ${oldPending}
      )::int`,
      overduePendingEvents: sql<number>`count(*) filter (
        where ${pending}
          and ${oldPending}
          and ${retryDue}
      )::int`,
      retryDeferredPendingEvents: sql<number>`count(*) filter (
        where ${pending}
          and ${oldPending}
          and not ${retryDue}
      )::int`,
      oldestPendingAgeSec: sql<number>`coalesce(max(extract(epoch from (
        statement_timestamp()::timestamp - ${polymarketTradeFlowEvents.eventAt}
      ))) filter (where ${pending}), 0)`,
    })
    .from(polymarketTradeFlowEvents)
    // A statement-stable clock lets PostgreSQL plan a BitmapOr over the existing event-time and
    // status-time indexes, bounding this request to the recent window plus the small pending queue.
    // A volatile per-row clock would force a full scan of the append-only tape.
    .where(sql`${recent} or ${pending}`);
  return row;
}

/** Frozen readiness only. No directional or performance fields are selected or returned. */
export async function authoritativeTradeFlowTapeStatus() {
  const [{ summary, grouped }, healthSummary, availableBytes] = await Promise.all([
    cumulativeTradeFlowStatus(),
    liveTradeFlowHealth(),
    tradeFlowFilesystemAvailableBytes(),
  ]);
  const byPair = new Map(grouped.map((row) => [row.pair, row]));
  const rawEvents = Number(summary?.rawEvents ?? 0);
  const verifiedEvents = Number(summary?.verifiedEvents ?? 0);
  const replacementVerifiedEvents = Number(summary?.replacementVerifiedEvents ?? 0);
  const pendingEvents = Number(healthSummary?.pendingEvents ?? 0);
  const missingHashEvents = Number(summary?.missingHashEvents ?? 0);
  const mismatchEvents = Number(summary?.mismatchEvents ?? 0);
  const revertedEvents = Number(summary?.revertedEvents ?? 0);
  const hashedEvents = Number(summary?.hashedEvents ?? 0);
  const distinctMarkets = Number(summary?.distinctMarkets ?? 0);
  const mappingViolations = Number(summary?.mappingViolations ?? 0);
  const operationalHealth = summarizeTradeFlowOperationalHealth({
    lastEventAgeSec:
      healthSummary?.lastEventAgeSec == null ? null : Number(healthSummary.lastEventAgeSec),
    recentRawEvents: Number(healthSummary?.recentRawEvents ?? 0),
    p95IngestionLatencyMs:
      healthSummary?.p95IngestionLatencyMs == null
        ? null
        : Number(healthSummary.p95IngestionLatencyMs),
    p99IngestionLatencyMs:
      healthSummary?.p99IngestionLatencyMs == null
        ? null
        : Number(healthSummary.p99IngestionLatencyMs),
    slowIngestionEvents: Number(healthSummary?.slowIngestionEvents ?? 0),
    oldPendingEvents: Number(healthSummary?.oldPendingEvents ?? 0),
    overduePendingEvents: Number(healthSummary?.overduePendingEvents ?? 0),
    retryDeferredPendingEvents: Number(
      healthSummary?.retryDeferredPendingEvents ?? 0,
    ),
    oldestPendingAgeSec: Number(healthSummary?.oldestPendingAgeSec ?? 0),
  });
  const firstEventAtMs = timeMs(summary?.firstEventAt);
  const lastEventAtMs = timeMs(summary?.lastEventAt);
  const spanDays =
    firstEventAtMs != null && lastEventAtMs != null && lastEventAtMs >= firstEventAtMs
      ? (lastEventAtMs - firstEventAtMs) / 86_400_000
      : 0;
  const storage = summarizeTradeFlowStorage({
    rawEvents,
    relationBytes: Number(summary?.relationBytes ?? 0),
    spanDays,
  });
  const capacity = summarizeTradeFlowCapacity({
    availableBytes,
    relationBytes: storage.relationBytes,
    bytesPerDay: storage.bytesPerDay,
    spanDays,
    floorSpanDays: AUTHORITATIVE_TRADE_FLOW_TAPE.minSpanDays,
  });
  const hashCoverage = rawEvents > 0 ? hashedEvents / rawEvents : 0;
  const terminalEvents = verifiedEvents + mismatchEvents + revertedEvents;
  const chainVerificationRate = terminalEvents > 0 ? verifiedEvents / terminalEvents : 0;
  const pairs = AUTHORITATIVE_TRADE_FLOW_TAPE.targetPairs.map((pair) => {
    const row = byPair.get(pair);
    const pairMarkets = Number(row?.distinctMarkets ?? 0);
    return {
      pair,
      rawEvents: Number(row?.rawEvents ?? 0),
      verifiedEvents: Number(row?.verifiedEvents ?? 0),
      distinctMarkets: pairMarkets,
      ready: pairMarkets >= AUTHORITATIVE_TRADE_FLOW_TAPE.minMarketsPerPair,
    };
  });

  const ready =
    rawEvents >= AUTHORITATIVE_TRADE_FLOW_TAPE.minRawEvents &&
    verifiedEvents >= AUTHORITATIVE_TRADE_FLOW_TAPE.minVerifiedEvents &&
    distinctMarkets >= AUTHORITATIVE_TRADE_FLOW_TAPE.minMarkets &&
    spanDays >= AUTHORITATIVE_TRADE_FLOW_TAPE.minSpanDays &&
    pairs.every((pair) => pair.ready) &&
    hashCoverage >= AUTHORITATIVE_TRADE_FLOW_TAPE.minHashCoverage &&
    chainVerificationRate >= AUTHORITATIVE_TRADE_FLOW_TAPE.minChainVerificationRate &&
    mappingViolations === 0;

  return {
    version: AUTHORITATIVE_TRADE_FLOW_TAPE.version,
    evalStartMs: AUTHORITATIVE_TRADE_FLOW_TAPE.evalStartMs,
    paperOnly: true,
    outcomeBlind: true,
    directionalRuleRegistered: false,
    readyForOutcomeFreeDistributionAudit: ready,
    rawEvents,
    verifiedEvents,
    replacementVerifiedEvents,
    pendingEvents,
    missingHashEvents,
    mismatchEvents,
    revertedEvents,
    distinctMarkets,
    firstEventAtMs,
    lastEventAtMs,
    spanDays,
    storage,
    capacity,
    hashCoverage,
    terminalEvents,
    chainVerificationRate,
    mappingViolations,
    operationalHealth,
    pairs,
    floors: {
      rawEvents: AUTHORITATIVE_TRADE_FLOW_TAPE.minRawEvents,
      verifiedEvents: AUTHORITATIVE_TRADE_FLOW_TAPE.minVerifiedEvents,
      distinctMarkets: AUTHORITATIVE_TRADE_FLOW_TAPE.minMarkets,
      spanDays: AUTHORITATIVE_TRADE_FLOW_TAPE.minSpanDays,
      marketsPerPair: AUTHORITATIVE_TRADE_FLOW_TAPE.minMarketsPerPair,
      hashCoverage: AUTHORITATIVE_TRADE_FLOW_TAPE.minHashCoverage,
      chainVerificationRate: AUTHORITATIVE_TRADE_FLOW_TAPE.minChainVerificationRate,
      mappingViolations: 0,
    },
  };
}
