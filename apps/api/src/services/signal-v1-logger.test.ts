import assert from "node:assert/strict";
import test from "node:test";
import {
  parseV1SignalSourceHealth,
  resolveV1PollState,
  V1_SIGNAL_SOURCE_HEALTH,
  v1SignalSourceHealthFromIngest,
} from "./signal-v1-source-health.ts";

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

test("V1 source health records only bounded operational state", () => {
  const health = v1SignalSourceHealthFromIngest({
    written: 0,
    unsided: 0,
    credentialPresent: true,
    subscriptionChecked: true,
    subscribed: false,
    notificationOk: false,
    notificationSkipped: true,
    historyChecks: 0,
    historySucceeded: 0,
  }, 123_000);

  assert.deepEqual(health, {
    version: V1_SIGNAL_SOURCE_HEALTH.version,
    status: "unsubscribed",
    observedAtMs: 123_000,
    subscriptionChecked: true,
    notifications: "skipped",
    historyChecks: 0,
    historySucceeded: 0,
    written: 0,
    unsided: 0,
  });
  assert.deepEqual(parseV1SignalSourceHealth(JSON.stringify(health)), health);
});

test("V1 source health rejects malformed or internally inconsistent receipts", () => {
  assert.equal(parseV1SignalSourceHealth(undefined), null);
  assert.equal(parseV1SignalSourceHealth("{"), null);
  assert.equal(parseV1SignalSourceHealth(JSON.stringify({
    version: V1_SIGNAL_SOURCE_HEALTH.version,
    status: "subscribed",
    observedAtMs: 123_000,
    subscriptionChecked: true,
    notifications: "ok",
    historyChecks: 1,
    historySucceeded: 2,
    written: 0,
    unsided: 0,
  })), null);
});
