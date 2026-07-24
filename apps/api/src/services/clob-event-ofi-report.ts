/**
 * Readiness-only surface for the prospective public CLOB event-OFI tape.
 *
 * Coverage, causal transport, time span, and bucket counts are selectable here. The rolling OFI
 * values themselves, outcome direction, paper decisions, and performance stay undisclosed until
 * every frozen floor passes and a separate outcome-free distribution audit is preregistered.
 */
import { and, desc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { db, polymarketStateSnapshots } from "@framework/db";
import { CLOB_EVENT_OFI_TAPE } from "./clob-event-ofi.ts";

const PAIRS = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD", "BNB-USD"] as const;
const HORIZONS = [5, 15] as const;
const OPERATIONAL_COVERAGE_WINDOW_MIN = 30;
const FORBIDDEN_DISCLOSURE_KEY =
  /(?:canonical|imbalance|flowSign|outcome|labelUp|grade|pnl|winRate|profit|loss|chosenSide|decisionSide|rawNet|worstCase)/i;
const SAFE_DISCLOSURE_KEYS = new Set(["readyForOutcomeFreeDistributionAudit"]);

export function assertOutcomeBlindClobEventStatus(value: unknown, path = "status"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertOutcomeBlindClobEventStatus(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_DISCLOSURE_KEY.test(key) && !SAFE_DISCLOSURE_KEYS.has(key)) {
      throw new Error(`CLOB event-OFI readiness disclosure blocked at ${path}.${key}`);
    }
    assertOutcomeBlindClobEventStatus(child, `${path}.${key}`);
  }
}

export interface ClobEventOfiReadinessInput {
  usableRows: number;
  resolvedMarkets: number;
  spanDays: number;
  coverage: number;
  weakestBucketMarkets: number;
  healthy: boolean;
}

export function clobEventOfiReady(input: ClobEventOfiReadinessInput): boolean {
  return (
    input.usableRows >= CLOB_EVENT_OFI_TAPE.minRows
    && input.resolvedMarkets >= CLOB_EVENT_OFI_TAPE.minMarkets
    && input.spanDays >= CLOB_EVENT_OFI_TAPE.minSpanDays
    && input.coverage >= CLOB_EVENT_OFI_TAPE.minCoverage
    && input.weakestBucketMarkets >= CLOB_EVENT_OFI_TAPE.minRowsPerBucket
    && input.healthy
  );
}

