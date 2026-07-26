import { and, desc, eq, gte, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { db, paperTrades } from "@framework/db";
import { PAPER_BOTS, paperBotBucketUniverse } from "./paper-floor.ts";
import { paperPerformanceStartMs, type PaperPerformanceScope } from "./paper-performance.ts";

export type PaperUnder35Horizon = "all" | 5 | 15;

export interface PaperUnder35PortfolioInput {
  scope: PaperPerformanceScope;
  horizon: PaperUnder35Horizon;
  timezone: string;
  assets?: string[];
}

export interface PaperUnder35TradeHistoryInput {
  scope: PaperPerformanceScope;
  timezone: string;
  cohortKeys?: string[];
  assets?: string[];
}

type DailyRow = {
  bot_key: string;
  horizon_min: number | string;
  local_day: string;
  n: number | string;
  wins: number | string;
  pnl: number | string;
};

const UNDER_35_MAX_ASK = 0.35;
const CAPTURED_STAKE_USD = 5;
const HORIZONS = [5, 15] as const;
const CACHE_TTL_MS = 30_000;
const TRADE_HISTORY_CACHE_TTL_MS = 10_000;
const TRADE_HISTORY_LIMIT = 10_000;

const num = (value: number | string | null | undefined) => Number(value ?? 0);

const validTimezone = (timezone: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return "America/Chicago";
  }
};

/** Deterministic YYYY-MM-DD key in an arbitrary IANA timezone. */
export function under35LocalDayKey(atMs: number, timezone: string): string {
  if (!Number.isFinite(atMs)) throw new Error("under-35 timestamp must be finite");
  const safeTimezone = validTimezone(timezone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(atMs));
  const value = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  if (!year || !month || !day) throw new Error("under-35 calendar conversion failed");
  return `${year}-${month}-${day}`;
}

/**
 * Seven consecutive local calendar keys, including the current local day. Date arithmetic runs at
 * UTC noon so daylight-saving changes cannot skip or duplicate a calendar key.
 */
export function trailingUnder35DayKeys(nowMs: number, timezone: string, count = 7): string[] {
  const current = under35LocalDayKey(nowMs, timezone);
  const currentNoonUtc = Date.parse(`${current}T12:00:00Z`);
  return Array.from({ length: count }, (_, index) =>
    new Date(currentNoonUtc - (count - 1 - index) * 86_400_000).toISOString().slice(0, 10),
  );
}

const registeredCohorts = (horizon: PaperUnder35Horizon) =>
  PAPER_BOTS.flatMap((bot) => {
    const registeredHorizons = new Set(
      paperBotBucketUniverse(bot)
        .map((bucket) => bucket.horizonMin)
        .filter((value): value is 5 | 15 => value === 5 || value === 15),
    );
    return HORIZONS.filter(
      (horizonMin) =>
        registeredHorizons.has(horizonMin) && (horizon === "all" || horizon === horizonMin),
    ).map((horizonMin) => ({
      key: `${bot.key}:${horizonMin}`,
      botKey: bot.key,
      name: bot.name,
      color: bot.color,
      horizonMin,
      control: bot.key === "drift",
      registeredAtMs: bot.evalStartMs,
    }));
  });

