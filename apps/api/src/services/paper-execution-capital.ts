import { and, gte, inArray, sql, type SQL } from "drizzle-orm";
import { db, macroBreadthSnapshots, paperTrades } from "@framework/db";
import { MACRO_BREADTH_ROUTER } from "./macro-breadth-router.ts";
import { PAPER_BOTS } from "./paper-floor.ts";
import {
  paperPerformanceStartMs,
  type PaperPerformancePeriod,
  type PaperPerformanceScope,
} from "./paper-performance.ts";

export type PaperExecutionCapitalHorizon = "all" | 5 | 15;

export interface PaperExecutionCapitalInput {
  scope: PaperPerformanceScope;
  period: PaperPerformancePeriod;
  horizon: PaperExecutionCapitalHorizon;
  timezone: string;
}

type Numeric = number | string | null;

type SummaryRow = {
  paper_intents: Numeric;
  quote_samples: Numeric;
  execution_rows: Numeric;
  fee_rows: Numeric;
  multilevel_rows: Numeric;
  median_fee_usd: Numeric;
  p95_fee_usd: Numeric;
  median_fee_bps: Numeric;
  p95_fee_bps: Numeric;
  median_depth_bps: Numeric;
  p95_depth_bps: Numeric;
  median_spread_bps: Numeric;
  p95_spread_bps: Numeric;
};

type CapitalRow = {
  strategy_intents: Numeric;
  strategy_notional_usd: Numeric;
  unique_positions: Numeric;
  unique_notional_usd: Numeric;
  same_side_duplicate_intents: Numeric;
  markets: Numeric;
  same_side_shared_markets: Numeric;
  opposed_markets: Numeric;
  peak_naive_capital_usd: Numeric;
  peak_deduplicated_capital_usd: Numeric;
};

type SegmentRow = {
  bot_key: string;
  horizon_min: Numeric;
  dimension: "ask" | "macro" | "day" | "freshness";
  segment_key: string;
  n: Numeric;
  wins: Numeric;
  pnl: Numeric;
  avg_ask: Numeric;
  avg_fee_usd: Numeric;
  avg_depth_bps: Numeric;
};

type AskTrendRow = {
  bot_key: string;
  horizon_min: Numeric;
  local_day: string;
  ask_bucket: string;
  n: Numeric;
  wins: Numeric;
  pnl: Numeric;
};

const num = (value: Numeric | undefined) => Number(value ?? 0);
const nullableNum = (value: Numeric | undefined) => value == null ? null : Number(value);

const validTimezone = (timezone: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return "America/Chicago";
  }
};

const scopeCondition = (
  fromMs: number | null,
  horizon: PaperExecutionCapitalHorizon,
  gradedOnly: boolean,
): SQL => and(
  inArray(
    paperTrades.status,
    gradedOnly ? ["won", "lost"] : ["open", "won", "lost"],
  ),
  ...(fromMs == null ? [] : [gte(paperTrades.windowStart, new Date(fromMs))]),
  ...(horizon === "all" ? [] : [sql`${paperTrades.horizonMin} = ${horizon}`]),
) as SQL;

const botIdentity = new Map(PAPER_BOTS.map((bot) => [bot.key, bot]));
const CACHE_TTL_MS = 30_000;
const executionCapitalCache = new Map<
  string,
  { expiresAtMs: number; value: Awaited<ReturnType<typeof loadPaperExecutionCapital>> }
>();
const executionCapitalLoading = new Map<
  string,
  Promise<Awaited<ReturnType<typeof loadPaperExecutionCapital>>>
>();

/**
 * Read-only execution and capital diagnostics for the paper ledger.
 *
 * Quote-cost metrics deduplicate identical market-side quote snapshots so a shared paper decision
 * is not counted once per strategy. Result matrices intentionally retain each strategy decision and
 * are labeled as diagnostic—not a portfolio. No credential, balance, signing, order, or mutation
 * capability is reachable from this service.
 */
