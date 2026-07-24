import { db, jesterCredentials, backtestRuns } from "@framework/db";
import { and, eq, desc } from "drizzle-orm";
import { jesterCall } from "../services/jester.ts";
async function main() {
  const [c] = await db.select({ userId: jesterCredentials.userId }).from(jesterCredentials).limit(1);
  const uid = c!.userId;
  const tool = (n: string, a: any) => jesterCall(uid, "POST", "/api/delegated/mcp/tool", { name: n, args: a });

  const top: any = await tool("jester_top_backtests", { limit: 50 });
  const bb = (top?.result?.strategies ?? []).find((s: any) => s.id === "bb_hybrid");
  console.log("=== FULL top_backtests row for bb_hybrid (all keys) ===");
  console.log(JSON.stringify(bb, null, 2));
  console.log("\ntop-level result keys:", Object.keys(top?.result ?? {}).join(", "));

  console.log("\n=== param_compare_read bb_hybrid SUI-USD/15m ===");
  const cmp: any = await tool("jester_param_compare_read", { strategyId: "bb_hybrid", pair: "SUI-USD", timeframe: "15m" }).catch((e) => ({ error: String(e) }));
  const res = cmp?.result ?? cmp;
  console.log("keys:", Object.keys(res ?? {}).join(", "));
  console.log("days-ish fields:", JSON.stringify({ days: res?.days, window: res?.window, testDays: res?.testDays, runId: res?.runId }));
  const first = (res?.combos ?? [])[0];
  if (first) console.log("combo[0] keys:", Object.keys(first).join(", "));

  console.log("\n=== cached_backtest_ranking bb_hybrid ===");
  const rank: any = await tool("jester_cached_backtest_ranking", { strategyId: "bb_hybrid" }).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
  console.log(JSON.stringify(rank?.result ?? rank).slice(0, 700));

  console.log("\n=== OUR warehouse rows for bb_hybrid SUI-USD/15m (window is recorded) ===");
  const rows = await db.select().from(backtestRuns)
    .where(and(eq(backtestRuns.strategyId, "bb_hybrid"), eq(backtestRuns.pair, "SUI-USD"), eq(backtestRuns.timeframe, "15m")))
    .orderBy(desc(backtestRuns.ranAt)).limit(5);
  for (const r of rows) console.log(`  days=${r.daysRequested} span=${r.spanDays}d ${r.actualStart}→${r.actualEnd} ret=${Number(r.totalReturn).toFixed(2)}% tr=${r.totalTrades} pf=${r.profitFactor ? Number(r.profitFactor).toFixed(2) : "?"} params=${r.paramHash}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
