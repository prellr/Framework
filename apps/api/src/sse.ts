/**
 * Server-Sent Events endpoint
 *
 * GET /api/sse  — authenticated clients subscribe here for real-time updates.
 * The worker (or API) publishes JSON messages to the Redis "app:events"
 * channel via publishEvent(); each connected SSE client forwards them to
 * the browser.
 *
 * Nginx config must have `proxy_buffering off` for this path (already set).
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import IORedis from "ioredis";
import { auth } from "./auth.ts";

const SSE_CHANNEL = "app:events";

/** Publish an event to all connected SSE clients (call from jobs or routers). */
export async function publishEvent(
  redis: IORedis,
  type: string,
  payload: unknown,
): Promise<void> {
  await redis.publish(
    SSE_CHANNEL,
    JSON.stringify({ type, payload, timestamp: new Date().toISOString() }),
  );
}

export function createSseApp(redisUrl: string) {
  const app = new Hono();

  app.get("/api/sse", async (c) => {
    // Auth check
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    return streamSSE(c, async (stream) => {
      // Each connected client gets its own subscriber connection
      const subscriber = new IORedis(redisUrl, { maxRetriesPerRequest: null });

      // Clean up when client disconnects
      stream.onAbort(async () => {
        subscriber.unsubscribe(SSE_CHANNEL);
        subscriber.disconnect();
      });

      // Send a heartbeat every 30s to keep the connection alive through proxies
      const heartbeat = setInterval(async () => {
        await stream.writeSSE({ event: "ping", data: "" });
      }, 30_000);

      stream.onAbort(() => clearInterval(heartbeat));

      await subscriber.subscribe(SSE_CHANNEL);

      // Forward Redis messages to the SSE stream
      subscriber.on("message", async (_channel, message) => {
        try {
          const parsed = JSON.parse(message) as {
            type: string;
            payload: unknown;
            timestamp: string;
          };
          await stream.writeSSE({
            event: parsed.type,
            data: JSON.stringify(parsed.payload),
            id: parsed.timestamp,
          });
        } catch {
          // ignore malformed messages
        }
      });

      // Block until client disconnects (stream.onAbort fires)
      await new Promise<void>((resolve) => stream.onAbort(resolve));
    });
  });

  return app;
}
