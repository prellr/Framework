import type { Job } from "bullmq";
import { connection } from "../queue.ts";
import { publishEvent } from "../../sse.ts";

/**
 * Example job processor. Replace with real work (polling an API, syncing
 * data, sending digests). Demonstrates publishing an SSE event that any
 * connected browser receives via useSSE({ heartbeat: ... }).
 */
export async function heartbeatProcessor(_job: Job): Promise<void> {
  await publishEvent(connection, "heartbeat", { at: new Date().toISOString() });
}
