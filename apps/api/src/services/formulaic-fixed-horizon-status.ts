/**
 * Static, read-only Jester Formula Lab status and deterministic planted-signal proof.
 *
 * This service imports only the pure formula POC. It has no database, network, live tape, strategy,
 * paper ledger, Crucible, account, or order dependency.
 */
import { FORMULAIC_FIXED_HORIZON_POC } from "./formulaic-fixed-horizon-contract.ts";
import {
  fixedFormulaCandidates,
  formulaComplexity,
  formulaDepth,
  renderFormula,
  walkForwardFormulaAssessment,
  type FormulaFeature,
  type FormulaPoint,
} from "./formulaic-fixed-horizon-poc.ts";
import { LEGACY_ALBERT_FORMULA_RESEARCH } from "./legacy-formula-research.ts";
import { HISTORICAL_ALBERT_REPLAY_RECEIPT } from "./historical-albert-replay-receipt.ts";
import {
  HISTORICAL_ALBERT_HORIZON_SENSITIVITY_RECEIPT,
} from "./historical-albert-horizon-sensitivity-receipt.ts";
import { formulaOperatorCatalogStatus } from "./formula-operator-catalog.ts";

const SYNTHETIC_CONFIG = {
  holdMs: FORMULAIC_FIXED_HORIZON_POC.target.holdSeconds * 1_000,
  folds: 4,
  testPointsPerFold: 100,
  minimumTrainPoints: 300,
  minimumTrainTrades: 10,
  minimumTestTrades: 2,
  roundTripCostBps: 0,
  complexityPenaltyBps: 0.05,
} as const;

const syntheticFeatures = (
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

function plantedSyntheticPoints(count = 760): FormulaPoint[] {
  const startAtMs = 1_800_000_000_000;
  return Array.from({ length: count }, (_, index) => {
    const plantedDriver =
      Math.sin(index * 0.37) + 0.35 * Math.sin(index * 0.071);
    const distractor = Math.cos(index * 0.19);
    const atMs = startAtMs + index * 60_000;
    return {
      pair: "SYNTHETIC-USD",
      atMs,
      labelEndAtMs: atMs + SYNTHETIC_CONFIG.holdMs,
      entryUnderlyingPrice: 100,
      exitUnderlyingPrice: 100 * Math.exp(plantedDriver * 0.001),
      features: syntheticFeatures(plantedDriver, distractor),
    };
  });
}

const CANDIDATES = fixedFormulaCandidates();
const SYNTHETIC_PROOF = walkForwardFormulaAssessment(
  plantedSyntheticPoints(),
  CANDIDATES,
  SYNTHETIC_CONFIG,
);

export function formulaLabStatus() {
  return {
    version: FORMULAIC_FIXED_HORIZON_POC.version,
    status: FORMULAIC_FIXED_HORIZON_POC.status,
    system: FORMULAIC_FIXED_HORIZON_POC.system,
    target: FORMULAIC_FIXED_HORIZON_POC.target,
    sourceAdapters: FORMULAIC_FIXED_HORIZON_POC.sourceAdapters,
    targetAdapters: FORMULAIC_FIXED_HORIZON_POC.targetAdapters,
    features: FORMULAIC_FIXED_HORIZON_POC.features,
    grammar: FORMULAIC_FIXED_HORIZON_POC.grammar,
    operatorCatalog: formulaOperatorCatalogStatus(),
    search: FORMULAIC_FIXED_HORIZON_POC.search,
    validation: FORMULAIC_FIXED_HORIZON_POC.validation,
    prerequisitesForLiveData:
      FORMULAIC_FIXED_HORIZON_POC.prerequisitesForLiveData,
    prerequisitesForPolymarketTranslation:
      FORMULAIC_FIXED_HORIZON_POC.prerequisitesForPolymarketTranslation,
    invariants: FORMULAIC_FIXED_HORIZON_POC.invariants,
    candidates: CANDIDATES.map((candidate) => ({
      id: candidate.id,
      expression: candidate.expression,
      formula: renderFormula(candidate.expression),
      thresholdZ: candidate.thresholdZ,
      complexity: formulaComplexity(candidate.expression),
      depth: formulaDepth(candidate.expression),
    })),
    historicalFormulaResearch: LEGACY_ALBERT_FORMULA_RESEARCH,
    historicalReplay: HISTORICAL_ALBERT_REPLAY_RECEIPT,
    historicalHorizonSensitivity:
      HISTORICAL_ALBERT_HORIZON_SENSITIVITY_RECEIPT,
    proof: {
      mode: "planted-signal synthetic mechanics test",
      isMarketEvidence: false,
      candidatesEvaluated: SYNTHETIC_PROOF.candidatesEvaluated,
      holdMs: SYNTHETIC_PROOF.holdMs,
      aggregate: SYNTHETIC_PROOF.aggregate,
      folds: SYNTHETIC_PROOF.folds.map((fold) => ({
        fold: fold.fold + 1,
        trainPoints: fold.trainPoints,
        testPoints: fold.testPoints,
        testStartAtMs: fold.testStartAtMs,
        trainLastLabelEndAtMs: fold.trainLastLabelEndAtMs,
        selectedCandidateId: fold.selectedCandidateId,
        selectedFormula: fold.selectedFormula,
        selectedComplexity: fold.selectedComplexity,
        trainingTrades: fold.trainingMetrics.trades,
        trainingMeanNetBps: fold.trainingMetrics.meanNetBps,
        trainingLowerConfidenceBoundBps:
          fold.trainingMetrics.lowerConfidenceBoundBps,
        testTrades: fold.testMetrics.trades,
        testMeanNetBps: fold.testMetrics.meanNetBps,
        testHitRate: fold.testMetrics.hitRate,
      })),
      disposition: SYNTHETIC_PROOF.disposition,
    },
  };
}
