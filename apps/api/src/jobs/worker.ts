import { setDefaultResultOrder } from "node:dns";
// Containers often have no IPv6 route; prefer IPv4 so outbound calls to hosts
// that publish AAAA records don't fail with ENETUNREACH.
setDefaultResultOrder("ipv4first");

import { Worker, type WorkerOptions } from "bullmq";
import { connection, registerJobs } from "./queue.ts";
import { heartbeatProcessor } from "./processors/heartbeat.ts";
import { runSweepProcessor } from "./processors/run-sweep.ts";
import { backtestCellProcessor } from "./processors/backtest-cell.ts";
import { rescreenProcessor } from "./processors/rescreen.ts";
import { paramCodeBackfillProcessor } from "./processors/param-code-backfill.ts";
import { tunabilityProbeProcessor } from "./processors/tunability-probe.ts";
import { paramPeriodTrackProcessor } from "./processors/param-period-track.ts";
import { fillsSyncProcessor } from "./processors/fills-sync.ts";
import { coverageScanProcessor } from "./processors/coverage-scan.ts";
import { tesseractLogProcessor } from "./processors/tesseract-log.ts";
import { polymarketUpdownCollectProcessor } from "./processors/polymarket-updown-collect.ts";
import { polymarketBookCaptureProcessor } from "./processors/polymarket-book-capture.ts";
import { signalGaugeLogProcessor } from "./processors/signal-gauge-log.ts";
import { paperFloorTickProcessor } from "./processors/paper-floor-tick.ts";
import { signalV1LogProcessor } from "./processors/signal-v1-log.ts";
import { tesseractLogFocusProcessor } from "./processors/tesseract-log-focus.ts";
import { polymarketStateTapeProcessor } from "./processors/polymarket-state-tape.ts";
import { deribitSkewCaptureProcessor } from "./processors/deribit-skew-capture.ts";
import { paperMarkoutCaptureProcessor } from "./processors/paper-markout-capture.ts";

/**
 * Shared worker defaults — applied to every queue so behavior is consistent.
 *
 * lockDuration / stalledInterval / maxStalledCount work together to recover
 * from orphaned jobs: when the DB crashes (or a processor hangs longer than
 * the lock TTL) the lock in Redis expires, the stalled-check claims the job
 * back, and after maxStalledCount strikes it's moved to "failed" so the
 * queue resumes instead of looping forever.
 *
 * removeOnComplete / removeOnFail keep Redis from accumulating job history
 * forever — a few hundred per queue is enough to debug yesterday's run.
 */
const workerDefaults: Partial<WorkerOptions> = {
  lockDuration: 30_000,
  stalledInterval: 30_000,
  maxStalledCount: 2,
  removeOnComplete: { count: 100, age: 24 * 3600 },
  removeOnFail: { count: 200, age: 7 * 24 * 3600 },
};

/**
 * Create a Worker with shared defaults + an error listener so BullMQ-internal
 * failures (lock renewal, redis hiccups) surface in the log with the queue
 * name attached, not as anonymous stack traces.
 */
function makeWorker<T = unknown>(
  queueName: string,
  processor: ConstructorParameters<typeof Worker<T>>[1],
  overrides: Partial<WorkerOptions> = {},
): Worker<T> {
  const w = new Worker<T>(queueName, processor, {
    connection,
    ...workerDefaults,
    ...overrides,
  });
  w.on("error", (err) => {
    console.error(`[worker:${queueName}] ${err.message}`);
  });
  return w;
}

