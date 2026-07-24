import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  RESEARCH_JSON_SCHEMAS,
  RESEARCH_PROTOCOL_VERSION,
  type ResearchShardResult,
  type ResearchWorkerCapabilities,
} from "@alchemy/research-protocol";
import {
  commitResearchShardResult,
  heartbeatResearchShard,
  leaseResearchShard,
} from "./services/research-control-plane.ts";
import { researchShardResultSchema } from "./research-worker-wire-schema.ts";

const resourceClassSchema = z.enum(["cpu", "memory", "gpu"]);

const capabilitiesSchema = z.object({
  protocolVersion: z.literal(RESEARCH_PROTOCOL_VERSION),
  workerId: z.string().trim().min(1).max(200),
  resourceClasses: z.array(resourceClassSchema).min(1),
  evaluatorVersions: z.array(z.string().min(1)).min(1),
  targetAdapterVersions: z.array(z.string().min(1)).min(1),
  maxCandidateBatch: z.number().int().positive().max(50_000),
}).strict();

const leaseRequestSchema = z.object({
  capabilities: capabilitiesSchema,
  leaseSeconds: z.number().int().min(30).max(900).optional(),
}).strict();

const heartbeatSchema = z.object({
  shardId: z.string().uuid(),
  workerId: z.string().trim().min(1).max(200),
  leaseToken: z.string().min(32).max(200),
  extendSeconds: z.number().int().min(30).max(900).optional(),
}).strict();

const commitSchema = z.object({
  workerId: z.string().trim().min(1).max(200),
  leaseToken: z.string().min(32).max(200),
  result: researchShardResultSchema,
}).strict();

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length
    && timingSafeEqual(leftBytes, rightBytes);
}

function workerApiKey(): string | null {
  const key = process.env.RESEARCH_WORKER_API_KEY?.trim();
  return key && key.length >= 32 ? key : null;
}

/**
 * A deliberately narrow, pull-based gateway for untrusted research compute nodes.
 *
 * It cannot create experiments, register datasets, freeze selections, access application
 * sessions, query market tables, or reach any trading action. A compromised worker can only
 * lease a bounded compatible shard and commit content-hashed research output for that lease.
 */
export function createResearchWorkerApp() {
  const app = new Hono();
  app.use("/api/research-worker/*", bodyLimit({ maxSize: 4 * 1024 * 1024 }));
  app.use("/api/research-worker/*", async (c, next) => {
    const expected = workerApiKey();
    if (!expected) {
      return c.json({ error: "research worker gateway is disabled" }, 503);
    }
    const supplied = c.req.header("X-Research-Worker-Key") ?? "";
    if (!constantTimeEqual(supplied, expected)) {
      return c.json({ error: "unauthorized research worker" }, 401);
    }
    await next();
  });

  app.get("/api/research-worker/protocol", (c) =>
    c.json({
      protocolVersion: RESEARCH_PROTOCOL_VERSION,
      transport: "pull-lease",
      executionCapable: false,
      schemas: RESEARCH_JSON_SCHEMAS,
    })
  );

  app.post("/api/research-worker/lease", async (c) => {
    const parsed = leaseRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "invalid lease request", issues: parsed.error.issues }, 400);
    }
    const leased = await leaseResearchShard(
      parsed.data.capabilities as ResearchWorkerCapabilities,
      parsed.data.leaseSeconds,
    );
    if (!leased) return c.body(null, 204);
    return c.json(leased);
  });

  app.post("/api/research-worker/heartbeat", async (c) => {
    const parsed = heartbeatSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "invalid heartbeat", issues: parsed.error.issues }, 400);
    }
    const heartbeat = await heartbeatResearchShard(parsed.data);
    return c.json({ leaseExpiresAt: heartbeat.leaseExpiresAt.toISOString() });
  });

  app.post("/api/research-worker/result", async (c) => {
    const parsed = commitSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "invalid result", issues: parsed.error.issues }, 400);
    }
    const committed = await commitResearchShardResult({
      workerId: parsed.data.workerId,
      leaseToken: parsed.data.leaseToken,
      result: parsed.data.result as ResearchShardResult,
    });
    return c.json(committed);
  });
  return app;
}