async function loadPaperUnder35Portfolio(input: PaperUnder35PortfolioInput, nowMs: number) {
  const timezone = validTimezone(input.timezone);
  const dayKeys = trailingUnder35DayKeys(nowMs, timezone);
  const currentDay = dayKeys.at(-1) ?? under35LocalDayKey(nowMs, timezone);
  const firstDay = dayKeys[0] ?? currentDay;
  const scopeStartMs = paperPerformanceStartMs(input.scope, "all", nowMs);
  const indexedStartMs = Math.max(scopeStartMs ?? 0, nowMs - 8 * 86_400_000);
  const localTime = sql`timezone(${timezone}, ${paperTrades.windowStart} at time zone 'UTC')`;
  const localDay = sql<string>`to_char(${localTime}, 'YYYY-MM-DD')`;
  const condition = and(
    inArray(paperTrades.status, ["won", "lost"]),
    lt(paperTrades.askPaid, UNDER_35_MAX_ASK),
    gte(paperTrades.windowStart, new Date(indexedStartMs)),
    sql`(${localTime})::date >= ${firstDay}::date`,
    ...(input.horizon === "all" ? [] : [eq(paperTrades.horizonMin, input.horizon)]),
    ...(input.assets?.length
      ? [
          inArray(
            paperTrades.pair,
            input.assets.map((asset) => `${asset}-USD`),
          ),
        ]
      : []),
  ) as SQL;

  const rowsResult = await db.execute(sql`
    with base as materialized (
      select
        ${paperTrades.botKey} as bot_key,
        ${paperTrades.horizonMin} as horizon_min,
        ${paperTrades.status} as status,
        ${paperTrades.pnlUsd} as pnl_usd,
        ${localTime} as local_time
      from ${paperTrades}
      where ${condition}
    )
    select
      bot_key,
      horizon_min,
      to_char(local_time, 'YYYY-MM-DD') as local_day,
      count(*)::int as n,
      count(*) filter (where status = 'won')::int as wins,
      coalesce(sum(pnl_usd), 0)::double precision as pnl
    from base
    group by bot_key, horizon_min, local_day
    order by local_day, bot_key, horizon_min
  `);
  const rows = rowsResult.rows as DailyRow[];

  const rowByKey = new Map(
    rows.map((row) => [`${row.bot_key}:${row.horizon_min}:${row.local_day}`, row]),
  );

  const cohorts = registeredCohorts(input.horizon).map((cohort) => {
    const days = dayKeys.map((day) => {
      const row = rowByKey.get(`${cohort.botKey}:${cohort.horizonMin}:${day}`);
      const n = num(row?.n);
      const wins = num(row?.wins);
      const rawNet = num(row?.pnl);
      return {
        day,
        current: day === currentDay,
        n,
        wins,
        winRate: n ? wins / n : null,
        rawNet,
        observed: n > 0,
      };
    });
    const n = days.reduce((sum, day) => sum + day.n, 0);
    const wins = days.reduce((sum, day) => sum + day.wins, 0);
    const rawNet = days.reduce((sum, day) => sum + day.rawNet, 0);
    const activeDays = days.filter((day) => day.observed).length;
    return {
      ...cohort,
      days,
      n,
      wins,
      winRate: n ? wins / n : null,
      rawNet,
      netPerBet: n ? rawNet / n : null,
      activeDays,
      averageRawPerCalendarDay: rawNet / dayKeys.length,
      averageRawPerActiveDay: activeDays ? rawNet / activeDays : null,
    };
  });

  return {
    version: "paper-under-35-portfolio-view-v1",
    paperOnly: true as const,
    executionCapability: false as const,
    scope: input.scope,
    horizon: input.horizon,
    timezone,
    threshold: {
      operator: "<" as const,
      maxAsk: UNDER_35_MAX_ASK,
      maxAskCents: UNDER_35_MAX_ASK * 100,
      priceSource: "recorded fee-adjusted $5 book-walk VWAP",
    },
    capturedStakeUsd: CAPTURED_STAKE_USD,
    attributionClock: "window_start" as const,
    dayKeys,
    currentDay,
    scopeStartMs,
    toMs: nowMs,
    cohorts,
    methodology: {
      chart:
        "For each calendar day, selected-cohort RAW P&L is summed and divided by the number of selected cohorts. A selected cohort with no trade contributes $0 for that day.",
      table:
        "A blank day cell means the registered strategy × timeframe made no graded decision below the recorded 35¢ ask cap on that calendar day.",
      overlap:
        "Strategy decisions are intentionally not deduplicated. Multiple strategies can represent the same market-side exposure, so the basket is a diagnostic candidate rather than a portfolio equity curve.",
      selection:
        "Selections are a user-interface research workspace only. They do not modify the paper roster, prospective gates, or any execution path.",
    },
  };
}

