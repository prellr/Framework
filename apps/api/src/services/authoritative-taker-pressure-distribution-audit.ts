/**
 * Readiness-gated, outcome-free first-minute pressure distributions.
 *
 * The private value query is unreachable until the inherited seven-day chain-verification gate
 * passes. It may use token semantics and independently decoded taker action internally to compute
 * canonical pressure, but it aggregates to one market row before disclosure and returns unsigned
 * activity, pressure-magnitude, and concentration coordinates only.
 */
import { db } from "@framework/db";
import { sql } from "drizzle-orm";
import { createAsyncTtlCache } from "./async-ttl-cache.ts";
import {
  AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT,
  expectedAuthoritativeTakerPressureBucketKeys,
} from "./authoritative-taker-pressure-distribution-contract.ts";
import {
  AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE,
  readAuthoritativeTakerPressureFeatureCutEnvelope,
} from "./authoritative-taker-pressure-feature-cut-freeze.ts";
import { authoritativeTradeFlowTapeStatus } from "./polymarket-trade-flow-report.ts";

const FORBIDDEN_REPORT_KEY =
  /(?:outcome|resolution|label|grade|pnl|winRate|profit|loss|paper|decision|direction|signed|position|account|wallet|order|chosenSide|fill|side|token)/i;

export function assertOutcomeFreeAuthoritativeTakerPressureReport(
  value: unknown,
  path = "report",
): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      assertOutcomeFreeAuthoritativeTakerPressureReport(child, `${path}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_REPORT_KEY.test(key)) {
      throw new Error(`Authoritative taker-pressure disclosure blocked at ${path}.${key}`);
    }
    assertOutcomeFreeAuthoritativeTakerPressureReport(child, `${path}.${key}`);
  }
}

export type AuthoritativeTakerPressureQuantileMetric = {
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

export function authoritativeTakerPressureQuantileMetric(
  nValue: unknown,
  quantileValue: unknown,
): AuthoritativeTakerPressureQuantileMetric {
  const n = Number(nValue);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error("invalid authoritative taker-pressure metric count");
  }
  if (n === 0) return { n, quantiles: null };
  const values = numericArray(quantileValue);
  if (
    !values ||
    values.length !== AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.quantileProbabilities.length
  ) {
    throw new Error("invalid authoritative taker-pressure quantile array");
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
  markets: number;
};

export type AuthoritativeTakerPressureDistributionBucket = {
  pair: string | null;
  horizonMin: number | null;
  markets: number;
  metrics: Record<string, AuthoritativeTakerPressureQuantileMetric>;
};

const metric = (row: RawDistributionRow, key: string): AuthoritativeTakerPressureQuantileMetric =>
  authoritativeTakerPressureQuantileMetric(row[`${key}_n`], row[`${key}_q`]);

function mapRow(row: RawDistributionRow): AuthoritativeTakerPressureDistributionBucket {
  return {
    pair: row.pair,
    horizonMin: row.horizon_min == null ? null : Number(row.horizon_min),
    markets: Number(row.markets),
    metrics: {
      logGrossShares: metric(row, "log_gross_shares"),
      eventCount: metric(row, "event_count"),
      uniqueReceiptCount: metric(row, "unique_receipt_count"),
      absoluteSharePressure: metric(row, "absolute_share_pressure"),
      maxEventShareFraction: metric(row, "max_event_share_fraction"),
    },
  };
}

export function authoritativeTakerPressureDistributionReportFromRows(rows: RawDistributionRow[]) {
  const mapped = rows.map(mapRow);
  const pooled = mapped.find((row) => row.pair == null && row.horizonMin == null);
  if (!pooled) throw new Error("authoritative taker-pressure query omitted its pooled row");

  const expectedKeys = expectedAuthoritativeTakerPressureBucketKeys();
  const expected = new Set(expectedKeys);
  const seen = new Set<string>();
  const buckets = mapped
    .filter((row) => row.pair != null && row.horizonMin != null)
    .map((row) => {
      const key = `${row.pair}:${row.horizonMin}`;
      if (!expected.has(key)) {
        throw new Error(`authoritative taker-pressure query returned out-of-scope bucket ${key}`);
      }
      if (seen.has(key)) {
        throw new Error(`authoritative taker-pressure query returned duplicate bucket ${key}`);
      }
      seen.add(key);
      return row;
    })
    .sort(
      (left, right) =>
        String(left.pair).localeCompare(String(right.pair)) ||
        Number(left.horizonMin) - Number(right.horizonMin),
    );
  const missingBuckets = expectedKeys.filter((key) => !seen.has(key));
  const minBucketMarkets = missingBuckets.length
    ? 0
    : Math.min(...buckets.map((bucket) => bucket.markets));
  const report = {
    pooled,
    buckets,
    expectedBuckets: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.expectedBuckets,
    completeBuckets: buckets.length,
    missingBuckets,
    minBucketMarkets,
    readyForCutFreeze:
      missingBuckets.length === 0 &&
      minBucketMarkets >= AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.minMarketsPerBucket,
  };
  assertOutcomeFreeAuthoritativeTakerPressureReport(report);
  return report;
}

async function loadAuthoritativeTakerPressureDistribution() {
  const result = await db.execute<RawDistributionRow>(sql`
    with usable_events as (
      select
        condition_id,
        pair,
        horizon_min,
        chain_transaction_hash,
        chain_shares,
        case
          when outcome_side = 'up' and chain_side = 'buy' then 1
          when outcome_side = 'down' and chain_side = 'sell' then 1
          else -1
        end as canonical_sign
      from polymarket_trade_flow_event
      where version = ${AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.tapeVersion}
        and event_at >= ${new Date(AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.evalStartMs)}
        and pair in ('BTC-USD','ETH-USD','SOL-USD','XRP-USD','DOGE-USD','BNB-USD')
        and horizon_min in (5,15)
        and chain_status = 'verified'
        and chain_transaction_hash is not null
        and outcome_side in ('up','down')
        and chain_side in ('buy','sell')
        and chain_shares is not null
        and chain_shares > 0
        and chain_confirmations is not null
        and chain_confirmations >= 20
        and event_at >= window_start
        and event_at < window_start
          + (${AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.observationWindowSec}
            * interval '1 second')
    ),
    market_features as (
      select
        condition_id,
        pair,
        horizon_min,
        ln(1 + sum(chain_shares)) as log_gross_shares,
        count(*)::int as event_count,
        count(distinct chain_transaction_hash)::int as unique_receipt_count,
        abs(sum(canonical_sign * chain_shares)) / nullif(sum(chain_shares), 0)
          as absolute_share_pressure,
        max(chain_shares) / nullif(sum(chain_shares), 0) as max_event_share_fraction
      from usable_events
      group by condition_id, pair, horizon_min
    )
    select
      pair,
      horizon_min,
      count(*)::int as markets,
      count(log_gross_shares)::int as log_gross_shares_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by log_gross_shares) as log_gross_shares_q,
      count(event_count)::int as event_count_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by event_count) as event_count_q,
      count(unique_receipt_count)::int as unique_receipt_count_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by unique_receipt_count) as unique_receipt_count_q,
      count(absolute_share_pressure)::int as absolute_share_pressure_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by absolute_share_pressure) as absolute_share_pressure_q,
      count(max_event_share_fraction)::int as max_event_share_fraction_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by max_event_share_fraction) as max_event_share_fraction_q
    from market_features
    group by grouping sets ((), (pair, horizon_min))
  `);
  return authoritativeTakerPressureDistributionReportFromRows(result.rows);
}

const readAuthoritativeTakerPressureDistribution = createAsyncTtlCache(
  AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.cacheMs,
  loadAuthoritativeTakerPressureDistribution,
);

export async function authoritativeTakerPressureDistributionAudit() {
  const tape = await authoritativeTradeFlowTapeStatus();
  const [report, featureCutEnvelope] = await Promise.all([
    tape.readyForOutcomeFreeDistributionAudit
      ? readAuthoritativeTakerPressureDistribution()
      : Promise.resolve(null),
    readAuthoritativeTakerPressureFeatureCutEnvelope(),
  ]);
  const disclosure = {
    version: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.version,
    tapeVersion: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.tapeVersion,
    evalStartMs: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.evalStartMs,
    observationWindowSec: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.observationWindowSec,
    quantileProbabilities: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.quantileProbabilities,
    cacheMs: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.cacheMs,
    expectedBuckets: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.expectedBuckets,
    minMarketsPerBucket: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.minMarketsPerBucket,
    intendedUse: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.intendedUse,
    prohibitedUse: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.prohibitedUse,
    inheritedTapeReady: tape.readyForOutcomeFreeDistributionAudit,
    tape: {
      rawEvents: tape.rawEvents,
      verifiedEvents: tape.verifiedEvents,
      distinctMarkets: tape.distinctMarkets,
      spanDays: tape.spanDays,
      hashCoverage: tape.hashCoverage,
      chainVerificationRate: tape.chainVerificationRate,
      operationalHealth: tape.operationalHealth,
    },
    readyForCutFreeze: report?.readyForCutFreeze ?? false,
    featureCutFreeze: {
      planVersion: AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.planVersion,
      artifactVersion: AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.artifactVersion,
      eligibleToFreeze: report?.readyForCutFreeze ?? false,
      frozen: featureCutEnvelope != null,
      minimumBoundaryDelayMs:
        AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs,
      artifact:
        featureCutEnvelope == null
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
  assertOutcomeFreeAuthoritativeTakerPressureReport(disclosure, "disclosure");
  return disclosure;
}
