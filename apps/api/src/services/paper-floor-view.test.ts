import assert from "node:assert/strict";
import test from "node:test";
import { projectPaperFloorView } from "./paper-floor-view.ts";

const scope = (label: string) => ({
  bots: [{ key: label }],
  equity: [{ t: 1, bot: label, raw: 1, profitStress: 0 }],
  segments: {
    pairs: ["BTC-USD"],
    horizons: [5],
    byPair: [{ bot: label }],
    byHorizon: [{ bot: label }],
  },
  combos: [{ botKey: label }],
  assetTape: [{ pair: "BTC-USD" }],
  dailyLedger: { version: "v1", rows: [{ botKey: label }] },
  total: 1,
  feed: [{ bot: label }],
  label,
  fromMs: 1,
  authoritative: label === "forward",
});

const state = {
  accounting: { version: "accounting" },
  gate: { version: "pooled" },
  timeframeGate: { version: "timeframe" },
  macroDirectionGate: { version: "macro" },
  familywiseGate: { version: "familywise" },
  macroDirectionCoverage: { version: "coverage" },
  macroLeader: { version: "leader" },
  engineRuntime: { version: "runtime", status: "ok", fresh: true },
  enabled: true,
  scopes: {
    paper: scope("paper"),
    forward: scope("forward"),
    history: scope("history"),
  },
} as any;

test("scoreboard view selects one scope and strips hidden floor-only collections", () => {
  const view = projectPaperFloorView(state, { scope: "history", view: "scoreboard" });

  assert.equal(view.scope.label, "history");
  assert.deepEqual(view.scope.equity, []);
  assert.deepEqual(view.scope.feed, []);
  assert.deepEqual(view.scope.combos, []);
  assert.deepEqual(view.scope.segments, {
    pairs: [],
    horizons: [],
    byPair: [],
    byHorizon: [],
  });
  assert.equal(view.scope.assetTape.length, 1);
  assert.equal(view.scope.dailyLedger.rows.length, 1);
  assert.equal(view.familywiseGate.version, "familywise");
  assert.equal(view.engineRuntime.status, "ok");
  assert.equal(view.paperLedgerStartMs, 1);
  assert.equal("scopes" in view, false);
});

test("floor view retains only the selected scope's complete interactive data", () => {
  const view = projectPaperFloorView(state, { scope: "paper", view: "floor" });

  assert.equal(view.scope.label, "paper");
  assert.equal(view.scope.equity[0]?.bot, "paper");
  assert.equal(view.scope.feed[0]?.bot, "paper");
  assert.equal(view.scope.combos[0]?.botKey, "paper");
  assert.equal(view.scope.segments.byPair[0]?.bot, "paper");
  assert.equal(JSON.stringify(view).includes("forward"), false);
  assert.equal(JSON.stringify(view).includes("history"), false);
});

test("registry view returns roster and gates without ledger or chart payloads", () => {
  const view = projectPaperFloorView(state, { scope: "forward", view: "registry" });

  assert.equal(view.scope.bots[0]?.key, "forward");
  assert.deepEqual(view.scope.dailyLedger.rows, []);
  assert.deepEqual(view.scope.assetTape, []);
  assert.deepEqual(view.scope.equity, []);
  assert.deepEqual(view.scope.feed, []);
});
