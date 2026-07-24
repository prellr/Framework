import { jesterCall } from "./jester.ts";

/**
 * Jester Observatory optimizer — the ONLY path that produces ranked parameter combos, which are in
 * turn the only thing `subscribe_cached_best` can activate. Parameter sets optimized in this app
 * can't be injected (Jester won't resolve a hash it didn't generate), so for a strategy Jester has
 * never optimized, running this is the prerequisite to activating it at all.
 *
 * Compute-only: it starts an optimizer job and reads results. It places no trades and moves no funds.
 */

export interface ObservatoryCombo {
  rank: number;
  paramsHash: string;
  totalReturn: number | null;
  maxDrawdown: number | null;
  winRate: number | null;
  totalTrades: number | null;
  score: number | null;
  /** Under ~20 trades the metrics aren't statistically meaningful — flagged, not hidden. */
  thin: boolean;
}

const MIN_CREDIBLE_TRADES = 20;

const hub = (userId: string, args: Record<string, unknown>) =>
  jesterCall(userId, "POST", "/api/delegated/mcp/tool", { name: "jester_observatory_hub", args });

/** Kick off an optimizer run. Returns the optRunId used to poll for progress. */
export async function startOptimize(
  userId: string,
  args: { strategyId: string; pair: string; timeframe: string; days: number },
): Promise<{ optRunId: string | null; message: string | null }> {
  const res = await hub(userId, { mode: "optimize_start", ...args });
  const r = res?.result ?? res;
  return { optRunId: r?.optRunId ?? null, message: r?.message ?? null };
}

/**
 * Poll a run. Jester briefly reports "opt run not found" both before the run registers and after it
 * finishes, so a not-found is reported as `unknown` rather than an error — the combo list is the
 * real completion signal.
 */
export async function optimizeStatus(
  userId: string,
  args: { optRunId: string; strategyId: string },
): Promise<{ state: "running" | "unknown"; combosStored: number | null }> {
  try {
    const res = await hub(userId, { mode: "optimize_status", ...args });
    const r = res?.result ?? res;
    if (r?.error) return { state: "unknown", combosStored: null };
    return { state: "running", combosStored: r?.run?.combosStored ?? null };
  } catch {
    return { state: "unknown", combosStored: null };
  }
}

/**
 * The ranked combos Jester has cached for a cell — what activation will actually deploy.
 * Sorted best-first as Jester ranks them; `thin` marks combos whose trade count is too small for the
 * metrics to mean anything (Jester's own scoring does not appear to penalise tiny samples, so its
 * rank-0 is frequently a 2-trade, 100%-win artifact).
 */
export async function listCombos(
  userId: string,
  args: { strategyId: string; pair: string; timeframe: string },
): Promise<{ combos: ObservatoryCombo[]; runId: string | null }> {
  const res = await jesterCall(userId, "POST", "/api/delegated/mcp/tool", {
    name: "jester_param_compare_read",
    args,
  }).catch(() => null);
  const r = res?.result ?? null;
  const raw = (r?.combos ?? []) as any[];
  const combos: ObservatoryCombo[] = raw.map((c, i) => ({
    rank: i,
    paramsHash: String(c.paramsHash ?? ""),
    totalReturn: typeof c.totalReturn === "number" ? c.totalReturn : null,
    maxDrawdown: typeof c.maxDrawdown === "number" ? c.maxDrawdown : null,
    winRate: typeof c.winRate === "number" ? c.winRate : null,
    totalTrades: typeof c.totalTrades === "number" ? c.totalTrades : null,
    score: typeof c.score === "number" ? c.score : null,
    thin: (c.totalTrades ?? 0) < MIN_CREDIBLE_TRADES,
  }));
  return { combos, runId: r?.runId ?? null };
}
