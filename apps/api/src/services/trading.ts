/**
 * Trading service (Phase 2 — strategy activation). Every function here performs or previews a LIVE
 * action on the funded Jester account and MUST only be reached via the human-gated `trading` router
 * (tradeProcedure: manager+ real session). Mutations go through `jesterTradeCall` (the narrow trade
 * channel); previews use the analysis-tier dry-run.
 *
 * Safety: a hard risk cap (percent of portfolio) is enforced app-side before any allocation is set,
 * and a kill-switch (emergency lockout + flatten) is always available.
 */

import { jesterCall, jesterTradeCall } from "./jester.ts";
import { getSetting } from "./config.ts";
import { getLiveCache, setLiveCache } from "./live-cache.ts";

const DEFAULT_RISK_PCT = 0.5; // starting risk per strategy, % of portfolio
const DEFAULT_MAX_RISK_PCT = 2; // hard ceiling — requests above this are rejected

export async function getRiskCaps(): Promise<{ defaultPct: number; maxPct: number }> {
  const d = parseFloat((await getSetting("TRADE_RISK_PERCENT")) ?? "");
  const m = parseFloat((await getSetting("TRADE_MAX_RISK_PERCENT")) ?? "");
  return {
    defaultPct: Number.isFinite(d) && d > 0 ? d : DEFAULT_RISK_PCT,
    maxPct: Number.isFinite(m) && m > 0 ? m : DEFAULT_MAX_RISK_PCT,
  };
}

/**
 * Preview a subscription without executing (safe). Shows target, param code, readiness, blockers.
 * A dry-run that can't proceed (e.g. no ranked combo for the strategy) returns success:false — we
 * catch that and return a structured "not ready" result with the reason, so the UI can show it as a
 * preview state rather than a hard error.
 */
