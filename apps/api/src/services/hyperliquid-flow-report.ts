/**
 * Readiness-only surface for the prospective Hyperliquid aggressor-flow tape.
 *
 * This module deliberately selects coverage, timing, and nullability only. It never selects a flow
 * sign, market outcome, grade, paper decision, or P&L. Once every frozen floor passes, a separate
 * outcome-free distribution audit may be specified; no directional rule exists in this version.
 */
import { and, desc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { db, polymarketStateSnapshots } from "@framework/db";
import { HYPERLIQUID_FLOW_TAPE } from "./hl-rtds.ts";

const PAIRS = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD", "BNB-USD"] as const;
const HORIZONS = [5, 15] as const;
const FORBIDDEN_DISCLOSURE_KEY =
  /(?:imbalance|flowSign|outcome|labelUp|grade|pnl|winRate|profit|loss|chosenSide|decisionSide|rawNet|worstCase)/i;
const SAFE_DISCLOSURE_KEYS = new Set(["readyForOutcomeFreeDistributionAudit"]);

/**
 * Fail closed if a future refactor adds a result-bearing field to this readiness surface.
 * Resolution counts are allowed; resolution direction and every strategy-performance field are not.
 */
export function assertOutcomeBlindFlowStatus(value: unknown, path = "status"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertOutcomeBlindFlowStatus(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_DISCLOSURE_KEY.test(key) && !SAFE_DISCLOSURE_KEYS.has(key)) {
      throw new Error(`Hyperliquid flow readiness disclosure blocked at ${path}.${key}`);
    }
    assertOutcomeBlindFlowStatus(child, `${path}.${key}`);
  }
}

export interface HyperliquidFlowReadinessInput {
  usableRows: number;
  resolvedMarkets: number;
  spanDays: number;
  coverage: number;
  weakestBucketMarkets: number;
  healthy: boolean;
}

export function hyperliquidFlowReady(input: HyperliquidFlowReadinessInput): boolean {
  return (
    input.usableRows >= HYPERLIQUID_FLOW_TAPE.minUsableRows &&
    input.resolvedMarkets >= HYPERLIQUID_FLOW_TAPE.minResolvedMarkets &&
    input.spanDays >= HYPERLIQUID_FLOW_TAPE.minSpanDays &&
    input.coverage >= HYPERLIQUID_FLOW_TAPE.minCoverage &&
    input.weakestBucketMarkets >= HYPERLIQUID_FLOW_TAPE.minMarketsPerBucket &&
    input.healthy
  );
}

export interface HyperliquidCoverageBreakdownInput {
  eligibleRows: number;
  usableRows: number;
  taggedRows: number;
  missingSnapshotRows: number;
  wrongVersionRows: number;
  incompleteTaggedRows: number;
  staleTradeRows: number;
  delayedTransportRows: number;
}

export function summarizeHyperliquidCoverage(input: HyperliquidCoverageBreakdownInput) {
  const accountedRows =
    input.usableRows
    + input.missingSnapshotRows
    + input.wrongVersionRows
    + input.incompleteTaggedRows
    + input.staleTradeRows
    + input.delayedTransportRows;
  const completeTaggedRows =
    input.usableRows + input.staleTradeRows + input.delayedTransportRows;
  return {
    taggedRows: input.taggedRows,
    completeTaggedRows,
    missingSnapshotRows: input.missingSnapshotRows,
    wrongVersionRows: input.wrongVersionRows,
    incompleteTaggedRows: input.incompleteTaggedRows,
    staleTradeRows: input.staleTradeRows,
    delayedTransportRows: input.delayedTransportRows,
    taggedCoverage: input.eligibleRows > 0 ? input.taggedRows / input.eligibleRows : null,
    completeTaggedUsableCoverage:
      completeTaggedRows > 0 ? input.usableRows / completeTaggedRows : null,
    accountedRows,
    exactAccounting:
      accountedRows === input.eligibleRows
      && input.taggedRows
        === completeTaggedRows + input.incompleteTaggedRows,
  };
}

