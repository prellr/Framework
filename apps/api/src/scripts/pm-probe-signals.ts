/**
 * One-off probe: sample the two candidate live directional signals (Trade composite gauge + ML
 * direction forecast) so we can design their P(up) bridges before wiring them into the Lab tournament.
 * Read-only. Run inside the api container: tsx apps/api/src/scripts/pm-probe-signals.ts
 */
import { db, jesterCredentials } from "@framework/db";
import { jesterCall } from "../services/jester.ts";

const tool = (userId: string, name: string, args: Record<string, unknown>) =>
  jesterCall(userId, "POST", "/api/delegated/mcp/tool", { name, args }, 20_000).then((r) => r?.result ?? r);

async function main() {
  const [cred] = await db.select({ userId: jesterCredentials.userId }).from(jesterCredentials).limit(1);
  if (!cred) { console.log("NO_CREDENTIAL"); return; }
  const userId = cred.userId;
  console.log("using userId", userId);

  for (const [label, name, args] of [
    ["gauge_scan (pairs)", "jester_technical_gauge_scan", { pairs: ["BTC-USD", "ETH-USD"] }],
    ["gauge_scan (no args)", "jester_technical_gauge_scan", {}],
    ["ml_forecast BTC", "jester_ml_forecast", { pair: "BTC-USD" }],
    ["ml_forecast ETH", "jester_ml_forecast", { pair: "ETH-USD" }],
  ] as const) {
    try {
      const out = await tool(userId, name, args as Record<string, unknown>);
      console.log(`\n===== ${label} =====`);
      console.log(JSON.stringify(out, null, 2).slice(0, 2500));
    } catch (e) {
      console.log(`\n===== ${label} ERROR =====`, e instanceof Error ? e.message : e);
    }
  }
  process.exit(0);
}
main();
