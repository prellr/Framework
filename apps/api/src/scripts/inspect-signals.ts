import { db, jesterCredentials } from "@framework/db";
import { jesterCall } from "../services/jester.ts";
async function main() {
  const [cred] = await db.select({ userId: jesterCredentials.userId }).from(jesterCredentials).limit(1);
  if (!cred) return console.log("no cred");
  for (const name of ["jester_signals_history"]) {
    try {
      const r = await jesterCall(cred.userId, "POST", "/api/delegated/mcp/tool", { name, args: { strategyId: "ichimoku_adx_trend", pair: "SOL-USD", days: 7 } });
      console.log(`=== ${name} ===`);
      console.log(JSON.stringify(r?.result ?? r, null, 2).slice(0, 1600));
    } catch (e) { console.log(`${name} FAILED:`, e instanceof Error ? e.message : e); }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
