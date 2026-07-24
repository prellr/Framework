import { db, jesterCredentials } from "@framework/db";
import { getUserFills, periodsFromFills } from "../services/hyperliquid.ts";
async function main() {
  const [c] = await db.select({ userId: jesterCredentials.userId, w: jesterCredentials.hlWallet }).from(jesterCredentials).limit(1);
  if (!c?.w) return console.log("no wallet");
  const fills = await getUserFills(c.w);
  const p = periodsFromFills(fills);
  const f = (x: any) => `net $${x.net.toFixed(2)} (realized $${x.realized.toFixed(2)} - fees $${x.fees.toFixed(2)}) over ${x.trades} trades`;
  console.log("last24h :", f(p.day));
  console.log("week    :", f(p.week));
  console.log("month   :", f(p.month));
  console.log("allTime :", f(p.allTime));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
