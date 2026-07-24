import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PAPER_FLOOR_RUNTIME_HEARTBEAT,
  parsePaperFloorRuntimeHeartbeat,
  readPaperFloorRuntimeHeartbeat,
  recordPaperFloorRuntimeHeartbeat,
} from "./paper-floor-runtime-heartbeat.ts";

class MemoryRedis {
  value: string | null = null;

  async get() {
    return this.value;
  }

  async set(_key: string, value: string) {
    this.value = value;
    return "OK";
  }
}

test("runtime heartbeat round-trips without strategy or market evidence", async () => {
  const redis = new MemoryRedis();
  await recordPaperFloorRuntimeHeartbeat(redis, {
    status: "ok",
    startedAtMs: 1_000,
    observedAtMs: 1_250,
  });
  const raw = redis.value;
  assert.ok(raw);
  assert.doesNotMatch(raw, /market|strategy|side|price|outcome|pnl|wallet|order/i);

  const view = await readPaperFloorRuntimeHeartbeat(redis, 2_250);
  assert.equal(view?.status, "ok");
  assert.equal(view?.ageSec, 1);
  assert.equal(view?.fresh, true);
});

test("runtime heartbeat becomes stale independently of the last paper decision", async () => {
  const redis = new MemoryRedis();
  await recordPaperFloorRuntimeHeartbeat(redis, {
    status: "running",
    startedAtMs: 5_000,
    observedAtMs: 5_000,
  });
  const view = await readPaperFloorRuntimeHeartbeat(
    redis,
    5_000 + PAPER_FLOOR_RUNTIME_HEARTBEAT.staleAfterMs + 1,
  );
  assert.equal(view?.fresh, false);
  assert.equal(view?.status, "running");
});

test("runtime heartbeat rejects malformed, future-inconsistent, or unknown records", () => {
  assert.equal(parsePaperFloorRuntimeHeartbeat(null), null);
  assert.equal(parsePaperFloorRuntimeHeartbeat("{"), null);
  assert.equal(parsePaperFloorRuntimeHeartbeat(JSON.stringify({
    version: PAPER_FLOOR_RUNTIME_HEARTBEAT.version,
    lane: "general",
    status: "unknown",
    startedAtMs: 1,
    observedAtMs: 2,
  })), null);
  assert.equal(parsePaperFloorRuntimeHeartbeat(JSON.stringify({
    version: PAPER_FLOOR_RUNTIME_HEARTBEAT.version,
    lane: "general",
    status: "ok",
    startedAtMs: 3,
    observedAtMs: 2,
  })), null);
});

test("runtime heartbeat fails closed on implausible future worker clocks", async () => {
  const redis = new MemoryRedis();
  await recordPaperFloorRuntimeHeartbeat(redis, {
    status: "ok",
    startedAtMs: 20_000,
    observedAtMs: 20_000,
  });
  assert.equal(await readPaperFloorRuntimeHeartbeat(redis, 10_000), null);
});

test("the general lane records every state while the peak lane cannot overwrite liveness", () => {
  const source = readFileSync(
    new URL("../jobs/processors/paper-floor-tick.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /if \(peakLane\) return/);
  for (const status of ["running", "ok", "error", "disabled"]) {
    assert.match(source, new RegExp(`recordRuntime\\("${status}"\\)`));
  }
  assert.match(source, /Operational telemetry must never block or alter the paper collector/);
});
