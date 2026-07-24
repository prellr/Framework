import type { Job } from "bullmq";
import { eq, sql } from "drizzle-orm";
import { db, sweeps, sweepCells } from "@framework/db";
import { connection, type BacktestCellJob } from "../queue.ts";
import { publishEvent } from "../../sse.ts";
import { runCell } from "../../services/backtest.ts";

/**
 * Run one sweep cell: resolve it to a backtest_run (cache hit or fresh), update the cell,
 * advance the sweep's progress, and stream both over SSE. Rate limiting + concurrency are
 * applied at the worker level (see worker.ts) so we don't hammer Jester.
 */
export async function backtestCellProcessor(job: Job<BacktestCellJob>): Promise<void> {
  const { sweepId, cellId, userId, strategyId, pair, timeframe, days, parameters, paramLabel } = job.data;

  // Honor cancellation — skip work if the sweep was canceled.
  const [sweep] = await db.select().from(sweeps).where(eq(sweeps.id, sweepId)).limit(1);
  if (!sweep || sweep.status === "canceled") return;

  await db.update(sweepCells).set({ status: "running" }).where(eq(sweepCells.id, cellId));

  try {
    // Sweeps use the async queue ("fast") so cells can run concurrently; the Jester param
    // code is fetched on demand later (results.fetchCode) rather than inline per cell.
    const { source, run } = await runCell(
      { strategyId, pair, timeframe, days, parameters },
      { userId, mode: "fast" },
    );
    await db
      .update(sweepCells)
      .set({ status: source === "cache" ? "cache_hit" : "done", backtestRunId: run.id })
      .where(eq(sweepCells.id, cellId));
    await publishEvent(connection, "sweep.cell", {
      sweepId,
      cellId,
      source,
      strategyId,
      pair,
      timeframe,
      paramLabel,
      backtestRunId: run.id,
      jesterParamCode: run.jesterParamCode,
      metrics: {
        returnPct: run.totalReturn,
        trades: run.totalTrades,
        winRate: run.winRate,
        maxDrawdown: run.maxDrawdown,
        profitFactor: run.profitFactor,
        spanDays: run.spanDays,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(sweepCells).set({ status: "failed", error: message }).where(eq(sweepCells.id, cellId));
    await publishEvent(connection, "sweep.cell", { sweepId, cellId, strategyId, pair, timeframe, error: message });
  }

  // Advance progress atomically; finalize the sweep when the last cell lands.
  const [updated] = await db
    .update(sweeps)
    .set({ doneCells: sql`${sweeps.doneCells} + 1` })
    .where(eq(sweeps.id, sweepId))
    .returning({ doneCells: sweeps.doneCells, totalCells: sweeps.totalCells });

  await publishEvent(connection, "sweep.progress", {
    sweepId,
    done: updated.doneCells,
    total: updated.totalCells,
  });

  if (updated.doneCells >= updated.totalCells) {
    await db.update(sweeps).set({ status: "done" }).where(eq(sweeps.id, sweepId));
    await publishEvent(connection, "sweep.finished", { sweepId, status: "done" });
  }
}
