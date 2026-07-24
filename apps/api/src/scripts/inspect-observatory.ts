import { db, jesterCredentials } from "@framework/db";
import { jesterCall } from "../services/jester.ts";
async function main() {
  const [c] = await db.select({ userId: jesterCredentials.userId }).from(jesterCredentials).limit(1);
  if (!c) return console.log("no cred");
  // Read-only probe: what does the Observatory hub report, and does it expose optimize_start?
  for (const args of [{ mode: "status" }]) {
    try {
      const r = await jesterCall(c.userId, "POST", "/api/delegated/mcp/tool", { name: "jester_observatory_hub", args });
      console.log(`observatory_hub ${JSON.stringify(args)}:`);
      console.log(JSON.stringify(r?.result ?? r, null, 2).slice(0, 1500));
    } catch (e) {
      console.log(`observatory_hub ${JSON.stringify(args)} FAILED:`, e instanceof Error ? e.message : e);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
