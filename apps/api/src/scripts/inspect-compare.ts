import { db, jesterCredentials, backtestRuns } from "@framework/db";
import { and, eq, desc } from "drizzle-orm";
import { jesterCall } from "../services/jester.ts";
async function main() {
  const [c] = await db.select({ userId: jesterCredentials.userId }).from(jesterCredentials).limit(1);
  const uid = c!.userId;
  const tool = (n: string, a: any) => jesterCall(uid, "POST", "/api/delegated/mcp/tool", { name: n, args: a });

  const top: any = await tool("jester_top_backtests", { limit: 50 });
  const picks = top?.result?.strategies ?? [];
  const ms: any = await tool("jester_my_strategies", {});
  const live = ms?.result?.strategies ?? [];

  console.log("PICK (Jester cached-optimized)                       | LIVE on account            | OUR default backtest");
  console.log("-".repeat(120));
  for (const p of picks) {
    const l = live.find((s: any) => s.id === p.id);
    const lp = l?.performance ?? {};
    const lpair = (l?.pairs ?? []).find((x: any) => x.pair === p.pair);
    // our own warehouse row for the same cell (default params)
    const rows = await db.select().from(backtestRuns)
      .where(and(eq(backtestRuns.strategyId, p.id), eq(backtestRuns.pair, p.pair), eq(backtestRuns.timeframe, p.timeframe)))
      .orderBy(desc(backtestRuns.ranAt)).limit(1);
    const o = rows[0];
    const liveStr = l
      ? `${lp.totalTrades ?? "?"}tr ${lp.winRate?.toFixed?.(0) ?? "?"}% ${lp.totalPnLUsd != null ? "$" + lp.totalPnLUsd.toFixed(2) : "?"}${lpair ? ` code=${lpair.paramHash8}` : " (diff pair)"}`
      : "not subscribed";
    const ourStr = o
      ? `${Number(o.totalReturn).toFixed(1)}% ${o.totalTrades}tr PF ${o.profitFactor ? Number(o.profitFactor).toFixed(2) : "?"}`
      : "no run for this cell";
    console.log(
      `${p.id.padEnd(36).slice(0,36)} ${p.pair}/${p.timeframe} +${p.totalReturn}% ${p.winRate}% ${p.totalTrades}tr PF${p.profitFactor} hash=${p.paramHash}`.padEnd(52) +
      ` | ${liveStr.padEnd(26)} | ${ourStr}`
    );
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
