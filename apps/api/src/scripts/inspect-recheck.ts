import { db, jesterCredentials } from "@framework/db";
import { jesterCall } from "../services/jester.ts";
async function main() {
  const [c] = await db.select({ userId: jesterCredentials.userId }).from(jesterCredentials).limit(1);
  const uid = c!.userId;
  const tool = (n: string, a: any) => jesterCall(uid, "POST", "/api/delegated/mcp/tool", { name: n, args: a });
  for (const cell of [
    { strategyId: "mean_reversion_pocket_volume", pair: "BTC-USD", timeframe: "15m" },
    { strategyId: "delta_absorption_vwap_reverse", pair: "BTC-USD", timeframe: "5m" },
    { strategyId: "mean_reversion_pocket_volume", pair: "AVAX-USD", timeframe: "15m" },
  ]) {
    const r: any = await tool("jester_param_compare_read", cell).catch((e) => ({ error: String(e) }));
    const res = r?.result ?? {};
    console.log(`${cell.strategyId} ${cell.pair}/${cell.timeframe}: combosStored=${res.combosStored ?? "?"} combos=${(res.combos ?? []).length} runId=${res.runId ?? "none"}${res.message ? " msg=" + res.message : ""}`);
  }
  // Does the dry-run now resolve a target for the cells we just optimized?
  for (const cell of [
    { strategyId: "mean_reversion_pocket_volume", pair: "BTC-USD" },
    { strategyId: "delta_absorption_vwap_reverse", pair: "BTC-USD" },
  ]) {
    const r: any = await tool("jester_subscribe_dry_run", cell).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    console.log(`dry_run ${cell.strategyId}/${cell.pair}: ${r?.error ? "FAILED — " + r.error : "target=" + JSON.stringify(r?.result?.target ?? null).slice(0, 160)}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
