import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  RESEARCH_PROTOCOL_VERSION,
  type ResearchArtifactRef,
  type ResearchCapitalPolicy,
} from "@alchemy/research-protocol";
import {
  buildResearchShardPlan,
  hashLeaseToken,
  summarizeResearchValidationFamily,
  type ResearchExperimentInput,
} from "./research-control-plane.ts";

const candidateManifest: ResearchArtifactRef = {
  contentHash: `sha256:${"a".repeat(64)}`,
  uri: "s3://alchemy-research/candidates/formulas-v1.jsonl",
  format: "jsonl",
  schemaVersion: "formula-candidate-v1",
};

const capitalPolicy: ResearchCapitalPolicy = {
  startingCapitalUsd: 10_000,
  sizingMode: "fixed-risk",
  sizingValue: 100,
  compound: true,
  maxGrossExposureFraction: 1,
  maxConcurrentPositions: 6,
  liquidationFloorUsd: 0,
};

function experiment(): ResearchExperimentInput {
  return {
    name: "10k formula discovery",
    kind: "formula",
    datasetId: "00000000-0000-4000-8000-000000000001",
    candidateManifest,
    candidateCount: 10_000,
    targetIds: ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD", "BNB-USD"],
    shardSize: 250,
    resourceClass: "cpu",
    evaluatorVersion: "alchemy-formula-scale-engine-v1",
    targetAdapterVersion: "fixed-horizon-paper-v1",
    costModel: { roundTripBps: 10 },
    capitalPolicy,
    selectionPolicy: { discovery: "rank", validation: "Holm", alpha: 0.05 },
    seed: 42,
  };
}

test("research plan partitions 10,000 candidates across six targets into 240 shards", () => {
  const plan = buildResearchShardPlan(experiment());
  assert.equal(plan.length, 240);
  assert.deepEqual(plan[0], {
    ordinal: 0,
    stage: "discovery",
    targetId: "BTC-USD",
    candidateStart: 0,
    candidateEnd: 250,
    resourceClass: "cpu",
    priority: 0,
    maxAttempts: 3,
  });
  assert.equal(plan.at(-1)?.candidateStart, 9_750);
  assert.equal(
    plan.reduce((sum, shard) => sum + shard.candidateEnd - shard.candidateStart, 0),
    60_000,
  );
});

test("shard plans are deterministic and reject duplicate targets", () => {
  const input = experiment();
  assert.deepEqual(buildResearchShardPlan(input), buildResearchShardPlan(input));
  input.targetIds = ["BTC-USD", "BTC-USD"];
  assert.throws(() => buildResearchShardPlan(input), /unique/);
});

test("formula validation requires the frozen calibration manifest contract", () => {
  const input = experiment();
  input.stage = "validation";
  input.validationBoundaryAt = new Date("2026-07-25T00:00:00.000Z");
  assert.throws(
    () => buildResearchShardPlan(input),
    /frozen v2 JSON selection manifest/,
  );
  input.candidateManifest = {
    ...candidateManifest,
    format: "json",
    schemaVersion: "formula-validation-selection-v2",
  };
  const plan = buildResearchShardPlan(input);
  assert.equal(plan[0].stage, "validation");
});

test("validation summary preserves the full family and applies Holm step-down", () => {
  const rows = [
    {
      key: "BTC\u0000strong",
      candidateId: "strong",
      targetId: "BTC",
      trades: 80,
      netMeanBps: 4,
      eligible: true,
      oneSidedPValue: 0.001,
    },
    {
      key: "BTC\u0000weak",
      candidateId: "weak",
      targetId: "BTC",
      trades: 75,
      netMeanBps: 1,
      eligible: true,
      oneSidedPValue: 0.03,
    },
    {
      key: "ETH\u0000missing",
      candidateId: "missing",
      targetId: "ETH",
      trades: 3,
      netMeanBps: null,
      eligible: false,
      oneSidedPValue: null,
    },
  ];
  const summary = summarizeResearchValidationFamily({
    expectedFamilySize: 3,
    alpha: 0.05,
    rows,
  });
  assert.equal(summary.familyComplete, true);
  assert.equal(summary.passingCandidates, 1);
  assert.equal(summary.rows.find((row) => row.candidateId === "strong")?.familywisePass, true);
  assert.equal(summary.rows.find((row) => row.candidateId === "weak")?.familywisePass, false);
  assert.equal(summary.researchReviewEligible, true);
  assert.equal(summary.strategyRegistrationAllowed, false);
  assert.equal(summary.executionAllowed, false);

  const incomplete = summarizeResearchValidationFamily({
    expectedFamilySize: 3,
    alpha: 0.05,
    rows: rows.slice(0, 2),
  });
  assert.equal(incomplete.familyComplete, false);
  assert.equal(incomplete.passingCandidates, 0);
  assert.equal(incomplete.researchReviewEligible, false);
});

test("lease tokens are stored as stable hashes rather than bearer secrets", () => {
  const token = "worker-lease-secret";
  assert.equal(hashLeaseToken(token), hashLeaseToken(token));
  assert.notEqual(hashLeaseToken(token), token);
  assert.match(hashLeaseToken(token), /^[a-f0-9]{64}$/);
});

test("wire protocol remains versioned and research service has no execution vocabulary", () => {
  assert.equal(RESEARCH_PROTOCOL_VERSION, "alchemy-research-v2");
  const source = readFileSync(
    new URL("./research-control-plane.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /\b(?:placeOrder|submitOrder|createOrder|privateKey|walletSecret|tradeProcedure)\b/,
  );
  assert.match(source, /paperOnly:\s*true/);
});

test("research schema locks every experiment to paper-only", () => {
  const source = readFileSync(
    new URL(
      "../../../../packages/db/src/schema/research-experiments.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /research_experiment_paper_only/);
  assert.match(source, /paperOnly:\s*boolean/);
  assert.doesNotMatch(
    source,
    /\b(?:wallet|credential|orderId|executionId)\s*:/i,
  );
});
