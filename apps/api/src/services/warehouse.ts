import { desc, getTableColumns, sql, type SQL } from "drizzle-orm";
import { db, backtestRuns } from "@framework/db";

/**
 * The RESULT SIGNATURE — cell + metrics. Two warehouse rows with the same signature are the same
 * result, even when their paramHash differs: a grid run against a strategy that ignores parameter
 * overrides writes N rows with distinct hashes but byte-identical metrics. Deduping on paramHash
 * left those as N "unique" rows, flooding tables and letting one result occupy N ranking slots.
 */
const SIGNATURE = [
  backtestRuns.strategyId,
  backtestRuns.pair,
  backtestRuns.timeframe,
  backtestRuns.daysRequested,
  backtestRuns.totalReturn,
  backtestRuns.totalTrades,
  backtestRuns.profitFactor,
  backtestRuns.maxDrawdown,
];

/**
 * Warehouse rows deduplicated on the result signature, newest row per group, each carrying a
 * `variants` count of how many collapsed into it (so "these params had no effect" stays visible
 * rather than silently hidden).
 *
 * Postgres evaluates window functions BEFORE DISTINCT, so `count(*) over (partition by …)` sees the
 * full group and the surviving row reports the true total. DISTINCT ON requires the ORDER BY to lead
 * with its expressions, hence the outer query to restore newest-first ordering for callers.
 */
export function dedupedRuns(where?: SQL, limit?: number) {
  const partition = sql`partition by ${sql.join(SIGNATURE, sql`, `)}`;
  const sub = db
    .selectDistinctOn(SIGNATURE, {
      ...getTableColumns(backtestRuns),
      variants: sql<number>`count(*) over (${partition})::int`.as("variants"),
    })
    .from(backtestRuns)
    .where(where)
    .orderBy(...SIGNATURE, desc(backtestRuns.ranAt))
    .as("sub");

  const q = db.select().from(sub).orderBy(desc(sub.ranAt));
  return limit != null ? q.limit(limit) : q;
}
