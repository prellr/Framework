/**
 * Readiness-gated, outcome-free liquidity-state distributions for the Polymarket state tape.
 *
 * The feature-value query is private, cached, and unreachable until the inherited raw tape gate
 * passes. It never selects a market outcome, paper decision, fill result, grade, return, or P&L.
 */
import { db } from "@framework/db";
import { sql } from "drizzle-orm";
import { createAsyncTtlCache } from "./async-ttl-cache.ts";
import {
  expectedMicrostructureStateBucketKeys,
  MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT,
} from "./microstructure-state-distribution-contract.ts";
import { polymarketMicrostructureTapeStatus } from "./polymarket-state-tape.ts";
import {
  MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE,
  readMicrostructureStateFeatureCutEnvelope,
} from "./microstructure-state-feature-cut-freeze.ts";

const FORBIDDEN_REPORT_KEY =
  /(?:outcome|resolution|label|grade|pnl|winRate|profit|loss|paper|decision|chosenSide|fill)/i;

export function assertOutcomeFreeStateDistributionReport(
  value: unknown,
  path = "report",
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertOutcomeFreeStateDistributionReport(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_REPORT_KEY.test(key)) {
      throw new Error(`Microstructure state disclosure blocked at ${path}.${key}`);
    }
    assertOutcomeFreeStateDistributionReport(child, `${path}.${key}`);
  }
}

export type StateQuantileMetric = {
  n: number;
  quantiles: {
    p05: number;
    p25: number;
    p50: number;
    p75: number;
    p95: number;
  } | null;
};

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

export function stateQuantileMetric(nValue: unknown, quantileValue: unknown): StateQuantileMetric {
  const n = Number(nValue);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error("invalid microstructure-state metric count");
  }
  if (n === 0) return { n, quantiles: null };
  const values = numericArray(quantileValue);
  if (
    !values
    || values.length !== MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.quantileProbabilities.length
  ) {
    throw new Error("invalid microstructure-state quantile array");
  }
  return {
    n,
    quantiles: {
      p05: values[0],
      p25: values[1],
      p50: values[2],
      p75: values[3],
      p95: values[4],
    },
  };
}

type RawDistributionRow = Record<string, unknown> & {
  pair: string | null;
  horizon_min: number | null;
  sample_minute: number | null;
  rows: number;
  markets: number;
};

type StateDistributionBucket = {
  pair: string | null;
  horizonMin: number | null;
  sampleMinute: number | null;
  rows: number;
  markets: number;
  metrics: Record<string, StateQuantileMetric>;
};

const metric = (
  row: RawDistributionRow,
  key: string,
): StateQuantileMetric => stateQuantileMetric(row[`${key}_n`], row[`${key}_q`]);

function mapRow(row: RawDistributionRow): StateDistributionBucket {
  return {
    pair: row.pair,
    horizonMin: row.horizon_min == null ? null : Number(row.horizon_min),
    sampleMinute: row.sample_minute == null ? null : Number(row.sample_minute),
    rows: Number(row.rows),
    markets: Number(row.markets),
    metrics: {
      micropriceSkew: metric(row, "microprice_skew"),
      absoluteMicropriceSkew: metric(row, "absolute_microprice_skew"),
      touchPressure: metric(row, "touch_pressure"),
      absoluteTouchPressure: metric(row, "absolute_touch_pressure"),
      pairedSpread: metric(row, "paired_spread"),
      logMinDepthUsd: metric(row, "log_min_depth_usd"),
      complementError: metric(row, "complement_error"),
    },
  };
}

export function stateDistributionReportFromRows(rows: RawDistributionRow[]) {
  const mapped = rows.map(mapRow);
  const pooled = mapped.find((row) =>
    row.pair == null && row.horizonMin == null && row.sampleMinute == null);
  if (!pooled) throw new Error("microstructure-state query omitted its pooled row");

  const expectedKeys = expectedMicrostructureStateBucketKeys();
  const expected = new Set(expectedKeys);
  const seen = new Set<string>();
  const buckets = mapped
    .filter((row) =>
      row.pair != null && row.horizonMin != null && row.sampleMinute != null)
    .map((row) => {
      const key = `${row.pair}:${row.horizonMin}:${row.sampleMinute}`;
      if (!expected.has(key)) {
        throw new Error(`microstructure-state query returned out-of-scope bucket ${key}`);
      }
      if (seen.has(key)) {
        throw new Error(`microstructure-state query returned duplicate bucket ${key}`);
      }
      seen.add(key);
      return row;
    })
    .sort((left, right) =>
      String(left.pair).localeCompare(String(right.pair))
      || Number(left.horizonMin) - Number(right.horizonMin)
      || Number(left.sampleMinute) - Number(right.sampleMinute));
  const missingBuckets = expectedKeys.filter((key) => !seen.has(key));
  const minBucketMarkets = missingBuckets.length
    ? 0
    : Math.min(...buckets.map((bucket) => bucket.markets));
  const report = {
    pooled,
    buckets,
    expectedBuckets: MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.expectedBuckets,
    completeBuckets: buckets.length,
    missingBuckets,
    minBucketMarkets,
    readyForCutFreeze:
      missingBuckets.length === 0
      && minBucketMarkets >= MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.minMarketsPerBucket,
  };
  assertOutcomeFreeStateDistributionReport(report);
  return report;
}

