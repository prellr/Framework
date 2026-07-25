import { and, asc, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import { db, macroBreadthSnapshots, paperTrades } from "@framework/db";
import { MACRO_BREADTH_ROUTER } from "./macro-breadth-router.ts";
import {
  PAPER_BOTS,
  paperBotBucketUniverse,
} from "./paper-floor.ts";
import {
  PAPER_ENGINE_V3_START_MS,
  PAPER_GATE,
} from "./paper-floor-gate.ts";
import { PAPER_ACCOUNTING } from "./paper-accounting.ts";

const WINNER_PROFIT_HAIRCUT = PAPER_ACCOUNTING.profitStress.winnerProfitHaircut;
const HORIZONS = [5, 15] as const;
const PERIOD_MS = {
  "24h": 24 * 60 * 60_000,
  "3d": 3 * 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
  "30d": 30 * 24 * 60 * 60_000,
  all: null,
} as const;

export type PaperPerformanceScope = "paper" | "forward" | "history";
export type PaperPerformancePeriod = keyof typeof PERIOD_MS;
export type PaperPerformanceAsset = "BTC" | "ETH" | "SOL" | "XRP" | "DOGE" | "BNB";

export interface PaperPerformanceInput {
  scope: PaperPerformanceScope;
  period: PaperPerformancePeriod;
  timezone: string;
  asset?: PaperPerformanceAsset;
  assets?: PaperPerformanceAsset[];
  segmentBotKey?: string;
  segmentHorizonMin?: 5 | 15;
}

type AggregateRow = {
  botKey: string;
  horizonMin: number;
  n: number | string;
  wins: number | string;
  pnl: number | string;
  profitStress: number | string;
  pairedN: number | string;
  residual: number | string;
  firstAt: Date | string | null;
  lastAt: Date | string | null;
  activeDays: number | string;
};

type SegmentSqlRow = {
  dimension:
    | "day"
    | "hour"
    | "session"
    | "weekday"
    | "asset"
    | "side"
    | "ask"
    | "macro"
    | "technical"
    | "freshness";
  key: string;
  n: number | string;
  days: number | string;
  wins: number | string;
  pnl: number | string;
  profit_stress: number | string;
  paired_n: number | string;
  residual: number | string;
};

const num = (value: number | string | null | undefined) => Number(value ?? 0);
const timeMs = (value: Date | string | null) =>
  value == null ? null : value instanceof Date ? value.getTime() : new Date(value).getTime();

export function paperPerformanceStartMs(
  scope: PaperPerformanceScope,
  period: PaperPerformancePeriod,
  nowMs: number,
): number | null {
  const scopeStart = scope === "forward"
    ? PAPER_GATE.evalStartMs
    : scope === "paper"
      ? PAPER_ENGINE_V3_START_MS
      : null;
  const duration = PERIOD_MS[period];
  const periodStart = duration == null ? null : nowMs - duration;
  if (scopeStart == null) return periodStart;
  if (periodStart == null) return scopeStart;
  return Math.max(scopeStart, periodStart);
}

const validTimezone = (timezone: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return "America/Chicago";
  }
};

const baseCondition = (
  startMs: number | null,
  asset?: PaperPerformanceAsset,
  assets?: PaperPerformanceAsset[],
): SQL => and(
  inArray(paperTrades.status, ["won", "lost"]),
  ...(startMs == null ? [] : [gte(paperTrades.windowStart, new Date(startMs))]),
  ...(assets?.length
    ? [inArray(paperTrades.pair, assets.map((item) => `${item}-USD`))]
    : asset == null
      ? []
      : [eq(paperTrades.pair, `${asset}-USD`)]),
) as SQL;

export function normalizePaperPerformanceAssets(
  input: Pick<PaperPerformanceInput, "asset" | "assets">,
): PaperPerformanceAsset[] {
  return [...new Set(input.assets?.length ? input.assets : input.asset ? [input.asset] : [])];
}

const registeredCohorts = () => PAPER_BOTS.flatMap((bot) => {
  const horizons = new Set(
    paperBotBucketUniverse(bot)
      .map((bucket) => bucket.horizonMin)
      .filter((horizon): horizon is 5 | 15 => horizon === 5 || horizon === 15),
  );
  return HORIZONS
    .filter((horizon) => horizons.has(horizon))
    .map((horizonMin) => ({
      key: `${bot.key}:${horizonMin}`,
      botKey: bot.key,
      name: bot.name,
      color: bot.color,
      horizonMin,
      control: bot.key === "drift",
      evalStartMs: Math.max(PAPER_GATE.evalStartMs, bot.evalStartMs),
    }));
});

