/**
 * Read-only Crucible observatory backed exclusively by Jester's mirrored strategy catalog and the
 * local backtest warehouse. It makes no outbound Jester call and exposes no work-spawning action.
 */
import { inArray, or, eq, like } from "drizzle-orm";
import { backtestRuns, db, strategies } from "@framework/db";
import { dedupedRuns } from "./warehouse.ts";
import { buildCrucibleObservatory } from "./crucible-observatory-model.ts";

export async function crucibleObservatory() {
  const programs = await db
    .select({
      id: strategies.id,
      name: strategies.name,
      tier: strategies.tier,
      category: strategies.category,
      nativeTimeframe: strategies.nativeTimeframe,
      description: strategies.description,
      refreshedAt: strategies.refreshedAt,
    })
    .from(strategies)
    .where(or(
      like(strategies.id, "prog_crucible_%"),
      eq(strategies.category, "CRUCIBLE_PROGRAM"),
    ));
  const ids = programs.map((program) => program.id);
  const runs = ids.length
    ? await dedupedRuns(inArray(backtestRuns.strategyId, ids), 10_000)
    : [];
  return buildCrucibleObservatory(programs, runs);
}
