import { Queue } from "bullmq";
import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

export const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
});

// One Queue per job type. Add yours here and register a repeat schedule below.
export const heartbeatQueue = new Queue("heartbeat", { connection });

export async function registerJobs() {
  // Repeatable jobs — upserted on every worker start so they survive restarts.
  // Use { every: ms } for intervals or { pattern: "0 3 * * *", tz: "..." } for cron.
  await heartbeatQueue.upsertJobScheduler(
    "heartbeat-repeatable",
    { every: 300_000 }, // every 5 minutes
    { name: "beat" },
  );
}
