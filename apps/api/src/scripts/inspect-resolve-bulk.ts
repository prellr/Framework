import { db, jesterCredentials } from "@framework/db";
import { jesterCall } from "../services/jester.ts";
async function main() {
  const [c] = await db.select({ userId: jesterCredentials.userId }).from(jesterCredentials).limit(1);
  const uid = c!.userId;
  const tool = (name: string, args: any) => jesterCall(uid, "POST", "/api/delegated/mcp/tool", { name, args });
  const top: any = await tool("jester_top_backtests", { limit: 50 });
  const rows = top?.result?.strategies ?? [];
  console.log(`resolving ${rows.length} cached hashes -> parameter values\n`);
  for (const r of rows) {
    const res: any = await tool("jester_param_hash_resolve", { paramHash: r.paramHash, strategyId: r.id })
      .catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    const params = res?.result?.parameters;
    const n = params ? Object.keys(params).length : 0;
    console.log(`${r.id} ${r.pair}/${r.timeframe} hash=${r.paramHash} tr=${r.totalTrades} pf=${r.profitFactor} -> ${res?.error ? "FAILED: " + res.error : `${n} params`}`);
    if (params && n) console.log("   sample:", JSON.stringify(Object.fromEntries(Object.entries(params).slice(0, 4))));
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
