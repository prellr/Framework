import assert from "node:assert/strict";
import test from "node:test";
import {
  RESEARCH_JSON_SCHEMAS,
  RESEARCH_PROTOCOL_VERSION,
  assertDatasetManifest,
  assertResearchCapitalPolicy,
  assertResearchBoundary,
  type ResearchDatasetManifest,
} from "./index.ts";

const hash = `sha256:${"a".repeat(64)}`;

function manifest(): ResearchDatasetManifest {
  return {
    protocolVersion: RESEARCH_PROTOCOL_VERSION,
    datasetId: "paired-venue-minute-v1",
    datasetVersion: "1",
    contentHash: hash,
    artifact: {
      contentHash: hash,
      uri: "s3://alchemy-research/datasets/paired-venue-minute-v1.parquet",
      format: "parquet",
      schemaVersion: "paired-venue-minute-v1",
    },
    rowCount: 100_000,
    assets: ["BTC-USD", "SOL-USD"],
    eventStart: "2026-07-01T00:00:00.000Z",
    eventEnd: "2026-07-20T00:00:00.000Z",
    frozenAt: "2026-07-20T00:01:00.000Z",
    availabilityClock: "receive_clock",
    columns: [
      {
        name: "received_at",
        dataType: "timestamp_ms",
        role: "receive_clock",
        nullable: false,
      },
      {
        name: "basis_bps",
        dataType: "float64",
        role: "feature",
        nullable: false,
      },
    ],
    boundary: {
      discoveryStart: "2026-07-01T00:00:00.000Z",
      discoveryEnd: "2026-07-15T00:00:00.000Z",
      embargoMs: 600_000,
      validationStart: "2026-07-15T00:10:00.000Z",
      validationEnd: "2026-07-20T00:00:00.000Z",
    },
    labelSpec: { kind: "fixed-horizon-return", horizonMs: 600_000 },
    sourceSpecs: [{ id: "chainlink" }, { id: "hyperliquid" }],
    targetSpecs: [{ id: "hyperliquid-short-10m" }],
  };
}

test("dataset manifest accepts a causal receive-clock boundary", () => {
  assert.doesNotThrow(() => assertDatasetManifest(manifest()));
});

test("dataset manifest rejects a validation boundary inside the embargo", () => {
  const value = manifest();
  value.boundary.validationStart = "2026-07-15T00:09:59.999Z";
  assert.throws(() => assertDatasetManifest(value), /embargo/);
});

test("dataset manifest rejects event-only datasets without an availability clock", () => {
  const value = manifest();
  value.columns = value.columns.filter((column) => column.role !== "receive_clock");
  assert.throws(() => assertDatasetManifest(value), /receive_clock/);
});

test("standalone discovery boundaries remain legal before a candidate is frozen", () => {
  assert.doesNotThrow(() =>
    assertResearchBoundary({
      discoveryStart: "2026-07-01T00:00:00.000Z",
      discoveryEnd: "2026-07-15T00:00:00.000Z",
      embargoMs: 600_000,
    })
  );
});

test("wire schemas remain closed and versioned for non-JS workers", () => {
  assert.equal(RESEARCH_JSON_SCHEMAS.datasetManifest.additionalProperties, false);
  assert.equal(
    RESEARCH_JSON_SCHEMAS.shardJob.properties.protocolVersion.const,
    RESEARCH_PROTOCOL_VERSION,
  );
  assert.equal(RESEARCH_JSON_SCHEMAS.shardResult.additionalProperties, false);
  assert.equal(
    RESEARCH_JSON_SCHEMAS.shardJob.properties.capitalPolicy.additionalProperties,
    false,
  );
  assert.equal(
    RESEARCH_JSON_SCHEMAS.shardResult.properties.inlineResults.maxItems,
    500,
  );
});

test("capital policy rejects unsafe fractions, caps, and liquidation floors", () => {
  const valid = {
    startingCapitalUsd: 10_000,
    sizingMode: "equity-fraction-risk" as const,
    sizingValue: 0.01,
    compound: true,
    maxGrossExposureFraction: 1,
    maxConcurrentPositions: 6,
    minNotionalUsd: 5,
    maxNotionalUsd: 1_000,
    liquidationFloorUsd: 0,
  };
  assert.doesNotThrow(() => assertResearchCapitalPolicy(valid));
  assert.throws(
    () => assertResearchCapitalPolicy({ ...valid, sizingValue: 1.01 }),
    /sizing/,
  );
  assert.throws(
    () => assertResearchCapitalPolicy({
      ...valid,
      liquidationFloorUsd: valid.startingCapitalUsd,
    }),
    /liquidation/,
  );
});
