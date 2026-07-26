import { and, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import { db, paperTrades } from "@framework/db";
import { PAPER_BOTS, paperBotBucketUniverse } from "./paper-floor.ts";
import { paperPerformanceStartMs, type PaperPerformanceScope } from "./paper-performance.ts";

export type PaperUnder35Horizon = "all" | 5 | 15;

export interface PaperUnder35PortfolioInput {
  scope: PaperPerformanceScope;
  horizon: PaperUnder35Horizon;
  timezone: string;
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
  const localTime = sql`timezone(${timezone}, ${paperTrades.windowStart} at time zone 'UTC')`;
  const localDay = sql<string>`to_char(${localTime}, 'YYYY-MM-DD')`;
  const condition = and(
    inArray(paperTrades.status, ["won", "lost"]),
    lt(paperTrades.askPaid, UNDER_35_MAX_ASK),
    sql`(${localTime})::date >= ${firstDay}::date`,
    ...(scopeStartMs == null ? [] : [gte(paperTrades.windowStart, new Date(scopeStartMs))]),
    ...(input.horizon === "all" ? [] : [eq(paperTrades.horizonMin, input.horizon)]),
  ) as SQL;

  const rows = await db
    .select({
      bot_key: paperTrades.botKey,
      horizon_min: paperTrades.horizonMin,
      local_day: localDay,
      n: sql<number>`count(*)::int`,
      wins: sql<number>`count(*) filter (where ${paperTrades.status} = 'won')::int`,
      pnl: sql<number>`coalesce(sum(${paperTrades.pnlUsd}), 0)::double precision`,
    })
    .from(paperTrades)
    .where(condition)
    .groupBy(paperTrades.botKey, paperTrades.horizonMin, localDay);

  const rowByKey = new Map(
    (rows as DailyRow[]).map((row) => [`${row.bot_key}:${row.horizon_min}:${row.local_day}`, row]),
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
