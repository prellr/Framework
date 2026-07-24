/** Read-only: compare jester_my_live_performance vs jester_my_strategies (they disagree). */
import { db, jesterCredentials } from "@framework/db";
import { jesterCall } from "../services/jester.ts";

async function main() {
  const [cred] = await db.select({ userId: jesterCredentials.userId }).from(jesterCredentials).limit(1);
  if (!cred) return console.log("no cred");

  const lp = await jesterCall(cred.userId, "POST", "/api/delegated/mcp/tool", {
    name: "jester_my_live_performance",
    args: {},
  }).catch((e) => ({ error: String(e) }));
  console.log("===== jester_my_live_performance (raw) =====");
  console.log(JSON.stringify(lp?.result ?? lp, null, 2).slice(0, 3000));

  const ms = await jesterCall(cred.userId, "POST", "/api/delegated/mcp/tool", {
    name: "jester_my_strategies",
    args: {},
  }).catch((e) => ({ error: String(e) }));
  console.log("\n===== jester_my_strategies (per-strategy summary) =====");
  for (const s of (ms?.result?.strategies ?? []) as any[]) {
    const p = s.performance ?? {};
    console.log(
      `${s.id}: trades=${p.totalTrades} win=${p.winRate?.toFixed?.(1)} pnl%=${p.totalPnLPct} pnl$=${p.totalPnLUsd} pairs=${(s.pairs ?? []).map((x: any) => x.pair).join(",")}`,
    );
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
