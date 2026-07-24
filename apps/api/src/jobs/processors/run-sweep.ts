import type { Job } from "bullmq";
import { eq } from "drizzle-orm";
import { db, sweeps, sweepCells } from "@framework/db";
import { cellQueue, connection, type RunSweepJob } from "../queue.ts";
import { publishEvent } from "../../sse.ts";

const MAX_DAYS = 100_000; // "max" window → request everything; Jester clamps to available history

interface Matrix {
  strategies: string[];
  assets: string[];
  timeframes: string[];
  windows: (number | "max")[];
}

/**
 * Expand a sweep's matrix into sweep_cells and fan out one backtest-cell job per cell.
 * The cell jobs run concurrently (bounded by the worker's concurrency + rate limiter).
 */
export async function runSweepProcessor(job: Job<RunSweepJob>): Promise<void> {
  const [sweep] = await db.select().from(sweeps).where(eq(sweeps.id, job.data.sweepId)).limit(1);
  if (!sweep || sweep.status === "canceled") return;

  const m = sweep.matrix as Matrix;
  const cells: { strategyId: string; pair: string; timeframe: string; days: number }[] = [];
  for (const strategyId of m.strategies)
    for (const pair of m.assets)
      for (const timeframe of m.timeframes)
        for (const w of m.windows)
          cells.push({ strategyId, pair, timeframe, days: w === "max" ? MAX_DAYS : w });

  // Persist the cells, then enqueue a job for each.
  const inserted = await db
    .insert(sweepCells)
    .values(cells.map((c) => ({ sweepId: sweep.id, ...c, status: "pending" as const })))
    .returning({ id: sweepCells.id, strategyId: sweepCells.strategyId, pair: sweepCells.pair, timeframe: sweepCells.timeframe, days: sweepCells.days });

  await db
    .update(sweeps)
    .set({ totalCells: inserted.length, status: "running" })
    .where(eq(sweeps.id, sweep.id));
  await publishEvent(connection, "sweep.progress", {
    sweepId: sweep.id,
    done: 0,
    total: inserted.length,
  });

  for (const cell of inserted) {
    await cellQueue.add("cell", {
      sweepId: sweep.id,
      cellId: cell.id,
      userId: sweep.userId,
      strategyId: cell.strategyId,
      pair: cell.pair,
      timeframe: cell.timeframe,
      days: cell.days,
    });
  }
}
