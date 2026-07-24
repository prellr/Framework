/**
 * Deploy path for OUR OWN parameter sets (Roadmap Phase 3.1, unblocked by API finding #3).
 *
 * Jester now registers a caller-supplied parameter set in a "deployable_registry" when it mints a
 * hash for it (previously the hash was issued but never resolvable, so externally-optimized params
 * were undeployable). That splits cleanly into two steps with very different risk:
 *
 *   registerParamSet  — ANALYSIS. Runs one backtest with the params (which mints Jester's hash),
 *                       then resolves the hash to confirm it landed in the deployable registry.
 *                       No live effect; safe to run and test freely.
 *
 *   deployParamHash   — LIVE TRADE. Applies a registered hash to a live subscription via
 *                       apply_params_by_hash. Gated to a real manager session (jesterTradeCall)
 *                       and a human confirm — never reachable from the agent/API/background.
 */
import { jesterCall, jesterTradeCall } from "./jester.ts";
import { runCell } from "./backtest.ts";
import { liveStrategies } from "./trading.ts";

export interface RegisterResult {
  jesterHash: string | null; // Jester's own param code for this set (the deployable handle)
  registered: boolean; // resolves in Jester's deployable registry?
  resolvedParams: Record<string, unknown> | null; // what the registry returns for the hash
  metrics: { totalReturn: number | null; totalTrades: number | null; profitFactor: number | null };
  note?: string;
}

const num = (v: string | null) => (v == null ? null : parseFloat(v));

/**
 * Register a parameter set for deployment: run a code-mode backtest so Jester mints its param code
 * inline, then resolve that code to confirm it's in the deployable registry. Analysis-only.
 */
export async function registerParamSet(
  userId: string,
  spec: { strategyId: string; pair: string; timeframe: string; days?: number; parameters: Record<string, unknown> },
): Promise<RegisterResult> {
  // "code" mode returns Jester's own paramHash inline (the async path doesn't), and running the
  // backtest is what registers the set. Rate-limited, but this is a single deliberate action.
  const { run } = await runCell(
    { strategyId: spec.strategyId, pair: spec.pair, timeframe: spec.timeframe, days: spec.days ?? 30, parameters: spec.parameters },
    { userId, mode: "code" },
  );
  const metrics = { totalReturn: num(run.totalReturn), totalTrades: run.totalTrades, profitFactor: num(run.profitFactor) };
  const hash = run.jesterParamCode;
  if (!hash) return { jesterHash: null, registered: false, resolvedParams: null, metrics, note: "Backtest returned no param code — cannot register." };

  const resolved = await jesterCall(userId, "POST", "/api/delegated/mcp/tool", {
    name: "jester_param_hash_resolve",
    args: { paramHash: hash, strategyId: spec.strategyId },
  }).catch((e) => ({ result: { error: e instanceof Error ? e.message : String(e) } }) as any);

  const params = (resolved?.result?.parameters ?? null) as Record<string, unknown> | null;
  const err = resolved?.result?.error;
  const registered = params != null && !err;
  return {
    jesterHash: hash,
    registered,
    resolvedParams: params,
    metrics,
    note: registered ? undefined : (err ?? "Hash did not resolve in the deployable registry."),
  };
}

/**
 * Take a chosen parameter set LIVE — WITHOUT requiring Jester's optimizer.
 *
 * This is the F3 payoff: the old activation path (subscribe_cached_best) can only deploy Jester's
 * rank-0 ranked combo, which forces an optimize run just to have something to deploy. Here we instead
 * (1) bare-subscribe the strategy on the pair if it isn't already live — bare subscribe needs NO
 * ranked combos — then (2) apply our registered param hash, then (3) pin the allocation to the risk.
 *
 * Partial-failure aware, like activate(): each step's result/error is returned and a failed apply is
 * flagged loudly (the strategy may be live at DEFAULT params) rather than silently leaving wrong
 * state. LIVE TRADE — manager+ real session, confirm:true. The confirmToken handshake is internal.
 *
 * NOTE: the subscribe→apply sequencing is the one part not verifiable without a live call (Jester's
 * post-F3 bare-subscribe behavior). Warnings surface exactly what each step returned.
 */
export interface DeployResult {
  subscribed: any | null; // null if it was already live
  apply: any | null;
  allocation: any | null;
  warnings: string[];
}

export async function deployParamSet(
  userId: string,
  args: { strategyId: string; pair: string; timeframe: string; paramHash?: string; riskPercent?: number },
): Promise<DeployResult> {
  const warnings: string[] = [];
  const call = (tool: string, action: string, extra: Record<string, unknown>) =>
    jesterTradeCall(userId, tool, action, extra)
      .then((r) => r?.result ?? r)
      .catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));

  // 1. Subscribe only if not already live on this pair (bare subscribe — no ranked combos needed).
  const live = await liveStrategies(userId).catch(() => null);
  const already = ((live?.strategies ?? []) as any[]).some(
    (s) => s.id === args.strategyId && (s.pairs ?? []).some((p: any) => p.pair === args.pair),
  );
  let subscribed: any = null;
  if (!already) {
    subscribed = await call("jester_automation_actions", "subscribe", {
      strategyId: args.strategyId,
      pair: args.pair,
      timeframe: args.timeframe,
    });
    // Subscribe failing means NOTHING went live — a clean failure, not a partial. Throw so the
    // client's error path (rate-limit cooldown + retry) handles it, rather than a misleading
    // "Live — with warnings" on a deploy that never happened.
    if (subscribed?.error) {
      throw new Error(`Subscribe failed — nothing was deployed: ${subscribed.error}`);
    }
  }

  // 2. Apply a specific param set — ONLY if one was given. Omit paramHash to run at DEFAULT params
  //    (the "just activate this strategy, no optimize" path).
  let apply: any = null;
  if (args.paramHash) {
    apply = await call("jester_automation_actions", "apply_params_by_hash", {
      strategyId: args.strategyId,
      pair: args.pair,
      timeframe: args.timeframe,
      paramHash: args.paramHash,
    });
    if (apply?.error) warnings.push(`Applying your params failed — the strategy may be live at DEFAULT params: ${apply.error}`);
  }

  // NOTE: we deliberately do NOT call allocation_set here. That tool controls EXCHANGE capital
  // allocation (broadcast mode, hyperliquid=100%), NOT per-trade risk — sending a risk % to it is
  // wrong and errors "Exchange not found". Per-trade risk is the strategy's own maxLossPerTrade /
  // riskSettings.riskPerTrade (Jester default 2%). A correct custom-risk control is a separate,
  // to-be-wired setting; the strategy goes live at its configured risk-per-trade.
  return { subscribed, apply, allocation: null, warnings };
}
