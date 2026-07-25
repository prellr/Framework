/**
 * Readiness-gated, outcome-free distributions for authoritative Polymarket taker flow.
 *
 * The value query is private and unreachable until the inherited seven-day chain-verification gate
 * passes. It selects verified receipt facts and unsigned source/receipt differences only. It does
 * not select token mapping, trade direction, market resolution, paper activity, grades, or P&L.
 */
import { db } from "@framework/db";
import { sql } from "drizzle-orm";
import { createAsyncTtlCache } from "./async-ttl-cache.ts";
import {
  AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT,
  expectedAuthoritativeTakerFlowBucketKeys,
} from "./authoritative-taker-flow-distribution-contract.ts";
import {
  AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE,
  readAuthoritativeTakerFlowFeatureCutEnvelope,
} from "./authoritative-taker-flow-feature-cut-freeze.ts";
import { authoritativeTradeFlowTapeStatus } from "./polymarket-trade-flow-report.ts";

const FORBIDDEN_REPORT_KEY =
  /(?:outcome|resolution|label|grade|pnl|winRate|profit|loss|paper|decision|direction|position|account|wallet|order|chosenSide|fill|side|token)/i;

export function assertOutcomeFreeAuthoritativeTakerFlowReport(
  value: unknown,
  path = "report",
): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      assertOutcomeFreeAuthoritativeTakerFlowReport(child, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_REPORT_KEY.test(key)) {
      throw new Error(`Authoritative taker-flow disclosure blocked at ${path}.${key}`);
    }
    assertOutcomeFreeAuthoritativeTakerFlowReport(child, `${path}.${key}`);
  }
}

