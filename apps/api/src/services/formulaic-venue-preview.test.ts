import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FORMULAIC_VENUE_PREVIEW } from "./formulaic-venue-preview-contract.ts";
import {
  assessVenuePreviewPoints,
  venuePreviewPointFromRow,
} from "./formulaic-venue-preview.ts";
import type {
  FormulaFeature,
  FormulaPoint,
} from "./formulaic-fixed-horizon-poc.ts";

const featureFrame = (index: number): Record<FormulaFeature, number> => ({
  chainlinkReturn60s: Math.sin(index * 0.17),
  chainlinkReturn300s: Math.cos(index * 0.031),
  hlReturn60s: Math.sin(index * 0.13 + 0.4),
  hlReturn300s: Math.cos(index * 0.047 - 0.2),
  basisBps: 2.5 + Math.sin(index * 0.11),
  basisChange60sBps: Math.cos(index * 0.23),
  basisPersistence5s: 0.2 + (index % 5) / 5,
});
function previewPoints(count = 1_900): FormulaPoint[] {
  const startAtMs = 1_900_000_000_000;
  return Array.from({ length: count }, (_, index) => {
    const atMs = startAtMs + index * 60_000;
    const driver =
      -0.7 * Math.sin(index * 0.17)
      - 0.3 * Math.sin(index * 0.13 + 0.4);
    return {
      pair: "BTC-USD",
      atMs,
      labelEndAtMs:
        atMs + FORMULAIC_VENUE_PREVIEW.target.holdSeconds * 1_000,
      entryUnderlyingPrice: 100,
      exitUnderlyingPrice: 100 * Math.exp(driver * 0.0002),
      features: featureFrame(index),
    };
  });
}

test("venue preview freezes five predeclared trials before the immutable data cut", () => {
  assert.equal(
    FORMULAIC_VENUE_PREVIEW.registeredAtMs,
    FORMULAIC_VENUE_PREVIEW.dataEndExclusiveMs,
  );
  assert.equal(FORMULAIC_VENUE_PREVIEW.status, "retrospective-exploratory");
  assert.deepEqual(FORMULAIC_VENUE_PREVIEW.trials, [
    "cl-1m-momentum-short:z0.5",
    "hl-1m-momentum-short:z0.5",
    "dual-1m-momentum-short:z0.5",
    "positive-basis-short:z0.5",
    "basis-widening-short:z0.5",
  ]);
  assert.equal(FORMULAIC_VENUE_PREVIEW.target.holdSeconds, 600);
  assert.equal(FORMULAIC_VENUE_PREVIEW.target.roundTripCostBps, 10);
  assert.equal(FORMULAIC_VENUE_PREVIEW.disclosure.rankingAllowed, false);
  assert.equal(
    FORMULAIC_VENUE_PREVIEW.disclosure.polymarketVerdictEligible,
    false,
  );
});

test("venue row mapping requires an exact ten-minute label and all seven features", () => {
  const row = {
    pair: "BTC-USD",
    at_ms: 1_900_000_000_000,
    label_end_at_ms: 1_900_000_600_000,
    entry_price: 100,
    exit_price: 99,
    chainlink_return_60s: 1,
    chainlink_return_300s: 2,
    hl_return_60s: 3,
    hl_return_300s: 4,
    basis_bps: 5,
    basis_change_60s_bps: 6,
    basis_persistence_5s: 0.8,
  };
  const point = venuePreviewPointFromRow(row);
  assert.equal(point?.pair, "BTC-USD");
  assert.equal(point?.labelEndAtMs - point!.atMs, 600_000);
  assert.equal(point?.features.basisPersistence5s, 0.8);
  assert.equal(
    venuePreviewPointFromRow({ ...row, label_end_at_ms: row.at_ms + 599_000 }),
    null,
  );
  assert.equal(
    venuePreviewPointFromRow({ ...row, hl_return_300s: Number.NaN }),
    null,
  );
});

test("every frozen trial is assessed independently with prior-fold normalization", () => {
  const results = assessVenuePreviewPoints(previewPoints());
  const btc = results.filter((result) => result.pair === "BTC-USD");
  assert.equal(btc.length, FORMULAIC_VENUE_PREVIEW.trials.length);
  assert.deepEqual(
    btc.map((result) => result.candidateId),
    [...FORMULAIC_VENUE_PREVIEW.trials],
  );
  assert.ok(btc.every((result) => result.available));
  assert.ok(btc.every((result) =>
    result.folds === FORMULAIC_VENUE_PREVIEW.assessment.folds));
  assert.ok(btc.every((result) => result.trades > 0));
  assert.ok(btc.every((result) => result.foldResults.every(
    (fold) => fold.trainPoints
      >= FORMULAIC_VENUE_PREVIEW.assessment.minimumTrainPoints,
  )));
});

test("venue preview is a bounded read-only tape query with no verdict or execution path", () => {
  const source = readFileSync(
    new URL("./formulaic-venue-preview.ts", import.meta.url),
    "utf8",
  );
  const routerSource = readFileSync(
    new URL("../routers/formula-lab.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /from\s+["']@framework\/db["']/);
  assert.match(source, /from venue_price_snapshot/);
  assert.match(source, /createAsyncTtlCache/);
  assert.doesNotMatch(
    source,
    /\b(?:paperTrades|paper_trade|resolvedUp|pnlUsd|placeOrder|submitOrder|privateKey)\b/,
  );
  assert.doesNotMatch(source, /\bdb\.(?:insert|update|delete|transaction)\b/);
  assert.match(
    routerSource,
    /venuePreview:\s*protectedProcedure\.query\(\(\)\s*=>\s*formulaicVenuePreview\(\)\)/,
  );
  assert.doesNotMatch(routerSource, /\.(?:mutation|subscription)\s*\(/);
});
