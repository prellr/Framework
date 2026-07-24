import { db, jesterCredentials } from "@framework/db";
import { jesterCall } from "../services/jester.ts";
const S = "mean_reversion_pocket_volume", PAIR = "AVAX-USD", TF = "15m";
async function main() {
  const [c] = await db.select({ userId: jesterCredentials.userId }).from(jesterCredentials).limit(1);
  const uid = c!.userId;
  const tool = (name: string, args: any) => jesterCall(uid, "POST", "/api/delegated/mcp/tool", { name, args });
  for (const [label, params] of [
    ["DEFAULT params", undefined],
    ["CUSTOM params (ours)", { lowVolumeThreshold: 0.7, pocketStrengthThreshold: 8 }],
  ] as const) {
    const bt: any = await tool("jester_run_backtest", { strategyId: S, pair: PAIR, timeframe: TF, days: 30, ...(params ? { parameters: params } : {}) }).catch((e) => ({ error: String(e) }));
    const h = bt?.result?.sharedResult?.paramHash;
    console.log(`\n=== ${label} -> hash ${h} ===`);
    if (!h) { console.log("  no hash:", JSON.stringify(bt).slice(0, 150)); continue; }
    const r: any = await tool("jester_param_hash_resolve", { paramHash: h, strategyId: S }).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    console.log("  resolve:", r?.error ? `FAILED — ${r.error}` : `ok (${Object.keys(r?.result?.parameters ?? {}).length} params returned)`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
