import { db, jesterCredentials } from "@framework/db";
import { jesterCall } from "../services/jester.ts";
async function main() {
  const [c] = await db.select({ userId: jesterCredentials.userId }).from(jesterCredentials).limit(1);
  const uid = c!.userId;
  const tool = (name: string, args: any) => jesterCall(uid, "POST", "/api/delegated/mcp/tool", { name, args });

  console.log("=== A. REST /strategies/top-optimized-combos (cross-strategy bulk) ===");
  try {
    const r: any = await jesterCall(uid, "GET", "/api/delegated/strategies/top-optimized-combos?pair=BTC-USD&timeframe=15m&days=30&perStrategy=3&limit=200");
    const rows = r?.combos ?? r?.results ?? r?.rows ?? r;
    console.log("keys:", Object.keys(r ?? {}).join(", "));
    console.log("count:", Array.isArray(rows) ? rows.length : typeof rows);
    if (Array.isArray(rows) && rows[0]) console.log("sample:", JSON.stringify(rows[0]).slice(0, 500));
  } catch (e) { console.log("FAILED:", e instanceof Error ? e.message : e); }

  console.log("\n=== B. jester_discover_optimized_combos (fleet cache) ===");
  try {
    const r: any = await tool("jester_discover_optimized_combos", { pair: "BTC-USD", timeframe: "15m", days: 30, limit: 100 });
    console.log("count:", r?.result?.count, "| combos:", (r?.result?.combos ?? []).length);
    const s = (r?.result?.combos ?? [])[0];
    if (s) console.log("sample:", JSON.stringify(s).slice(0, 500));
    else console.log("msg:", r?.result?.message);
  } catch (e) { console.log("FAILED:", e instanceof Error ? e.message : e); }

  console.log("\n=== C. jester_top_backtests (best per strategy) ===");
  try {
    const r: any = await tool("jester_top_backtests", { limit: 200 });
    const rows = r?.result?.rows ?? r?.result?.backtests ?? r?.result?.results ?? [];
    console.log("keys:", Object.keys(r?.result ?? {}).join(", "), "| rows:", rows.length);
    if (rows[0]) console.log("sample:", JSON.stringify(rows[0]).slice(0, 500));
  } catch (e) { console.log("FAILED:", e instanceof Error ? e.message : e); }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
