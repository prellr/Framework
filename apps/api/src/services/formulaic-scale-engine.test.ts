import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import type {
  FormulaFeature,
  FormulaPoint,
} from "./formulaic-fixed-horizon-poc.ts";
import {
  evaluateFormulaValidation,
  evaluateFormulaShard,
  FORMULAIC_SCALE_ENGINE,
  freezeFormulaValidationSelection,
  generateFormulaVariantManifest,
  inspectFormulaVariant,
  planFormulaExperiment,
} from "./formulaic-scale-engine.ts";

function featureFrame(index: number): Record<FormulaFeature, number> {
  return {
    chainlinkReturn60s: Math.sin(index * 0.17),
    chainlinkReturn300s: Math.cos(index * 0.031),
    hlReturn60s: Math.sin(index * 0.13 + 0.4),
    hlReturn300s: Math.cos(index * 0.047 - 0.2),
    basisBps: 2.5 + Math.sin(index * 0.11),
    basisChange60sBps: Math.cos(index * 0.23),
    basisPersistence5s: 0.2 + (index % 5) / 5,
  };
}

function syntheticPoints(count = 480): FormulaPoint[] {
  const startAtMs = 1_900_000_000_000;
  return Array.from({ length: count }, (_, index) => {
    const atMs = startAtMs + index * 60_000;
    const frame = featureFrame(index);
    const futureMove =
      0.65 * frame.hlReturn60s
      + 0.25 * frame.chainlinkReturn60s
      + 0.1 * frame.basisChange60sBps;
    return {
      pair: "BTC-USD",
      atMs,
      labelEndAtMs: atMs + 600_000,
      entryUnderlyingPrice: 100,
      exitUnderlyingPrice: 100 * Math.exp(futureMove * 0.00025),
      features: frame,
    };
  });
}

test("10k generator is exact, deterministic, unique, and grammar bounded", () => {
  const first = generateFormulaVariantManifest({
    seed: "mechanics-v1",
    variantCount: 10_000,
  });
  const second = generateFormulaVariantManifest({
    seed: "mechanics-v1",
    variantCount: 10_000,
  });
  assert.equal(first.variantCount, 10_000);
  assert.equal(first.candidates.length, 10_000);
  assert.equal(
    new Set(first.candidates.map((candidate) => candidate.id)).size,
    10_000,
  );
  assert.equal(first.candidateManifestHash, second.candidateManifestHash);
  assert.deepEqual(
    first.candidates.map((candidate) => candidate.id),
    second.candidates.map((candidate) => candidate.id),
  );
  for (const candidate of first.candidates) {
    const inspected = inspectFormulaVariant(candidate);
    assert.ok(
      inspected.complexity
        <= FORMULAIC_SCALE_ENGINE.maximumVariants,
    );
    assert.ok(inspected.complexity <= 7);
    assert.ok(inspected.depth <= 3);
  }
  const differentSeed = generateFormulaVariantManifest({
    seed: "mechanics-v2",
    variantCount: 10_000,
  });
  assert.notEqual(
    first.candidateManifestHash,
    differentSeed.candidateManifestHash,
  );
});

test("experiment planner shards every candidate-target unit exactly once", () => {
  const manifest = generateFormulaVariantManifest({
    seed: "shard-test",
    variantCount: 10_000,
  });
  const createdAtMs = 1_900_000_100_000;
  const targets = ["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB"].map((asset) => ({
    key: `${asset}-USD:hyperliquid-10m`,
    adapter: "hyperliquid-mid-fixed-horizon",
    pair: `${asset}-USD`,
    holdSeconds: 600,
    roundTripCostBps: 10,
  }));
  const plan = planFormulaExperiment({
    manifest,
    targets,
    createdAtMs,
    dataEndExclusiveMs: createdAtMs - 1,
    shardSize: 250,
  });
  assert.equal(plan.variantCount, 10_000);
  assert.equal(plan.targetCount, 6);
  assert.equal(plan.evaluationUnitCount, 60_000);
  assert.equal(plan.shardCount, 240);
  assert.equal(plan.family.discoveryTrials, 60_000);
  assert.equal(
    plan.family.expectedFalsePositivesAtNominalFivePercent,
    3_000,
  );
  for (const target of targets) {
    const shards = plan.shards.filter((shard) => shard.targetKey === target.key);
    assert.equal(shards.length, 40);
    assert.equal(
      shards.reduce((sum, shard) => sum + shard.candidateCount, 0),
      10_000,
    );
    assert.deepEqual(
      shards.map((shard) => [
        shard.candidateStart,
        shard.candidateEndExclusive,
      ]),
      Array.from({ length: 40 }, (_, index) => [
        index * 250,
        (index + 1) * 250,
      ]),
    );
  }
});

