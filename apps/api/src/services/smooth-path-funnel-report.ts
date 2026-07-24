/**
 * Outcome-blind status report for the prospectively captured Smooth Path v1/v2 decision funnel.
 *
 * The report reads only the dedicated funnel relation. It never joins paper trades, resolutions,
 * prices, directions, grades, returns, accounts, orders, or positions.
 */
import { db, polymarketSmoothPathFunnel } from "@framework/db";
import { sql } from "drizzle-orm";
import {
  SMOOTH_PATH_CAUSAL_DISPLACEMENT,
  SMOOTH_PATH_DISPLACEMENT,
} from "./smooth-path-displacement.ts";
import {
  SMOOTH_PATH_QUALITY_TAPE,
  smoothPathQualityReady,
} from "./smooth-path-quality-tape.ts";

const PAIRS = [...SMOOTH_PATH_CAUSAL_DISPLACEMENT.pairs];
const VERSION_META = [
  {
    version: SMOOTH_PATH_DISPLACEMENT.version,
    botKey: "smoothPathDisplacement",
    label: "v1 · source-time path",
  },
  {
    version: SMOOTH_PATH_CAUSAL_DISPLACEMENT.version,
    botKey: "smoothPathCausalDisplacement",
    label: "v2 · causal-delivery path",
  },
] as const;

type AggregateRow = {
  version: string;
  botKey: string;
  eligibleRows: number;
  observedRows: number;
  pathQualifiedRows: number;
  bookQualifiedRows: number;
  placedRows: number;
  firstWindow: Date | string | null;
  lastWindow: Date | string | null;
  lastCapturedAt: Date | string | null;
  qualityEligibleRows?: number;
  qualityMetricRows?: number;
  qualityFirstWindow?: Date | string | null;
  qualityLastWindow?: Date | string | null;
  absDisplacementP10?: number | string | null;
  absDisplacementP50?: number | string | null;
  absDisplacementP90?: number | string | null;
  pathR2P10?: number | string | null;
  pathR2P50?: number | string | null;
  pathR2P90?: number | string | null;
  pathEfficiencyP10?: number | string | null;
  pathEfficiencyP50?: number | string | null;
  pathEfficiencyP90?: number | string | null;
  continuationSlopeP10?: number | string | null;
  continuationSlopeP50?: number | string | null;
  continuationSlopeP90?: number | string | null;
  continuationFreshP10?: number | string | null;
  continuationFreshP50?: number | string | null;
  continuationFreshP90?: number | string | null;
};

type PairRow = {
  version: string;
  pair: string;
  eligibleRows: number;
  observedRows: number;
  pathQualifiedRows: number;
  bookQualifiedRows: number;
  placedRows: number;
  qualityMetricRows?: number;
};

type RejectionRow = {
  version: string;
  reason: string;
  count: number;
};

const numberValue = (value: number | string | null | undefined) =>
  Math.max(0, Number(value) || 0);

