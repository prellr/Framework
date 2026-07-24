/**
 * One-shot batch: probe tunability for every strategy that hasn't been probed yet.
 * The probe runs on Jester's async backtest path (not rate-limited), so we run a small pool
 * concurrently. The repeatable tunability-probe job keeps things fresh afterward; this just
 * fills the backlog quickly instead of trickling 3/minute.
 *
 *   docker compose exec -d api pnpm --filter @framework/api exec tsx src/scripts/probe-all-tunability.ts
 */
import { isNull } from "drizzle-orm";
import { db, strategies, jesterCredentials } from "@framework/db";
import { probeAndStoreTunability } from "../services/tunability.ts";

const POOL = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const [cred] = await db.select({ userId: jesterCredentials.userId }).from(jesterCredentials).limit(1);
  if (!cred) {
    console.error("[probe-all] no jester credential — cannot probe");
    process.exit(1);
  }

  const pending = await db.select({ id: strategies.id }).from(strategies).where(isNull(strategies.tunable));
  console.log(`[probe-all] ${pending.length} strategies to probe (pool ${POOL})`);

  let done = 0;
  let tunable = 0;
  let fixed = 0;
  const queue = [...pending];

  async function worker(n: number) {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) await sleep(5000); // back off on transient Jester rate-limit / 502
        try {
          const v = await probeAndStoreTunability(cred.userId, item.id);
          if (v === true) tunable++;
          else if (v === false) fixed++;
          done++;
          console.log(`[probe-all:${n}] ${item.id} -> ${v} (${done}/${pending.length}, tunable=${tunable} fixed=${fixed})`);
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (lastErr) {
        done++;
        console.error(`[probe-all:${n}] ${item.id} FAILED:`, lastErr instanceof Error ? lastErr.message : lastErr);
      }
      await sleep(500); // gentle pacing between probes per worker
    }
  }

  await Promise.all(Array.from({ length: POOL }, (_, i) => worker(i)));
  console.log(`[probe-all] complete: ${done} probed, ${tunable} tunable, ${fixed} fixed`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[probe-all] fatal:", err);
  process.exit(1);
});