test("shard evaluation is deterministic and keeps every variation independent", () => {
  const manifest = generateFormulaVariantManifest({
    seed: "assessment-test",
    variantCount: 500,
  });
  const candidates = manifest.candidates.slice(0, 250);
  const config = {
    holdMs: 600_000,
    roundTripCostBps: 10,
    minimumTrades: 10,
    complexityPenaltyBps: 0.01,
    familySize: 3_000,
  };
  const first = evaluateFormulaShard({
    targetKey: "BTC-USD:hl-10m",
    points: syntheticPoints(),
    candidates,
    config,
  });
  const second = evaluateFormulaShard({
    targetKey: "BTC-USD:hl-10m",
    points: syntheticPoints(),
    candidates,
    config,
  });
  assert.equal(first.candidatesEvaluated, 250);
  assert.equal(first.formulaPointEvaluations, 250 * 480);
  assert.equal(first.results.length, 250);
  assert.equal(
    new Set(first.results.map((result) => result.candidateId)).size,
    250,
  );
  assert.deepEqual(first, second);
  assert.ok(first.results.some((result) => result.eligible));
  assert.equal(first.bonferroniAlpha, 0.05 / 3_000);
});

test("discovery selection freezes definitions behind a new validation boundary", () => {
  const manifest = generateFormulaVariantManifest({
    seed: "selection-test",
    variantCount: 500,
  });
  const createdAtMs = 1_900_000_100_000;
  const target = {
    key: "BTC-USD:hl-10m",
    adapter: "hyperliquid-mid-fixed-horizon",
    pair: "BTC-USD",
    holdSeconds: 600,
    roundTripCostBps: 10,
  };
  const experiment = planFormulaExperiment({
    manifest,
    targets: [target],
    createdAtMs,
    dataEndExclusiveMs: createdAtMs - 1,
  });
  const assessed = evaluateFormulaShard({
    targetKey: target.key,
    points: syntheticPoints(),
    candidates: manifest.candidates,
    config: {
      holdMs: 600_000,
      roundTripCostBps: 10,
      minimumTrades: 10,
      complexityPenaltyBps: 0.01,
      familySize: 500,
    },
  });
  const selection = freezeFormulaValidationSelection({
    experiment,
    manifest,
    targetKey: target.key,
    discoveryFeatureCalibration: assessed.featureCalibration,
    discoveryResults: assessed.results,
    topK: 5,
    createdAtMs: createdAtMs + 1,
    forwardBoundaryMs: createdAtMs + 60_000,
  });
  assert.equal(selection.selected.length, 5);
  assert.equal(selection.validationFamilySize, 5);
  assert.equal(selection.correction, "Holm");
  assert.equal(selection.executionAllowed, false);
  assert.equal(selection.strategyRegistrationAllowed, false);
  assert.ok(selection.selected.every((candidate) => candidate.expression));
  assert.ok(selection.selected.every((candidate) => candidate.outputCalibration.std > 0));
  assert.deepEqual(selection.featureCalibration, assessed.featureCalibration);
  assert.throws(
    () => freezeFormulaValidationSelection({
      experiment,
      manifest,
      targetKey: target.key,
      discoveryFeatureCalibration: assessed.featureCalibration,
      discoveryResults: assessed.results,
      topK: 5,
      createdAtMs: createdAtMs + 1,
      forwardBoundaryMs: createdAtMs + 1,
    }),
    /new future boundary/,
  );
});