async function loadMicrostructureStateDistribution() {
  const result = await db.execute<RawDistributionRow>(sql`
    with usable as (
      select
        condition_id,
        pair,
        horizon_min,
        sample_minute,
        (
          (up_microprice + 1 - down_microprice) / 2
          - (((up_bid + up_ask) / 2 + 1 - (down_bid + down_ask) / 2) / 2)
        ) as microprice_skew,
        abs(
          (up_microprice + 1 - down_microprice) / 2
          - (((up_bid + up_ask) / 2 + 1 - (down_bid + down_ask) / 2) / 2)
        ) as absolute_microprice_skew,
        (up_touch_imbalance - down_touch_imbalance) / 2 as touch_pressure,
        abs((up_touch_imbalance - down_touch_imbalance) / 2) as absolute_touch_pressure,
        ((up_ask - up_bid) + (down_ask - down_bid)) / 2 as paired_spread,
        ln(1 + least(up_depth_usd, down_depth_usd)) as log_min_depth_usd,
        abs((up_bid + up_ask) / 2 + (down_bid + down_ask) / 2 - 1) as complement_error
      from polymarket_state_snapshot
      where captured_at >= ${new Date(MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.evalStartMs)}
        and pair in ('BTC-USD','ETH-USD','SOL-USD','XRP-USD','DOGE-USD','BNB-USD')
        and horizon_min in (5,15)
        and sample_minute >= 0
        and sample_minute < horizon_min
        and up_bid is not null
        and up_ask is not null
        and down_bid is not null
        and down_ask is not null
        and up_microprice is not null
        and down_microprice is not null
        and up_touch_imbalance is not null
        and down_touch_imbalance is not null
        and up_depth_usd is not null
        and down_depth_usd is not null
        and up_bid >= 0
        and up_ask <= 1
        and down_bid >= 0
        and down_ask <= 1
        and up_bid <= up_ask
        and down_bid <= down_ask
        and up_microprice between 0 and 1
        and down_microprice between 0 and 1
        and up_touch_imbalance between -1 and 1
        and down_touch_imbalance between -1 and 1
        and up_depth_usd > 0
        and down_depth_usd > 0
    )
    select
      pair,
      horizon_min,
      sample_minute,
      count(*)::int as rows,
      count(distinct condition_id)::int as markets,
      count(microprice_skew)::int as microprice_skew_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by microprice_skew) as microprice_skew_q,
      count(absolute_microprice_skew)::int as absolute_microprice_skew_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by absolute_microprice_skew) as absolute_microprice_skew_q,
      count(touch_pressure)::int as touch_pressure_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by touch_pressure) as touch_pressure_q,
      count(absolute_touch_pressure)::int as absolute_touch_pressure_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by absolute_touch_pressure) as absolute_touch_pressure_q,
      count(paired_spread)::int as paired_spread_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by paired_spread) as paired_spread_q,
      count(log_min_depth_usd)::int as log_min_depth_usd_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by log_min_depth_usd) as log_min_depth_usd_q,
      count(complement_error)::int as complement_error_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by complement_error) as complement_error_q
    from usable
    group by grouping sets ((), (pair, horizon_min, sample_minute))
  `);
  return stateDistributionReportFromRows(result.rows);
}

const readMicrostructureStateDistribution = createAsyncTtlCache(
  MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.cacheMs,
  loadMicrostructureStateDistribution,
);

export async function microstructureStateDistributionAudit() {
  const tape = await polymarketMicrostructureTapeStatus();
  const [report, featureCutEnvelope] = await Promise.all([
    tape.readyForFrozenDiagnostic
      ? readMicrostructureStateDistribution()
      : Promise.resolve(null),
    readMicrostructureStateFeatureCutEnvelope(),
  ]);
  return {
    version: MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.version,
    tapeVersion: MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.tapeVersion,
    evalStartMs: MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.evalStartMs,
    quantileProbabilities: MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.quantileProbabilities,
    cacheMs: MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.cacheMs,
    expectedBuckets: MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.expectedBuckets,
    minMarketsPerBucket: MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.minMarketsPerBucket,
    inheritedTapeReady: tape.readyForFrozenDiagnostic,
    tape: {
      rows: tape.rows,
      usableRows: tape.usableRows,
      markets: tape.markets,
      resolvedMarkets: tape.resolvedMarkets,
      spanDays: tape.spanDays,
    },
    readyForCutFreeze: report?.readyForCutFreeze ?? false,
    featureCutFreeze: {
      planVersion: MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.planVersion,
      artifactVersion: MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.artifactVersion,
      eligibleToFreeze: report?.readyForCutFreeze ?? false,
      frozen: featureCutEnvelope != null,
      minimumBoundaryDelayMs:
        MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs,
      artifact: featureCutEnvelope == null
        ? null
        : {
            sha256: featureCutEnvelope.sha256,
            frozenAtMs: featureCutEnvelope.artifact.frozenAtMs,
            strategyNotBeforeMs: featureCutEnvelope.artifact.strategyNotBeforeMs,
            buckets: featureCutEnvelope.artifact.buckets.length,
          },
    },
    report,
  };
}
