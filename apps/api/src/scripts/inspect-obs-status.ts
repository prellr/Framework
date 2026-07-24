import { db, jesterCredentials } from "@framework/db";
import { jesterCall } from "../services/jester.ts";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const [c] = await db.select({ userId: jesterCredentials.userId }).from(jesterCredentials).limit(1);
  if (!c) return console.log("no cred");
  const optRunId = process.argv[2];
  for (let i = 0; i < 8; i++) {
    const st = await jesterCall(c.userId, "POST", "/api/delegated/mcp/tool", {
      name: "jester_observatory_hub",
      args: { mode: "optimize_status", optRunId, strategyId: "mean_reversion_pocket_volume" },
    }).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    const r: any = st?.result ?? st;
    console.log(`[${i * 10}s] status=${r?.status ?? r?.state ?? "?"} ${JSON.stringify(r).slice(0, 300)}`);
    if (r?.status === "done" || r?.status === "complete" || r?.done) break;
    await sleep(10000);
  }
  // Did ranked combos appear?
  const combos = await jesterCall(c.userId, "POST", "/api/delegated/mcp/tool", {
    name: "jester_param_compare_read",
    args: { strategyId: "mean_reversion_pocket_volume", pair: "AVAX-USD", timeframe: "15m" },
  }).catch((e) => ({ error: String(e) }));
  console.log("\n=== param_compare_read after run ===");
  console.log(JSON.stringify(combos?.result ?? combos).slice(0, 700));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
