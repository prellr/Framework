/**
 * Operational liveness for the general Paper Floor worker lane.
 *
 * A paper decision is not a heartbeat: eligible markets arrive on five-minute boundaries and a
 * healthy strategy may abstain for hours. The worker therefore writes this tiny Redis record at the
 * start and end of every general one-minute tick. It contains no market, strategy, direction, book,
 * outcome, grade, P&L, credential, wallet, or execution data.
 */
import IORedis from "ioredis";

export const PAPER_FLOOR_RUNTIME_HEARTBEAT = {
  version: "paper-floor-runtime-heartbeat-v1",
  redisKey: "alchemy:paper-floor:runtime-heartbeat:v1",
  staleAfterMs: 150_000,
  maxFutureSkewMs: 5_000,
  ttlMs: 24 * 60 * 60_000,
  readTimeoutMs: 500,
} as const;

export type PaperFloorRuntimeStatus = "running" | "ok" | "error" | "disabled";

export interface PaperFloorRuntimeHeartbeat {
  version: typeof PAPER_FLOOR_RUNTIME_HEARTBEAT.version;
  lane: "general";
  status: PaperFloorRuntimeStatus;
  startedAtMs: number;
  observedAtMs: number;
}

export interface PaperFloorRuntimeView extends PaperFloorRuntimeHeartbeat {
  source: "runtime";
  ageSec: number;
  fresh: boolean;
}

type RedisStringClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "PX", ttlMs: number): Promise<unknown>;
};

let runtimeReadClient: IORedis | null = null;

function defaultRuntimeReadClient(): IORedis {
  if (!runtimeReadClient) {
    runtimeReadClient = new IORedis(
      process.env.REDIS_URL ?? "redis://localhost:6379",
      {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: PAPER_FLOOR_RUNTIME_HEARTBEAT.readTimeoutMs,
      },
    );
    // The read is optional operational telemetry. Avoid an unhandled emitter when Redis is down;
    // readPaperFloorRuntimeHeartbeat still fails closed to null.
    runtimeReadClient.on("error", () => {});
  }
  return runtimeReadClient;
}

async function defaultRuntimeRead(): Promise<string | null> {
  const redis = defaultRuntimeReadClient();
  if (redis.status === "wait") await redis.connect();
  return redis.get(PAPER_FLOOR_RUNTIME_HEARTBEAT.redisKey);
}

const finiteTimestamp = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

export function parsePaperFloorRuntimeHeartbeat(
  raw: string | null,
): PaperFloorRuntimeHeartbeat | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PaperFloorRuntimeHeartbeat>;
    if (
      value.version !== PAPER_FLOOR_RUNTIME_HEARTBEAT.version
      || value.lane !== "general"
      || !["running", "ok", "error", "disabled"].includes(value.status ?? "")
      || !finiteTimestamp(value.startedAtMs)
      || !finiteTimestamp(value.observedAtMs)
      || value.observedAtMs < value.startedAtMs
    ) return null;
    return value as PaperFloorRuntimeHeartbeat;
  } catch {
    return null;
  }
}

export async function recordPaperFloorRuntimeHeartbeat(
  redis: RedisStringClient,
  input: Omit<PaperFloorRuntimeHeartbeat, "version" | "lane">,
): Promise<void> {
  const payload: PaperFloorRuntimeHeartbeat = {
    version: PAPER_FLOOR_RUNTIME_HEARTBEAT.version,
    lane: "general",
    ...input,
  };
  await redis.set(
    PAPER_FLOOR_RUNTIME_HEARTBEAT.redisKey,
    JSON.stringify(payload),
    "PX",
    PAPER_FLOOR_RUNTIME_HEARTBEAT.ttlMs,
  );
}

export async function readPaperFloorRuntimeHeartbeat(
  redis?: RedisStringClient,
  nowMs = Date.now(),
): Promise<PaperFloorRuntimeView | null> {
  if (!finiteTimestamp(nowMs)) return null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const raw = await Promise.race([
      redis
        ? redis.get(PAPER_FLOOR_RUNTIME_HEARTBEAT.redisKey)
        : defaultRuntimeRead(),
      new Promise<null>((resolve) => {
        timer = setTimeout(
          () => resolve(null),
          PAPER_FLOOR_RUNTIME_HEARTBEAT.readTimeoutMs,
        );
      }),
    ]);
    const heartbeat = parsePaperFloorRuntimeHeartbeat(raw);
    if (!heartbeat) return null;
    if (
      heartbeat.startedAtMs > nowMs + PAPER_FLOOR_RUNTIME_HEARTBEAT.maxFutureSkewMs
      || heartbeat.observedAtMs > nowMs + PAPER_FLOOR_RUNTIME_HEARTBEAT.maxFutureSkewMs
    ) return null;
    const ageMs = Math.max(0, nowMs - heartbeat.observedAtMs);
    return {
      ...heartbeat,
      source: "runtime",
      ageSec: ageMs / 1_000,
      fresh: ageMs <= PAPER_FLOOR_RUNTIME_HEARTBEAT.staleAfterMs,
    };
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