export async function clobEventOfiTapeStatus() {
  const boundary = new Date(CLOB_EVENT_OFI_TAPE.evalStartMs);
  const operationalCoverageBoundary = new Date(Math.max(
    CLOB_EVENT_OFI_TAPE.evalStartMs,
    Date.now() - OPERATIONAL_COVERAGE_WINDOW_MIN * 60_000,
  ));
  const eligible = and(
    gte(polymarketStateSnapshots.capturedAt, boundary),
    inArray(polymarketStateSnapshots.pair, [...PAIRS]),
    inArray(polymarketStateSnapshots.horizonMin, [...HORIZONS]),
  );
  const usableFlow = and(
    eq(polymarketStateSnapshots.clobEventOfiVersion, CLOB_EVENT_OFI_TAPE.version),
    isNotNull(polymarketStateSnapshots.clobEventOfiCanonical5s),
    isNotNull(polymarketStateSnapshots.clobEventOfiCanonical30s),
    isNotNull(polymarketStateSnapshots.clobEventOfiCanonical60s),
    isNotNull(polymarketStateSnapshots.clobEventOfiUpEvents60s),
    isNotNull(polymarketStateSnapshots.clobEventOfiDownEvents60s),
    isNotNull(polymarketStateSnapshots.clobEventOfiSourceAgeSec),
    isNotNull(polymarketStateSnapshots.clobEventOfiReceiveAgeSec),
    isNotNull(polymarketStateSnapshots.clobEventOfiMaxTransportLagMs60s),
    lte(
      polymarketStateSnapshots.clobEventOfiReceiveAgeSec,
      CLOB_EVENT_OFI_TAPE.maxSocketAgeSec,
    ),
    lte(
      polymarketStateSnapshots.clobEventOfiMaxTransportLagMs60s,
      CLOB_EVENT_OFI_TAPE.maxTransportLagMs,
    ),
  );
  const usable = and(eligible, usableFlow);
  const operationalWindow = gte(
    polymarketStateSnapshots.capturedAt,
    operationalCoverageBoundary,
  );
  const pairedBookAvailable = and(
    isNotNull(polymarketStateSnapshots.upBid),
    isNotNull(polymarketStateSnapshots.upAsk),
    isNotNull(polymarketStateSnapshots.downBid),
    isNotNull(polymarketStateSnapshots.downAsk),
  );
  const [aggregate, bucketRows, latestRows] = await Promise.all([
    db
      .select({
        eligibleRows: sql<number>`count(*)::int`,
        usableRows: sql<number>`count(*) filter (where ${usableFlow})::int`,
        operationalEligibleRows: sql<number>`count(*) filter (
          where ${operationalWindow}
        )::int`,
        operationalUsableRows: sql<number>`count(*) filter (
          where ${and(operationalWindow, usableFlow)}
        )::int`,
        operationalPairedBookEligibleRows: sql<number>`count(*) filter (
          where ${and(operationalWindow, pairedBookAvailable)}
        )::int`,
        operationalPairedBookUsableRows: sql<number>`count(*) filter (
          where ${and(operationalWindow, pairedBookAvailable, usableFlow)}
        )::int`,
        markets: sql<number>`count(distinct ${polymarketStateSnapshots.conditionId})::int`,
        resolvedMarkets: sql<number>`count(distinct ${polymarketStateSnapshots.conditionId})
          filter (where
            ${polymarketStateSnapshots.labelStatus} = 'resolved'
            and ${usableFlow}
          )::int`,
        firstCapturedAt: sql<Date | null>`min(${polymarketStateSnapshots.capturedAt})
          filter (where ${polymarketStateSnapshots.clobEventOfiVersion} = ${CLOB_EVENT_OFI_TAPE.version})`,
        lastCapturedAt: sql<Date | null>`max(${polymarketStateSnapshots.capturedAt})
          filter (where ${polymarketStateSnapshots.clobEventOfiVersion} = ${CLOB_EVENT_OFI_TAPE.version})`,
      })
      .from(polymarketStateSnapshots)
      .where(eligible)
      .then((rows) => rows[0]),
    db
      .select({
        pair: polymarketStateSnapshots.pair,
        horizonMin: polymarketStateSnapshots.horizonMin,
        rows: sql<number>`count(*)::int`,
        markets: sql<number>`count(distinct ${polymarketStateSnapshots.conditionId})::int`,
      })
      .from(polymarketStateSnapshots)
      .where(usable)
      .groupBy(polymarketStateSnapshots.pair, polymarketStateSnapshots.horizonMin),
    db
      .select({
        capturedAt: polymarketStateSnapshots.capturedAt,
        marketDataAgeSec: polymarketStateSnapshots.clobEventOfiReceiveAgeSec,
        maxTransportLagMs: polymarketStateSnapshots.clobEventOfiMaxTransportLagMs60s,
      })
      .from(polymarketStateSnapshots)
      .where(
        and(
          gte(polymarketStateSnapshots.capturedAt, boundary),
          eq(polymarketStateSnapshots.clobEventOfiVersion, CLOB_EVENT_OFI_TAPE.version),
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
  const operationalEligibleRows = Number(aggregate?.operationalEligibleRows ?? 0);
  const operationalUsableRows = Number(aggregate?.operationalUsableRows ?? 0);
  const operationalCoverage = operationalEligibleRows > 0
    ? operationalUsableRows / operationalEligibleRows
    : null;
  const operationalPairedBookEligibleRows = Number(
    aggregate?.operationalPairedBookEligibleRows ?? 0,
  );
  const operationalPairedBookUsableRows = Number(
    aggregate?.operationalPairedBookUsableRows ?? 0,
  );
  const operationalPairedBookCoverage = operationalPairedBookEligibleRows > 0
    ? operationalPairedBookUsableRows / operationalPairedBookEligibleRows
    : null;
  const operationalPairedBookUnavailableRows = Math.max(
    0,
    operationalEligibleRows - operationalPairedBookEligibleRows,
  );
  const operationalTransportMissingRows = Math.max(
    0,
    operationalPairedBookEligibleRows - operationalPairedBookUsableRows,
  );
  const bucketByKey = new Map(
    bucketRows.map(
      (row) =>
        [
          `${row.pair}|${row.horizonMin}`,
          {
            pair: row.pair,
            horizonMin: row.horizonMin,
            rows: Number(row.rows),
            markets: Number(row.markets),
          },
        ] as const,
    ),
  );
  const buckets = PAIRS.flatMap((pair) =>
    HORIZONS.map(
      (horizonMin) =>
        bucketByKey.get(`${pair}|${horizonMin}`) ?? { pair, horizonMin, rows: 0, markets: 0 },
    ),
  );
  const weakestBucketMarkets = Math.min(...buckets.map((bucket) => bucket.markets));
  const now = Date.now();
  const lastCaptureAgeSec = lastMs == null ? null : Math.max(0, (now - lastMs) / 1_000);
  const latestMarketDataAgeSec = latestRows.length
    ? Math.max(...latestRows.map((row) => Number(row.marketDataAgeSec ?? Number.POSITIVE_INFINITY)))
    : null;
  const latestMaxTransportLagMs = latestRows.length
    ? Math.max(...latestRows.map((row) => Number(row.maxTransportLagMs ?? Number.POSITIVE_INFINITY)))
    : null;
  const healthy =
    lastCaptureAgeSec != null
    && lastCaptureAgeSec <= 180
    && latestMarketDataAgeSec != null
    && latestMarketDataAgeSec <= CLOB_EVENT_OFI_TAPE.maxSocketAgeSec
    && latestMaxTransportLagMs != null
    && latestMaxTransportLagMs <= CLOB_EVENT_OFI_TAPE.maxTransportLagMs;
  const readiness = {
    usableRows,
    resolvedMarkets: Number(aggregate?.resolvedMarkets ?? 0),
    spanDays,
    coverage,
    weakestBucketMarkets,
    healthy,
  };
  const status = {
    version: CLOB_EVENT_OFI_TAPE.version,
    evalStartMs: CLOB_EVENT_OFI_TAPE.evalStartMs,
    floors: {
      usableRows: CLOB_EVENT_OFI_TAPE.minRows,
      resolvedMarkets: CLOB_EVENT_OFI_TAPE.minMarkets,
      spanDays: CLOB_EVENT_OFI_TAPE.minSpanDays,
      marketsPerBucket: CLOB_EVENT_OFI_TAPE.minRowsPerBucket,
      coverage: CLOB_EVENT_OFI_TAPE.minCoverage,
    },
    eligibleRows,
    usableRows,
    markets: Number(aggregate?.markets ?? 0),
    resolvedMarkets: readiness.resolvedMarkets,
    spanDays,
    coverage,
    operationalCoverage: {
      windowMin: OPERATIONAL_COVERAGE_WINDOW_MIN,
      eligibleRows: operationalEligibleRows,
      usableRows: operationalUsableRows,
      coverage: operationalCoverage,
      pairedBookEligibleRows: operationalPairedBookEligibleRows,
      pairedBookUsableRows: operationalPairedBookUsableRows,
      pairedBookCoverage: operationalPairedBookCoverage,
      pairedBookUnavailableRows: operationalPairedBookUnavailableRows,
      transportMissingRows: operationalTransportMissingRows,
    },
    firstCapturedAtMs: firstMs,
    lastCapturedAtMs: lastMs,
    buckets,
    weakestBucketMarkets,
    operationalHealth: {
      healthy,
      lastCaptureAgeSec,
      latestMarketDataAgeSec,
      maxSocketAgeSec: CLOB_EVENT_OFI_TAPE.maxSocketAgeSec,
      latestMaxTransportLagMs,
      maxTransportLagMs: CLOB_EVENT_OFI_TAPE.maxTransportLagMs,
    },
    readyForOutcomeFreeDistributionAudit: clobEventOfiReady(readiness),
  };
  assertOutcomeBlindClobEventStatus(status);
  return status;
}
