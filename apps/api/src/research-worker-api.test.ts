import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createResearchWorkerApp } from "./research-worker-api.ts";

test("research worker gateway fails closed without its distinct secret", async () => {
  const previous = process.env.RESEARCH_WORKER_API_KEY;
  delete process.env.RESEARCH_WORKER_API_KEY;
  try {
    const response = await createResearchWorkerApp().request(
      "http://localhost/api/research-worker/protocol",
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "research worker gateway is disabled",
    });
  } finally {
    if (previous != null) process.env.RESEARCH_WORKER_API_KEY = previous;
  }
});

test("research worker gateway rejects the application agent key", async () => {
  const previousWorker = process.env.RESEARCH_WORKER_API_KEY;
  const previousAgent = process.env.AGENT_API_KEY;
  process.env.RESEARCH_WORKER_API_KEY = "worker-secret-that-is-at-least-32-bytes";
  process.env.AGENT_API_KEY = "agent-secret-that-is-at-least-32-bytes";
  try {
    const response = await createResearchWorkerApp().request(
      "http://localhost/api/research-worker/protocol",
      { headers: { "X-Research-Worker-Key": process.env.AGENT_API_KEY } },
    );
    assert.equal(response.status, 401);
  } finally {
    if (previousWorker == null) delete process.env.RESEARCH_WORKER_API_KEY;
    else process.env.RESEARCH_WORKER_API_KEY = previousWorker;
    if (previousAgent == null) delete process.env.AGENT_API_KEY;
    else process.env.AGENT_API_KEY = previousAgent;
  }
});

test("research worker protocol is versioned and explicitly non-executing", async () => {
  const previous = process.env.RESEARCH_WORKER_API_KEY;
  process.env.RESEARCH_WORKER_API_KEY = "worker-secret-that-is-at-least-32-bytes";
  try {
    const response = await createResearchWorkerApp().request(
      "http://localhost/api/research-worker/protocol",
      {
        headers: {
          "X-Research-Worker-Key": process.env.RESEARCH_WORKER_API_KEY,
        },
      },
    );
    assert.equal(response.status, 200);
    const body = await response.json() as {
      protocolVersion: string;
      transport: string;
      executionCapable: boolean;
      schemas: Record<string, unknown>;
    };
    assert.equal(body.protocolVersion, "alchemy-research-v2");
    assert.equal(body.transport, "pull-lease");
    assert.equal(body.executionCapable, false);
    assert.ok(body.schemas.datasetManifest);
    assert.ok(body.schemas.shardJob);
    assert.ok(body.schemas.shardResult);
  } finally {
    if (previous == null) delete process.env.RESEARCH_WORKER_API_KEY;
    else process.env.RESEARCH_WORKER_API_KEY = previous;
  }
});

test("gateway source contains no application, venue, or trade authorization fallback", () => {
  const source = readFileSync(
    new URL("./research-worker-api.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /RESEARCH_WORKER_API_KEY/);
  assert.doesNotMatch(source, /getSetting\(\s*["']AGENT_API_KEY/);
  assert.doesNotMatch(
    source,
    /\b(?:tradeProcedure|placeOrder|submitOrder|privateKey|jesterCredential)\b/,
  );
});
