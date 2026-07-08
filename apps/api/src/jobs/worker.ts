import { setDefaultResultOrder } from "node:dns";
// Containers often have no IPv6 route; prefer IPv4 so outbound calls to hosts
// that publish AAAA records don't fail with ENETUNREACH.
setDefaultResultOrder("ipv4first");

import { Worker, type WorkerOptions } from "bullmq";
import { connection, registerJobs } from "./queue.ts";
import { heartbeatProcessor } from "./processors/heartbeat.ts";

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

  makeWorker("heartbeat", heartbeatProcessor);

  console.log("[worker] BullMQ workers started");
}

start().catch((err) => {
  console.error("[worker] Failed to start:", err);
  process.exit(1);
});
