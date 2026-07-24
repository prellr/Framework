/**
 * Jester call allowlist — the structural safety boundary of this system.
 *
 * This system is ANALYSIS-ONLY. It must never place an order, move funds, deploy
 * a strategy live, or invoke any mutating Jester action. That guarantee is enforced
 * here, in the one place every Jester call is checked (see services/jester.ts).
 *
 * Design: FAIL-CLOSED. Only the explicitly listed REST paths and MCP tools are
 * permitted; everything else is rejected — including Jester tools we've never seen.
 * A new mutating tool added by Jester is denied by default until a human adds it.
 *
 * This module is intentionally pure (no db, no network) so it is trivially unit-testable.
 */

export class JesterForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JesterForbiddenError";
  }
}

/** REST GET paths this system may read. */
const ALLOWED_GET: RegExp[] = [
  /^\/api\/delegated\/whoami(\?.*)?$/,
  /^\/api\/delegated\/positions$/,
  /^\/api\/delegated\/pnl\/summary$/,
  /^\/api\/delegated\/strategies\/[\w-]+(\?.*)?$/, // available, top-backtests, top-live, top-optimized-combos
  /^\/api\/delegated\/backtests\/[\w-]+$/, // poll a job
  /^\/api\/delegated\/tools$/,
  /^\/api\/delegated\/mcp\/capabilities(\?.*)?$/,
  /^\/api\/delegated\/agent\/onboarding(\?.*)?$/,
  /^\/api\/health$/,
];

/** REST POST paths this system may call. `/mcp/tool` is further gated by tool name below. */
const ALLOWED_POST: RegExp[] = [
  /^\/api\/delegated\/backtests$/, // enqueue an async backtest
  /^\/api\/delegated\/mcp\/tool$/, // execute ONE analysis tool (name-checked)
];

/**
 * Curated analysis-tool allowlist for POST /mcp/tool.
 *
 * Deliberately NARROWER than "all observe/experiment tiers": several experiment-tier
 * Jester tools are side-effectful for us (e.g. qscript_deploy goes live, builder_save
 * and the *_actions tools persist/mutate, crucible + optimizer_enqueue spawn work).
 * Only pure read / discovery / backtest / parity tools belong here. Extend consciously.
 */
export const ANALYSIS_TOOLS: ReadonlySet<string> = new Set([
  // account / portfolio (read)
  "jester_capabilities", "jester_user_status", "jester_account_readiness",
  "jester_account_snapshot", "jester_wallets_summary", "jester_onboarding_status",
  "jester_exchange_status", "jester_portfolio_summary", "jester_positions",
  "jester_pnl_analytics", "jester_risk_review", "jester_trade_history",
  "jester_trading_stats", "jester_trading_review", "jester_my_live_performance",
  "jester_my_strategies", "jester_notifications", "jester_signals_history",
  "jester_preferences_summary", // read-only: notification toggles, HL wallet default, exchange allocation mode
  // strategy discovery / analysis (read)
  "jester_strategy_discovery", "jester_browse_strategies", "jester_popular_strategies",
  "jester_strategy_overview", "jester_strategy_stats", "jester_strategy_settings",
  "jester_strategy_categories", "jester_strategy_hold_analytics",
  "jester_strategy_hourly_profile", "jester_top_backtests", "jester_top_live_strategies",
  "jester_top_live_performers", "jester_recommendations", "jester_governance_rankings",
  "jester_cached_backtest_ranking", "jester_discover_optimized_combos",
  "jester_param_compare_read", "jester_param_hash_resolve", "jester_subscription_audit",
  "jester_subscribe_dry_run",
  // Observatory hub (observe tier): status / optimize_start / optimize_status / chart / parity.
  // Compute-only — it can start an optimizer run and read its progress, but places no trades and
  // moves no funds. This is the one path that can GENERATE the ranked combos activation requires.
  "jester_observatory_hub",
  // backtest / parity (compute, read-only result)
  "jester_run_backtest", "jester_backtest_job_status", "jester_backtest_params",
  "jester_compare_backtests", "jester_strategy_live_vs_backtest", "jester_parity_check",
  // market / pairs (read)
  "jester_tradable_pairs", "jester_pair_snapshot", "jester_pair_detail",
  "jester_market_health", "jester_ml_forecast", "jester_technical_gauge_scan",
  "jester_top_wallets", "jester_top_wallet_context",
  // OHLCV candle snapshot + optional strategy-signal overlay (read; Jester "o" tier). Added for the
  // Up/Down tournament: the signal overlay is the only unsubscribed path to a strategy's signal SIDES.
  "jester_chart_snapshot",
  // Tesseract planning (read-only): market Field (Drive/Heat/Mass/Flow/Book) + a derived trade plan
  // (entry/SL/TP/sizing) + optional LLM commentary. No trades, no funds — analysis/exploration only.
  "jester_tesseract_field", "jester_tesseract_analyze", "jester_tesseract_commentary",
]);