async function start() {
  await registerJobs();

  // Persistent Chainlink price feed (Polymarket RTDS) — the resolution source for the pricer bots.
  // Six per-symbol WebSockets live in this worker; the floor tick reads their in-memory buffers.
  const { startRtds } = await import("../services/rtds.ts");
  startRtds();
  // Independent public Hyperliquid BBO stream + paired one-second research tape. Observational only;
  // a lead/lag strategy cannot be added until its constants are separately preregistered.
  const { startVenueLeadLagTape } = await import("../services/venue-lead-lag-tape.ts");
  await startVenueLeadLagTape();
  // Public Polymarket trade stream reconciled to finalized official V2 OrdersMatched receipts.
  // Outcome-blind collection only; no directional rule or order-capable method exists in this path.
  const { startAuthoritativeTradeFlowTape } = await import("../services/polymarket-trade-flow-tape.ts");
  await startAuthoritativeTradeFlowTape();

  makeWorker("heartbeat", heartbeatProcessor);

  // Sweep orchestration. run-sweep just fans out (cheap). backtest-cell does the real
  // work: bounded concurrency + a rate limiter so we respect Jester's backtest throttle.
  // The shared warehouse + dedup means many cells resolve to cache hits and never call out.
  makeWorker("run-sweep", runSweepProcessor, { concurrency: 2 });
  // Cells run on Jester's async /backtests queue (runCell mode "fast"), which is built for
  // concurrency — the reference harness fans out ~5 at once. So we run several cells in parallel
  // with a rate limiter that respects Jester's backtest throttle. Cache hits cost nothing, and
  // fresh cells no longer bottleneck one-at-a-time the way the synchronous MCP path did.
  // Concurrency 3 (was 5): Jester caps queued backtests per account (QUEUE_FULL). runCell now waits
  // out QUEUE_FULL as backpressure, but keeping fewer in flight means less thrash. Cache hits are
  // free regardless, so this only slows genuinely-fresh fan-outs.
  makeWorker("backtest-cell", backtestCellProcessor, {
    concurrency: 3,
    limiter: { max: 3, duration: 1000 },
  });

  // Rescreen is pure warehouse reads (no Jester calls) — cheap, runs on the daily schedule.
  makeWorker("rescreen", rescreenProcessor);

  // Param-code backfill trickles through the rate-limited sync tool — one job at a time.
  makeWorker("param-code-backfill", paramCodeBackfillProcessor, { concurrency: 1 });

  // Tunability probing — async backtests, one job at a time (each probes a few strategies).
  makeWorker("tunability-probe", tunabilityProbeProcessor, { concurrency: 1 });

  // Param-period tracking — one cheap Jester read per tick.
  makeWorker("param-period-track", paramPeriodTrackProcessor, { concurrency: 1 });

  // Fills sync — pull each wallet's Hyperliquid fill tail into the warehouse. One at a time; the
  // cold-start backfill pages through history, steady state is a cheap tail fetch.
  makeWorker("fills-sync", fillsSyncProcessor, { concurrency: 1 });

  // Coverage engine — fills a few stale matrix cells per tick when armed (else instant no-op).
  makeWorker("coverage-scan", coverageScanProcessor, { concurrency: 1 });

  // Tesseract Field logger — snapshot + label the live microstructure Field (build #1). One at a
  // time; batches its reads internally to respect Jester's throttle.
  makeWorker("tesseract-log", tesseractLogProcessor, { concurrency: 1 });
  // Faster 5m focus logger (BTC-USD by default) — same processor family, tighter cadence.
  makeWorker("tesseract-log-focus", tesseractLogFocusProcessor, { concurrency: 1 });

  // Polymarket Up/Down collector — score resolved BTC/ETH markets vs Tesseract (Phase 1).
  makeWorker("polymarket-updown-collect", polymarketUpdownCollectProcessor, { concurrency: 1 });
  makeWorker("polymarket-book-capture", polymarketBookCaptureProcessor, { concurrency: 1 });
  makeWorker("polymarket-state-tape", polymarketStateTapeProcessor, { concurrency: 1 });
  makeWorker("deribit-skew-capture", deribitSkewCaptureProcessor, { concurrency: 1 });
  makeWorker("signal-gauge-log", signalGaugeLogProcessor, { concurrency: 1 });
  makeWorker("paper-floor-tick", paperFloorTickProcessor, { concurrency: 1 });
  makeWorker("paper-markout-capture", paperMarkoutCaptureProcessor, { concurrency: 1 });
  makeWorker("signal-v1-log", signalV1LogProcessor, { concurrency: 1 });

  console.log("[worker] BullMQ workers started");
}

start().catch((err) => {
  console.error("[worker] Failed to start:", err);
  process.exit(1);
});
