/**
 * Read-only investigation: can a param set WE discovered be activated?
 * 1. Run the winning combo through Jester's sync backtest to get its own paramHash (code).
 * 2. Ask Jester to resolve that code back to parameters (jester_param_hash_resolve).
 * 3. Check what the subscribe dry-run resolves for this strategy/pair.
 * No mutations — backtest/resolve/dry-run are all read or compute calls.
 */
import { db, jesterCredentials } from "@framework/db";
import { jesterCall } from "../services/jester.ts";

const STRATEGY = "mean_reversion_pocket_volume";
const PAIR = "AVAX-USD";
const TF = "15m";
const WINNER = { lowVolumeThreshold: 0.7, pocketStrengthThreshold: 8 };

async function main() {
  const [cred] = await db.select({ userId: jesterCredentials.userId }).from(jesterCredentials).limit(1);
  if (!cred) return console.log("no cred");
  const uid = cred.userId;

  console.log("=== 1. sync backtest of the winning param set (to obtain Jester's code) ===");
  let code: string | null = null;
  try {
    const res = await jesterCall(uid, "POST", "/api/delegated/mcp/tool", {
      name: "jester_run_backtest",
      args: { strategyId: STRATEGY, pair: PAIR, timeframe: TF, days: 60, parameters: WINNER },
    });
    code = res?.result?.sharedResult?.paramHash ?? null;
    console.log("paramHash:", code);
    console.log("metrics:", JSON.stringify(res?.result?.metrics ?? {}).slice(0, 200));
  } catch (e) {
    console.log("backtest FAILED:", e instanceof Error ? e.message : e);
  }

  if (code) {
    console.log("\n=== 2. can Jester resolve that code back to parameters? ===");
    for (const args of [{ paramHash: code, strategyId: STRATEGY }, { hash: code, strategyId: STRATEGY }]) {
      try {
        const r = await jesterCall(uid, "POST", "/api/delegated/mcp/tool", {
          name: "jester_param_hash_resolve",
          args,
        });
        console.log(`args=${JSON.stringify(args)} ->`, JSON.stringify(r?.result ?? r).slice(0, 600));
      } catch (e) {
        console.log(`args=${JSON.stringify(args)} FAILED:`, e instanceof Error ? e.message : e);
      }
    }
  }

  console.log("\n=== 3. subscribe dry-run for this strategy/pair ===");
  try {
    const r = await jesterCall(uid, "POST", "/api/delegated/mcp/tool", {
      name: "jester_subscribe_dry_run",
      args: { strategyId: STRATEGY, pair: PAIR },
    });
    console.log(JSON.stringify(r?.result ?? r, null, 2).slice(0, 900));
  } catch (e) {
    console.log("dry-run FAILED:", e instanceof Error ? e.message : e);
  }

  console.log("\n=== 4. does Jester have ANY cached combos for this strategy? ===");
  for (const name of ["jester_param_compare_read", "jester_discover_optimized_combos"]) {
    try {
      const r = await jesterCall(uid, "POST", "/api/delegated/mcp/tool", {
        name,
        args: { strategyId: STRATEGY, pair: PAIR, timeframe: TF },
      });
      console.log(`${name}:`, JSON.stringify(r?.result ?? r).slice(0, 500));
    } catch (e) {
      console.log(`${name} FAILED:`, e instanceof Error ? e.message : e);
    }
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
