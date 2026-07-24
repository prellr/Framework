import { setDefaultResultOrder } from "node:dns";
// Containers often have no IPv6 route; prefer IPv4 so outbound calls to hosts
// that publish AAAA records don't fail with ENETUNREACH.
setDefaultResultOrder("ipv4first");

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { bodyLimit } from "hono/body-limit";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { auth } from "./auth.ts";
import { appRouter } from "./trpc/router.ts";
import { createContext } from "./trpc/context.ts";
import { createSseApp } from "./sse.ts";
import { createMcpApp } from "./mcp/server.ts";
import { createResearchWorkerApp } from "./research-worker-api.ts";

const app = new Hono();

// ── Middleware ──────────────────────────────────────────────────────────────
app.use("*", logger());

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
];

app.use(
  "*",
  cors({
    origin: allowedOrigins,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", "X-API-Key"],
  }),
);

// ── Health check ────────────────────────────────────────────────────────────
app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

// ── Better Auth ─────────────────────────────────────────────────────────────
// Mount custom /api/auth/* routes (e.g. OAuth callbacks) BEFORE this line —
// app.all("/api/auth/*") swallows them and returns 404 otherwise.
app.all("/api/auth/*", (c) => auth.handler(c.req.raw));

// ── SSE (real-time events via Redis pub/sub) ───────────────────────────────
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
app.route("/", createSseApp(redisUrl));

// ── MCP server (agent access to the warehouse; analysis-only) ──────────────
app.route("/", createMcpApp());

// ── Research worker gateway (separate credential; paper-only leases) ────────
app.route("/", createResearchWorkerApp());

// ── tRPC ────────────────────────────────────────────────────────────────────
app.use("/api/trpc/*", bodyLimit({ maxSize: 20 * 1024 * 1024 }));
app.all("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext: () => createContext(c),
  });
});

// ── Start ───────────────────────────────────────────────────────────────────
const port = Number(process.env.PORT ?? 3001);
console.log(`API starting on port ${port}`);

serve({ fetch: app.fetch, port });
