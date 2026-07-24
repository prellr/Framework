/**
 * Read-only: pull Jester's OWN cached backtest ranking for the strategies it recommends, so a
 * Telegram "top pick" claim can be traced to the cached row (paramHash, window, win rate) it came
 * from — and compared against our warehouse + live results.
 */
import { db, jesterCredentials } from "@framework/db";
import { jesterCall } from "../services/jester.ts";

const IDS = ["ichimoku_adx_trend", "anchored_vwap_deviation_hod_lod_fade", "rsi_momentum"];

async function main() {
  const [cred] = await db.select({ userId: jesterCredentials.userId }).from(jesterCredentials).limit(1);
  if (!cred) return console.log("no cred");

  for (const id of IDS) {
    for (const tool of ["jester_cached_backtest_ranking", "jester_top_backtests"]) {
      try {
        const res = await jesterCall(cred.userId, "POST", "/api/delegated/mcp/tool", {
          name: tool,
          args: { strategyId: id },
        });
        const r = res?.result;
        console.log(`\n===== ${id} :: ${tool} =====`);
        console.log(JSON.stringify(r, null, 2).slice(0, 1800));
      } catch (e) {
        console.log(`\n===== ${id} :: ${tool} FAILED: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