export type AuthoritativeTakerFlowQuantileMetric = {
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

export function authoritativeTakerFlowQuantileMetric(
  nValue: unknown,
  quantileValue: unknown,
): AuthoritativeTakerFlowQuantileMetric {
  const n = Number(nValue);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error("invalid authoritative taker-flow metric count");
  }
  if (n === 0) return { n, quantiles: null };
  const values = numericArray(quantileValue);
  if (
    !values
    || values.length
      !== AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.quantileProbabilities.length
  ) {
    throw new Error("invalid authoritative taker-flow quantile array");
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
  rows: number;
  markets: number;
};

export type AuthoritativeTakerFlowDistributionBucket = {
  pair: string | null;
  horizonMin: number | null;
  rows: number;
  markets: number;
  metrics: Record<string, AuthoritativeTakerFlowQuantileMetric>;
};

const metric = (
  row: RawDistributionRow,
  key: string,
): AuthoritativeTakerFlowQuantileMetric =>
  authoritativeTakerFlowQuantileMetric(row[`${key}_n`], row[`${key}_q`]);

function mapRow(row: RawDistributionRow): AuthoritativeTakerFlowDistributionBucket {
  return {
    pair: row.pair,
    horizonMin: row.horizon_min == null ? null : Number(row.horizon_min),
    rows: Number(row.rows),
    markets: Number(row.markets),
    metrics: {
      logChainNotionalUsd: metric(row, "log_chain_notional_usd"),
      logChainShares: metric(row, "log_chain_shares"),
      absoluteChainPriceDistanceBps: metric(row, "absolute_chain_price_distance_bps"),
      secondsFromWindowStart: metric(row, "seconds_from_window_start"),
      ingestionLatencyMs: metric(row, "ingestion_latency_ms"),
      chainConfirmations: metric(row, "chain_confirmations"),
      absoluteSourceReceiptPriceErrorBps: metric(
        row,
        "absolute_source_receipt_price_error_bps",
      ),
      absoluteSourceReceiptShareErrorPpm: metric(
        row,
        "absolute_source_receipt_share_error_ppm",
      ),
    },
  };
}

export function authoritativeTakerFlowDistributionReportFromRows(
  rows: RawDistributionRow[],
) {
  const mapped = rows.map(mapRow);
  const pooled = mapped.find((row) => row.pair == null && row.horizonMin == null);
  if (!pooled) throw new Error("authoritative taker-flow query omitted its pooled row");

  const expectedKeys = expectedAuthoritativeTakerFlowBucketKeys();
  const expected = new Set(expectedKeys);
  const seen = new Set<string>();
  const buckets = mapped
    .filter((row) => row.pair != null && row.horizonMin != null)
    .map((row) => {
      const key = `${row.pair}:${row.horizonMin}`;
      if (!expected.has(key)) {
        throw new Error(`authoritative taker-flow query returned out-of-scope bucket ${key}`);
      }
      if (seen.has(key)) {
        throw new Error(`authoritative taker-flow query returned duplicate bucket ${key}`);
      }
      seen.add(key);
      return row;
    })
    .sort((left, right) =>
      String(left.pair).localeCompare(String(right.pair))
      || Number(left.horizonMin) - Number(right.horizonMin));
  const missingBuckets = expectedKeys.filter((key) => !seen.has(key));
  const minBucketMarkets = missingBuckets.length
    ? 0
    : Math.min(...buckets.map((bucket) => bucket.markets));
  const report = {
    pooled,
    buckets,
    expectedBuckets: AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.expectedBuckets,
    completeBuckets: buckets.length,
    missingBuckets,
    minBucketMarkets,
    readyForCutFreeze:
      missingBuckets.length === 0
      && minBucketMarkets
        >= AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.minMarketsPerBucket,
  };
  assertOutcomeFreeAuthoritativeTakerFlowReport(report);
  return report;
}

async function loadAuthoritativeTakerFlowDistribution() {
  const result = await db.execute<RawDistributionRow>(sql`
    with usable as (
      select
        condition_id,
        pair,
        horizon_min,
        ln(1 + chain_price * chain_shares) as log_chain_notional_usd,
        ln(1 + chain_shares) as log_chain_shares,
        abs(chain_price - 0.5) * 10000 as absolute_chain_price_distance_bps,
        extract(epoch from (event_at - window_start)) as seconds_from_window_start,
        ingestion_latency_ms,
        chain_confirmations,
        abs(price - chain_price) * 10000 as absolute_source_receipt_price_error_bps,
        abs(shares - chain_shares) / shares * 1000000
          as absolute_source_receipt_share_error_ppm
      from polymarket_trade_flow_event
      where version = ${AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.tapeVersion}
        and event_at >= ${new Date(AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.evalStartMs)}
        and pair in ('BTC-USD','ETH-USD','SOL-USD','XRP-USD','DOGE-USD','BNB-USD')
        and horizon_min in (5,15)
        and chain_status = 'verified'
        and chain_price is not null
        and chain_shares is not null
        and chain_confirmations is not null
        and chain_price > 0
        and chain_price < 1
        and shares > 0
        and chain_shares > 0
        and chain_confirmations >= 20
        and ingestion_latency_ms >= 0
        and event_at >= window_start
        and event_at <= window_start + (horizon_min * interval '1 minute')
    )
    select
      pair,
      horizon_min,
      count(*)::int as rows,
      count(distinct condition_id)::int as markets,
      count(log_chain_notional_usd)::int as log_chain_notional_usd_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by log_chain_notional_usd) as log_chain_notional_usd_q,
      count(log_chain_shares)::int as log_chain_shares_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by log_chain_shares) as log_chain_shares_q,
      count(absolute_chain_price_distance_bps)::int as absolute_chain_price_distance_bps_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by absolute_chain_price_distance_bps)
          as absolute_chain_price_distance_bps_q,
      count(seconds_from_window_start)::int as seconds_from_window_start_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by seconds_from_window_start) as seconds_from_window_start_q,
      count(ingestion_latency_ms)::int as ingestion_latency_ms_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by ingestion_latency_ms) as ingestion_latency_ms_q,
      count(chain_confirmations)::int as chain_confirmations_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by chain_confirmations) as chain_confirmations_q,
      count(absolute_source_receipt_price_error_bps)::int
        as absolute_source_receipt_price_error_bps_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by absolute_source_receipt_price_error_bps)
          as absolute_source_receipt_price_error_bps_q,
      count(absolute_source_receipt_share_error_ppm)::int
        as absolute_source_receipt_share_error_ppm_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by absolute_source_receipt_share_error_ppm)
          as absolute_source_receipt_share_error_ppm_q
    from usable
    group by grouping sets ((), (pair, horizon_min))
  `);
  return authoritativeTakerFlowDistributionReportFromRows(result.rows);
}

const readAuthoritativeTakerFlowDistribution = createAsyncTtlCache(
  AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.cacheMs,
  loadAuthoritativeTakerFlowDistribution,
);

export async function authoritativeTakerFlowDistributionAudit() {
  const tape = await authoritativeTradeFlowTapeStatus();
  const [report, featureCutEnvelope] = await Promise.all([
    tape.readyForOutcomeFreeDistributionAudit
      ? readAuthoritativeTakerFlowDistribution()
      : Promise.resolve(null),
    readAuthoritativeTakerFlowFeatureCutEnvelope(),
  ]);
  const disclosure = {
    version: AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.version,
    tapeVersion: AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.tapeVersion,
    evalStartMs: AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.evalStartMs,
    quantileProbabilities:
      AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.quantileProbabilities,
    cacheMs: AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.cacheMs,
    expectedBuckets: AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.expectedBuckets,
    minMarketsPerBucket:
      AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.minMarketsPerBucket,
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
      planVersion: AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.planVersion,
      artifactVersion: AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.artifactVersion,
      eligibleToFreeze: report?.readyForCutFreeze ?? false,
      frozen: featureCutEnvelope != null,
      minimumBoundaryDelayMs:
        AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs,
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
  assertOutcomeFreeAuthoritativeTakerFlowReport(disclosure, "disclosure");
  return disclosure;
}