const metricValue = (value: number | string | null | undefined): number | null => {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const quantiles = (
  p10: number | string | null | undefined,
  p50: number | string | null | undefined,
  p90: number | string | null | undefined,
) => ({
  p10: metricValue(p10),
  p50: metricValue(p50),
  p90: metricValue(p90),
});

const timeMs = (value: Date | string | null | undefined): number | null => {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
};

export function summarizeSmoothPathFunnel(
  aggregates: readonly AggregateRow[],
  pairRows: readonly PairRow[],
  rejectionRows: readonly RejectionRow[],
  nowMs = Date.now(),
) {
  const aggregateByVersion = new Map(aggregates.map((row) => [row.version, row]));
  const pairByVersion = new Map<string, Map<string, PairRow>>();
  for (const row of pairRows) {
    let versionRows = pairByVersion.get(row.version);
    if (!versionRows) {
      versionRows = new Map();
      pairByVersion.set(row.version, versionRows);
    }
    versionRows.set(row.pair, row);
  }
  const rejectionByVersion = new Map<string, RejectionRow[]>();
  for (const row of rejectionRows) {
    const rows = rejectionByVersion.get(row.version) ?? [];
    rows.push(row);
    rejectionByVersion.set(row.version, rows);
  }

  const versions = VERSION_META.map((meta) => {
    const row = aggregateByVersion.get(meta.version);
    const pairs = PAIRS.map((pair) => {
      const pairRow = pairByVersion.get(meta.version)?.get(pair);
      return {
        pair,
        eligibleRows: numberValue(pairRow?.eligibleRows),
        observedRows: numberValue(pairRow?.observedRows),
        pathQualifiedRows: numberValue(pairRow?.pathQualifiedRows),
        bookQualifiedRows: numberValue(pairRow?.bookQualifiedRows),
        placedRows: numberValue(pairRow?.placedRows),
        qualityMetricRows: numberValue(pairRow?.qualityMetricRows),
      };
    });
    const qualityEligibleRows = numberValue(row?.qualityEligibleRows);
    const qualityMetricRows = numberValue(row?.qualityMetricRows);
    const qualityFirstWindowMs = timeMs(row?.qualityFirstWindow);
    const qualityLastWindowMs = timeMs(row?.qualityLastWindow);
    const qualitySpanDays =
      qualityFirstWindowMs != null && qualityLastWindowMs != null
        ? (qualityLastWindowMs - qualityFirstWindowMs) / 86_400_000
        : 0;
    const weakestPairMetricRows = Math.min(...pairs.map((pair) => pair.qualityMetricRows));
    const qualityCoverage = qualityEligibleRows > 0
      ? qualityMetricRows / qualityEligibleRows
      : 0;
    const qualityReady = smoothPathQualityReady({
      metricRows: qualityMetricRows,
      weakestPairMetricRows,
      spanDays: qualitySpanDays,
      coverage: qualityCoverage,
    });
    const disclosedQuantiles = (
      p10: number | string | null | undefined,
      p50: number | string | null | undefined,
      p90: number | string | null | undefined,
    ) => qualityReady ? quantiles(p10, p50, p90) : quantiles(null, null, null);
    return {
      ...meta,
      eligibleRows: numberValue(row?.eligibleRows),
      observedRows: numberValue(row?.observedRows),
      pathQualifiedRows: numberValue(row?.pathQualifiedRows),
      bookQualifiedRows: numberValue(row?.bookQualifiedRows),
      placedRows: numberValue(row?.placedRows),
      firstWindowMs: timeMs(row?.firstWindow),
      lastWindowMs: timeMs(row?.lastWindow),
      lastCapturedAtMs: timeMs(row?.lastCapturedAt),
      quality: {
        eligibleRows: qualityEligibleRows,
        metricRows: qualityMetricRows,
        coverage: qualityCoverage,
        spanDays: qualitySpanDays,
        firstWindowMs: qualityFirstWindowMs,
        lastWindowMs: qualityLastWindowMs,
        weakestPairMetricRows,
        readyForThresholdDesign: qualityReady,
        absDisplacementLog: disclosedQuantiles(
          row?.absDisplacementP10,
          row?.absDisplacementP50,
          row?.absDisplacementP90,
        ),
        pathR2: disclosedQuantiles(row?.pathR2P10, row?.pathR2P50, row?.pathR2P90),
        pathEfficiency: disclosedQuantiles(
          row?.pathEfficiencyP10,
          row?.pathEfficiencyP50,
          row?.pathEfficiencyP90,
        ),
        continuationSlopePerSec: disclosedQuantiles(
          row?.continuationSlopeP10,
          row?.continuationSlopeP50,
          row?.continuationSlopeP90,
        ),
        continuationFreshLog: disclosedQuantiles(
          row?.continuationFreshP10,
          row?.continuationFreshP50,
          row?.continuationFreshP90,
        ),
      },
      rejections: [...(rejectionByVersion.get(meta.version) ?? [])]
        .map((item) => ({ reason: item.reason, count: numberValue(item.count) }))
        .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason)),
      pairs,
    };
  });
  const lastCapturedAtMs = Math.max(
    ...versions.map((version) => version.lastCapturedAtMs ?? Number.NEGATIVE_INFINITY),
  );
  const normalizedLastCapture = Number.isFinite(lastCapturedAtMs) ? lastCapturedAtMs : null;
  const collectionDueMs = SMOOTH_PATH_CAUSAL_DISPLACEMENT.evalStartMs + 4 * 60_000;
  const scheduled = nowMs < collectionDueMs;
  const maxCaptureAgeMs = 12 * 60_000;
  const collectionFresh =
    scheduled
    || (
      versions.every((version) => version.eligibleRows > 0)
      && normalizedLastCapture != null
      && nowMs - normalizedLastCapture <= maxCaptureAgeMs
    );

  return {
    boundaryMs: SMOOTH_PATH_CAUSAL_DISPLACEMENT.evalStartMs,
    paperOnly: true,
    outcomeBlind: true,
    scheduled,
    collectionFresh,
    maxCaptureAgeMin: maxCaptureAgeMs / 60_000,
    lastCapturedAtMs: normalizedLastCapture,
    totalRows: versions.reduce((sum, version) => sum + version.eligibleRows, 0),
    rowCapPerFiveMinutes: VERSION_META.length * PAIRS.length,
    qualityTape: {
      version: SMOOTH_PATH_QUALITY_TAPE.version,
      evalStartMs: SMOOTH_PATH_QUALITY_TAPE.evalStartMs,
      scheduled: nowMs < SMOOTH_PATH_QUALITY_TAPE.evalStartMs,
      floors: {
        metricRowsPerVersion: SMOOTH_PATH_QUALITY_TAPE.minMetricRowsPerVersion,
        metricRowsPerPair: SMOOTH_PATH_QUALITY_TAPE.minMetricRowsPerPair,
        spanDays: SMOOTH_PATH_QUALITY_TAPE.minSpanDays,
        coverage: SMOOTH_PATH_QUALITY_TAPE.minCoverage,
      },
      allVersionsReadyForThresholdDesign:
        nowMs >= SMOOTH_PATH_QUALITY_TAPE.evalStartMs
        && versions.every((version) => version.quality.readyForThresholdDesign),
    },
    versions,
  };
}

