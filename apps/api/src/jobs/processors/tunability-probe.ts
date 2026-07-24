import type { Job } from "bullmq";
import { and, eq, isNull } from "drizzle-orm";
import { db, strategies, backtestRuns, jesterCredentials } from "@framework/db";
import { connection } from "../queue.ts";
import { publishEvent } from "../../sse.ts";
import { probeAndStoreTunability } from "../../services/tunability.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PER_TICK = 3;

/**
 * Probe a few strategies' tunability per tick, prioritising ones that have actually been backtested
 * (so we can probe on a cell where they trade). Uses the async backtest path, so it's not
 * rate-limited. Once every strategy has a verdict this is a cheap no-op.
 *
 * We fetch a pool and pick from it randomly in JS (rather than ORDER BY random() in SQL) so a
 * handful of persistently-failing strategies can't wedge the queue — and so we avoid Postgres's
 * "SELECT DISTINCT / ORDER BY expressions must appear in the select list" rule.
 */
export async function tunabilityProbeProcessor(_job: Job): Promise<void> {
  const [cred] = await db.select({ userId: jesterCredentials.userId }).from(jesterCredentials).limit(1);
  if (!cred) return;

  // Prefer unprobed strategies that have a default backtest (so probeAndStore can use a real cell).
  // GROUP BY dedupes the innerJoin's multiple rows per strategy without SELECT DISTINCT.
  let pool = await db
    .select({ id: strategies.id })
    .from(strategies)
    .innerJoin(backtestRuns, eq(backtestRuns.strategyId, strategies.id))
    .where(and(isNull(strategies.tunable), eq(backtestRuns.paramHash, "default")))
    .groupBy(strategies.id)
    .limit(40);
  if (pool.length === 0) {
    pool = await db.select({ id: strategies.id }).from(strategies).where(isNull(strategies.tunable)).limit(40);
  }
  if (pool.length === 0) return;

  const pending = pool
    .map((r) => r.id)
    .sort(() => Math.random() - 0.5)
    .slice(0, PER_TICK);

  for (let i = 0; i < pending.length; i++) {
    try {
      const verdict = await probeAndStoreTunability(cred.userId, pending[i]);
      await publishEvent(connection, "tunability.probed", { strategyId: pending[i], tunable: verdict });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // PERMANENT failures must not retry forever: virtual/program strategies (triad_rotation,
      // any_profitable_30d, prog_crucible_*) have no backtestable instance — "StrategyFactory
      // returned null" every time. Left unstamped, the 60s scheduler burned thousands of Jester
      // calls/day re-probing them (the 2026-07-22 rate-limit incident). Stamp tunable=false and move on.
      if (/StrategyFactory returned null|VIRTUAL_|not backtestable/i.test(msg)) {
        await db.update(strategies).set({ tunable: false, tunableCheckedAt: new Date() }).where(eq(strategies.id, pending[i]));
        console.warn(`[tunability] ${pending[i]} permanently unprobeable (virtual/program) — stamped tunable=false`);
      } else {
        console.error(`[tunability] ${pending[i]} failed:`, msg);
      }
    }
    if (i < pending.length - 1) await sleep(3000);
  }
}
