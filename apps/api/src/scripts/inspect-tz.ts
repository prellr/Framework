import { db, jesterCredentials } from "@framework/db";
import { getUserFills } from "../services/hyperliquid.ts";
async function main() {
  const [c] = await db.select({ w: jesterCredentials.hlWallet }).from(jesterCredentials).limit(1);
  if (!c?.w) return console.log("no wallet");
  const now = new Date();
  console.log("server TZ           :", Intl.DateTimeFormat().resolvedOptions().timeZone, "| offsetMin:", now.getTimezoneOffset());
  console.log("now (server local)  :", now.toString());
  console.log("now (UTC)           :", now.toISOString());
  console.log("day of week (0=Sun) :", now.getDay());

  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  console.log("startOfDay          :", startOfDay.toISOString());
  console.log("startOfWeek(Sun)    :", startOfWeek.toISOString());

  const fills = await getUserFills(c.w);
  const closing = fills.filter((f) => f.closedPnl !== 0);
  const cnt = (from: number) => closing.filter((f) => f.time >= from).length;
  console.log("\n--- closed trade counts ---");
  console.log("calendar today      :", cnt(startOfDay.getTime()));
  console.log("calendar week (Sun) :", cnt(startOfWeek.getTime()));
  console.log("rolling last 24h    :", cnt(Date.now() - 86400000));
  console.log("rolling last 7d     :", cnt(Date.now() - 7 * 86400000));
  console.log("rolling last 30d    :", cnt(Date.now() - 30 * 86400000));
  console.log("latest fill (UTC)   :", new Date(Math.max(...closing.map((f) => f.time))).toISOString());
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
