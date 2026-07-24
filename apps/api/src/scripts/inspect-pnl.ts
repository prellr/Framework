import { db, jesterCredentials } from "@framework/db";
import { jesterCall } from "../services/jester.ts";
async function main() {
  const [cred] = await db.select({ userId: jesterCredentials.userId }).from(jesterCredentials).limit(1);
  if (!cred) return console.log("no cred");
  const r = await jesterCall(cred.userId, "GET", "/api/delegated/pnl/summary");
  console.log(JSON.stringify(r, null, 2).slice(0, 2000));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
