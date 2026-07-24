import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SMOOTH_PATH_CAUSAL_DISPLACEMENT,
  SMOOTH_PATH_DISPLACEMENT,
} from "./smooth-path-displacement.ts";
import { summarizeSmoothPathFunnel } from "./smooth-path-funnel-report.ts";
import { SMOOTH_PATH_QUALITY_TAPE } from "./smooth-path-quality-tape.ts";

test("Smooth Path funnel report preserves both versions and every zero-activity asset bucket", () => {
  const report = summarizeSmoothPathFunnel([], [], [], SMOOTH_PATH_CAUSAL_DISPLACEMENT.evalStartMs);

  assert.equal(report.paperOnly, true);
  assert.equal(report.outcomeBlind, true);
  assert.equal(report.scheduled, true);
  assert.equal(report.totalRows, 0);
  assert.equal(report.rowCapPerFiveMinutes, 12);
  assert.equal(report.qualityTape.version, "updown-smooth-path-quality-tape-v1");
  assert.equal(report.qualityTape.scheduled, true);
  assert.equal(report.qualityTape.allVersionsReadyForThresholdDesign, false);
  assert.deepEqual(
    report.versions.map((version) => version.version),
    [
      SMOOTH_PATH_DISPLACEMENT.version,
      SMOOTH_PATH_CAUSAL_DISPLACEMENT.version,
    ],
  );
  for (const version of report.versions) {
    assert.deepEqual(
      version.pairs.map((pair) => pair.pair),
      ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD", "BNB-USD"],
    );
    assert.ok(version.pairs.every((pair) => pair.eligibleRows === 0));
  }
});

test("Smooth Path funnel report keeps causal and source-time evidence independent", () => {
  const capturedAt = new Date(SMOOTH_PATH_CAUSAL_DISPLACEMENT.evalStartMs + 7 * 60_000);
  const report = summarizeSmoothPathFunnel(
    [
      {
        version: SMOOTH_PATH_DISPLACEMENT.version,
        botKey: "smoothPathDisplacement",
        eligibleRows: 6,
        observedRows: 5,
        pathQualifiedRows: 2,
        bookQualifiedRows: 1,
        placedRows: 1,
        firstWindow: new Date(SMOOTH_PATH_CAUSAL_DISPLACEMENT.evalStartMs),
        lastWindow: new Date(SMOOTH_PATH_CAUSAL_DISPLACEMENT.evalStartMs),
        lastCapturedAt: capturedAt,
        qualityMetricRows: 6,
        absDisplacementP10: 0.0002,
        absDisplacementP50: 0.0006,
        absDisplacementP90: 0.0012,
        pathR2P10: 0.1,
        pathR2P50: 0.4,
        pathR2P90: 0.8,
        pathEfficiencyP10: 0.05,
        pathEfficiencyP50: 0.2,
        pathEfficiencyP90: 0.6,
        continuationSlopeP10: -0.00001,
        continuationSlopeP50: 0.00001,
        continuationSlopeP90: 0.00003,
        continuationFreshP10: -0.0002,
        continuationFreshP50: 0.00005,
        continuationFreshP90: 0.0003,
      },
      {
        version: SMOOTH_PATH_CAUSAL_DISPLACEMENT.version,
        botKey: "smoothPathCausalDisplacement",
        eligibleRows: 6,
        observedRows: 4,
        pathQualifiedRows: 1,
        bookQualifiedRows: 0,
        placedRows: 0,
        firstWindow: new Date(SMOOTH_PATH_CAUSAL_DISPLACEMENT.evalStartMs),
        lastWindow: new Date(SMOOTH_PATH_CAUSAL_DISPLACEMENT.evalStartMs),
        lastCapturedAt: capturedAt,
      },
    ],
    [
      {
        version: SMOOTH_PATH_DISPLACEMENT.version,
        pair: "BTC-USD",
        eligibleRows: 1,
        observedRows: 1,
        pathQualifiedRows: 1,
        bookQualifiedRows: 1,
        placedRows: 1,
      },
      {
        version: SMOOTH_PATH_CAUSAL_DISPLACEMENT.version,
        pair: "BTC-USD",
        eligibleRows: 1,
        observedRows: 1,
        pathQualifiedRows: 0,
        bookQualifiedRows: 0,
        placedRows: 0,
      },
    ],
    [
      {
        version: SMOOTH_PATH_CAUSAL_DISPLACEMENT.version,
        reason: "receive-after-observation",
        count: 2,
      },
      {
        version: SMOOTH_PATH_DISPLACEMENT.version,
        reason: "book-edge-or-chase",
        count: 1,
      },
    ],
    capturedAt.getTime() + 60_000,
  );

  assert.equal(report.collectionFresh, true);
  assert.equal(report.totalRows, 12);
  assert.equal(report.versions[0]?.placedRows, 1);
  assert.equal(report.versions[1]?.placedRows, 0);
  assert.equal(report.versions[0]?.pairs[0]?.placedRows, 1);
  assert.equal(report.versions[1]?.pairs[0]?.placedRows, 0);
  assert.equal(report.versions[0]?.quality.readyForThresholdDesign, false);
  assert.deepEqual(report.versions[0]?.quality.pathEfficiency, {
    p10: null,
    p50: null,
    p90: null,
  });
  assert.deepEqual(report.versions[1]?.quality.pathEfficiency, {
    p10: null,
    p50: null,
    p90: null,
  });
  assert.deepEqual(report.versions[1]?.rejections, [
    { reason: "receive-after-observation", count: 2 },
  ]);
});