export async function smoothPathFunnelStatus() {
  const qualityBoundary = new Date(SMOOTH_PATH_QUALITY_TAPE.evalStartMs);
  const qualityEligible = sql`${polymarketSmoothPathFunnel.windowStart} >= ${qualityBoundary}`;
  const qualityComplete = sql`${qualityEligible}
    and ${polymarketSmoothPathFunnel.absDisplacementLog} is not null
    and ${polymarketSmoothPathFunnel.pathR2} is not null
    and ${polymarketSmoothPathFunnel.pathEfficiency} is not null
    and ${polymarketSmoothPathFunnel.continuationSlopePerSec} is not null
    and ${polymarketSmoothPathFunnel.continuationFreshLog} is not null`;
  const aggregates = await db
    .select({
      version: polymarketSmoothPathFunnel.version,
      botKey: polymarketSmoothPathFunnel.botKey,
      eligibleRows: sql<number>`count(*)::int`,
      observedRows:
        sql<number>`count(*) filter (where ${polymarketSmoothPathFunnel.observed})::int`,
      pathQualifiedRows:
        sql<number>`count(*) filter (where ${polymarketSmoothPathFunnel.pathQualified})::int`,
      bookQualifiedRows:
        sql<number>`count(*) filter (where ${polymarketSmoothPathFunnel.bookQualified})::int`,
      placedRows:
        sql<number>`count(*) filter (where ${polymarketSmoothPathFunnel.placed})::int`,
      firstWindow: sql<Date | null>`min(${polymarketSmoothPathFunnel.windowStart})`,
      lastWindow: sql<Date | null>`max(${polymarketSmoothPathFunnel.windowStart})`,
      lastCapturedAt: sql<Date | null>`max(${polymarketSmoothPathFunnel.capturedAt})`,
      qualityEligibleRows: sql<number>`count(*) filter
        (where ${qualityEligible} and ${polymarketSmoothPathFunnel.observed})::int`,
      qualityMetricRows: sql<number>`count(*) filter (where ${qualityComplete})::int`,
      qualityFirstWindow: sql<Date | null>`min(${polymarketSmoothPathFunnel.windowStart})
        filter (where ${qualityComplete})`,
      qualityLastWindow: sql<Date | null>`max(${polymarketSmoothPathFunnel.windowStart})
        filter (where ${qualityComplete})`,
      absDisplacementP10: sql<number | null>`percentile_cont(0.10) within group
        (order by ${polymarketSmoothPathFunnel.absDisplacementLog})
        filter (where ${qualityEligible}
          and ${polymarketSmoothPathFunnel.absDisplacementLog} is not null)`,
      absDisplacementP50: sql<number | null>`percentile_cont(0.50) within group
        (order by ${polymarketSmoothPathFunnel.absDisplacementLog})
        filter (where ${qualityEligible}
          and ${polymarketSmoothPathFunnel.absDisplacementLog} is not null)`,
      absDisplacementP90: sql<number | null>`percentile_cont(0.90) within group
        (order by ${polymarketSmoothPathFunnel.absDisplacementLog})
        filter (where ${qualityEligible}
          and ${polymarketSmoothPathFunnel.absDisplacementLog} is not null)`,
      pathR2P10: sql<number | null>`percentile_cont(0.10) within group
        (order by ${polymarketSmoothPathFunnel.pathR2})
        filter (where ${qualityEligible} and ${polymarketSmoothPathFunnel.pathR2} is not null)`,
      pathR2P50: sql<number | null>`percentile_cont(0.50) within group
        (order by ${polymarketSmoothPathFunnel.pathR2})
        filter (where ${qualityEligible} and ${polymarketSmoothPathFunnel.pathR2} is not null)`,
      pathR2P90: sql<number | null>`percentile_cont(0.90) within group
        (order by ${polymarketSmoothPathFunnel.pathR2})
        filter (where ${qualityEligible} and ${polymarketSmoothPathFunnel.pathR2} is not null)`,
      pathEfficiencyP10: sql<number | null>`percentile_cont(0.10) within group
        (order by ${polymarketSmoothPathFunnel.pathEfficiency})
        filter (where ${qualityEligible}
          and ${polymarketSmoothPathFunnel.pathEfficiency} is not null)`,
      pathEfficiencyP50: sql<number | null>`percentile_cont(0.50) within group
        (order by ${polymarketSmoothPathFunnel.pathEfficiency})
        filter (where ${qualityEligible}
          and ${polymarketSmoothPathFunnel.pathEfficiency} is not null)`,
      pathEfficiencyP90: sql<number | null>`percentile_cont(0.90) within group
        (order by ${polymarketSmoothPathFunnel.pathEfficiency})
        filter (where ${qualityEligible}
          and ${polymarketSmoothPathFunnel.pathEfficiency} is not null)`,
      continuationSlopeP10: sql<number | null>`percentile_cont(0.10) within group
        (order by ${polymarketSmoothPathFunnel.continuationSlopePerSec})
        filter (where ${qualityEligible}
          and ${polymarketSmoothPathFunnel.continuationSlopePerSec} is not null)`,
      continuationSlopeP50: sql<number | null>`percentile_cont(0.50) within group
        (order by ${polymarketSmoothPathFunnel.continuationSlopePerSec})
        filter (where ${qualityEligible}
          and ${polymarketSmoothPathFunnel.continuationSlopePerSec} is not null)`,
      continuationSlopeP90: sql<number | null>`percentile_cont(0.90) within group
        (order by ${polymarketSmoothPathFunnel.continuationSlopePerSec})
        filter (where ${qualityEligible}
          and ${polymarketSmoothPathFunnel.continuationSlopePerSec} is not null)`,
      continuationFreshP10: sql<number | null>`percentile_cont(0.10) within group
        (order by ${polymarketSmoothPathFunnel.continuationFreshLog})
        filter (where ${qualityEligible}
          and ${polymarketSmoothPathFunnel.continuationFreshLog} is not null)`,
      continuationFreshP50: sql<number | null>`percentile_cont(0.50) within group
        (order by ${polymarketSmoothPathFunnel.continuationFreshLog})
        filter (where ${qualityEligible}
          and ${polymarketSmoothPathFunnel.continuationFreshLog} is not null)`,
      continuationFreshP90: sql<number | null>`percentile_cont(0.90) within group
        (order by ${polymarketSmoothPathFunnel.continuationFreshLog})
        filter (where ${qualityEligible}
          and ${polymarketSmoothPathFunnel.continuationFreshLog} is not null)`,
    })
    .from(polymarketSmoothPathFunnel)
    .groupBy(
      polymarketSmoothPathFunnel.version,
      polymarketSmoothPathFunnel.botKey,
    );

  const pairs = await db
    .select({
      version: polymarketSmoothPathFunnel.version,
      pair: polymarketSmoothPathFunnel.pair,
      eligibleRows: sql<number>`count(*)::int`,
      observedRows:
        sql<number>`count(*) filter (where ${polymarketSmoothPathFunnel.observed})::int`,
      pathQualifiedRows:
        sql<number>`count(*) filter (where ${polymarketSmoothPathFunnel.pathQualified})::int`,
      bookQualifiedRows:
        sql<number>`count(*) filter (where ${polymarketSmoothPathFunnel.bookQualified})::int`,
      placedRows:
        sql<number>`count(*) filter (where ${polymarketSmoothPathFunnel.placed})::int`,
      qualityMetricRows:
        sql<number>`count(*) filter (where ${qualityComplete})::int`,
    })
    .from(polymarketSmoothPathFunnel)
    .groupBy(
      polymarketSmoothPathFunnel.version,
      polymarketSmoothPathFunnel.pair,
    );

  const rejectionResult = await db.execute(sql`
    select
      ${polymarketSmoothPathFunnel.version} as version,
      reason,
      count(*)::int as count
    from ${polymarketSmoothPathFunnel}
    cross join lateral unnest(${polymarketSmoothPathFunnel.rejectionReasons}) as reason
    group by ${polymarketSmoothPathFunnel.version}, reason
  `);
  const rejections = rejectionResult.rows.map((row) => ({
    version: String(row.version),
    reason: String(row.reason),
    count: numberValue(row.count as number | string | null),
  }));

  return summarizeSmoothPathFunnel(aggregates, pairs, rejections);
}
