import assert from "node:assert/strict";
import test from "node:test";
import { resolveV1PollState } from "./signal-v1-source-health.ts";

test("V1 source polling stops only for a confirmed unsubscribe", () => {
  assert.deepEqual(resolveV1PollState(null, false), {
    subscribed: false,
    shouldPoll: false,
  });
  assert.deepEqual(resolveV1PollState(true, false), {
    subscribed: false,
    shouldPoll: false,
  });
});

test("V1 source polling survives unknown subscription audits", () => {
  assert.deepEqual(resolveV1PollState(null, null), {
    subscribed: null,
    shouldPoll: true,
  });
  assert.deepEqual(resolveV1PollState(true, null), {
    subscribed: true,
    shouldPoll: true,
  });
  assert.deepEqual(resolveV1PollState(false, null), {
    subscribed: false,
    shouldPoll: false,
  });
});
