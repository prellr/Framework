/**
 * Readiness-gated, outcome-free feature distributions for the compact public flow tapes.
 *
 * The readiness queries inspect counts/nullability only. A feature-value query is not invoked until
 * its source independently passes every frozen tape floor. Reports contain no market resolution,
 * paper decision, fill, grade, return, or P&L field and cannot create a strategy or order.
 */
import { db } from "@framework/db";
import { sql } from "drizzle-orm";
import { createAsyncTtlCache } from "./async-ttl-cache.ts";
import { CLOB_EVENT_OFI_TAPE } from "./clob-event-ofi.ts";
import { clobEventOfiTapeStatus } from "./clob-event-ofi-report.ts";
import { FLOW_DISTRIBUTION_AUDIT } from "./flow-distribution-contract.ts";
import {
  FLOW_FEATURE_CUT_FREEZE,
  readFlowFeatureCutEnvelope,
} from "./flow-feature-cut-freeze.ts";
import { HYPERLIQUID_FLOW_TAPE } from "./hl-rtds.ts";
import { hyperliquidFlowTapeStatus } from "./hyperliquid-flow-report.ts";

const FORBIDDEN_REPORT_KEY =
  /(?:outcome|resolution|label|grade|pnl|winRate|profit|loss|paper|decision|chosenSide|fill)/i;

export function assertOutcomeFreeDistributionReport(value: unknown, path = "report"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertOutcomeFreeDistributionReport(item, `${path}[${index}]`)
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_REPORT_KEY.test(key)) {
      throw new Error(`Flow distribution disclosure blocked at ${path}.${key}`);
    }
    assertOutcomeFreeDistributionReport(child, `${path}.${key}`);
  }
}