const under35Cache = new Map<
  string,
  {
    expiresAtMs: number;
    value: Awaited<ReturnType<typeof loadPaperUnder35Portfolio>>;
  }
>();
const under35Loading = new Map<
  string,
  Promise<Awaited<ReturnType<typeof loadPaperUnder35Portfolio>>>
>();

/** Read-only seven-calendar-day `<35¢` strategy-selection projection. */
export async function paperUnder35Portfolio(input: PaperUnder35PortfolioInput) {
  const timezone = validTimezone(input.timezone);
  const key = JSON.stringify({ ...input, timezone });
  const nowMs = Date.now();
  const cached = under35Cache.get(key);
  if (cached && cached.expiresAtMs > nowMs) return cached.value;
  const active = under35Loading.get(key);
  if (active) return active;

  const loading = loadPaperUnder35Portfolio({ ...input, timezone }, nowMs)
    .then((value) => {
      under35Cache.set(key, {
        value,
        expiresAtMs: Date.now() + CACHE_TTL_MS,
      });
      return value;
    })
    .finally(() => {
      under35Loading.delete(key);
    });
  under35Loading.set(key, loading);
  return loading;
}

async function loadPaperUnder35TradeHistory(input: PaperUnder35TradeHistoryInput, nowMs: number) {
  const timezone = validTimezone(input.timezone);
  const dayKeys = trailingUnder35DayKeys(nowMs, timezone);
  const currentDay = dayKeys.at(-1) ?? under35LocalDayKey(nowMs, timezone);
  const firstDay = dayKeys[0] ?? currentDay;
  const scopeStartMs = paperPerformanceStartMs(input.scope, "all", nowMs);
  const indexedStartMs = Math.max(scopeStartMs ?? 0, nowMs - 8 * 86_400_000);
  const requestedCohorts = input.cohortKeys ? new Set(input.cohortKeys) : null;
  const selectedCohorts = registeredCohorts("all").filter(
    (cohort) => !requestedCohorts || requestedCohorts.has(cohort.key),
  );
  const cohortCondition = selectedCohorts.length
    ? or(
        ...selectedCohorts.map((cohort) =>
          and(eq(paperTrades.botKey, cohort.botKey), eq(paperTrades.horizonMin, cohort.horizonMin)),
        ),
      )
    : sql`false`;
  const localTime = sql`timezone(${timezone}, ${paperTrades.windowStart} at time zone 'UTC')`;
  const localDay = sql<string>`to_char(${localTime}, 'YYYY-MM-DD')`;
  const condition = and(
    cohortCondition,
    inArray(paperTrades.status, ["won", "lost"]),
    lt(paperTrades.askPaid, UNDER_35_MAX_ASK),
    gte(paperTrades.windowStart, new Date(indexedStartMs)),
    sql`(${localTime})::date >= ${firstDay}::date`,
    ...(input.assets?.length
      ? [
          inArray(
            paperTrades.pair,
            input.assets.map((asset) => `${asset}-USD`),
          ),
        ]
      : []),
  ) as SQL;

  const rows = await db
    .select({
      id: paperTrades.id,
      botKey: paperTrades.botKey,
      conditionId: paperTrades.conditionId,
      slug: paperTrades.slug,
      pair: paperTrades.pair,
      horizonMin: paperTrades.horizonMin,
      windowStart: paperTrades.windowStart,
      decidedAt: paperTrades.decidedAt,
      gradedAt: paperTrades.gradedAt,
      side: paperTrades.side,
      pSignal: paperTrades.pSignal,
      askPaid: paperTrades.askPaid,
      edgeAsk: paperTrades.edgeAsk,
      sizeUsd: paperTrades.sizeUsd,
      signalAgeSec: paperTrades.signalAgeSec,
      status: paperTrades.status,
      pnlUsd: paperTrades.pnlUsd,
      localDay,
      totalRows: sql<number>`(count(*) over())::int`,
    })
    .from(paperTrades)
    .where(condition)
    .orderBy(desc(paperTrades.windowStart), desc(paperTrades.decidedAt), desc(paperTrades.id))
    .limit(TRADE_HISTORY_LIMIT);

  const botByKey = new Map(PAPER_BOTS.map((bot) => [bot.key, bot]));
  const total = num(rows[0]?.totalRows);
  const trades = rows.map((row) => {
    const bot = botByKey.get(row.botKey);
    const ask = num(row.askPaid);
    const sizeUsd = num(row.sizeUsd);
    return {
      id: row.id,
      cohortKey: `${row.botKey}:${row.horizonMin}`,
      botKey: row.botKey,
      botName: bot?.name ?? row.botKey,
      botColor: bot?.color ?? "#94a3b8",
      conditionId: row.conditionId,
      slug: row.slug,
      pair: row.pair,
      horizonMin: row.horizonMin,
      windowStartMs: row.windowStart.getTime(),
      decidedAtMs: row.decidedAt.getTime(),
      gradedAtMs: row.gradedAt?.getTime() ?? null,
      side: row.side,
      pSignal: row.pSignal,
      ask: ask,
      edgeAsk: row.edgeAsk,
      sizeUsd,
      contracts: ask > 0 ? sizeUsd / ask : null,
      signalAgeSec: row.signalAgeSec,
      status: row.status as "won" | "lost",
      rawNet: num(row.pnlUsd),
      localDay: row.localDay,
    };
  });

  return {
    version: "paper-under-35-trade-history-v1",
    paperOnly: true as const,
    executionCapability: false as const,
    scope: input.scope,
    timezone,
    threshold: {
      operator: "<" as const,
      maxAsk: UNDER_35_MAX_ASK,
      maxAskCents: UNDER_35_MAX_ASK * 100,
      priceSource: "recorded fee-adjusted $5 book-walk VWAP",
    },
    attributionClock: "window_start" as const,
    dayKeys,
    currentDay,
    scopeStartMs,
    toMs: nowMs,
    total,
    returned: trades.length,
    limit: TRADE_HISTORY_LIMIT,
    truncated: total > trades.length,
    trades,
    methodology: {
      rows: "Each row is one graded strategy decision below the recorded 35¢ ask cap. No strategy decision is deduplicated or converted into an assumed fill.",
      grouping:
        "Time groups are a browser-side view of the same rows. Market-window groups use the exact recorded window start; hour and calendar-day groups use America/Chicago display boundaries.",
      overlap:
        "Cluster stake and RAW are row sums. Unique market-side exposure counts reveal strategies sharing the same condition and side; those shared decisions are not independent capital uses.",
    },
  };
}

