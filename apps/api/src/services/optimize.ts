/**
 * Optimization = validate Jester's optimized parameter combos in OUR full-window warehouse.
 *
 * Jester's optimizer publishes top parameter sets per strategy/pair/timeframe. We pull those
 * combos (read-only) and backtest each one in our warehouse (via the sweep/cell worker), so the
 * user sees which "optimized" parameter set actually holds up on a full window — the project's
 * whole thesis. We never trigger Jester's optimizer; we only read + validate.
 */

import { jesterCall } from "./jester.ts";

export interface Combo {
  parameters: Record<string, unknown>;
  label: string;
}

/** Fetch and normalize the top optimized parameter combos for one strategy/cell. */
export async function fetchOptimizedCombos(
  userId: string,
  strategyId: string,
  pair: string,
  timeframe: string,
  days: number,
  max = 8,
): Promise<Combo[]> {
  const qs = new URLSearchParams({
    pair,
    timeframe,
    days: String(days),
    perStrategy: String(max),
    limit: "300",
    filter: "all",
    minReturnPct: "-100",
    minTrades: "0",
  });
  const res = await jesterCall(
    userId,
    "GET",
    `/api/delegated/strategies/top-optimized-combos?${qs.toString()}`,
  );
  const combos: any[] = Array.isArray(res?.combos) ? res.combos : [];
  return combos
    .filter((c) => c?.strategyId === strategyId && c?.parameters && typeof c.parameters === "object")
    .slice(0, max)
    .map((c, i) => ({
      parameters: c.parameters as Record<string, unknown>,
      label: `#${c.rankWithinStrategy ?? i + 1}${c.paramsHash8 ? ` ${c.paramsHash8}` : ""}`,
    }));
}

// Parameter names most worth tuning, in priority order (substring match, case-insensitive).
// Entry/signal params first (they change which trades fire), exit/risk multipliers last.
const TUNABLE_PRIORITY = [
  "rmultiple", "threshold", "min", "max", "period", "length", "lookback",
  "adx", "rsi", "donchian", "stddev", "atrmultiplier", "multiplier", "stoploss", "takeprofit",
];

export interface NumericParam {
  name: string;
  value: number;
  /** Suggested grid values (~±40% around the default). */
  autoValues: number[];
}

/** Suggested grid values for a numeric default: {~0.6×, 1×, ~1.4×}, integers stay integers. */
export function autoValues(d: number): number[] {
  const isInt = Number.isInteger(d);
  const raw = [d * 0.6, d, d * 1.4].map((x) =>
    isInt ? Math.max(1, Math.round(x)) : Math.round(x * 100) / 100,
  );
  return [...new Set(raw)];
}

/** Introspect a strategy's numeric parameters (with defaults + suggested grids), priority-ordered. */
export async function getStrategyParams(
  userId: string,
  strategyId: string,
  pair: string,
  timeframe: string,
): Promise<{ defaults: Record<string, unknown>; numeric: NumericParam[] }> {
  const res = await jesterCall(userId, "POST", "/api/delegated/mcp/tool", {
    name: "jester_backtest_params",
    args: { strategyId, pair, timeframe },
  });
  const defaults = (res?.result?.defaultParameters ?? {}) as Record<string, unknown>;
  const score = (k: string) => {
    const lk = k.toLowerCase();
    const i = TUNABLE_PRIORITY.findIndex((p) => lk.includes(p));
    return i < 0 ? 99 : i;
  };
  const numeric: NumericParam[] = Object.entries(defaults)
    .filter(([, v]) => typeof v === "number" && Number.isFinite(v) && (v as number) > 0)
    .map(([name, v]) => ({ name, value: v as number, autoValues: autoValues(v as number) }))
    .sort((a, b) => score(a.name) - score(b.name));
  return { defaults, numeric };
}

/**
 * Pre-probe: does overriding this parameter actually change the strategy's backtest? Jester
 * honors parameter overrides for some strategies and silently ignores them for others; this
 * runs two backtests (default vs shifted) and reports whether they differ.
 */
export async function probeHasEffect(
  userId: string,
  strategyId: string,
  pair: string,
  timeframe: string,
  days: number,
  param: string,
  value: number,
): Promise<boolean> {
  const { runCell } = await import("./backtest.ts"); // avoid import cycle at module load
  const shifted = Number.isInteger(value)
    ? Math.max(1, Math.round(value * 1.5))
    : Math.round(value * 1.5 * 100) / 100;
  if (shifted === value) return true; // can't meaningfully shift — don't block
  // Use the async queue ("fast") — the probe is 2 backtests and the sync tool is rate-limited.
  const a = await runCell({ strategyId, pair, timeframe, days, parameters: { [param]: value } }, { userId, mode: "fast" });
  const b = await runCell({ strategyId, pair, timeframe, days, parameters: { [param]: shifted } }, { userId, mode: "fast" });
  return a.run.totalReturn !== b.run.totalReturn || a.run.totalTrades !== b.run.totalTrades;
}

/** Build combos from an explicit {param: values[]} grid (user-selected). */
export function buildCombosFromGrid(
  defaults: Record<string, unknown>,
  grid: Record<string, number[]>,
  maxCombos = 24,
): Combo[] {
  const keys = Object.keys(grid).filter((k) => Array.isArray(grid[k]) && grid[k].length > 0);
  let product: Record<string, number>[] = [{}];
  for (const k of keys) {
    const next: Record<string, number>[] = [];
    for (const partial of product) for (const v of grid[k]) next.push({ ...partial, [k]: v });
    product = next;
  }
  return product.slice(0, maxCombos).map((override) => ({
    parameters: { ...defaults, ...override },
    label: Object.entries(override).map(([k, v]) => `${k}=${v}`).join(" "),
  }));
}

/**
 * FORCE an optimization when Jester has no published combos: auto grid-search the strategy's
 * top ~2 tunable numeric params (~±40%). Returns [] if nothing tunable.
 */
export async function buildGridCombos(
  userId: string,
  strategyId: string,
  pair: string,
  timeframe: string,
  maxCombos = 12,
): Promise<Combo[]> {
  const { defaults, numeric } = await getStrategyParams(userId, strategyId, pair, timeframe);
  const picks = numeric.slice(0, 2);
  if (picks.length === 0) return [];
  const grid: Record<string, number[]> = {};
  for (const p of picks) grid[p.name] = p.autoValues;
  return buildCombosFromGrid(defaults, grid, maxCombos);
}
