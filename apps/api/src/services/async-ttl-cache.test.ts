import assert from "node:assert/strict";
import test from "node:test";
import { createAsyncTtlCache } from "./async-ttl-cache.ts";

test("async TTL cache coalesces concurrent cumulative reads and expires normally", async () => {
  let atMs = 1_000;
  let calls = 0;
  let release!: (value: number) => void;
  const loader = () => {
    calls++;
    return new Promise<number>((resolve) => {
      release = resolve;
    });
  };
  const read = createAsyncTtlCache(500, loader, () => atMs);

  const first = read();
  const concurrent = read();
  assert.equal(calls, 1);
  release(7);
  assert.deepEqual(await Promise.all([first, concurrent]), [7, 7]);

  assert.equal(await read(), 7);
  assert.equal(calls, 1);

  atMs = 1_500;
  const expired = read();
  assert.equal(calls, 2);
  release(9);
  assert.equal(await expired, 9);
});

test("async TTL cache never caches a failed load", async () => {
  let calls = 0;
  const read = createAsyncTtlCache(500, async () => {
    calls++;
    if (calls === 1) throw new Error("transient");
    return 11;
  });
  await assert.rejects(read(), /transient/);
  assert.equal(await read(), 11);
  assert.equal(calls, 2);
});
