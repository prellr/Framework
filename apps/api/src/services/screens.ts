import { eq } from "drizzle-orm";
import { db, backtestRuns, screens, strategies } from "@framework/db";

/**
 * A screen query: threshold filters over the warehouse. All fields optional — an empty
 * query matches every warehouse row. Numeric thresholds are inclusive floors/ceilings.
 */
export interface ScreenQuery {
  minPf?: number;
  minTrades?: number;
  minReturn?: number; // percent, e.g. 5 = +5%
  maxDrawdown?: number; // percent magnitude, e.g. 20 = allow drawdowns no worse than -20%
  pairs?: string[];
  timeframes?: string[];
  days?: number[]; // daysRequested values to include
}

type Row = typeof backtestRuns.$inferSelect;

const num = (v: string | null): number | null => (v == null ? null : parseFloat(v));

/** Identity of a survivor — a strategy on a given pair+timeframe. Diffs key off this. */
export const survivorKey = (r: { strategyId: string; pair: string; timeframe: string }) =>
  `${r.strategyId}|${r.pair}|${r.timeframe}`;

// Jester's "zero losing trades" sentinel — an infinite profit factor, effectively always a
// 1-trade fluke. Never a valid screen survivor.
const PF_INFINITE = 999;

function passes(r: Row, q: ScreenQuery): boolean {
  const pfAll = num(r.profitFactor);
  if (pfAll != null && pfAll >= PF_INFINITE) return false; // drop infinite-PF sentinel rows
  if (q.pairs?.length && !q.pairs.includes(r.pair)) return false;
  if (q.timeframes?.length && !q.timeframes.includes(r.timeframe)) return false;
  if (q.days?.length && !q.days.includes(r.daysRequested)) return false;
  if (q.minTrades != null && (r.totalTrades ?? 0) < q.minTrades) return false;
  if (q.minPf != null) {
    const pf = num(r.profitFactor);
    if (pf == null || pf < q.minPf) return false;
  }
  if (q.minReturn != null) {
    const ret = num(r.totalReturn);
    if (ret == null || ret < q.minReturn) return false;
  }
  if (q.maxDrawdown != null) {
    const dd = num(r.maxDrawdown); // stored as a negative percent (e.g. -18.4)
    if (dd == null || dd < -Math.abs(q.maxDrawdown)) return false;
  }
  return true;
}

export interface Survivor {
  key: string;
  strategyId: string;
  strategyName: string | null;
  pair: string;
  timeframe: string;
  daysRequested: number;
  spanDays: number;
  profitFactor: number | null;
  totalReturn: number | null;
  totalTrades: number | null;
  winRate: number | null;
  maxDrawdown: number | null;
  sharpe: number | null;
  jesterParamCode: string | null;
  ranAt: Date;
}

/**
 * Evaluate a screen against the whole warehouse. Returns the surviving rows deduped to the
 * best profit-factor row per (strategy, pair, timeframe), sorted best-first. The warehouse is
 * small enough (hundreds–low thousands of rows) that a full scan + JS filter is simplest and
 * keeps the threshold logic in one readable place.
 */
export async function evaluateScreen(query: ScreenQuery): Promise<Survivor[]> {
  const rows = await db.select().from(backtestRuns);
  const names = new Map(
    (await db.select({ id: strategies.id, name: strategies.name }).from(strategies)).map((s) => [
      s.id,
      s.name,
    ]),
  );

  const best = new Map<string, Row>();
  for (const r of rows) {
    if (!passes(r, query)) continue;
    const k = survivorKey(r);
    const prev = best.get(k);
    if (!prev || (num(r.profitFactor) ?? -Infinity) > (num(prev.profitFactor) ?? -Infinity)) {
      best.set(k, r);
    }
  }

  return [...best.values()]
    .map(
      (r): Survivor => ({
        key: survivorKey(r),
        strategyId: r.strategyId,
        strategyName: names.get(r.strategyId) ?? null,
        pair: r.pair,
        timeframe: r.timeframe,
        daysRequested: r.daysRequested,
        spanDays: r.spanDays,
        profitFactor: num(r.profitFactor),
        totalReturn: num(r.totalReturn),
        totalTrades: r.totalTrades,
        winRate: num(r.winRate),
        maxDrawdown: num(r.maxDrawdown),
        sharpe: num(r.sharpe),
        jesterParamCode: r.jesterParamCode,
        ranAt: r.ranAt,
      }),
    )
    .sort((a, b) => (b.profitFactor ?? -Infinity) - (a.profitFactor ?? -Infinity));
}

export interface ScreenRunResult {
  survivors: Survivor[];
  added: string[]; // survivor keys new since the previous run
  removed: string[]; // survivor keys dropped since the previous run
  firstRun: boolean; // no prior baseline existed — added/removed are empty
}

/**
 * Run a saved screen: evaluate it, diff against the stored baseline (the "alert"), then
 * persist the new survivor set + diff + timestamp. Shared by the manual "Run" action and the
 * scheduled rescreen job so both compute alerts identically.
 */
export async function runScreen(screenId: string): Promise<ScreenRunResult> {
  const [screen] = await db.select().from(screens).where(eq(screens.id, screenId)).limit(1);
  if (!screen) throw new Error(`Screen ${screenId} not found`);

  const survivors = await evaluateScreen(screen.query as ScreenQuery);
  const keys = survivors.map((s) => s.key);
  const prev = (screen.lastSurvivors as string[] | null) ?? null;

  const firstRun = prev === null;
  const added = firstRun ? [] : keys.filter((k) => !prev!.includes(k));
  const removed = firstRun ? [] : prev!.filter((k) => !keys.includes(k));

  await db
    .update(screens)
    .set({ lastSurvivors: keys, lastAdded: added, lastRemoved: removed, lastRunAt: new Date() })
    .where(eq(screens.id, screenId));

  return { survivors, added, removed, firstRun };
}
