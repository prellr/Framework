import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPaperMarkout,
  PAPER_MARKOUT_AUDIT,
  type MarkoutBooks,
  type PaperMarkoutRow,
} from "./paper-markout-model.ts";

const START = PAPER_MARKOUT_AUDIT.evalStartMs;
const BOOKS: MarkoutBooks = {
  up: { bestBid: 0.56, bestAsk: 0.58, mid: 0.57 },
  down: { bestBid: 0.42, bestAsk: 0.44, mid: 0.43 },
};
const row = (side: "up" | "down" = "up"): PaperMarkoutRow => ({
  side,
  askPaid: side === "up" ? 0.55 : 0.45,
  decidedAtMs: START,
  modelMeta: {
    bookMicrostructure: {
      up: { mid: 0.54 },
      down: { mid: 0.46 },
    },
  },
});

test("markout audit constants preserve the prospective boundary and fixed horizon", () => {
  assert.equal(PAPER_MARKOUT_AUDIT.evalStartMs, Date.parse("2026-07-23T09:30:00.000Z"));
  assert.equal(PAPER_MARKOUT_AUDIT.targetDelaySec, 30);
  assert.equal(PAPER_MARKOUT_AUDIT.maxDelaySec, 75);
});

test("markout waits until target and captures the actual selected side", () => {
  assert.equal(buildPaperMarkout(row(), BOOKS, START + 29_999), null);
  assert.deepEqual(buildPaperMarkout(row(), BOOKS, START + 35_000), {
    version: "paper-fill-markout-audit-v1",
    status: "captured",
    reason: null,
    targetDelaySec: 30,
    delaySec: 35,
    capturedAtMs: START + 35_000,
    initialSideMid: 0.54,
    sideBestBid: 0.56,
    sideMid: 0.57,
    midDelta: 0.029999999999999916,
    roundTripPerContract: 0.010000000000000009,
  });
  const down = buildPaperMarkout(row("down"), BOOKS, START + 35_000);
  assert.equal(down?.sideBestBid, 0.42);
  assert.equal(down?.sideMid, 0.43);
  assert.ok(Math.abs((down?.midDelta ?? 0) + 0.03) < 1e-12);
});

test("markout permanently labels stale or incoherent observations", () => {
  const stale = buildPaperMarkout(row(), BOOKS, START + 75_001);
  assert.equal(stale?.status, "stale");
  assert.equal(stale?.reason, "capture-delay-exceeded");
  assert.equal(stale?.sideMid, null);

  const oneSided: MarkoutBooks = { ...BOOKS, down: { bestBid: null, bestAsk: null, mid: null } };
  const unavailable = buildPaperMarkout(row(), oneSided, START + 35_000, "incoherent-book");
  assert.equal(unavailable?.status, "unavailable");
  assert.equal(unavailable?.reason, "incoherent-book");
  assert.equal(unavailable?.roundTripPerContract, null);
});