export async function previewActivate(
  userId: string,
  args: { strategyId?: string; pair?: string; timeframe?: string },
): Promise<any> {
  try {
    const res = await jesterCall(userId, "POST", "/api/delegated/mcp/tool", {
      name: "jester_subscribe_dry_run",
      args,
    });
    return res?.result ?? null;
  } catch (e) {
    return { ok: false, ready: false, target: null, blockers: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** Current live automations (read via the trade channel — jester_automation_actions.center). */
export async function automationCenter(userId: string): Promise<any> {
  const res = await jesterTradeCall(userId, "jester_automation_actions", "center");
  return res?.result ?? null;
}

/**
 * Rich per-strategy live view (read-only, analysis tier): each subscribed strategy with its pairs,
 * the ACTIVE param code per pair (`paramHash8` — the combo actually trading), and live executed PnL.
 * This is the authoritative answer to "what am I running and how is it doing" — unlike a warehouse
 * default-param backtest, these numbers reflect the exact combo Jester deployed.
 */
export async function liveStrategies(userId: string): Promise<any> {
  // Cached briefly — read constantly, and jester_my_strategies is unreliable: it intermittently
  // hangs AND intermittently returns 0 strategies for an account that has several. So we can't take
  // a single response at face value.
  const { fresh, stale } = getLiveCache(userId);
  if (fresh) return fresh;
  const staleHasStrategies = Array.isArray(stale?.strategies) && stale.strategies.length > 0;

  // Retry through the flakiness with a SHORT per-attempt timeout (fail fast on a hang, try again),
  // and prefer a non-empty response — a lone "0 strategies" is almost always a glitch.
  let result: any = null;
  let sawNonEmpty = false;
  for (let attempt = 0; attempt < 3 && !sawNonEmpty; attempt++) {
    try {
      const res = await jesterCall(userId, "POST", "/api/delegated/mcp/tool", { name: "jester_my_strategies", args: {} }, 8_000);
      result = res?.result ?? result;
      if (Array.isArray(res?.result?.strategies) && res.result.strategies.length > 0) sawNonEmpty = true;
    } catch {
      /* timeout/error — retry */
    }
  }

  // Couldn't get ANY response, or only got empty reads while we KNOW there were strategies → the
  // last-good snapshot beats showing a wrong/empty list.
  if ((result == null || (!sawNonEmpty && staleHasStrategies)) && stale) return stale;
  if (result == null) return null;

  // Portfolio value for portfolio-% math (Jester's per-strategy totalPnLPct is leveraged-on-margin).
  const pnl = await jesterCall(userId, "GET", "/api/delegated/pnl/summary").catch(() => null);
  if (result && typeof result === "object") result.portfolioValue = pnl?.totalPortfolioValue ?? null;
  setLiveCache(userId, result);
  return result;
}

/** Current allocation config (read). */
export async function allocationGet(userId: string): Promise<any> {
  const res = await jesterTradeCall(userId, "jester_preferences_actions", "allocation_get");
  return res?.result ?? null;
}

/**
 * Activate (subscribe) a strategy with a specific param code, capped to the risk percent. LIVE.
 * Enforces the risk ceiling BEFORE subscribing, then pins the strategy's allocation to that percent.
 */
export async function activate(
  userId: string,
  args: { strategyId: string; pair: string; timeframe?: string; paramHash?: string; riskPercent: number },
): Promise<any> {
  const { maxPct } = await getRiskCaps();
  if (!(args.riskPercent > 0) || args.riskPercent > maxPct) {
    throw new Error(`Risk percent must be between 0 and the ${maxPct}% cap.`);
  }
  // Subscribe to the strategy's best cached/ranked combo. Jester's own guidance is explicit:
  // use `subscribe_cached_best` (NOT bare `subscribe`) — and `jester_subscribe_dry_run` (our preview)
  // is defined as "preview subscribe_cached_best", so this is the action the preview actually resolves.
  // subscribe_cached_best auto-resolves rank-0 (the paramHash the preview displays) for the pair/timeframe.
  let sub: any;
  let applyWarning: string | null = null;
  try {
    sub = await jesterTradeCall(userId, "jester_automation_actions", "subscribe_cached_best", {
      strategyId: args.strategyId,
      pair: args.pair,
      ...(args.timeframe ? { timeframe: args.timeframe } : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // IMPORTANT: Jester subscribes the strategy even when it can't confirm the combo applied
    // ("Live parameter verification failed after apply") — it falls back to DEFAULT params and the
    // subscription persists and is LIVE. So we must NOT abort here (that would leave a live strategy
    // with unpinned risk). Record the warning, then still pin the allocation below.
    if (/verification failed|after apply|could not verify|not verified/i.test(msg)) {
      applyWarning = `Live combo could not be verified — the strategy subscribed at DEFAULT params, not the selected combo. (${msg})`;
      sub = { partial: true, error: msg };
    } else {
      throw e; // genuine failure (no combo, rate limit, blocked, etc.) — nothing went live
    }
  }
  // Pin allocation to the (tiny) risk cap so exposure stays bounded — runs on clean AND partial subscribe.
  const alloc = await jesterTradeCall(userId, "jester_preferences_actions", "allocation_set", {
    allocation: args.riskPercent,
  }).catch((e) => ({ allocationError: e instanceof Error ? e.message : String(e) }));
  return { subscribe: sub?.result ?? sub, allocation: alloc, applyWarning };
}

export async function pauseAll(userId: string): Promise<any> {
  return (await jesterTradeCall(userId, "jester_automation_actions", "pause_all"))?.result ?? null;
}
export async function resumeAll(userId: string): Promise<any> {
  return (await jesterTradeCall(userId, "jester_automation_actions", "resume_all"))?.result ?? null;
}
export async function toggleStrategy(userId: string, strategyId: string): Promise<any> {
  return (await jesterTradeCall(userId, "jester_automation_actions", "toggle_strategy", { strategyId }))?.result ?? null;
}

/** Current per-strategy risk config (read-only) — the fields the risk control reads/shows. */
export async function getRiskSettings(userId: string, strategyId: string): Promise<any> {
  const r = await jesterCall(userId, "POST", "/api/delegated/mcp/tool", { name: "jester_strategy_settings", args: { strategyId } });
  const res = r?.result ?? r;
  const rs = (res?.riskSettings ?? {}) as Record<string, unknown>;
  return {
    riskPerTrade: typeof rs.riskPerTrade === "number" ? rs.riskPerTrade : null,
    stopLoss: rs.stopLoss ?? null,
    takeProfit: rs.takeProfit ?? null,
    maxDrawdown: rs.maxDrawdown ?? null,
    maxLossPerTrade: res?.maxLossPerTrade ?? null,
    hasCustomRiskOverlay: !!res?.hasCustomRiskOverlay,
  };
}

/**
 * Set the strategy's per-trade risk (% of account risked per trade). READ-MODIFY-WRITE: we re-read
 * the live riskSettings block and change ONLY riskPerTrade (+ mirror maxLossPerTrade), then send the
 * complete block via update_config so no other risk field (stopLoss/TP/maxDrawdown/ATR) is reset.
 * Human-gated (tradeProcedure) — never reachable from the agent/MCP surface.
 */
export async function setRiskPerTrade(userId: string, strategyId: string, riskPerTrade: number): Promise<any> {
  const r = await jesterCall(userId, "POST", "/api/delegated/mcp/tool", { name: "jester_strategy_settings", args: { strategyId } });
  const res = r?.result ?? r;
  const current = (res?.riskSettings ?? {}) as Record<string, unknown>;
  const merged = { ...current, riskPerTrade };
  return (
    await jesterTradeCall(userId, "jester_automation_actions", "update_config", {
      strategyId,
      riskSettings: merged,
      maxLossPerTrade: { mode: "percent", value: riskPerTrade },
    })
  )?.result ?? null;
}
export async function removeStrategy(userId: string, strategyId: string): Promise<any> {
  return (await jesterTradeCall(userId, "jester_automation_actions", "remove_strategy", { strategyId }))?.result ?? null;
}

export async function setAllocation(userId: string, percent: number): Promise<any> {
  const { maxPct } = await getRiskCaps();
  if (!(percent > 0) || percent > maxPct) throw new Error(`Allocation must be between 0 and the ${maxPct}% cap.`);
  return (await jesterTradeCall(userId, "jester_preferences_actions", "allocation_set", { allocation: percent }))?.result ?? null;
}

/** Kill switch: halt all automations AND flatten every position. The big red button. */
export async function killSwitch(userId: string): Promise<any> {
  const lockout = await jesterTradeCall(userId, "jester_preferences_actions", "emergency_lockout").catch((e) => ({ error: String(e) }));
  const flatten = await jesterTradeCall(userId, "jester_portfolio_actions", "close_all").catch((e) => ({ error: String(e) }));
  return { lockout: lockout?.result ?? lockout, flatten: flatten?.result ?? flatten };
}

export async function emergencyRelease(userId: string): Promise<any> {
  return (await jesterTradeCall(userId, "jester_preferences_actions", "emergency_release"))?.result ?? null;
}
