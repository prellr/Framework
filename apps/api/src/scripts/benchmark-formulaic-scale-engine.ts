/**
 * Local synthetic capacity benchmark for Formula Lab's deterministic 10k-variant mechanics.
 *
 * This does not read a database, network, live tape, paper ledger, account, or outcome. Run it away
 * from the production worker to size shards before enabling any durable experiment runner.
 */
import type {
  FormulaFeature,
  FormulaPoint,
} from "../services/formulaic-fixed-horizon-poc.ts";
import {
  evaluateFormulaShard,
  generateFormulaVariantManifest,
  planFormulaExperiment,
} from "../services/formulaic-scale-engine.ts";

const POINTS = 1_440;
const HOLD_MS = 10 * 60_000;
const SHARD_SIZE = 250;
const VARIANTS = 10_000;
const startAtMs = 1_900_000_000_000;

function frame(index: number): Record<FormulaFeature, number> {
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

const points: FormulaPoint[] = Array.from({ length: POINTS }, (_, index) => {
  const features = frame(index);
  const futureMove =
    0.55 * features.hlReturn60s
    + 0.25 * features.chainlinkReturn60s
    + 0.2 * features.basisChange60sBps;
  const atMs = startAtMs + index * 60_000;
  return {
    pair: "BTC-USD",
    atMs,
    labelEndAtMs: atMs + HOLD_MS,
    entryUnderlyingPrice: 100,
    exitUnderlyingPrice: 100 * Math.exp(futureMove * 0.00025),
    features,
  };
});

const targets = ["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB"].map((asset) => ({
  key: `${asset}-USD:hyperliquid-10m`,
  adapter: "hyperliquid-mid-fixed-horizon",
  pair: `${asset}-USD`,
  holdSeconds: 600,
  roundTripCostBps: 10,
}));

const generatedAt = performance.now();
const manifest = generateFormulaVariantManifest({
  seed: "formula-scale-capacity-v1",
  variantCount: VARIANTS,
});
const generatedMs = performance.now() - generatedAt;
const plan = planFormulaExperiment({
  manifest,
  targets,
  createdAtMs: startAtMs,
  dataEndExclusiveMs: startAtMs - 1,
  shardSize: SHARD_SIZE,
});

const evaluationStartedAt = performance.now();
let formulaPointEvaluations = 0;
const results = [];
for (const shard of plan.shards.filter(
  (candidateShard) => candidateShard.targetKey === targets[0].key,
)) {
  const result = evaluateFormulaShard({
    targetKey: shard.targetKey,
    points,
    candidates: manifest.candidates.slice(
      shard.candidateStart,
      shard.candidateEndExclusive,
    ),
    candidateHash: shard.candidateHash,
    config: {
      holdMs: HOLD_MS,
      roundTripCostBps: 10,
      minimumTrades: 30,
      complexityPenaltyBps: 0.01,
      familySize: plan.evaluationUnitCount,
    },
  });
  formulaPointEvaluations += result.formulaPointEvaluations;
  results.push(...result.results);
}
const evaluationMs = performance.now() - evaluationStartedAt;
const eligible = results
  .filter((result) => result.eligible && result.selectionScore != null)
  .sort((left, right) =>
    right.selectionScore! - left.selectionScore!
    || left.candidateId.localeCompare(right.candidateId));
const memory = process.memoryUsage();

console.log(JSON.stringify({
  benchmark: "formula-scale-synthetic-capacity-v1",
  syntheticOnly: true,
  variantsGenerated: manifest.variantCount,
  targetsPlanned: plan.targetCount,
  evaluationUnitsPlanned: plan.evaluationUnitCount,
  shardsPlanned: plan.shardCount,
  shardsEvaluatedForOneTarget: plan.shards.filter(
    (shard) => shard.targetKey === targets[0].key,
  ).length,
  pointsPerVariant: POINTS,
  formulaPointEvaluations,
  manifestHash: manifest.candidateManifestHash,
  generationMs: Math.round(generatedMs),
  evaluationMs: Math.round(evaluationMs),
  formulaPointEvaluationsPerSecond: Math.round(
    formulaPointEvaluations / (evaluationMs / 1_000),
  ),
  eligibleDiscoveryVariants: eligible.length,
  memory: {
    rssMiB: Math.round(memory.rss / 1024 / 1024),
    heapUsedMiB: Math.round(memory.heapUsed / 1024 / 1024),
  },
  descriptiveTopFive: eligible.slice(0, 5).map((result) => ({
    candidateId: result.candidateId,
    complexity: result.complexity,
    trades: result.trades,
    meanNetBps: result.meanNetBps,
    lowerConfidenceBoundBps: result.lowerConfidenceBoundBps,
    selectionScore: result.selectionScore,
  })),
  disposition:
    "capacity proof only; synthetic rankings are not hypotheses, evidence, paper bots, or execution candidates",
}, null, 2));
