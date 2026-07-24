/**
 * Evidence-gathering audit of the Jester delegated API. Read/compute only — no trades, no funds.
 * Produces the raw findings behind the API report.
 */
import { db, jesterCredentials } from "@framework/db";
import { jesterCall } from "../services/jester.ts";

const S = "mean_reversion_pocket_volume";
const PAIR = "AVAX-USD";
const TF = "15m";

let uid = "";
const tool = (name: string, args: Record<string, unknown> = {}) =>
  jesterCall(uid, "POST", "/api/delegated/mcp/tool", { name, args });

const show = (label: string, v: unknown, n = 400) =>
  console.log(`\n### ${label}\n${JSON.stringify(v, null, 2).slice(0, n)}`);

async function main() {
  const [c] = await db.select({ userId: jesterCredentials.userId }).from(jesterCredentials).limit(1);
  if (!c) return console.log("no cred");
  uid = c.userId;

  // 1. PnL summary — are the period fields ever populated?
  const pnl = await jesterCall(uid, "GET", "/api/delegated/pnl/summary").catch((e) => ({ error: String(e) }));
  show("1. /pnl/summary .pnl block", (pnl as any)?.pnl ?? pnl, 300);
  console.log("   equity:", (pnl as any)?.totalPortfolioValue, "unrealized:", (pnl as any)?.totalUnrealizedPnL);

  // 2. my_live_performance vs my_strategies — coverage mismatch
  const lp = await tool("jester_my_live_performance").catch((e) => ({ error: String(e) }));
  const ms = await tool("jester_my_strategies").catch((e) => ({ error: String(e) }));
  const lpRows = (lp as any)?.result?.rows ?? [];
  const msRows = (ms as any)?.result?.strategies ?? [];
  console.log(`\n### 2. coverage: my_live_performance=${lpRows.length} strategies, my_strategies=${msRows.length}`);
  console.log("   live_perf ids:", lpRows.map((r: any) => r.strategyId).join(", "));
  console.log("   my_strats ids:", msRows.map((r: any) => r.id).join(", "));
  console.log("   combinedPnLPct (sums % on different bases):", (lp as any)?.result?.summary?.combinedPnLPct);
  for (const s of msRows) {
    const p = s.performance ?? {};
    if (p.totalTrades == null || p.totalPnLUsd == null)
      console.log(`   INCOMPLETE perf: ${s.id} trades=${p.totalTrades} pnlUsd=${p.totalPnLUsd}`);
  }

  // 3. Backtest payload — any per-trade data?
  const bt = await tool("jester_run_backtest", { strategyId: S, pair: PAIR, timeframe: TF, days: 30 }).catch((e) => ({
    error: String(e),
  }));
  const btKeys = Object.keys((bt as any)?.result ?? {});
  console.log("\n### 3. backtest result keys:", btKeys.join(", "));
  console.log("   metrics keys:", Object.keys((bt as any)?.result?.metrics ?? {}).join(", "));
  const btStr = JSON.stringify(bt);
  console.log(
    "   per-trade keys present:",
    ["trades", "tradeList", "orders", "fills", "equityCurve"].filter((k) => btStr.includes(`"${k}":`)).join(", ") || "NONE",
  );
  const hash = (bt as any)?.result?.sharedResult?.paramHash;
  console.log("   sharedResult.paramHash:", hash);

  // 4. Is a backtest's own paramHash resolvable?
  if (hash) {
    const res = await tool("jester_param_hash_resolve", { paramHash: hash, strategyId: S }).catch((e) => ({
      error: e instanceof Error ? e.message : String(e),
    }));
    show("4. param_hash_resolve on the hash Jester just issued", res, 250);
  }

  // 5. Observatory combo quality — does ranking penalise tiny samples?
  const combos = await tool("jester_param_compare_read", { strategyId: S, pair: PAIR, timeframe: TF }).catch((e) => ({
    error: String(e),
  }));
  const list = (combos as any)?.result?.combos ?? [];
  console.log(`\n### 5. observatory combos: ${list.length} stored`);
  for (const c of list.slice(0, 5)) {
    console.log(
      `   rank ${list.indexOf(c)}: return=${c.totalReturn?.toFixed?.(2)}% trades=${c.totalTrades} win=${c.winRate}% dd=${c.maxDrawdown} score=${c.score?.toFixed?.(3)}`,
    );
  }
  const thin = list.filter((c: any) => (c.totalTrades ?? 0) < 20).length;
  console.log(`   combos with <20 trades: ${thin}/${list.length}`);

  // 6. Signals history — usable for trade attribution?
  const sig = await tool("jester_signals_history", { strategyId: "ichimoku_adx_trend", pair: "SOL-USD", days: 7 }).catch(
    (e) => ({ error: String(e) }),
  );
  show("6. signals_history sample", (sig as any)?.result?.signals?.slice(0, 2) ?? sig, 200);

  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