const under35HistoryCache = new Map<
  string,
  {
    expiresAtMs: number;
    value: Awaited<ReturnType<typeof loadPaperUnder35TradeHistory>>;
  }
>();
const under35HistoryLoading = new Map<
  string,
  Promise<Awaited<ReturnType<typeof loadPaperUnder35TradeHistory>>>
>();

/** Read-only, bounded trade ledger for the seven-calendar-day `<35¢` workbench. */
export async function paperUnder35TradeHistory(input: PaperUnder35TradeHistoryInput) {
  const timezone = validTimezone(input.timezone);
  const key = JSON.stringify({ ...input, timezone });
  const nowMs = Date.now();
  const cached = under35HistoryCache.get(key);
  if (cached && cached.expiresAtMs > nowMs) return cached.value;
  const active = under35HistoryLoading.get(key);
  if (active) return active;

  const loading = loadPaperUnder35TradeHistory({ ...input, timezone }, nowMs)
    .then((value) => {
      under35HistoryCache.set(key, {
        value,
        expiresAtMs: Date.now() + TRADE_HISTORY_CACHE_TTL_MS,
      });
      return value;
    })
    .finally(() => {
      under35HistoryLoading.delete(key);
    });
  under35HistoryLoading.set(key, loading);
  return loading;
}