export async function hyperliquidFlowTapeStatus() {
  const boundary = new Date(HYPERLIQUID_FLOW_TAPE.evalStartMs);
  const eligible = and(
    gte(polymarketStateSnapshots.capturedAt, boundary),
    inArray(polymarketStateSnapshots.pair, [...PAIRS]),
    inArray(polymarketStateSnapshots.horizonMin, [...HORIZONS]),
  );
  const taggedFlow = eq(
    polymarketStateSnapshots.hlFlowVersion,
    HYPERLIQUID_FLOW_TAPE.version,
  );
  const completeFlowFields = and(
    isNotNull(polymarketStateSnapshots.hlFlowImbalance60s),
    isNotNull(polymarketStateSnapshots.hlFlowNotional60s),
    isNotNull(polymarketStateSnapshots.hlFlowTradeCount60s),
    isNotNull(polymarketStateSnapshots.hlFlowMaxTradeShare60s),
    isNotNull(polymarketStateSnapshots.hlFlowSourceAgeSec),
    isNotNull(polymarketStateSnapshots.hlFlowReceiveAgeSec),
    isNotNull(polymarketStateSnapshots.hlFlowMaxTransportLagMs60s),
  );
  const completeTaggedFlow = and(taggedFlow, completeFlowFields);
  const usableFlow = and(
    completeTaggedFlow,
    // A null 5s/30s imbalance means there were no trades in that subwindow. It is a legitimate
    // sparse-flow observation, not missing transport. The enclosing 60s aggregate must be complete.
    lte(
      polymarketStateSnapshots.hlFlowMaxTransportLagMs60s,
      HYPERLIQUID_FLOW_TAPE.maxTransportLagMs,
    ),
    lte(
      polymarketStateSnapshots.hlFlowReceiveAgeSec,
      HYPERLIQUID_FLOW_TAPE.maxLastTradeAgeSec,
    ),
  );
  const [aggregate, bucketRows, latestRows] = await Promise.all([
    db
      .select({
        eligibleRows: sql<number>`count(*)::int`,
        usableRows: sql<number>`count(*) filter (where ${usableFlow})::int`,
        taggedRows: sql<number>`count(*) filter (where ${taggedFlow})::int`,
        missingSnapshotRows: sql<number>`count(*) filter (
          where ${polymarketStateSnapshots.hlFlowVersion} is null
        )::int`,
        wrongVersionRows: sql<number>`count(*) filter (
          where ${polymarketStateSnapshots.hlFlowVersion} is not null
            and ${polymarketStateSnapshots.hlFlowVersion}
              <> ${HYPERLIQUID_FLOW_TAPE.version}
        )::int`,
        incompleteTaggedRows: sql<number>`count(*) filter (
          where ${taggedFlow} and not (${completeFlowFields})
        )::int`,
        staleTradeRows: sql<number>`count(*) filter (
          where ${completeTaggedFlow}
            and ${polymarketStateSnapshots.hlFlowReceiveAgeSec}
              > ${HYPERLIQUID_FLOW_TAPE.maxLastTradeAgeSec}
        )::int`,
        delayedTransportRows: sql<number>`count(*) filter (
          where ${completeTaggedFlow}
            and ${polymarketStateSnapshots.hlFlowReceiveAgeSec}
              <= ${HYPERLIQUID_FLOW_TAPE.maxLastTradeAgeSec}
            and ${polymarketStateSnapshots.hlFlowMaxTransportLagMs60s}
              > ${HYPERLIQUID_FLOW_TAPE.maxTransportLagMs}
        )::int`,
        markets: sql<number>`count(distinct ${polymarketStateSnapshots.conditionId})::int`,
        resolvedMarkets: sql<number>`count(distinct ${polymarketStateSnapshots.conditionId})
          filter (where
            ${polymarketStateSnapshots.labelStatus} = 'resolved'
            and ${usableFlow}
          )::int`,
        firstCapturedAt: sql<Date | null>`min(${polymarketStateSnapshots.capturedAt})
          filter (where ${polymarketStateSnapshots.hlFlowVersion} = ${HYPERLIQUID_FLOW_TAPE.version})`,
        lastCapturedAt: sql<Date | null>`max(${polymarketStateSnapshots.capturedAt})
          filter (where ${polymarketStateSnapshots.hlFlowVersion} = ${HYPERLIQUID_FLOW_TAPE.version})`,
      })
      .from(polymarketStateSnapshots)
      .where(eligible)
      .then((rows) => rows[0]),
    db
      .select({
        pair: polymarketStateSnapshots.pair,
        horizonMin: polymarketStateSnapshots.horizonMin,
        eligibleRows: sql<number>`count(*)::int`,
        rows: sql<number>`count(*) filter (where ${usableFlow})::int`,
        taggedRows: sql<number>`count(*) filter (where ${taggedFlow})::int`,
        missingSnapshotRows: sql<number>`count(*) filter (
          where ${polymarketStateSnapshots.hlFlowVersion} is null
        )::int`,
        delayedTransportRows: sql<number>`count(*) filter (
          where ${completeTaggedFlow}
            and ${polymarketStateSnapshots.hlFlowReceiveAgeSec}
              <= ${HYPERLIQUID_FLOW_TAPE.maxLastTradeAgeSec}
            and ${polymarketStateSnapshots.hlFlowMaxTransportLagMs60s}
              > ${HYPERLIQUID_FLOW_TAPE.maxTransportLagMs}
        )::int`,
        markets: sql<number>`count(distinct ${polymarketStateSnapshots.conditionId})
          filter (where ${usableFlow})::int`,
      })
      .from(polymarketStateSnapshots)
      .where(eligible)
      .groupBy(polymarketStateSnapshots.pair, polymarketStateSnapshots.horizonMin),
    db
      .select({
        capturedAt: polymarketStateSnapshots.capturedAt,
        lastTradeAgeSec: polymarketStateSnapshots.hlFlowReceiveAgeSec,
        maxTransportLagMs: polymarketStateSnapshots.hlFlowMaxTransportLagMs60s,
      })
      .from(polymarketStateSnapshots)
      .where(
        and(
          gte(polymarketStateSnapshots.capturedAt, boundary),
          eq(polymarketStateSnapshots.hlFlowVersion, HYPERLIQUID_FLOW_TAPE.version),
        ),
      )
      .orderBy(desc(polymarketStateSnapshots.capturedAt))
      .limit(12),
  ]);

  const firstMs = aggregate?.firstCapturedAt ? new Date(aggregate.firstCapturedAt).getTime() : null;
  const lastMs = aggregate?.lastCapturedAt ? new Date(aggregate.lastCapturedAt).getTime() : null;
  const spanDays = firstMs != null && lastMs != null ? (lastMs - firstMs) / 86_400_000 : 0;
  const eligibleRows = Number(aggregate?.eligibleRows ?? 0);
  const usableRows = Number(aggregate?.usableRows ?? 0);
  const coverage = eligibleRows > 0 ? usableRows / eligibleRows : 0;
  const coverageBreakdown = summarizeHyperliquidCoverage({
    eligibleRows,
    usableRows,
    taggedRows: Number(aggregate?.taggedRows ?? 0),
    missingSnapshotRows: Number(aggregate?.missingSnapshotRows ?? 0),
    wrongVersionRows: Number(aggregate?.wrongVersionRows ?? 0),
    incompleteTaggedRows: Number(aggregate?.incompleteTaggedRows ?? 0),
    staleTradeRows: Number(aggregate?.staleTradeRows ?? 0),
    delayedTransportRows: Number(aggregate?.delayedTransportRows ?? 0),
  });
  const bucketByKey = new Map(
    bucketRows.map(
      (row) =>
        [
          `${row.pair}|${row.horizonMin}`,
          {
            pair: row.pair,
            horizonMin: row.horizonMin,
            eligibleRows: Number(row.eligibleRows),
            rows: Number(row.rows),
            taggedRows: Number(row.taggedRows),
            missingSnapshotRows: Number(row.missingSnapshotRows),
            delayedTransportRows: Number(row.delayedTransportRows),
            markets: Number(row.markets),
          },
        ] as const,
    ),
  );
  const buckets = PAIRS.flatMap((pair) =>
    HORIZONS.map(
      (horizonMin) =>
        bucketByKey.get(`${pair}|${horizonMin}`) ?? {
          pair,
          horizonMin,
          eligibleRows: 0,
          rows: 0,
          taggedRows: 0,
          missingSnapshotRows: 0,
          delayedTransportRows: 0,
          markets: 0,
        },
    ),
  );
  const weakestBucketMarkets = Math.min(...buckets.map((bucket) => bucket.markets));
  const now = Date.now();
  const lastCaptureAgeSec = lastMs == null ? null : Math.max(0, (now - lastMs) / 1000);
  const latestLastTradeAgeSec = latestRows.length
    ? Math.max(...latestRows.map((row) => Number(row.lastTradeAgeSec ?? Number.POSITIVE_INFINITY)))
    : null;
  const latestMaxTransportLagMs = latestRows.length
    ? Math.max(...latestRows.map((row) => Number(row.maxTransportLagMs ?? Number.POSITIVE_INFINITY)))
    : null;
  const healthy =
    lastCaptureAgeSec != null &&
    lastCaptureAgeSec <= 180 &&
    latestLastTradeAgeSec != null &&
    latestLastTradeAgeSec <= HYPERLIQUID_FLOW_TAPE.maxLastTradeAgeSec &&
    latestMaxTransportLagMs != null &&
    latestMaxTransportLagMs <= HYPERLIQUID_FLOW_TAPE.maxTransportLagMs &&
    coverageBreakdown.exactAccounting &&
    coverageBreakdown.wrongVersionRows === 0;
  const readiness = {
    usableRows,
    resolvedMarkets: Number(aggregate?.resolvedMarkets ?? 0),
    spanDays,
    coverage,
    weakestBucketMarkets,
    healthy,
  };

  const status = {
    version: HYPERLIQUID_FLOW_TAPE.version,
    evalStartMs: HYPERLIQUID_FLOW_TAPE.evalStartMs,
    floors: {
      usableRows: HYPERLIQUID_FLOW_TAPE.minUsableRows,
      resolvedMarkets: HYPERLIQUID_FLOW_TAPE.minResolvedMarkets,
      spanDays: HYPERLIQUID_FLOW_TAPE.minSpanDays,
      marketsPerBucket: HYPERLIQUID_FLOW_TAPE.minMarketsPerBucket,
      coverage: HYPERLIQUID_FLOW_TAPE.minCoverage,
    },
    eligibleRows,
    usableRows,
    markets: Number(aggregate?.markets ?? 0),
    resolvedMarkets: readiness.resolvedMarkets,
    spanDays,
    coverage,
    coverageBreakdown,
    firstCapturedAtMs: firstMs,
    lastCapturedAtMs: lastMs,
    buckets,
    weakestBucketMarkets,
    operationalHealth: {
      healthy,
      lastCaptureAgeSec,
      latestLastTradeAgeSec,
      maxLastTradeAgeSec: HYPERLIQUID_FLOW_TAPE.maxLastTradeAgeSec,
      latestMaxTransportLagMs,
      maxTransportLagMs: HYPERLIQUID_FLOW_TAPE.maxTransportLagMs,
    },
    readyForOutcomeFreeDistributionAudit: hyperliquidFlowReady(readiness),
  };
  assertOutcomeBlindFlowStatus(status);
  return status;
}