test("Smooth Path funnel freshness fails closed after the post-boundary grace window", () => {
  const report = summarizeSmoothPathFunnel(
    [],
    [],
    [],
    SMOOTH_PATH_CAUSAL_DISPLACEMENT.evalStartMs + 5 * 60_000,
  );

  assert.equal(report.scheduled, false);
  assert.equal(report.collectionFresh, false);
});

test("Smooth Path quality quantiles exclude every pre-boundary smoke row", () => {
  const source = readFileSync(new URL("./smooth-path-funnel-report.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /const qualityEligible = sql`\\?\$\{polymarketSmoothPathFunnel\.windowStart\} >= \\?\$\{qualityBoundary\}`/,
  );
  assert.match(
    source,
    /qualityMetricRows:[\s\S]*?filter \(where \\?\$\{qualityComplete\}\)/,
  );
  assert.match(
    source,
    /percentile_cont\(0\.50\)[\s\S]*?filter \(where \\?\$\{qualityEligible\}/,
  );
});

test("Smooth Path quality quantiles unlock only after every frozen floor", () => {
  const boundary = new Date(SMOOTH_PATH_QUALITY_TAPE.evalStartMs);
  const end = new Date(
    SMOOTH_PATH_QUALITY_TAPE.evalStartMs
      + SMOOTH_PATH_QUALITY_TAPE.minSpanDays * 86_400_000,
  );
  const report = summarizeSmoothPathFunnel(
    [{
      version: SMOOTH_PATH_DISPLACEMENT.version,
      botKey: "smoothPathDisplacement",
      eligibleRows: 5_000,
      observedRows: 5_000,
      pathQualifiedRows: 0,
      bookQualifiedRows: 0,
      placedRows: 0,
      firstWindow: boundary,
      lastWindow: end,
      lastCapturedAt: end,
      qualityEligibleRows: 5_000,
      qualityMetricRows: 5_000,
      qualityFirstWindow: boundary,
      qualityLastWindow: end,
      pathEfficiencyP10: 0.05,
      pathEfficiencyP50: 0.2,
      pathEfficiencyP90: 0.6,
    }],
    SMOOTH_PATH_DISPLACEMENT.pairs.map((pair) => ({
      version: SMOOTH_PATH_DISPLACEMENT.version,
      pair,
      eligibleRows: 834,
      observedRows: 834,
      pathQualifiedRows: 0,
      bookQualifiedRows: 0,
      placedRows: 0,
      qualityMetricRows: 800,
    })),
    [],
    end.getTime(),
  );

  assert.equal(report.versions[0]?.quality.readyForThresholdDesign, true);
  assert.deepEqual(report.versions[0]?.quality.pathEfficiency, {
    p10: 0.05,
    p50: 0.2,
    p90: 0.6,
  });
  assert.equal(report.qualityTape.allVersionsReadyForThresholdDesign, false);
});
