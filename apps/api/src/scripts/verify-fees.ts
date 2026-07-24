import { db, jesterCredentials } from "@framework/db";
import { getUserFills, closedTradesWithFees } from "../services/hyperliquid.ts";
async function main() {
  const [c] = await db.select({ w: jesterCredentials.hlWallet }).from(jesterCredentials).limit(1);
  const fills = await getUserFills(c!.w!);
  const trades = closedTradesWithFees(fills);
  console.log("Most recent 5 closed trades (round-trip fees attributed):\n");
  for (const t of trades.slice(0, 5)) {
    console.log(
      `${new Date(t.time).toISOString().slice(5, 16)} ${t.coin.padEnd(4)} ${t.dir.padEnd(12)} sz=${t.sz} px=${t.px}` +
      `  gross=$${t.closedPnl.toFixed(2)}  fees=$${t.fee.toFixed(3)} (entry $${t.entryFee.toFixed(3)} + exit $${t.exitFee.toFixed(3)})  NET=$${t.net.toFixed(2)}`,
    );
  }
  // Cross-check: summed net must equal realized - all fees
  const sumNet = trades.reduce((a, t) => a + t.net, 0);
  const realized = fills.reduce((a, f) => a + f.closedPnl, 0);
  const allFees = fills.reduce((a, f) => a + f.fee, 0);
  console.log(`\nreconciliation: sum(per-trade net)=$${sumNet.toFixed(2)} vs realized-allFees=$${(realized - allFees).toFixed(2)}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
