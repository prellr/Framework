/**
 * Read-only diagnostic: run one backtest and dump the FULL response shape, to find out whether
 * Jester returns an individual-trade list (we currently only read `metrics`).
 */
import { db, jesterCredentials } from "@framework/db";
import { jesterCall } from "../services/jester.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function outline(o: any, depth = 0, path = ""): string[] {
  const out: string[] = [];
  if (o == null || depth > 3) return out;
  if (Array.isArray(o)) {
    out.push(`${path}: ARRAY(${o.length})`);
    if (o.length) out.push(...outline(o[0], depth + 1, `${path}[0]`));
    return out;
  }
  if (typeof o === "object") {
    for (const [k, v] of Object.entries(o)) {
      const p = path ? `${path}.${k}` : k;
      if (v && typeof v === "object") out.push(...outline(v, depth + 1, p));
      else out.push(`${p} = ${JSON.stringify(v)?.slice(0, 60)}`);
    }
    return out;
  }
  return out;
}

async function main() {
  const [cred] = await db.select({ userId: jesterCredentials.userId }).from(jesterCredentials).limit(1);
  if (!cred) return console.log("no cred");
  const args = { strategyId: "bos_choch_fvg", pair: "DOGE-USD", timeframe: "15m", days: 30 };

  const enq = await jesterCall(cred.userId, "POST", "/api/delegated/backtests", args);
  const jobId = enq?.jobId;
  console.log("jobId:", jobId, "| enqueue keys:", Object.keys(enq ?? {}).join(", "));
  if (!jobId) return console.log(JSON.stringify(enq).slice(0, 500));

  for (let i = 0; i < 25; i++) {
    await sleep(3000);
    const p = await jesterCall(cred.userId, "GET", `/api/delegated/backtests/${jobId}`);
    if (p?.status === "done") {
      console.log("\n=== top-level job keys ===");
      console.log(Object.keys(p).join(", "));
      console.log("\n=== data outline ===");
      console.log(outline(p.data).join("\n"));
      // Look for anything resembling a trade list anywhere in the payload.
      const s = JSON.stringify(p);
      for (const key of ["trades", "tradeList", "tradeLog", "orders", "fills", "signals", "equityCurve"]) {
        const re = new RegExp(`"${key}"\\s*:`, "g");
        const hits = (s.match(re) || []).length;
        if (hits) console.log(`\nFOUND key "${key}" x${hits}`);
      }
      return process.exit(0);
    }
    if (p?.status === "failed" || p?.status === "error") return console.log("failed:", p?.error);
  }
  console.log("timed out");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
