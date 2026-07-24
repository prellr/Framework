import { db, jesterCredentials } from "@framework/db";
import { jesterCall } from "../services/jester.ts";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const [c] = await db.select({ userId: jesterCredentials.userId }).from(jesterCredentials).limit(1);
  if (!c) return console.log("no cred");
  const base = { strategyId: "mean_reversion_pocket_volume", pair: "AVAX-USD", timeframe: "15m", days: 30 };

  console.log("=== optimize_start ===");
  const start = await jesterCall(c.userId, "POST", "/api/delegated/mcp/tool", {
    name: "jester_observatory_hub",
    args: { mode: "optimize_start", ...base },
  }).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
  console.log(JSON.stringify(start?.result ?? start, null, 2).slice(0, 900));

  for (let i = 0; i < 3; i++) {
    await sleep(5000);
    const st = await jesterCall(c.userId, "POST", "/api/delegated/mcp/tool", {
      name: "jester_observatory_hub",
      args: { mode: "optimize_status", ...base },
    }).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    console.log(`\n=== optimize_status (${(i + 1) * 5}s) ===`);
    console.log(JSON.stringify(st?.result ?? st, null, 2).slice(0, 700));
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
