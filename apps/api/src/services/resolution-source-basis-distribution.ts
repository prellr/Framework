/**
 * Readiness-gated, outcome-free distributions for the Chainlink × Hyperliquid basis tape.
 *
 * The feature-value query is private, cached, and unreachable until all six venue-tape pairs pass
 * every inherited row/span/block floor. It selects no market, strategy, side, outcome, paper
 * decision, fill, grade, return, or P&L field.
 */
import { db } from "@framework/db";
import { sql } from "drizzle-orm";
import { createAsyncTtlCache } from "./async-ttl-cache.ts";
import {
  RESOLUTION_SOURCE_BASIS_DISTRIBUTION_AUDIT,
} from "./resolution-source-basis-distribution-contract.ts";
import { venueLeadLagTapeStatus } from "./venue-lead-lag-report.ts";

const FORBIDDEN_REPORT_KEY =
  /(?:outcome|resolution|label|grade|pnl|winRate|profit|loss|paper|decision|chosenSide|fill|return)/i;

export function assertOutcomeFreeBasisDistributionReport(
  value: unknown,
  path = "report",
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertOutcomeFreeBasisDistributionReport(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_REPORT_KEY.test(key)) {
      throw new Error(`Resolution-source basis disclosure blocked at ${path}.${key}`);
    }
    assertOutcomeFreeBasisDistributionReport(child, `${path}.${key}`);
  }
}

