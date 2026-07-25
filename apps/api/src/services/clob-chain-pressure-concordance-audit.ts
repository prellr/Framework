/**
 * Readiness-gated CLOB event-OFI versus verified-chain pressure concordance.
 *
 * Source values remain unreachable until both inherited tapes pass their own frozen gates. A
 * count/nullability-only matched-panel query runs next. Aggregate concordance is queried only if
 * that panel independently passes its coverage, span, and twelve-bucket support floors.
 */
import { db } from "@framework/db";
import { sql } from "drizzle-orm";
import { createAsyncTtlCache } from "./async-ttl-cache.ts";
import { clobEventOfiTapeStatus } from "./clob-event-ofi-report.ts";
import {
  CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT,
  expectedClobChainPressureConcordanceBucketKeys,
} from "./clob-chain-pressure-concordance-contract.ts";
import { authoritativeTradeFlowTapeStatus } from "./polymarket-trade-flow-report.ts";

const FORBIDDEN_REPORT_KEY =
  /(?:outcome|resolution|label|grade|pnl|winRate|profit|loss|paper|decisionSide|chosenSide|position|account|wallet|order|fill|tokenId|transactionHash)/i;

export function assertOutcomeFreeClobChainPressureConcordanceReport(
  value: unknown,
  path = "report",
): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      assertOutcomeFreeClobChainPressureConcordanceReport(child, `${path}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_REPORT_KEY.test(key)) {
      throw new Error(`CLOB/chain pressure concordance disclosure blocked at ${path}.${key}`);
    }
    assertOutcomeFreeClobChainPressureConcordanceReport(child, `${path}.${key}`);
  }
}

type RawMatchedReadinessRow = {
  eligible_anchors: number;
  usable_anchors: number;
  matched_markets: number;
  first_window_start: Date | string | null;
  last_window_start: Date | string | null;
};

type RawMatchedBucketRow = {
  pair: string;
  horizon_min: number;
  matched_markets: number;
};

type RawMatchedPanelRow = RawMatchedBucketRow & RawMatchedReadinessRow;

export type ClobChainPressureMatchedReadiness = {
  eligibleAnchors: number;
  usableAnchors: number;
  anchorCoverage: number;
  matchedMarkets: number;
  spanDays: number;
  buckets: {
    pair: string;
    horizonMin: number;
    matchedMarkets: number;
  }[];
  missingBuckets: string[];
  weakestBucketMarkets: number;
  readyForAggregateConcordance: boolean;
};

function asCount(value: unknown, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`invalid CLOB/chain pressure ${name}`);
  }
  return parsed;
}

export function clobChainPressureMatchedReadinessFromRows(
  aggregate: RawMatchedReadinessRow,
  rows: RawMatchedBucketRow[],
): ClobChainPressureMatchedReadiness {
  const eligibleAnchors = asCount(aggregate.eligible_anchors, "eligible anchor count");
  const usableAnchors = asCount(aggregate.usable_anchors, "usable anchor count");
  const matchedMarkets = asCount(aggregate.matched_markets, "matched market count");
  const firstMs = aggregate.first_window_start == null
    ? null
    : new Date(aggregate.first_window_start).getTime();
  const lastMs = aggregate.last_window_start == null
    ? null
    : new Date(aggregate.last_window_start).getTime();
  if (
    (firstMs != null && !Number.isFinite(firstMs))
    || (lastMs != null && !Number.isFinite(lastMs))
  ) {
    throw new Error("invalid CLOB/chain pressure matched-panel timestamps");
  }
  const spanDays = firstMs != null && lastMs != null
    ? Math.max(0, (lastMs - firstMs) / 86_400_000)
    : 0;
  const anchorCoverage = eligibleAnchors > 0 ? usableAnchors / eligibleAnchors : 0;
  const expectedKeys = expectedClobChainPressureConcordanceBucketKeys();
  const expected = new Set(expectedKeys);
  const seen = new Set<string>();
  const buckets = rows.map((row) => {
    const horizonMin = Number(row.horizon_min);
    const key = `${row.pair}:${horizonMin}`;
    if (!expected.has(key)) throw new Error(`unexpected CLOB/chain pressure bucket ${key}`);
    if (seen.has(key)) throw new Error(`duplicate CLOB/chain pressure bucket ${key}`);
    seen.add(key);
    return {
      pair: row.pair,
      horizonMin,
      matchedMarkets: asCount(row.matched_markets, `${key} matched market count`),
    };
  }).sort(
    (left, right) =>
      left.pair.localeCompare(right.pair) || left.horizonMin - right.horizonMin,
  );
  const missingBuckets = expectedKeys.filter((key) => !seen.has(key));
  const weakestBucketMarkets = missingBuckets.length || !buckets.length
    ? 0
    : Math.min(...buckets.map((bucket) => bucket.matchedMarkets));
  const readyForAggregateConcordance =
    anchorCoverage >= CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.minAnchorCoverage
    && spanDays >= CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.minMatchedSpanDays
    && missingBuckets.length === 0
    && weakestBucketMarkets >=
      CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.minMatchedMarketsPerBucket;
  return {
    eligibleAnchors,
    usableAnchors,
    anchorCoverage,
    matchedMarkets,
    spanDays,
    buckets,
    missingBuckets,
    weakestBucketMarkets,
    readyForAggregateConcordance,
  };
}

type RawConcordanceRow = {
  pair: string | null;
  horizon_min: number | null;
  matched_markets: number;
  nonzero_pairs: number;
  pearson_correlation: number | null;
  spearman_correlation: number | null;
  nonzero_sign_agreement: number | null;
  proxy_zero_rate: number;
  reference_zero_rate: number;
};

export type ClobChainPressureConcordanceBucket = {
  pair: string | null;
  horizonMin: number | null;
  matchedMarkets: number;
  nonzeroPairs: number;
  metrics: {
    pearsonCorrelation: number | null;
    spearmanCorrelation: number | null;
    nonzeroSignAgreement: number | null;
    proxyZeroRate: number;
    referenceZeroRate: number;
  };
};

function boundedMetric(
  value: unknown,
  name: string,
  nullable = false,
): number | null {
  if (value == null && nullable) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < -1 || parsed > 1) {
    throw new Error(`invalid CLOB/chain pressure ${name}`);
  }
  return parsed;
}

function rateMetric(value: unknown, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`invalid CLOB/chain pressure ${name}`);
  }
  return parsed;
}

function mapConcordanceRow(row: RawConcordanceRow): ClobChainPressureConcordanceBucket {
  return {
    pair: row.pair,
    horizonMin: row.horizon_min == null ? null : Number(row.horizon_min),
    matchedMarkets: asCount(row.matched_markets, "report matched market count"),
    nonzeroPairs: asCount(row.nonzero_pairs, "report nonzero pair count"),
    metrics: {
      pearsonCorrelation: boundedMetric(
        row.pearson_correlation,
        "Pearson correlation",
        true,
      ),
      spearmanCorrelation: boundedMetric(
        row.spearman_correlation,
        "Spearman correlation",
        true,
      ),
      nonzeroSignAgreement: boundedMetric(
        row.nonzero_sign_agreement,
        "nonzero sign agreement",
        true,
      ),
      proxyZeroRate: rateMetric(row.proxy_zero_rate, "proxy zero rate"),
      referenceZeroRate: rateMetric(row.reference_zero_rate, "reference zero rate"),
    },
  };
}

export function clobChainPressureConcordanceReportFromRows(rows: RawConcordanceRow[]) {
  const mapped = rows.map(mapConcordanceRow);
  const pooled = mapped.find((row) => row.pair == null && row.horizonMin == null);
  if (!pooled) throw new Error("CLOB/chain pressure query omitted pooled concordance");
  const expectedKeys = expectedClobChainPressureConcordanceBucketKeys();
  const expected = new Set(expectedKeys);
  const seen = new Set<string>();
  const buckets = mapped
    .filter((row) => row.pair != null && row.horizonMin != null)
    .map((row) => {
      const key = `${row.pair}:${row.horizonMin}`;
      if (!expected.has(key)) throw new Error(`unexpected concordance report bucket ${key}`);
      if (seen.has(key)) throw new Error(`duplicate concordance report bucket ${key}`);
      seen.add(key);
      return row;
    })
    .sort(
      (left, right) =>
        String(left.pair).localeCompare(String(right.pair))
        || Number(left.horizonMin) - Number(right.horizonMin),
    );
  const missingBuckets = expectedKeys.filter((key) => !seen.has(key));
  if (missingBuckets.length) {
    throw new Error(`CLOB/chain pressure query omitted buckets: ${missingBuckets.join(", ")}`);
  }
  const report = {
    pooled,
    buckets,
    expectedBuckets: CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.expectedBuckets,
  };
  assertOutcomeFreeClobChainPressureConcordanceReport(report);
  return report;
}

const readinessPanelSql = sql`
  with reference_markets as (
    select distinct
      condition_id,
      pair,
      horizon_min
    from polymarket_trade_flow_event
    where version = ${CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.referenceTapeVersion}
      and window_start >= ${new Date(CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.evalStartMs)}
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
        + (${CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.referenceWindowSec}
          * interval '1 second')
  ),
  eligible_anchors as (
    select
      condition_id,
      pair,
      horizon_min,
      window_start,
      (
        clob_event_ofi_version =
          ${CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.clobTapeVersion}
        and clob_event_ofi_canonical_60s is not null
        and clob_event_ofi_receive_age_sec is not null
        and clob_event_ofi_receive_age_sec <= 20
        and clob_event_ofi_max_transport_lag_ms_60s is not null
        and clob_event_ofi_max_transport_lag_ms_60s <= 30000
      ) as usable
    from polymarket_state_snapshot
    where captured_at >= ${new Date(CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.evalStartMs)}
      and pair in ('BTC-USD','ETH-USD','SOL-USD','XRP-USD','DOGE-USD','BNB-USD')
      and horizon_min in (5,15)
      and sample_minute = ${CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.anchorSampleMinute}
      and extract(epoch from (captured_at - window_start))
        >= ${CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.anchorOffsetMinSec}
      and extract(epoch from (captured_at - window_start))
        < ${CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.anchorOffsetMaxExclusiveSec}
  ),
  matched as (
    select
      anchor.condition_id,
      anchor.pair,
      anchor.horizon_min,
      anchor.window_start
    from eligible_anchors anchor
    join reference_markets reference
      on reference.condition_id = anchor.condition_id
      and reference.pair = anchor.pair
      and reference.horizon_min = anchor.horizon_min
    where anchor.usable
  )
`;

const valuePanelSql = sql`
  with reference_events as (
    select
      condition_id,
      pair,
      horizon_min,
      window_start,
      chain_shares,
      case
        when outcome_side = 'up' and chain_side = 'buy' then 1
        when outcome_side = 'down' and chain_side = 'sell' then 1
        else -1
      end as canonical_sign
    from polymarket_trade_flow_event
    where version = ${CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.referenceTapeVersion}
      and window_start >= ${new Date(CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.evalStartMs)}
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
        + (${CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.referenceWindowSec}
          * interval '1 second')
  ),
  reference_markets as (
    select
      condition_id,
      pair,
      horizon_min,
      min(window_start) as window_start,
      sum(canonical_sign * chain_shares) / nullif(sum(chain_shares), 0)
        as reference_pressure
    from reference_events
    group by condition_id, pair, horizon_min
  ),
  eligible_anchors as (
    select
      condition_id,
      pair,
      horizon_min,
      window_start,
      clob_event_ofi_canonical_60s as proxy_pressure,
      (
        clob_event_ofi_version =
          ${CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.clobTapeVersion}
        and clob_event_ofi_canonical_60s is not null
        and clob_event_ofi_receive_age_sec is not null
        and clob_event_ofi_receive_age_sec <= 20
        and clob_event_ofi_max_transport_lag_ms_60s is not null
        and clob_event_ofi_max_transport_lag_ms_60s <= 30000
      ) as usable
    from polymarket_state_snapshot
    where captured_at >= ${new Date(CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.evalStartMs)}
      and pair in ('BTC-USD','ETH-USD','SOL-USD','XRP-USD','DOGE-USD','BNB-USD')
      and horizon_min in (5,15)
      and sample_minute = ${CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.anchorSampleMinute}
      and extract(epoch from (captured_at - window_start))
        >= ${CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.anchorOffsetMinSec}
      and extract(epoch from (captured_at - window_start))
        < ${CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.anchorOffsetMaxExclusiveSec}
  ),
  matched as (
    select
      anchor.condition_id,
      anchor.pair,
      anchor.horizon_min,
      anchor.window_start,
      anchor.proxy_pressure,
      reference.reference_pressure
    from eligible_anchors anchor
    join reference_markets reference
      on reference.condition_id = anchor.condition_id
      and reference.pair = anchor.pair
      and reference.horizon_min = anchor.horizon_min
    where anchor.usable
  )
`;

async function loadMatchedReadiness() {
  const result = await db.execute<RawMatchedPanelRow>(sql`
    ${readinessPanelSql}
    select
      pair,
      horizon_min,
      (select count(*)::int from eligible_anchors) as eligible_anchors,
      (select count(*)::int from eligible_anchors where usable) as usable_anchors,
      count(*)::int as matched_markets,
      min(window_start) as first_window_start,
      max(window_start) as last_window_start
    from matched
    group by grouping sets ((), (pair, horizon_min))
  `);
  const aggregate = result.rows.find(
    (row) => row.pair == null && row.horizon_min == null,
  );
  if (!aggregate) throw new Error("CLOB/chain pressure matched query omitted aggregate");
  const buckets = result.rows.filter(
    (row): row is RawMatchedPanelRow & { pair: string; horizon_min: number } =>
      row.pair != null && row.horizon_min != null,
  );
  return clobChainPressureMatchedReadinessFromRows(aggregate, buckets);
}

async function loadAggregateConcordance() {
  const result = await db.execute<RawConcordanceRow>(sql`
    ${valuePanelSql},
    bucket_ranked as (
      select
        *,
        rank() over (
          partition by pair, horizon_min
          order by proxy_pressure
        ) + (
          count(*) over (
            partition by pair, horizon_min, proxy_pressure
          ) - 1
        ) / 2.0 as proxy_rank,
        rank() over (
          partition by pair, horizon_min
          order by reference_pressure
        ) + (
          count(*) over (
            partition by pair, horizon_min, reference_pressure
          ) - 1
        ) / 2.0 as reference_rank
      from matched
    ),
    pooled_ranked as (
      select
        *,
        rank() over (order by proxy_pressure)
          + (count(*) over (partition by proxy_pressure) - 1) / 2.0 as proxy_rank,
        rank() over (order by reference_pressure)
          + (count(*) over (partition by reference_pressure) - 1) / 2.0
            as reference_rank
      from matched
    ),
    aggregate_rows as (
      select
        pair,
        horizon_min,
        count(*)::int as matched_markets,
        count(*) filter (
          where proxy_pressure <> 0 and reference_pressure <> 0
        )::int as nonzero_pairs,
        corr(proxy_pressure, reference_pressure) as pearson_correlation,
        corr(
          proxy_rank::double precision,
          reference_rank::double precision
        ) as spearman_correlation,
        avg(
          case
            when proxy_pressure <> 0 and reference_pressure <> 0
            then (sign(proxy_pressure) = sign(reference_pressure))::int
            else null
          end
        ) as nonzero_sign_agreement,
        avg((proxy_pressure = 0)::int) as proxy_zero_rate,
        avg((reference_pressure = 0)::int) as reference_zero_rate
      from bucket_ranked
      group by pair, horizon_min
      union all
      select
        null as pair,
        null as horizon_min,
        count(*)::int as matched_markets,
        count(*) filter (
          where proxy_pressure <> 0 and reference_pressure <> 0
        )::int as nonzero_pairs,
        corr(proxy_pressure, reference_pressure) as pearson_correlation,
        corr(
          proxy_rank::double precision,
          reference_rank::double precision
        ) as spearman_correlation,
        avg(
          case
            when proxy_pressure <> 0 and reference_pressure <> 0
            then (sign(proxy_pressure) = sign(reference_pressure))::int
            else null
          end
        ) as nonzero_sign_agreement,
        avg((proxy_pressure = 0)::int) as proxy_zero_rate,
        avg((reference_pressure = 0)::int) as reference_zero_rate
      from pooled_ranked
    )
    select * from aggregate_rows
  `);
  return clobChainPressureConcordanceReportFromRows(result.rows);
}

const readMatchedReadiness = createAsyncTtlCache(
  CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.cacheMs,
  loadMatchedReadiness,
);
const readAggregateConcordance = createAsyncTtlCache(
  CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.cacheMs,
  loadAggregateConcordance,
);

export async function clobChainPressureConcordanceAudit() {
  const [clobTape, referenceTape] = await Promise.all([
    clobEventOfiTapeStatus(),
    authoritativeTradeFlowTapeStatus(),
  ]);
  const inheritedSourcesReady =
    clobTape.readyForOutcomeFreeDistributionAudit
    && referenceTape.readyForOutcomeFreeDistributionAudit;
  const matchedReadiness = inheritedSourcesReady
    ? await readMatchedReadiness()
    : null;
  const report = matchedReadiness?.readyForAggregateConcordance
    ? await readAggregateConcordance()
    : null;
  const disclosure = {
    version: CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.version,
    evalStartMs: CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.evalStartMs,
    sources: {
      clobTapeVersion: CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.clobTapeVersion,
      referenceTapeVersion:
        CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.referenceTapeVersion,
      clobTapeReady: clobTape.readyForOutcomeFreeDistributionAudit,
      referenceTapeReady: referenceTape.readyForOutcomeFreeDistributionAudit,
    },
    clock: {
      kind: "near-synchronous",
      anchorSampleMinute: CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.anchorSampleMinute,
      anchorOffsetMinSec: CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.anchorOffsetMinSec,
      anchorOffsetMaxExclusiveSec:
        CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.anchorOffsetMaxExclusiveSec,
      referenceWindowSec: CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.referenceWindowSec,
      minimumClockOverlapSec:
        CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.minimumClockOverlapSec,
      maximumClockMismatchSec:
        CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.maximumClockMismatchSec,
    },
    floors: {
      expectedBuckets: CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.expectedBuckets,
      matchedMarketsPerBucket:
        CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.minMatchedMarketsPerBucket,
      matchedSpanDays: CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.minMatchedSpanDays,
      anchorCoverage: CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.minAnchorCoverage,
    },
    metrics: CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.metrics,
    definitions: CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.definitions,
    intendedUse: CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.intendedUse,
    prohibitedUse: CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.prohibitedUse,
    inheritedSourcesReady,
    matchedReadiness,
    report,
  };
  assertOutcomeFreeClobChainPressureConcordanceReport(disclosure, "disclosure");
  return disclosure;
}