test("validation uses frozen discovery calibration, rejects leakage, and applies Holm", () => {
  const manifest = generateFormulaVariantManifest({
    seed: "validation-test",
    variantCount: 500,
  });
  const discoveryPoints = syntheticPoints();
  const lastDiscoveryLabel = discoveryPoints.at(-1)!.labelEndAtMs;
  const createdAtMs = lastDiscoveryLabel + 1;
  const target = {
    key: "BTC-USD:hl-10m",
    adapter: "hyperliquid-mid-fixed-horizon",
    pair: "BTC-USD",
    holdSeconds: 600,
    roundTripCostBps: 1,
  };
  const experiment = planFormulaExperiment({
    manifest,
    targets: [target],
    createdAtMs,
    dataEndExclusiveMs: lastDiscoveryLabel + 1,
  });
  const assessed = evaluateFormulaShard({
    targetKey: target.key,
    points: discoveryPoints,
    candidates: manifest.candidates,
    config: {
      holdMs: 600_000,
      roundTripCostBps: 1,
      minimumTrades: 10,
      complexityPenaltyBps: 0.01,
      familySize: 500,
    },
  });
  const forwardBoundaryMs = createdAtMs + 600_000;
  const selection = freezeFormulaValidationSelection({
    experiment,
    manifest,
    targetKey: target.key,
    discoveryFeatureCalibration: assessed.featureCalibration,
    discoveryResults: assessed.results,
    topK: 5,
    createdAtMs,
    forwardBoundaryMs,
  });
  const validationPoints = syntheticPoints(180).map((point, index) => ({
    ...point,
    atMs: forwardBoundaryMs + index * 60_000,
    labelEndAtMs: forwardBoundaryMs + index * 60_000 + 600_000,
  }));
  const nowMs = validationPoints.at(-1)!.labelEndAtMs;
  const result = evaluateFormulaValidation({
    selection,
    targetKey: target.key,
    points: validationPoints,
    holdMs: 600_000,
    roundTripCostBps: 1,
    minimumTrades: 10,
    nowMs,
  });
  assert.equal(result.validationFamilySize, 5);
  assert.equal(result.correction, "Holm");
  assert.equal(result.executionAllowed, false);
  assert.equal(result.strategyRegistrationAllowed, false);
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.holmRank).sort((a, b) => a - b),
    [1, 2, 3, 4, 5],
  );
  assert.throws(
    () => evaluateFormulaValidation({
      selection,
      targetKey: target.key,
      points: [
        {
          ...validationPoints[0],
          atMs: forwardBoundaryMs - 60_000,
          labelEndAtMs: forwardBoundaryMs + 540_000,
        },
      ],
      holdMs: 600_000,
      roundTripCostBps: 1,
      minimumTrades: 10,
      nowMs,
    }),
    /pre-boundary/,
  );
  assert.throws(
    () => evaluateFormulaValidation({
      selection,
      targetKey: target.key,
      points: validationPoints,
      holdMs: 600_000,
      roundTripCostBps: 1,
      minimumTrades: 10,
      nowMs: nowMs - 1,
    }),
    /unobserved future label/,
  );
  const tampered = structuredClone(selection);
  tampered.featureCalibration.hlReturn60s.mean += 1;
  assert.throws(
    () => evaluateFormulaValidation({
      selection: tampered,
      targetKey: target.key,
      points: validationPoints,
      holdMs: 600_000,
      roundTripCostBps: 1,
      minimumTrades: 10,
      nowMs,
    }),
    /selection hash/,
  );

  const frozenCalibrationBody = {
    ...structuredClone(selection),
    validationFamilySize: 1,
    featureCalibration: {
      ...structuredClone(selection.featureCalibration),
      hlReturn60s: { mean: 1_000, std: 1 },
    },
    selected: [{
      candidateId: "frozen-hl-return",
      expression: {
        op: "feature" as const,
        feature: "hlReturn60s" as const,
      },
      formula: "hlReturn60s",
      thresholdZ: 0,
      complexity: 1,
      discoverySelectionScore: 1,
      outputCalibration: { mean: 0, std: 1 },
    }],
  };
  delete (frozenCalibrationBody as Partial<typeof selection>).selectionHash;
  const frozenCalibrationSelection = {
    ...frozenCalibrationBody,
    selectionHash: createHash("sha256")
      .update(JSON.stringify(frozenCalibrationBody))
      .digest("hex"),
  };
  const frozenResult = evaluateFormulaValidation({
    selection: frozenCalibrationSelection,
    targetKey: target.key,
    points: validationPoints,
    holdMs: 600_000,
    roundTripCostBps: 1,
    minimumTrades: 10,
    nowMs,
  });
  assert.equal(
    frozenResult.candidates[0].trades,
    0,
    "validation must not recenter its feature or output calibration",
  );
});

test("scale engine is pure research mechanics with no persistence or execution path", () => {
  assert.deepEqual(FORMULAIC_SCALE_ENGINE.invariants, {
    materializesSourceOncePerExperiment: true,
    oneCandidateDefinitionPerManifestEntry: true,
    oneResultPerCandidateTargetUnit: true,
    readsPaperOutcomes: false,
    createsStrategy: false,
    createsPaperBot: false,
    startsCrucibleRun: false,
    enablesExecution: false,
    preservesVerdictGate: true,
  });
  const source = readFileSync(
    new URL("./formulaic-scale-engine.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /from\s+["'][^"']*(?:db|router|worker|paper-floor|crucible)/i,
  );
  assert.doesNotMatch(
    source,
    /\b(?:venuePriceSnapshots|paperTrades|placeOrder|submitOrder|privateKey|fetch\s*\(|db\.)/i,
  );
});