async function loadPaperExecutionCapital(
  input: PaperExecutionCapitalInput,
  nowMs: number,
) {
  const timezone = validTimezone(input.timezone);
  const fromMs = paperPerformanceStartMs(input.scope, input.period, nowMs);
  const executionCondition = scopeCondition(fromMs, input.horizon, false);
  const gradedCondition = scopeCondition(fromMs, input.horizon, true);
  const localTime = sql`timezone(${timezone}, ${paperTrades.windowStart} at time zone 'UTC')`;

  const grossVwap = sql`
    case
      when ${paperTrades.side} = 'up'
        then nullif(${paperTrades.modelMeta} #>> '{bookExecution,up,grossVwap}', '')::double precision
      when ${paperTrades.side} = 'down'
        then nullif(${paperTrades.modelMeta} #>> '{bookExecution,down,grossVwap}', '')::double precision
      else null
    end
  `;
  const feeUsd = sql`
    case
      when ${paperTrades.side} = 'up'
        then nullif(${paperTrades.modelMeta} #>> '{bookExecution,up,feeUsd}', '')::double precision
      when ${paperTrades.side} = 'down'
        then nullif(${paperTrades.modelMeta} #>> '{bookExecution,down,feeUsd}', '')::double precision
      else null
    end
  `;
  const levelsConsumed = sql`
    case
      when ${paperTrades.side} = 'up'
        then nullif(${paperTrades.modelMeta} #>> '{bookExecution,up,levelsConsumed}', '')::int
      when ${paperTrades.side} = 'down'
        then nullif(${paperTrades.modelMeta} #>> '{bookExecution,down,levelsConsumed}', '')::int
      else null
    end
  `;
  const bestAsk = sql`
    case
      when ${paperTrades.side} = 'up'
        then nullif(${paperTrades.modelMeta} #>> '{bookMicrostructure,up,bestAsk}', '')::double precision
      when ${paperTrades.side} = 'down'
        then nullif(${paperTrades.modelMeta} #>> '{bookMicrostructure,down,bestAsk}', '')::double precision
      else null
    end
  `;
  const spread = sql`
    case
      when ${paperTrades.side} = 'up'
        then nullif(${paperTrades.modelMeta} #>> '{bookMicrostructure,up,spread}', '')::double precision
      when ${paperTrades.side} = 'down'
        then nullif(${paperTrades.modelMeta} #>> '{bookMicrostructure,down,spread}', '')::double precision
      else null
    end
  `;

  const [summaryResult, capitalResult, segmentResult, askTrendResult] = await Promise.all([
    db.execute(sql`
      with base as materialized (
        select
          ${paperTrades.conditionId} as condition_id,
          ${paperTrades.side} as side,
          ${paperTrades.askPaid} as effective_vwap,
          ${grossVwap} as gross_vwap,
          ${feeUsd} as fee_usd,
          ${levelsConsumed} as levels_consumed,
          ${bestAsk} as best_ask,
          ${spread} as spread
        from ${paperTrades}
        where ${executionCondition}
      ),
      quote_samples as (
        select distinct
          condition_id,
          side,
          effective_vwap,
          gross_vwap,
          fee_usd,
          levels_consumed,
          best_ask,
          spread
        from base
      )
      select
        (select count(*) from base)::int as paper_intents,
        count(*)::int as quote_samples,
        count(*) filter (where gross_vwap is not null)::int as execution_rows,
        count(*) filter (where fee_usd is not null)::int as fee_rows,
        count(*) filter (where levels_consumed > 1)::int as multilevel_rows,
        percentile_cont(0.5) within group (order by fee_usd)
          filter (where fee_usd is not null) as median_fee_usd,
        percentile_cont(0.95) within group (order by fee_usd)
          filter (where fee_usd is not null) as p95_fee_usd,
        percentile_cont(0.5) within group (order by 10000 * (effective_vwap - gross_vwap))
          filter (where gross_vwap is not null) as median_fee_bps,
        percentile_cont(0.95) within group (order by 10000 * (effective_vwap - gross_vwap))
          filter (where gross_vwap is not null) as p95_fee_bps,
        percentile_cont(0.5) within group (order by 10000 * (gross_vwap - best_ask))
          filter (where gross_vwap is not null and best_ask is not null) as median_depth_bps,
        percentile_cont(0.95) within group (order by 10000 * (gross_vwap - best_ask))
          filter (where gross_vwap is not null and best_ask is not null) as p95_depth_bps,
        percentile_cont(0.5) within group (order by 10000 * spread)
          filter (where spread is not null) as median_spread_bps,
        percentile_cont(0.95) within group (order by 10000 * spread)
          filter (where spread is not null) as p95_spread_bps
      from quote_samples
    `),
    db.execute(sql`
      with base as materialized (
        select
          ${paperTrades.conditionId} as condition_id,
          ${paperTrades.side} as side,
          ${paperTrades.windowStart} as window_start,
          ${paperTrades.endDate} as end_date,
          ${paperTrades.botKey} as bot_key,
          ${paperTrades.sizeUsd} as size_usd
        from ${paperTrades}
        where ${executionCondition}
      ),
      positions as (
        select
          condition_id,
          side,
          min(window_start) as window_start,
          max(end_date) as end_date,
          max(size_usd) as size_usd,
          count(*)::int as intents,
          count(distinct bot_key)::int as strategies
        from base
        group by condition_id, side
      ),
      markets as (
        select
          condition_id,
          count(distinct side)::int as sides,
          max(strategies)::int as max_same_side_strategies
        from positions
        group by condition_id
      ),
      naive_events as (
        select window_start as event_at, sum(size_usd) as delta from base group by window_start
        union all
        select end_date as event_at, -sum(size_usd) as delta from base group by end_date
      ),
      naive_times as (
        select event_at, sum(delta) as delta from naive_events group by event_at
      ),
      naive_running as (
        select sum(delta) over (order by event_at rows unbounded preceding) as capital
        from naive_times
      ),
      position_events as (
        select window_start as event_at, sum(size_usd) as delta from positions group by window_start
        union all
        select end_date as event_at, -sum(size_usd) as delta from positions group by end_date
      ),
      position_times as (
        select event_at, sum(delta) as delta from position_events group by event_at
      ),
      position_running as (
        select sum(delta) over (order by event_at rows unbounded preceding) as capital
        from position_times
      )
      select
        (select count(*) from base)::int as strategy_intents,
        coalesce((select sum(size_usd) from base), 0)::double precision as strategy_notional_usd,
        (select count(*) from positions)::int as unique_positions,
        coalesce((select sum(size_usd) from positions), 0)::double precision as unique_notional_usd,
        coalesce((select sum(greatest(intents - 1, 0)) from positions), 0)::int
          as same_side_duplicate_intents,
        (select count(*) from markets)::int as markets,
        count(*) filter (where max_same_side_strategies > 1)::int as same_side_shared_markets,
        count(*) filter (where sides > 1)::int as opposed_markets,
        coalesce((select max(capital) from naive_running), 0)::double precision
          as peak_naive_capital_usd,
        coalesce((select max(capital) from position_running), 0)::double precision
          as peak_deduplicated_capital_usd
      from markets
    `),
    db.execute(sql`
      with base as materialized (
        select
          ${paperTrades.botKey} as bot_key,
          ${paperTrades.horizonMin} as horizon_min,
          ${paperTrades.status} as status,
          ${paperTrades.pnlUsd} as pnl_usd,
          ${paperTrades.askPaid} as ask_paid,
          ${paperTrades.signalAgeSec} as signal_age_sec,
          ${feeUsd} as fee_usd,
          case
            when ${grossVwap} is not null and ${bestAsk} is not null
              then 10000 * (${grossVwap} - ${bestAsk})
            else null
          end as depth_bps,
          ${macroBreadthSnapshots.state} as macro_state,
          ${localTime} as local_time
        from ${paperTrades}
        left join ${macroBreadthSnapshots}
          on ${macroBreadthSnapshots.version} = ${MACRO_BREADTH_ROUTER.version}
          and ${macroBreadthSnapshots.barEnd} = ${paperTrades.windowStart}
        where ${gradedCondition}
      ),
      segments as (
        select
          bot_key,
          horizon_min,
          'ask'::text as dimension,
          case
            when ask_paid < 0.35 then '<35¢'
            when ask_paid < 0.50 then '35–49¢'
            when ask_paid < 0.65 then '50–64¢'
            else '65¢+'
          end as segment_key,
          status,
          pnl_usd,
          ask_paid,
          fee_usd,
          depth_bps
        from base
        union all
        select
          bot_key,
          horizon_min,
          'macro',
          coalesce(upper(macro_state), 'UNAVAILABLE'),
          status,
          pnl_usd,
          ask_paid,
          fee_usd,
          depth_bps
        from base
        union all
        select
          bot_key,
          horizon_min,
          'day',
          to_char(local_time, 'YYYY-MM-DD'),
          status,
          pnl_usd,
          ask_paid,
          fee_usd,
          depth_bps
        from base
        union all
        select
          bot_key,
          horizon_min,
          'freshness',
          case
            when signal_age_sec is null then 'UNAVAILABLE'
            when signal_age_sec < 2 then '<2s'
            when signal_age_sec < 5 then '2–5s'
            when signal_age_sec < 15 then '5–15s'
            else '15s+'
          end,
          status,
          pnl_usd,
          ask_paid,
          fee_usd,
          depth_bps
        from base
      )
      select
        bot_key,
        horizon_min,
        dimension,
        segment_key,
        count(*)::int as n,
        count(*) filter (where status = 'won')::int as wins,
        coalesce(sum(pnl_usd), 0)::double precision as pnl,
        avg(ask_paid)::double precision as avg_ask,
        avg(fee_usd)::double precision as avg_fee_usd,
        avg(depth_bps)::double precision as avg_depth_bps
      from segments
      group by bot_key, horizon_min, dimension, segment_key
      order by dimension, segment_key, bot_key, horizon_min
    `),
    db.execute(sql`
      with base as materialized (
        select
          ${paperTrades.botKey} as bot_key,
          ${paperTrades.horizonMin} as horizon_min,
          ${paperTrades.status} as status,
          ${paperTrades.pnlUsd} as pnl_usd,
          ${paperTrades.askPaid} as ask_paid,
          ${localTime} as local_time
        from ${paperTrades}
        where ${gradedCondition}
      )
      select
        bot_key,
        horizon_min,
        to_char(local_time, 'YYYY-MM-DD') as local_day,
        case
          when ask_paid < 0.35 then '<35¢'
          when ask_paid < 0.50 then '35–49¢'
          when ask_paid < 0.65 then '50–64¢'
          else '65¢+'
        end as ask_bucket,
        count(*)::int as n,
        count(*) filter (where status = 'won')::int as wins,
        coalesce(sum(pnl_usd), 0)::double precision as pnl
      from base
      group by bot_key, horizon_min, local_day, ask_bucket
      order by local_day, ask_bucket, bot_key, horizon_min
    `),
  ]);

  const summary = (summaryResult.rows[0] ?? {}) as Partial<SummaryRow>;
  const capital = (capitalResult.rows[0] ?? {}) as Partial<CapitalRow>;
  const quoteSamples = num(summary.quote_samples);
  const executionRows = num(summary.execution_rows);
  const strategyNotionalUsd = num(capital.strategy_notional_usd);
  const uniqueNotionalUsd = num(capital.unique_notional_usd);

  return {
    version: "paper-execution-capital-view-v1",
    paperOnly: true as const,
    executionCapability: false as const,
    scope: input.scope,
    period: input.period,
    horizon: input.horizon,
    timezone,
    fromMs,
    toMs: nowMs,
    quoteCosts: {
      paperIntents: num(summary.paper_intents),
      quoteSamples,
      executionRows,
      executionCoverage: quoteSamples ? executionRows / quoteSamples : 0,
      feeRows: num(summary.fee_rows),
      multilevelRows: num(summary.multilevel_rows),
      multilevelRate: executionRows ? num(summary.multilevel_rows) / executionRows : 0,
      medianFeeUsd: nullableNum(summary.median_fee_usd ?? null),
      p95FeeUsd: nullableNum(summary.p95_fee_usd ?? null),
      medianFeeBps: nullableNum(summary.median_fee_bps ?? null),
      p95FeeBps: nullableNum(summary.p95_fee_bps ?? null),
      medianDepthBps: nullableNum(summary.median_depth_bps ?? null),
      p95DepthBps: nullableNum(summary.p95_depth_bps ?? null),
      medianSpreadBps: nullableNum(summary.median_spread_bps ?? null),
      p95SpreadBps: nullableNum(summary.p95_spread_bps ?? null),
    },
    capital: {
      strategyIntents: num(capital.strategy_intents),
      strategyNotionalUsd,
      uniquePositions: num(capital.unique_positions),
      uniqueNotionalUsd,
      sameSideDuplicateIntents: num(capital.same_side_duplicate_intents),
      markets: num(capital.markets),
      sameSideSharedMarkets: num(capital.same_side_shared_markets),
      opposedMarkets: num(capital.opposed_markets),
      opposedMarketRate: num(capital.markets)
        ? num(capital.opposed_markets) / num(capital.markets)
        : 0,
      deduplicationRate: strategyNotionalUsd
        ? 1 - uniqueNotionalUsd / strategyNotionalUsd
        : 0,
      peakNaiveCapitalUsd: num(capital.peak_naive_capital_usd),
      peakDeduplicatedCapitalUsd: num(capital.peak_deduplicated_capital_usd),
    },
    segments: (segmentResult.rows as SegmentRow[]).map((row) => {
      const identity = botIdentity.get(row.bot_key);
      const n = num(row.n);
      const wins = num(row.wins);
      const pnl = num(row.pnl);
      return {
        botKey: row.bot_key,
        name: identity?.name ?? row.bot_key,
        color: identity?.color ?? "#888888",
        horizonMin: num(row.horizon_min) as 5 | 15,
        dimension: row.dimension,
        key: row.segment_key,
        n,
        wins,
        winRate: n ? wins / n : null,
        pnl,
        netPerBet: n ? pnl / n : null,
        avgAsk: nullableNum(row.avg_ask),
        avgFeeUsd: nullableNum(row.avg_fee_usd),
        avgDepthBps: nullableNum(row.avg_depth_bps),
      };
    }),
    askTrend: (askTrendResult.rows as AskTrendRow[]).map((row) => {
      const identity = botIdentity.get(row.bot_key);
      const n = num(row.n);
      const wins = num(row.wins);
      const pnl = num(row.pnl);
      return {
        botKey: row.bot_key,
        name: identity?.name ?? row.bot_key,
        color: identity?.color ?? "#888888",
        horizonMin: num(row.horizon_min) as 5 | 15,
        day: row.local_day,
        askBucket: row.ask_bucket,
        n,
        wins,
        winRate: n ? wins / n : null,
        pnl,
        netPerBet: n ? pnl / n : null,
      };
    }),
    methodology: {
      quoteSample:
        "Identical market-side execution snapshots are counted once so shared strategy decisions do not multiply venue-cost evidence.",
      depthSlippage:
        "Gross book-walk VWAP minus the captured best ask, in price basis points.",
      feeDrag:
        "Fee-adjusted effective VWAP minus gross book-walk VWAP, in price basis points.",
      capital:
        "Naive capital treats every strategy decision as separate. Deduplicated capital nets same-market, same-side strategy intents into one $5 paper position; opposite sides remain separate.",
      limitations:
        "These are executable paper quotes, not exchange fills. Queue position, fill rejection, partial fills, post-submit latency, and realized live slippage remain unobserved.",
    },
  };
}

/**
 * A short keyed cache coalesces concurrent dashboard refreshes and bounds repeated historical
 * aggregate scans. The cache key contains every user-selectable scope dimension; it stores only
 * read-only projections and cannot affect paper collection or any research verdict.
 */
export async function paperExecutionCapital(input: PaperExecutionCapitalInput) {
  const timezone = validTimezone(input.timezone);
  const key = JSON.stringify({ ...input, timezone });
  const nowMs = Date.now();
  const cached = executionCapitalCache.get(key);
  if (cached && cached.expiresAtMs > nowMs) return cached.value;

  const active = executionCapitalLoading.get(key);
  if (active) return active;

  const loading = loadPaperExecutionCapital({ ...input, timezone }, nowMs)
    .then((value) => {
      executionCapitalCache.set(key, {
        value,
        expiresAtMs: Date.now() + CACHE_TTL_MS,
      });
      return value;
    })
    .finally(() => {
      executionCapitalLoading.delete(key);
    });
  executionCapitalLoading.set(key, loading);
  return loading;
}