/**
 * Known mutate-tier tools (from the live catalog). Not strictly required given the
 * fail-closed allowlist above, but kept as explicit defense-in-depth and to make the
 * "never these" guarantee legible in tests.
 */
export const MUTATE_TOOLS: ReadonlySet<string> = new Set([
  "jester_agent_schedule_actions", "jester_agent_settings_actions", "jester_automation_actions",
  "jester_builder_actions", "jester_copy_trading_actions", "jester_crucible_promote",
  "jester_guild_actions", "jester_mesh_actions", "jester_portfolio_actions",
  "jester_preferences_actions", "jester_propose_prediction", "jester_propose_trade",
  "jester_research_org_actions", "jester_strategy_actions", "jester_swarm_actions",
  "jester_targets_activate", "jester_targets_run_cycle", "jester_trade_gauge_quickstart",
  "jester_webhook_actions",
]);

/**
 * TRADE tier (Phase 2). The ONLY mutating actions this system may perform, and only via the
 * separate `jesterTradeCall` channel — which is reachable exclusively from the human-gated `trading`
 * router (manager+ real session, with confirm). The normal analysis path (assertAllowed above) stays
 * fully fail-closed and never touches these. Anything not listed here is blocked. Curated tight:
 * activation/allocation/pause/kill only — no direct order execution (that's Phase 3).
 */
export const TRADE_ACTIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  jester_automation_actions: new Set([
    "center", "strategy_settings", // read-only status (routed here for convenience)
    "subscribe", "subscribe_cached_best", "apply_params_by_hash", "apply_cached_combo",
    "toggle_strategy", "pause_all", "resume_all", "remove_strategy",
    "update_config", // adjust per-strategy risk (riskPerTrade / maxLossPerTrade) — read-modify-write only
  ]),
  jester_preferences_actions: new Set([
    "allocation_get", "allocation_set", "emergency_lockout", "emergency_release",
  ]),
  jester_portfolio_actions: new Set(["positions", "close_all"]),
};

/** Throw unless (tool, action) is an explicitly permitted TRADE action. */
export function assertTradeAllowed(name: string, action: string): void {
  const allowed = TRADE_ACTIONS[name];
  if (!allowed || !allowed.has(action)) {
    throw new JesterForbiddenError(`Trade action "${name}.${action}" is not permitted`);
  }
}

export type Method = "GET" | "POST";

/**
 * Throw JesterForbiddenError unless (method, path, body) is an allowed analysis call.
 * Call this before building any Jester request.
 */
export function assertAllowed(method: Method, path: string, body?: unknown): void {
  if (method === "GET") {
    if (ALLOWED_GET.some((re) => re.test(path))) return;
    throw new JesterForbiddenError(`GET ${path} is not an allowed analysis endpoint`);
  }

  if (method === "POST") {
    if (!ALLOWED_POST.some((re) => re.test(path))) {
      throw new JesterForbiddenError(`POST ${path} is not an allowed analysis endpoint`);
    }
    // Extra gate on the tool executor: only curated analysis tools, never a mutate tool.
    if (/^\/api\/delegated\/mcp\/tool$/.test(path)) {
      const name = (body as { name?: unknown } | undefined)?.name;
      if (typeof name !== "string") {
        throw new JesterForbiddenError("mcp/tool call is missing a string `name`");
      }
      if (MUTATE_TOOLS.has(name)) {
        throw new JesterForbiddenError(`mcp/tool "${name}" is a mutate-tier tool — blocked`);
      }
      if (!ANALYSIS_TOOLS.has(name)) {
        throw new JesterForbiddenError(`mcp/tool "${name}" is not in the analysis allowlist`);
      }
    }
    return;
  }

  throw new JesterForbiddenError(`Method ${String(method)} is not allowed`);
}

/** Non-throwing variant for callers that want a boolean. */
export function isAllowed(method: Method, path: string, body?: unknown): boolean {
  try {
    assertAllowed(method, path, body);
    return true;
  } catch {
    return false;
  }
}
