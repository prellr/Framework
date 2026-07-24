/**
 * Autonomous backtest coverage engine (Roadmap Phase 1.2).
 *
 * Instead of a human hand-building sweeps, this keeps a TARGET MATRIX of cells backtested and fresh.
 * The conservative default matrix: every strategy on (the pairs it's already been tested on ∪ a
 * handful of majors) × {15m, 1h} × 30d. A background job fills the stalest missing cells a few at a
 * time via the async queue (cache hits cost nothing), so coverage converges then idles.
 *
 * DISABLED BY DEFAULT. Arming it (coverage.enabled = "true", set by a manager) is what starts the
 * standing Jester spend — until then every tick is a no-op. That's deliberate: a continuously
 * refreshing sweep of ~191 strategies is real API load, so a human turns it on knowingly.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { db, strategies, backtestRuns } from "@framework/db";
import { runCell } from "./backtest.ts";
import { getSetting, setSetting } from "./config.ts";

// Conservative target matrix knobs.
const MAJORS = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD"];
const TIMEFRAMES = ["15m", "1h"];
const WINDOW_DAYS = 30;
const COVERAGE_FRESH_DAYS = 7; // a cell counts as covered if backtested within this many days
const PER_TICK = 5; // stale cells filled per scan — the throttle on standing spend

const ENABLED_KEY = "coverage.enabled";
const LAST_SCAN_KEY = "coverage.lastScanAt";
export const COVERAGE_MAX_LOAD_PER_CPU = 0.5;
const NON_RUNNABLE_CATEGORIES = new Set(["VIRTUAL_ANYTHING", "TRIAD_ROTATION"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface CoverageCell {
  strategyId: string;
  pair: string;
  timeframe: string;
  days: number;
}
const cellKey = (c: { strategyId: string; pair: string; timeframe: string }) =>
  `${c.strategyId}|${c.pair}|${c.timeframe}`;

/** Lower-priority coverage work yields before the live paper/tape collectors need to. */
export function coverageLoadPerCpu(load1: number, parallelism: number): number {
  if (!Number.isFinite(load1) || load1 < 0 || !Number.isFinite(parallelism) || parallelism < 1) {
    return Number.POSITIVE_INFINITY;
  }
  return load1 / Math.max(1, Math.floor(parallelism));
}

/**
 * Jester exposes virtual routing programs in its catalog, but its backtest factory intentionally
 * returns null for them. They remain visible in the catalog while being excluded from the runnable
 * coverage matrix, preventing the scheduler from retrying deterministic failures forever.
 */
export function coverageStrategyRunnable(strategy: {
  category: string | null;
  description: string | null;
  features: unknown;
}): boolean {
  if (strategy.category && NON_RUNNABLE_CATEGORIES.has(strategy.category.toUpperCase())) {
    return false;
  }
  const features = Array.isArray(strategy.features)
    ? strategy.features.filter((item): item is string => typeof item === "string")
    : [];
  if (features.some((feature) => /\bvirtual\b/i.test(feature))) return false;
  const description = strategy.description ?? "";
  return !/\bvirtual program\b|no direct instance/i.test(description);
}

export async function coverageEnabled(): Promise<boolean> {
  return (await getSetting(ENABLED_KEY)) === "true";
}
export async function setCoverageEnabled(on: boolean): Promise<void> {
  await setSetting(ENABLED_KEY, on ? "true" : "false");
}

/** The conservative target matrix: strategy × (tested pairs ∪ majors) × {15m,1h} × 30d. */
export async function coverageTargets(): Promise<CoverageCell[]> {
  const [strats, tested] = await Promise.all([
    db
      .select({
        id: strategies.id,
        category: strategies.category,
        description: strategies.description,
        features: strategies.features,
      })
      .from(strategies),
    db
      .select({ strategyId: backtestRuns.strategyId, pair: backtestRuns.pair })
      .from(backtestRuns)
      .where(eq(backtestRuns.paramHash, "default"))
      .groupBy(backtestRuns.strategyId, backtestRuns.pair),
  ]);
  const testedByStrat = new Map<string, Set<string>>();
  for (const r of tested) {
    const s = testedByStrat.get(r.strategyId) ?? new Set<string>();
    s.add(r.pair);
    testedByStrat.set(r.strategyId, s);
  }
  const cells: CoverageCell[] = [];
  for (const strategy of strats) {
    if (!coverageStrategyRunnable(strategy)) continue;
    const { id } = strategy;
    const pairs = new Set<string>(MAJORS);
    for (const p of testedByStrat.get(id) ?? []) pairs.add(p);
    for (const pair of pairs) for (const tf of TIMEFRAMES) cells.push({ strategyId: id, pair, timeframe: tf, days: WINDOW_DAYS });
  }
  return cells;
}

/** (strategy|pair|tf) keys with a default-param run inside the freshness window. */
async function freshKeys(): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - COVERAGE_FRESH_DAYS * 86_400_000).toISOString().slice(0, 10);
  const rows = await db
    .select({ strategyId: backtestRuns.strategyId, pair: backtestRuns.pair, timeframe: backtestRuns.timeframe })
    .from(backtestRuns)
    .where(and(eq(backtestRuns.paramHash, "default"), gte(backtestRuns.asOfBucket, cutoff)))
    .groupBy(backtestRuns.strategyId, backtestRuns.pair, backtestRuns.timeframe);
  return new Set(rows.map(cellKey));
}

export interface CoverageStatus {
  enabled: boolean;
  target: number;
  covered: number;
  stale: number;
  pct: number;
  lastScanAt: string | null;
}

export async function coverageStatus(): Promise<CoverageStatus> {
  const [targets, fresh, enabled, lastScanAt] = await Promise.all([
    coverageTargets(),
    freshKeys(),
    coverageEnabled(),
    getSetting(LAST_SCAN_KEY),
  ]);
  let covered = 0;
  for (const c of targets) if (fresh.has(cellKey(c))) covered++;
  const target = targets.length;
  return {
    enabled,
    target,
    covered,
    stale: target - covered,
    pct: target ? Math.round((covered / target) * 1000) / 10 : 0,
    lastScanAt: lastScanAt ?? null,
  };
}

/**
 * One scan tick: fill up to PER_TICK stale target cells via the async queue. No-op when disabled.
 * Cells are picked from the stale set in shuffled order so a few persistently-failing cells (e.g. a
 * pair with no candle data) can't wedge the head of the queue forever.
 */
export async function scanCoverage(userId: string): Promise<{ ran: number; stale: number; target: number }> {
  if (!(await coverageEnabled())) return { ran: 0, stale: 0, target: 0 };
  const [targets, fresh] = await Promise.all([coverageTargets(), freshKeys()]);
  const stale = targets.filter((c) => !fresh.has(cellKey(c)));
  const batch = [...stale].sort(() => Math.random() - 0.5).slice(0, PER_TICK);

  let ran = 0;
  for (let i = 0; i < batch.length; i++) {
    try {
      await runCell(batch[i], { userId, mode: "fast" });
      ran++;
    } catch (err) {
      console.error(`[coverage] ${cellKey(batch[i])} failed:`, err instanceof Error ? err.message : err);
    }
    if (i < batch.length - 1) await sleep(2000);
  }
  await setSetting(LAST_SCAN_KEY, new Date().toISOString());
  return { ran, stale: stale.length, target: targets.length };
}