export type BasisQuantileMetric = {
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

export function basisQuantileMetric(
  nValue: unknown,
  quantileValue: unknown,
): BasisQuantileMetric {
  const n = Number(nValue);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error("invalid resolution-source basis metric count");
  }
  if (n === 0) return { n, quantiles: null };
  const values = numericArray(quantileValue);
  if (
    !values
    || values.length
      !== RESOLUTION_SOURCE_BASIS_DISTRIBUTION_AUDIT.quantileProbabilities.length
  ) {
    throw new Error("invalid resolution-source basis quantile array");
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

type RawBasisDistributionRow = Record<string, unknown> & {
  pair: string | null;
  rows: number;
};

type BasisDistributionBucket = {
  pair: string | null;
  rows: number;
  metrics: Record<string, BasisQuantileMetric>;
};

const metric = (
  row: RawBasisDistributionRow,
  key: string,
): BasisQuantileMetric => basisQuantileMetric(row[`${key}_n`], row[`${key}_q`]);

function mapRow(row: RawBasisDistributionRow): BasisDistributionBucket {
  return {
    pair: row.pair,
    rows: Number(row.rows),
    metrics: {
      basisBps: metric(row, "basis"),
      absoluteBasisBps: metric(row, "absolute_basis"),
      basisChange1sBps: metric(row, "basis_change_1s"),
      sameSignPersistence5s: metric(row, "same_sign_persistence_5s"),
      chainlinkAgeMs: metric(row, "chainlink_age"),
      hlAgeMs: metric(row, "hl_age"),
    },
  };
}

export function basisDistributionReportFromRows(rows: RawBasisDistributionRow[]) {
  const mapped = rows.map(mapRow);
  const pooled = mapped.find((row) => row.pair == null);
  if (!pooled) throw new Error("resolution-source basis query omitted its pooled row");

  const expectedPairs = new Set<string>(
    RESOLUTION_SOURCE_BASIS_DISTRIBUTION_AUDIT.pairs,
  );
  const seen = new Set<string>();
  const buckets = mapped
    .filter((row) => row.pair != null)
    .map((row) => {
      const pair = String(row.pair);
      if (!expectedPairs.has(pair)) {
        throw new Error(`resolution-source basis query returned out-of-scope pair ${pair}`);
      }
      if (seen.has(pair)) {
        throw new Error(`resolution-source basis query returned duplicate pair ${pair}`);
      }
      seen.add(pair);
      return row;
    })
    .sort((left, right) => String(left.pair).localeCompare(String(right.pair)));
  const missingPairs = RESOLUTION_SOURCE_BASIS_DISTRIBUTION_AUDIT.pairs.filter(
    (pair) => !seen.has(pair),
  );
  if (missingPairs.length) {
    throw new Error(
      `resolution-source basis query omitted pairs: ${missingPairs.join(", ")}`,
    );
  }

  const report = { pooled, buckets };
  assertOutcomeFreeBasisDistributionReport(report);
  return report;
}

async function loadResolutionSourceBasisDistribution() {
  const result = await db.execute<RawBasisDistributionRow>(sql`
    with ordered as (
      select
        pair,
        sampled_at,
        basis_bps,
        chainlink_age_ms,
        hl_age_ms,
        lag(sampled_at, 1) over w as prior_at_1,
        lag(sampled_at, 2) over w as prior_at_2,
        lag(sampled_at, 3) over w as prior_at_3,
        lag(sampled_at, 4) over w as prior_at_4,
        lag(basis_bps, 1) over w as prior_basis_1,
        lag(basis_bps, 2) over w as prior_basis_2,
        lag(basis_bps, 3) over w as prior_basis_3,
        lag(basis_bps, 4) over w as prior_basis_4
      from venue_price_snapshot
      where sampled_at >= ${new Date(RESOLUTION_SOURCE_BASIS_DISTRIBUTION_AUDIT.evalStartMs)}
        and pair in ('BTC-USD','ETH-USD','SOL-USD','XRP-USD','DOGE-USD','BNB-USD')
        and chainlink_age_ms <= ${RESOLUTION_SOURCE_BASIS_DISTRIBUTION_AUDIT.maximumSourceAgeMs}
        and hl_age_ms <= ${RESOLUTION_SOURCE_BASIS_DISTRIBUTION_AUDIT.maximumSourceAgeMs}
        and basis_bps not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
      window w as (partition by pair order by sampled_at)
    ),
    usable as (
      select
        pair,
        basis_bps,
        abs(basis_bps) as absolute_basis_bps,
        case
          when sampled_at - prior_at_1 = interval '1 second'
          then basis_bps - prior_basis_1
        end as basis_change_1s_bps,
        case
          when basis_bps <> 0
            and sampled_at - prior_at_1 = interval '1 second'
            and sampled_at - prior_at_2 = interval '2 seconds'
            and sampled_at - prior_at_3 = interval '3 seconds'
            and sampled_at - prior_at_4 = interval '4 seconds'
          then (
            1
            + (sign(prior_basis_1) = sign(basis_bps))::int
            + (sign(prior_basis_2) = sign(basis_bps))::int
            + (sign(prior_basis_3) = sign(basis_bps))::int
            + (sign(prior_basis_4) = sign(basis_bps))::int
          ) / 5.0
        end as same_sign_persistence_5s,
        chainlink_age_ms,
        hl_age_ms
      from ordered
    )
    select
      pair,
      count(*)::int as rows,
      count(basis_bps)::int as basis_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by basis_bps) as basis_q,
      count(absolute_basis_bps)::int as absolute_basis_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by absolute_basis_bps) as absolute_basis_q,
      count(basis_change_1s_bps)::int as basis_change_1s_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by basis_change_1s_bps)
        filter (where basis_change_1s_bps is not null) as basis_change_1s_q,
      count(same_sign_persistence_5s)::int as same_sign_persistence_5s_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by same_sign_persistence_5s)
        filter (where same_sign_persistence_5s is not null) as same_sign_persistence_5s_q,
      count(chainlink_age_ms)::int as chainlink_age_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by chainlink_age_ms) as chainlink_age_q,
      count(hl_age_ms)::int as hl_age_n,
      percentile_cont(array[0.05,0.25,0.5,0.75,0.95])
        within group (order by hl_age_ms) as hl_age_q
    from usable
    group by grouping sets ((), (pair))
  `);
  return basisDistributionReportFromRows(result.rows);
}

const readResolutionSourceBasisDistribution = createAsyncTtlCache(
  RESOLUTION_SOURCE_BASIS_DISTRIBUTION_AUDIT.cacheMs,
  loadResolutionSourceBasisDistribution,
);

export async function resolutionSourceBasisDistributionAudit() {
  const tape = await venueLeadLagTapeStatus();
  const report = tape.allPairsReadyForFrozenDiagnostic
    ? await readResolutionSourceBasisDistribution()
    : null;
  return {
    version: RESOLUTION_SOURCE_BASIS_DISTRIBUTION_AUDIT.version,
    tapeVersion: RESOLUTION_SOURCE_BASIS_DISTRIBUTION_AUDIT.tapeVersion,
    evalStartMs: RESOLUTION_SOURCE_BASIS_DISTRIBUTION_AUDIT.evalStartMs,
    quantileProbabilities:
      RESOLUTION_SOURCE_BASIS_DISTRIBUTION_AUDIT.quantileProbabilities,
    cacheMs: RESOLUTION_SOURCE_BASIS_DISTRIBUTION_AUDIT.cacheMs,
    metrics: RESOLUTION_SOURCE_BASIS_DISTRIBUTION_AUDIT.metrics,
    inheritedTapeReady: tape.allPairsReadyForFrozenDiagnostic,
    tape: {
      minimumRows: tape.minRows,
      minimumSpanDays: tape.minSpanDays,
      minimumBlocks: tape.minBlocks,
      pairs: tape.pairs,
    },
    report,
  };
}