export async function paperPerformance(
  input: PaperPerformanceInput,
  nowMs = Date.now(),
) {
  const timezone = validTimezone(input.timezone);
  const fromMs = paperPerformanceStartMs(input.scope, input.period, nowMs);
  const assets = normalizePaperPerformanceAssets(input);
  const condition = baseCondition(fromMs, input.asset, input.assets);
  const localTime = sql`timezone(${timezone}, ${paperTrades.windowStart} at time zone 'UTC')`;
  const aggregateRows = await db
    .select({
      botKey: paperTrades.botKey,
      horizonMin: paperTrades.horizonMin,
      n: sql<number>`count(*)::int`,
      wins: sql<number>`count(*) filter (where ${paperTrades.status} = 'won')::int`,
      pnl: sql<number>`coalesce(sum(${paperTrades.pnlUsd}), 0)::double precision`,
      profitStress: sql<number>`coalesce(sum(case when ${paperTrades.status} = 'won' then ${paperTrades.pnlUsd} * ${1 - WINNER_PROFIT_HAIRCUT} else ${paperTrades.pnlUsd} end), 0)::double precision`,
      pairedN: sql<number>`count(*) filter (
        where ${paperTrades.controlAskPaid} is not null
          and ${paperTrades.side} in ('up', 'down')
      )::int`,
      residual: sql<number>`coalesce(sum(
        case
          when ${paperTrades.controlAskPaid} is null or ${paperTrades.side} not in ('up', 'down') then 0
          else
            case when ${paperTrades.status} = 'won' then 1 - ${paperTrades.askPaid} else -${paperTrades.askPaid} end
            -
            case
              when (${paperTrades.side} = 'down' and ${paperTrades.status} = 'won')
                or (${paperTrades.side} = 'up' and ${paperTrades.status} = 'lost')
                then 1 - ${paperTrades.controlAskPaid}
              else -${paperTrades.controlAskPaid}
            end
        end
      ), 0)::double precision`,
      firstAt: sql<Date | string | null>`min(${paperTrades.windowStart})`,
      lastAt: sql<Date | string | null>`max(${paperTrades.windowStart})`,
      activeDays: sql<number>`count(distinct date_trunc('day', ${localTime}))::int`,
    })
    .from(paperTrades)
    .where(condition)
    .groupBy(paperTrades.botKey, paperTrades.horizonMin)
    .orderBy(asc(paperTrades.botKey), asc(paperTrades.horizonMin));

  const aggregateByKey = new Map(
    (aggregateRows as AggregateRow[]).map((row) => [`${row.botKey}:${row.horizonMin}`, row]),
  );
  const cohorts = registeredCohorts().map((cohort) => {
    const row = aggregateByKey.get(cohort.key);
    const n = num(row?.n);
    const wins = num(row?.wins);
    const pnl = num(row?.pnl);
    const pairedN = num(row?.pairedN);
    const residual = num(row?.residual);
    return {
      ...cohort,
      n,
      wins,
      losses: Math.max(0, n - wins),
      winRate: n ? wins / n : null,
      pnl,
      profitStress: num(row?.profitStress),
      netPerBet: n ? pnl / n : null,
      pairedN,
      residual,
      residualPerBet: pairedN ? residual / pairedN : null,
      firstAtMs: timeMs(row?.firstAt ?? null),
      lastAtMs: timeMs(row?.lastAt ?? null),
      activeDays: num(row?.activeDays),
    };
  });

  const requested = cohorts.find((cohort) =>
    cohort.botKey === input.segmentBotKey
    && cohort.horizonMin === input.segmentHorizonMin
  );
  const selected = requested
    ?? cohorts
      .filter((cohort) => !cohort.control && cohort.n > 0)
      .sort((a, b) =>
        (b.residualPerBet ?? Number.NEGATIVE_INFINITY)
        - (a.residualPerBet ?? Number.NEGATIVE_INFINITY)
        || b.pnl - a.pnl
        || b.n - a.n
      )[0]
    ?? cohorts[0];

  const segmentCondition = selected
    ? and(
      condition,
      eq(paperTrades.botKey, selected.botKey),
      eq(paperTrades.horizonMin, selected.horizonMin),
    ) as SQL
    : condition;

  const segmentResult = selected
    ? await db.execute(sql`
      with base as materialized (
        select
          ${paperTrades.pair} as pair,
          ${paperTrades.side} as side,
          ${paperTrades.askPaid} as ask_paid,
          ${paperTrades.controlAskPaid} as control_ask_paid,
          ${paperTrades.status} as status,
          ${paperTrades.pnlUsd} as pnl_usd,
          ${paperTrades.signalAgeSec} as signal_age_sec,
          ${paperTrades.modelMeta} #>> '{technicalRegime,label}' as technical_regime,
          ${macroBreadthSnapshots.state} as macro_state,
          ${localTime} as local_time
        from ${paperTrades}
        left join ${macroBreadthSnapshots}
          on ${macroBreadthSnapshots.version} = ${MACRO_BREADTH_ROUTER.version}
          and ${macroBreadthSnapshots.barEnd} = ${paperTrades.windowStart}
        where ${segmentCondition}
      ),
      segments as (
        select 'day'::text as dimension, to_char(local_time, 'YYYY-MM-DD') as key, local_time::date as local_day, status, pnl_usd, side, ask_paid, control_ask_paid from base
        union all
        select 'hour', lpad(extract(hour from local_time)::int::text, 2, '0'), local_time::date, status, pnl_usd, side, ask_paid, control_ask_paid from base
        union all
        select
          'session',
          case
            when extract(hour from local_time) < 6 then '00–06'
            when extract(hour from local_time) < 12 then '06–12'
            when extract(hour from local_time) < 18 then '12–18'
            else '18–24'
          end,
          local_time::date,
          status,
          pnl_usd,
          side,
          ask_paid,
          control_ask_paid
        from base
        union all
        select 'weekday', extract(isodow from local_time)::int::text, local_time::date, status, pnl_usd, side, ask_paid, control_ask_paid from base
        union all
        select 'asset', replace(pair, '-USD', ''), local_time::date, status, pnl_usd, side, ask_paid, control_ask_paid from base
        union all
        select 'side', upper(side), local_time::date, status, pnl_usd, side, ask_paid, control_ask_paid from base
        union all
        select
          'ask',
          case
            when ask_paid < 0.35 then '<35¢'
            when ask_paid < 0.50 then '35–49¢'
            when ask_paid < 0.65 then '50–64¢'
            else '65¢+'
          end,
          local_time::date,
          status,
          pnl_usd,
          side,
          ask_paid,
          control_ask_paid
        from base
        union all
        select
          'macro',
          coalesce(upper(macro_state), 'UNAVAILABLE'),
          local_time::date,
          status,
          pnl_usd,
          side,
          ask_paid,
          control_ask_paid
        from base
        union all
        select
          'technical',
          coalesce(initcap(technical_regime), 'Unavailable'),
          local_time::date,
          status,
          pnl_usd,
          side,
          ask_paid,
          control_ask_paid
        from base
        union all
        select
          'freshness',
          case
            when signal_age_sec is null then 'Unavailable'
            when signal_age_sec < 2 then '<2s'
            when signal_age_sec < 5 then '2–5s'
            when signal_age_sec < 15 then '5–15s'
            else '15s+'
          end,
          local_time::date,
          status,
          pnl_usd,
          side,
          ask_paid,
          control_ask_paid
        from base
      )
      select
        dimension,
        key,
        count(*)::int as n,
        count(distinct local_day)::int as days,
        count(*) filter (where status = 'won')::int as wins,
        coalesce(sum(pnl_usd), 0)::double precision as pnl,
        coalesce(sum(case when status = 'won' then pnl_usd * ${1 - WINNER_PROFIT_HAIRCUT} else pnl_usd end), 0)::double precision as profit_stress,
        count(*) filter (
          where control_ask_paid is not null and side in ('up', 'down')
        )::int as paired_n,
        coalesce(sum(
          case
            when control_ask_paid is null or side not in ('up', 'down') then 0
            else
              case when status = 'won' then 1 - ask_paid else -ask_paid end
              -
              case
                when (side = 'down' and status = 'won') or (side = 'up' and status = 'lost')
                  then 1 - control_ask_paid
                else -control_ask_paid
              end
          end
        ), 0)::double precision as residual
      from segments
      group by dimension, key
      order by dimension, key
    `)
    : { rows: [] };

  const segments = (segmentResult.rows as SegmentSqlRow[]).map((row) => {
    const n = num(row.n);
    const activeDays = num(row.days);
    const wins = num(row.wins);
    const pnl = num(row.pnl);
    const pairedN = num(row.paired_n);
    const residual = num(row.residual);
    return {
      dimension: row.dimension,
      key: row.key,
      n,
      activeDays,
      wins,
      losses: Math.max(0, n - wins),
      winRate: n ? wins / n : null,
      pnl,
      profitStress: num(row.profit_stress),
      netPerBet: n ? pnl / n : null,
      pairedN,
      residual,
      residualPerBet: pairedN ? residual / pairedN : null,
    };
  });

  return {
    accounting: PAPER_ACCOUNTING,
    scope: input.scope,
    period: input.period,
    asset: input.asset ?? (assets.length === 1 ? assets[0] : null),
    assets,
    timezone,
    fromMs,
    toMs: nowMs,
    authoritative: input.scope === "forward" && input.period === "all",
    note: input.scope === "forward" && input.period === "all"
      ? assets.length
        ? `${assets.join(", ")} rows are a diagnostic slice; the independent prospective 5m/15m verdict remains pooled over each strategy's registered asset universe.`
        : "N and performance retain pooled-gate history for context; the Familywise gate column is the independent prospective 5m/15m verdict."
      : "Filtered periods and segments are diagnostic only and cannot alter a frozen verdict.",
    cohorts,
    selectedKey: selected?.key ?? null,
    segments,
  };
}
