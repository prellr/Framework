/**
 * Preregistered empirical k-nearest-neighbor digital pricer.
 * KB: updown-empirical-knn-pricer-v1. PAPER ONLY.
 *
 * Training rows are forward-captured states whose outcomes were already known at decision time. The
 * pure estimator keeps only one nearest observation per historical market, preventing a 60-minute
 * market's repeated snapshots from masquerading as many independent examples.
 */
import { and, eq, isNotNull, lte } from "drizzle-orm";
import { db, polymarketStateSnapshots } from "@framework/db";
import type { EmpiricalTrainingRow } from "./empirical-pricer-model.ts";

/** Snapshot the eligible training tape once per paper-floor tick; callers reuse it across markets. */
export async function loadEmpiricalTraining(decisionMs: number): Promise<EmpiricalTrainingRow[]> {
  const rows = await db
    .select({
      conditionId: polymarketStateSnapshots.conditionId,
      zDistance: polymarketStateSnapshots.zDistance,
      remainingSec: polymarketStateSnapshots.remainingSec,
      resolvedUp: polymarketStateSnapshots.resolvedUp,
    })
    .from(polymarketStateSnapshots)
    .where(and(
      eq(polymarketStateSnapshots.labelStatus, "resolved"),
      eq(polymarketStateSnapshots.referenceSource, "chainlink"),
      isNotNull(polymarketStateSnapshots.zDistance),
      isNotNull(polymarketStateSnapshots.resolvedUp),
      isNotNull(polymarketStateSnapshots.labeledAt),
      lte(polymarketStateSnapshots.labeledAt, new Date(decisionMs)),
    ));
  return rows.map((row) => ({
    conditionId: row.conditionId,
    zDistance: row.zDistance!,
    remainingSec: row.remainingSec,
    resolvedUp: row.resolvedUp!,
  }));
}
