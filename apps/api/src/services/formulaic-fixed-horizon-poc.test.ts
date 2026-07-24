import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FORMULAIC_FIXED_HORIZON_POC } from "./formulaic-fixed-horizon-contract.ts";
import {
  evaluateFormula,
  fixedFormulaCandidates,
  formulaComplexity,
  formulaDepth,
  renderFormula,
  validateFormula,
  walkForwardFormulaAssessment,
  type FormulaCandidate,
  type FormulaFeature,
  type FormulaNode,
  type FormulaPoint,
} from "./formulaic-fixed-horizon-poc.ts";

const feature = (name: FormulaFeature): FormulaNode => ({ op: "feature", feature: name });
const features = (
  hlReturn60s: number,
  chainlinkReturn60s: number,
): Record<FormulaFeature, number> => ({
  chainlinkReturn60s,
  chainlinkReturn300s: Math.sin(chainlinkReturn60s),
  hlReturn60s,
  hlReturn300s: Math.cos(hlReturn60s),
  basisBps: Math.sin(hlReturn60s * 0.7),
  basisChange60sBps: Math.cos(chainlinkReturn60s * 0.5),
  basisPersistence5s: 0.2 + 0.8 * Math.abs(Math.sin(hlReturn60s)),
});

function syntheticPoints(count = 760): FormulaPoint[] {
  const start = 1_800_000_000_000;
  return Array.from({ length: count }, (_, index) => {
    const hidden = Math.sin(index * 0.37) + 0.35 * Math.sin(index * 0.071);
    const distractor = Math.cos(index * 0.19);
    return {
      pair: "BTC-USD",
      atMs: start + index * 60_000,
      labelEndAtMs: start + index * 60_000 + 600_000,
      entryUnderlyingPrice: 100,
      // A negative Hyperliquid feature precedes a decline, so -hlReturn60s is the causal short score.
      exitUnderlyingPrice: 100 * Math.exp(hidden * 0.001),
      features: features(hidden, distractor),
    };
  });
}

const momentumCandidates: FormulaCandidate[] = [
  {
    id: "hl-short",
    expression: { op: "neg", child: feature("hlReturn60s") },
    thresholdZ: 0,
  },
  {
    id: "cl-short",
    expression: { op: "neg", child: feature("chainlinkReturn60s") },
    thresholdZ: 0,
  },
];

const config = {
  holdMs: 600_000,
  folds: 4,
  testPointsPerFold: 100,
  minimumTrainPoints: 300,
  minimumTrainTrades: 12,
  minimumTestTrades: 3,
  roundTripCostBps: 0,
  complexityPenaltyBps: 0.01,
} as const;

test("formula grammar is bounded, readable, and protected against invalid arithmetic", () => {
  const expression: FormulaNode = {
    op: "protectedDiv",
    left: { op: "neg", child: feature("basisBps") },
    right: feature("hlReturn60s"),
  };
  assert.equal(formulaComplexity(expression), 4);
  assert.equal(formulaDepth(expression), 3);
  assert.equal(renderFormula(expression), "(-(basisBps) ÷ hlReturn60s)");
  assert.equal(
    evaluateFormula(expression, features(0, 0)),
    null,
  );
  assert.doesNotThrow(() => validateFormula(expression));
  const tooDeep: FormulaNode = {
    op: "neg",
    child: { op: "neg", child: { op: "neg", child: feature("basisBps") } },
  };
  assert.throws(() => validateFormula(tooDeep), /depth/);
});

test("fixed formula library is deterministic and counts every threshold as a trial", () => {
  const candidates = fixedFormulaCandidates();
  assert.equal(
    candidates.length,
    11 * FORMULAIC_FIXED_HORIZON_POC.search.scoreThresholdsZ.length,
  );
  assert.equal(new Set(candidates.map((candidate) => candidate.id)).size, candidates.length);
  assert.deepEqual(
    candidates.slice(0, 3).map((candidate) => candidate.thresholdZ),
    [0, 0.5, 1],
  );
});

test("walk-forward POC selects on prior data and scores the next block only", () => {
  const result = walkForwardFormulaAssessment(
    syntheticPoints(),
    momentumCandidates,
    config,
  );
  assert.equal(result.version, FORMULAIC_FIXED_HORIZON_POC.version);
  assert.equal(result.folds.length, config.folds);
  assert.ok(result.folds.every((fold) => fold.selectedCandidateId === "hl-short"));
  assert.ok(result.folds.every((fold) =>
    fold.trainLastLabelEndAtMs != null
    && fold.trainLastLabelEndAtMs <= fold.testStartAtMs));
  assert.ok(result.folds.every((fold) => fold.testMetrics.trades >= config.minimumTestTrades));
  assert.ok(result.aggregate.tradeWeightedMeanNetBps != null);
  assert.ok(result.aggregate.tradeWeightedMeanNetBps > 0);
  assert.match(result.disposition, /hypothesis.*new forward paper boundary/i);
});

test("future observations cannot alter an earlier fold selection", () => {
  const original = syntheticPoints();
  const first = walkForwardFormulaAssessment(original, momentumCandidates, config);
  const firstTestStart = first.folds[0].testStartAtMs;
  const mutated = original.map((point) =>
    point.atMs < firstTestStart
      ? point
      : {
          ...point,
          exitUnderlyingPrice: point.entryUnderlyingPrice ** 2 / point.exitUnderlyingPrice,
          features: features(
            -point.features.hlReturn60s,
            point.features.chainlinkReturn60s * 100,
          ),
        });
  const second = walkForwardFormulaAssessment(mutated, momentumCandidates, config);
  assert.equal(
    second.folds[0].selectedCandidateId,
    first.folds[0].selectedCandidateId,
  );
  assert.deepEqual(
    second.folds[0].trainingMetrics,
    first.folds[0].trainingMetrics,
  );
});

test("formula POC has no live data, strategy, Crucible, or execution dependency", () => {
  assert.deepEqual(FORMULAIC_FIXED_HORIZON_POC.invariants, {
    readsLockedLiveValues: false,
    readsPaperOutcomes: false,
    createsStrategy: false,
    createsPaperBot: false,
    startsCrucibleRun: false,
    enablesExecution: false,
    preservesVerdictGate: true,
  });
  const source = readFileSync(
    new URL("./formulaic-fixed-horizon-poc.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /from\s+["'][^"']*(?:db|router|worker|paper-floor|crucible)/i);
  assert.doesNotMatch(
    source,
    /venuePriceSnapshots|paperTrades|placeOrder|submitOrder|privateKey|fetch\s*\(/i,
  );
});
