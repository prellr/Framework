import { db, jesterCredentials } from "@framework/db";
import { getUserFills, summarizeFills } from "../services/hyperliquid.ts";
async function main() {
  const [c] = await db.select({ w: jesterCredentials.hlWallet }).from(jesterCredentials).limit(1);
  const fills = await getUserFills(c!.w!, Date.now() - 30 * 86400000);
  const s = summarizeFills(fills);
  console.log("COIN   TRADES   WIN%     NET      GROSS     FEES");
  for (const cn of s.byCoin.slice(0, 6))
    console.log(`${cn.coin.padEnd(6)} ${String(cn.trades).padStart(5)}  ${cn.winRate.toFixed(1).padStart(5)}%  ${("$" + cn.net.toFixed(2)).padStart(8)} ${("$" + cn.realized.toFixed(2)).padStart(8)} ${("$" + cn.fees.toFixed(2)).padStart(8)}`);
  const L = s.bySide.long, S = s.bySide.short;
  console.log(`\nLONG : ${L.trades} tr · ${L.winRate.toFixed(1)}% · net $${L.net.toFixed(2)} (gross $${L.realized.toFixed(2)} - fees $${L.fees.toFixed(2)})`);
  console.log(`SHORT: ${S.trades} tr · ${S.winRate.toFixed(1)}% · net $${S.net.toFixed(2)} (gross $${S.realized.toFixed(2)} - fees $${S.fees.toFixed(2)})`);
  console.log(`\nTOTAL: net $${s.net.toFixed(2)} = realized $${s.realized.toFixed(2)} - fees $${s.fees.toFixed(2)}`);
  console.log(`check: sum(coin net)=$${s.byCoin.reduce((a, x) => a + x.net, 0).toFixed(2)}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
