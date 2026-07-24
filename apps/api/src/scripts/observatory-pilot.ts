/**
 * Observatory pilot: run the full pipeline on a couple of cells and report what comes back.
 *   optimize_start -> poll -> param_compare_read -> resolve each hash -> parameter values
 * Compute-only (no trades, no funds). Validates the loop before committing to a bulk sweep.
 */
import { db, jesterCredentials } from "@framework/db";
import { jesterCall } from "../services/jester.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CELLS = [
  { strategyId: "mean_reversion_pocket_volume", pair: "BTC-USD", timeframe: "15m", days: 30 },
  { strategyId: "delta_absorption_vwap_reverse", pair: "BTC-USD", timeframe: "5m", days: 30 },
];

let uid = "";
const tool = (name: string, args: Record<string, unknown>) =>
  jesterCall(uid, "POST", "/api/delegated/mcp/tool", { name, args });

async function runCell(cell: (typeof CELLS)[number]) {
  const tag = `${cell.strategyId} ${cell.pair}/${cell.timeframe}`;
  console.log(`\n${"=".repeat(78)}\n${tag}\n${"=".repeat(78)}`);

  const start: any = await tool("jester_observatory_hub", { mode: "optimize_start", ...cell }).catch((e) => ({
    error: e instanceof Error ? e.message : String(e),
  }));
  const optRunId = start?.result?.optRunId ?? start?.optRunId;
  if (!optRunId) {
    console.log("  start FAILED:", JSON.stringify(start).slice(0, 200));
    return;
  }
  console.log(`  started optRunId=${optRunId}`);

  // Poll: combosStored climbing is the progress signal; "not found" means not-yet-registered OR done.
  let last = -1;
  let stable = 0;
  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    const st: any = await tool("jester_observatory_hub", {
      mode: "optimize_status",
      optRunId,
      strategyId: cell.strategyId,
    }).catch(() => null);
    const stored = st?.result?.run?.combosStored ?? null;
    if (stored != null) {
      console.log(`  [${(i + 1) * 5}s] combosStored=${stored}`);
      stable = stored === last ? stable + 1 : 0;
      last = stored;
      if (stable >= 2) break; // count held steady twice — treat as finished
    } else if (last >= 0) {
      console.log(`  [${(i + 1) * 5}s] run no longer reported — finished`);
      break;
    }
  }

  const cmp: any = await tool("jester_param_compare_read", {
    strategyId: cell.strategyId,
    pair: cell.pair,
    timeframe: cell.timeframe,
  }).catch((e) => ({ error: String(e) }));
  const combos = cmp?.result?.combos ?? [];
  console.log(`\n  combos available: ${combos.length} (runId ${cmp?.result?.runId ?? "?"})`);

  let resolved = 0;
  for (const [i, c] of combos.slice(0, 8).entries()) {
    const r: any = await tool("jester_param_hash_resolve", {
      paramHash: c.paramsHash,
      strategyId: cell.strategyId,
    }).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    const params = r?.result?.parameters;
    const n = params ? Object.keys(params).length : 0;
    if (n) resolved++;
    const thin = (c.totalTrades ?? 0) < 20 ? " THIN" : "";
    console.log(
      `  rank ${i}: ret=${c.totalReturn?.toFixed?.(2)}% trades=${c.totalTrades} win=${c.winRate?.toFixed?.(0)}% dd=${c.maxDrawdown?.toFixed?.(2)}${thin} hash=${c.paramsHash} -> ${n ? `${n} params` : "UNRESOLVABLE"}`,
    );
  }
  const credible = combos.filter((c: any) => (c.totalTrades ?? 0) >= 20).length;
  console.log(`\n  SUMMARY: ${combos.length} combos, ${credible} with >=20 trades, ${resolved}/${Math.min(combos.length, 8)} resolvable`);
}

async function main() {
  const [c] = await db.select({ userId: jesterCredentials.userId }).from(jesterCredentials).limit(1);
  if (!c) return console.log("no cred");
  uid = c.userId;
  for (const cell of CELLS) {
    await runCell(cell);
    await sleep(5000); // space the runs so we don't trip rate limits
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
