import assert from "node:assert/strict";
import test from "node:test";
import {
  buildJesterV1PaperBotActivity,
  buildSmoothPathPaperBotActivity,
} from "./paper-bot-activity.ts";
import { V1_SIGNAL_SOURCE_HEALTH } from "./signal-v1-source-health.ts";

test("Jester V1 activity distinguishes an unsubscribe from an empty decision ledger", () => {
  const nowMs = 1_000_000;
  assert.deepEqual(buildJesterV1PaperBotActivity({
    version: V1_SIGNAL_SOURCE_HEALTH.version,
    status: "unsubscribed",
    observedAtMs: nowMs - 30_000,
    subscriptionChecked: true,
    notifications: "skipped",
    historyChecks: 0,
    historySucceeded: 0,
    written: 0,
    unsided: 0,
    ageSec: 30,
    fresh: true,
  }, {
    rows: 0,
    lastSignalAtMs: null,
  }, nowMs), {
    kind: "jester-v1-source",
    status: "unsubscribed",
    fresh: true,
    checkedAgoSec: 30,
    signalRows: 0,
    lastSignalAgoSec: null,
  });
});

test("Jester V1 activity fails visibly stale when the source receipt expires", () => {
  const nowMs = 2_000_000;
  const activity = buildJesterV1PaperBotActivity({
    version: V1_SIGNAL_SOURCE_HEALTH.version,
    status: "subscribed",
    observedAtMs: nowMs - 1_500_000,
    subscriptionChecked: true,
    notifications: "ok",
    historyChecks: 2,
    historySucceeded: 2,
    written: 0,
    unsided: 0,
    ageSec: 1_500,
    fresh: false,
  }, {
    rows: 7,
    lastSignalAtMs: nowMs - 60_000,
  }, nowMs);

  assert.equal(activity.status, "stale");
  assert.equal(activity.signalRows, 7);
  assert.equal(activity.lastSignalAgoSec, 60);
});

test("Smooth Path activity exposes funnel progress without outcomes", () => {
  const nowMs = 5_000_000;
  assert.deepEqual(buildSmoothPathPaperBotActivity({
    eligibleRows: 3_307,
    observedRows: 3_270,
    pathQualifiedRows: 20,
    bookQualifiedRows: 0,
    placedRows: 0,
    lastCapturedAtMs: nowMs - 90_000,
  }, nowMs), {
    kind: "smooth-path-funnel",
    status: "path-qualified",
    fresh: true,
    capturedAgoSec: 90,
    eligibleRows: 3_307,
    observedRows: 3_270,
    pathQualifiedRows: 20,
    bookQualifiedRows: 0,
    placedRows: 0,
  });
});

test("Smooth Path activity distinguishes missing observations and a stale funnel", () => {
  assert.equal(
    buildSmoothPathPaperBotActivity(undefined, 10_000).status,
    "awaiting-observation",
  );
  assert.equal(buildSmoothPathPaperBotActivity({
    eligibleRows: 10,
    observedRows: 10,
    pathQualifiedRows: 0,
    bookQualifiedRows: 0,
    placedRows: 0,
    lastCapturedAtMs: 0,
  }, 1_000_000).status, "stale");
});
