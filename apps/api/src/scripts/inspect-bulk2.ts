import { db, jesterCredentials } from "@framework/db";
import { jesterCall } from "../services/jester.ts";
async function main() {
  const [c] = await db.select({ userId: jesterCredentials.userId }).from(jesterCredentials).limit(1);
  const uid = c!.userId;
  const tool = (name: string, args: any) => jesterCall(uid, "POST", "/api/delegated/mcp/tool", { name, args });

  const r: any = await tool("jester_top_backtests", { limit: 300 });
  const res = r?.result ?? {};
  const strats = res.strategies ?? [];
  console.log("=== jester_top_backtests ===");
  console.log("strategies returned:", strats.length);
  console.log("optimizationCacheCoverage:", JSON.stringify(res.optimizationCacheCoverage));
  console.log("topPick:", JSON.stringify(res.topPick).slice(0, 300));
  if (strats[0]) console.log("\nsample row:", JSON.stringify(strats[0], null, 2).slice(0, 700));
  const withHash = strats.filter((s: any) => s.paramHash || s.paramsHash);
  console.log(`\nrows carrying a paramHash: ${withHash.length}/${strats.length}`);
  const withParams = strats.filter((s: any) => s.parameters);
  console.log(`rows carrying actual parameter VALUES: ${withParams.length}/${strats.length}`);
  // distinct pairs/timeframes covered
  const cells = new Set(strats.map((s: any) => `${s.pair}/${s.timeframe}`));
  console.log("distinct cells covered:", [...cells].slice(0, 12).join(", "), cells.size > 12 ? `… (${cells.size})` : "");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