export type FlowQuantileMetric = {
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

export function flowQuantileMetric(nValue: unknown, quantileValue: unknown): FlowQuantileMetric {
  const n = Number(nValue);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error("invalid flow-distribution metric count");
  }
  if (n === 0) return { n, quantiles: null };
  const values = numericArray(quantileValue);
  if (!values || values.length !== FLOW_DISTRIBUTION_AUDIT.quantileProbabilities.length) {
    throw new Error("invalid flow-distribution quantile array");
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
};

type DistributionBucket = {
  pair: string | null;
  horizonMin: number | null;
  rows: number;
  metrics: Record<string, FlowQuantileMetric>;
};

const metric = (
  row: RawDistributionRow,
  key: string,
): FlowQuantileMetric => flowQuantileMetric(row[`${key}_n`], row[`${key}_q`]);

function mapHyperliquidRow(row: RawDistributionRow): DistributionBucket {
  return {
    pair: row.pair,
    horizonMin: row.horizon_min == null ? null : Number(row.horizon_min),
    rows: Number(row.rows),
    metrics: {
      imbalance5s: metric(row, "imbalance_5"),
      imbalance30s: metric(row, "imbalance_30"),
      imbalance60s: metric(row, "imbalance_60"),
      absoluteImbalance60s: metric(row, "absolute_imbalance_60"),
      logNotional60s: metric(row, "log_notional_60"),
      tradeCount60s: metric(row, "trade_count_60"),
      maxTradeShare60s: metric(row, "max_trade_share_60"),
    },
  };
}

function mapClobEventRow(row: RawDistributionRow): DistributionBucket {
  return {
    pair: row.pair,
    horizonMin: row.horizon_min == null ? null : Number(row.horizon_min),
    rows: Number(row.rows),
    metrics: {
      canonical5s: metric(row, "canonical_5"),
      canonical30s: metric(row, "canonical_30"),
      canonical60s: metric(row, "canonical_60"),
      absoluteCanonical60s: metric(row, "absolute_canonical_60"),
      totalEvents60s: metric(row, "total_events_60"),
      receiveAgeSec: metric(row, "receive_age"),
      maxTransportLagMs60s: metric(row, "transport_lag"),
    },
  };
}

function reportFromRows(
  rows: RawDistributionRow[],
  mapper: (row: RawDistributionRow) => DistributionBucket,
) {
  const mapped = rows.map(mapper);
  const pooled = mapped.find((row) => row.pair == null && row.horizonMin == null);
  if (!pooled) throw new Error("flow distribution query omitted its pooled row");
  const buckets = mapped
    .filter((row) => row.pair != null && row.horizonMin != null)
    .sort((left, right) =>
      String(left.pair).localeCompare(String(right.pair))
      || Number(left.horizonMin) - Number(right.horizonMin)
    );
  if (buckets.length !== 12) {
    throw new Error(`flow distribution query returned ${buckets.length} buckets instead of 12`);
  }
  const report = { pooled, buckets };
  assertOutcomeFreeDistributionReport(report);
  return report;
}

async function loadHyperliquidDistribution() {
  const result = await db.execute<RawDistributionRow>(sql`
    with usable as (
      select *
      from polymarket_state_snapshot
      where captured_at >= ${new Date(HYPERLIQUID_FLOW_TAPE.evalStartMs)}
        and pair in ('BTC-USD','ETH-USD','SOL-USD','XRP-USD','DOGE-USD','BNB-USD')
        and horizon_min in (5,15)
        and hl_flow_version = ${HYPERLIQUID_FLOW_TAPE.version}
        and hl_flow_imbalance_60s is not null
        and hl_flow_notional_60s is not null
        and hl_flow_trade_count_60s is not null
        and hl_flow_max_trade_share_60s is not null
        and hl_flow_source_age_sec is not null
        and hl_flow_receive_age_sec is not null
        and hl_flow_max_transport_lag_ms_60s is not null
        and hl_flow_receive_age_sec <= ${HYPERLIQUID_FLOW_TAPE.maxLastTradeAgeSec}
        and hl_flow_max_transport_lag_ms_60s <= ${HYPERLIQUID_FLOW_TAPE.maxTransportLagMs}
    )
    select
      pair,
      horizon_min,
      count(*)::int as rows,
      count(hl_flow_imbalance_5s)::int as imbalance_5_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by hl_flow_imbalance_5s)
        filter (where hl_flow_imbalance_5s is not null) as imbalance_5_q,
      count(hl_flow_imbalance_30s)::int as imbalance_30_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by hl_flow_imbalance_30s)
        filter (where hl_flow_imbalance_30s is not null) as imbalance_30_q,
      count(hl_flow_imbalance_60s)::int as imbalance_60_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by hl_flow_imbalance_60s) as imbalance_60_q,
      count(hl_flow_imbalance_60s)::int as absolute_imbalance_60_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by abs(hl_flow_imbalance_60s)) as absolute_imbalance_60_q,
      count(hl_flow_notional_60s)::int as log_notional_60_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by ln(1 + hl_flow_notional_60s)) as log_notional_60_q,
      count(hl_flow_trade_count_60s)::int as trade_count_60_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by hl_flow_trade_count_60s) as trade_count_60_q,
      count(hl_flow_max_trade_share_60s)::int as max_trade_share_60_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by hl_flow_max_trade_share_60s) as max_trade_share_60_q
    from usable
    group by grouping sets ((), (pair, horizon_min))
  `);
  return reportFromRows(result.rows, mapHyperliquidRow);
}

async function loadClobEventDistribution() {
  const result = await db.execute<RawDistributionRow>(sql`
    with usable as (
      select *
      from polymarket_state_snapshot
      where captured_at >= ${new Date(CLOB_EVENT_OFI_TAPE.evalStartMs)}
        and pair in ('BTC-USD','ETH-USD','SOL-USD','XRP-USD','DOGE-USD','BNB-USD')
        and horizon_min in (5,15)
        and clob_event_ofi_version = ${CLOB_EVENT_OFI_TAPE.version}
        and clob_event_ofi_canonical_5s is not null
        and clob_event_ofi_canonical_30s is not null
        and clob_event_ofi_canonical_60s is not null
        and clob_event_ofi_up_events_60s is not null
        and clob_event_ofi_down_events_60s is not null
        and clob_event_ofi_source_age_sec is not null
        and clob_event_ofi_receive_age_sec is not null
        and clob_event_ofi_max_transport_lag_ms_60s is not null
        and clob_event_ofi_receive_age_sec <= ${CLOB_EVENT_OFI_TAPE.maxSocketAgeSec}
        and clob_event_ofi_max_transport_lag_ms_60s <= ${CLOB_EVENT_OFI_TAPE.maxTransportLagMs}
    )
    select
      pair,
      horizon_min,
      count(*)::int as rows,
      count(clob_event_ofi_canonical_5s)::int as canonical_5_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by clob_event_ofi_canonical_5s) as canonical_5_q,
      count(clob_event_ofi_canonical_30s)::int as canonical_30_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by clob_event_ofi_canonical_30s) as canonical_30_q,
      count(clob_event_ofi_canonical_60s)::int as canonical_60_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by clob_event_ofi_canonical_60s) as canonical_60_q,
      count(clob_event_ofi_canonical_60s)::int as absolute_canonical_60_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by abs(clob_event_ofi_canonical_60s)) as absolute_canonical_60_q,
      count(*)::int as total_events_60_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (
          order by clob_event_ofi_up_events_60s + clob_event_ofi_down_events_60s
        ) as total_events_60_q,
      count(clob_event_ofi_receive_age_sec)::int as receive_age_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by clob_event_ofi_receive_age_sec) as receive_age_q,
      count(clob_event_ofi_max_transport_lag_ms_60s)::int as transport_lag_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by clob_event_ofi_max_transport_lag_ms_60s) as transport_lag_q
    from usable
    group by grouping sets ((), (pair, horizon_min))
  `);
  return reportFromRows(result.rows, mapClobEventRow);
}

const readHyperliquidDistribution = createAsyncTtlCache(
  FLOW_DISTRIBUTION_AUDIT.cacheMs,
  loadHyperliquidDistribution,
);
const readClobEventDistribution = createAsyncTtlCache(
  FLOW_DISTRIBUTION_AUDIT.cacheMs,
  loadClobEventDistribution,
);

export async function flowDistributionAudit() {
  const [hyperliquidStatus, clobEventStatus] = await Promise.all([
    hyperliquidFlowTapeStatus(),
    clobEventOfiTapeStatus(),
  ]);
  const [hyperliquidReport, clobEventReport] = await Promise.all([
    hyperliquidStatus.readyForOutcomeFreeDistributionAudit
      ? readHyperliquidDistribution()
      : null,
    clobEventStatus.readyForOutcomeFreeDistributionAudit
      ? readClobEventDistribution()
      : null,
  ]);
  const featureCutEnvelope = await readFlowFeatureCutEnvelope();
  const readySources =
    Number(hyperliquidReport != null) + Number(clobEventReport != null);
  return {
    version: FLOW_DISTRIBUTION_AUDIT.version,
    quantileProbabilities: FLOW_DISTRIBUTION_AUDIT.quantileProbabilities,
    cacheMs: FLOW_DISTRIBUTION_AUDIT.cacheMs,
    readySources,
    totalSources: 2,
    featureCutFreeze: {
      planVersion: FLOW_FEATURE_CUT_FREEZE.planVersion,
      artifactVersion: FLOW_FEATURE_CUT_FREEZE.artifactVersion,
      eligibleToFreeze: readySources === 2,
      frozen: featureCutEnvelope != null,
      requiredBuckets: FLOW_FEATURE_CUT_FREEZE.requiredBuckets,
      minimumBoundaryDelayMs: FLOW_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs,
      artifact: featureCutEnvelope == null
        ? null
        : {
            sha256: featureCutEnvelope.sha256,
            frozenAtMs: featureCutEnvelope.artifact.frozenAtMs,
            strategyNotBeforeMs: featureCutEnvelope.artifact.strategyNotBeforeMs,
            buckets: featureCutEnvelope.artifact.buckets.length,
          },
    },
    sources: {
      hyperliquid: {
        tapeVersion: hyperliquidStatus.version,
        evalStartMs: hyperliquidStatus.evalStartMs,
        ready: hyperliquidStatus.readyForOutcomeFreeDistributionAudit,
        report: hyperliquidReport,
      },
      clobEventOfi: {
        tapeVersion: clobEventStatus.version,
        evalStartMs: clobEventStatus.evalStartMs,
        ready: clobEventStatus.readyForOutcomeFreeDistributionAudit,
        report: clobEventReport,
      },
    },
  };
}
