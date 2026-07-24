/**
 * End-to-end verifier for the external research-compute control plane.
 *
 * It deliberately refuses to run against any database whose name does not begin with
 * `alchemy_research_test_`. The verifier creates durable rows, leases shards, heartbeats, commits
 * an idempotent result, and exercises retry semantics; it must never touch a real Alchemy database.
 */
import assert from "node:assert/strict";
import {
  RESEARCH_PROTOCOL_VERSION,
  type ResearchDatasetManifest,
  type ResearchShardResult,
  type ResearchWorkerCapabilities,
} from "@alchemy/research-protocol";
import {
  commitResearchShardResult,
  createResearchExperiment,
  heartbeatResearchShard,
  leaseResearchShard,
  registerResearchDataset,
  researchControlPlaneStatus,
} from "../services/research-control-plane.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "");
if (!databaseName.startsWith("alchemy_research_test_")) {
  throw new Error("refusing research verifier outside alchemy_research_test_* database");
}

const datasetHash = `sha256:${"1".repeat(64)}`;
const candidateHash = `sha256:${"2".repeat(64)}`;
const completedHash = `sha256:${"3".repeat(64)}`;
const retryHash = `sha256:${"4".repeat(64)}`;
const manifest: ResearchDatasetManifest = {
  protocolVersion: RESEARCH_PROTOCOL_VERSION,
  datasetId: "integration-paired-venue-minute",
  datasetVersion: "1",
  contentHash: datasetHash,
  artifact: {
    contentHash: datasetHash,
    uri: "s3://alchemy-test/dataset.parquet",
    format: "parquet",
    schemaVersion: "paired-minute-v1",
  },
  rowCount: 10_000,
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
  targetSpecs: [{ id: "paper-short-10m" }],
};

const dataset = await registerResearchDataset(manifest);
const created = await createResearchExperiment({
  name: "integration formula discovery",
  kind: "formula",
  datasetId: dataset.id,
  candidateManifest: {
    contentHash: candidateHash,
    uri: "s3://alchemy-test/candidates.jsonl",
    format: "jsonl",
    schemaVersion: "formula-candidate-v1",
  },
  candidateCount: 500,
  targetIds: ["BTC-USD", "SOL-USD"],
  shardSize: 250,
  resourceClass: "cpu",
  evaluatorVersion: "integration-evaluator-v1",
  targetAdapterVersion: "integration-paper-target-v1",
  costModel: { roundTripBps: 10 },
  capitalPolicy: {
    startingCapitalUsd: 10_000,
    sizingMode: "fixed-risk",
    sizingValue: 100,
    compound: true,
    maxGrossExposureFraction: 1,
    maxConcurrentPositions: 6,
    liquidationFloorUsd: 0,
  },
  selectionPolicy: { correction: "Holm", alpha: 0.05 },
  seed: 42,
});
assert.equal(created.shardCount, 4);
assert.equal(created.experiment.paperOnly, true);
assert.equal(created.experiment.familySize, 1_000);

const capabilities: ResearchWorkerCapabilities = {
  protocolVersion: RESEARCH_PROTOCOL_VERSION,
  workerId: "integration-cpu-worker",
  resourceClasses: ["cpu"],
  evaluatorVersions: ["integration-evaluator-v1"],
  targetAdapterVersions: ["integration-paper-target-v1"],
  maxCandidateBatch: 250,
};
const firstLease = await leaseResearchShard(capabilities, 60);
assert.ok(firstLease);
assert.equal(firstLease.job.candidateStart, 0);
assert.equal(firstLease.job.candidateEnd, 250);
assert.equal(firstLease.job.targetId, "BTC-USD");
assert.equal(firstLease.job.attempt, 1);

const heartbeat = await heartbeatResearchShard({
  shardId: firstLease.job.shardId,
  workerId: capabilities.workerId,
  leaseToken: firstLease.leaseToken,
  extendSeconds: 60,
});
assert.ok(heartbeat.leaseExpiresAt.getTime() > Date.now());

const completed: ResearchShardResult = {
  protocolVersion: RESEARCH_PROTOCOL_VERSION,
  experimentId: firstLease.job.experimentId,
  shardId: firstLease.job.shardId,
  attempt: firstLease.job.attempt,
  status: "completed",
  resultDigest: completedHash,
  runtimeMs: 50,
  evaluatedCandidates: 250,
  evaluatedRows: 2_500_000,
  inlineResults: [{
    candidateId: "formula-000000",
    targetId: "BTC-USD",
    trades: 100,
    grossMeanBps: 3,
    netMeanBps: 2,
    standardErrorBps: 0.5,
    lowerConfidenceBoundBps: 1.1775,
    hitRate: 0.55,
    selectionScore: 1.1,
    capitalSummary: { endingCapitalUsd: 10_200 },
  }],
};
assert.deepEqual(
  await commitResearchShardResult({
    workerId: capabilities.workerId,
    leaseToken: firstLease.leaseToken,
    result: completed,
  }),
  { idempotent: false },
);
assert.deepEqual(
  await commitResearchShardResult({
    workerId: capabilities.workerId,
    leaseToken: firstLease.leaseToken,
    result: completed,
  }),
  { idempotent: true },
);

const retryLease = await leaseResearchShard(capabilities, 60);
assert.ok(retryLease);
assert.equal(retryLease.job.attempt, 1);
assert.deepEqual(
  await commitResearchShardResult({
    workerId: capabilities.workerId,
    leaseToken: retryLease.leaseToken,
    result: {
      protocolVersion: RESEARCH_PROTOCOL_VERSION,
      experimentId: retryLease.job.experimentId,
      shardId: retryLease.job.shardId,
      attempt: retryLease.job.attempt,
      status: "failed",
      resultDigest: retryHash,
      runtimeMs: 10,
      evaluatedCandidates: 0,
      evaluatedRows: 0,
      error: {
        code: "TRANSIENT_WORKER_FAILURE",
        message: "synthetic retry proof",
        retryable: true,
      },
    },
  }),
  { idempotent: false },
);
const retried = await leaseResearchShard(capabilities, 60);
assert.ok(retried);
assert.equal(retried.job.shardId, retryLease.job.shardId);
assert.equal(retried.job.attempt, 2);

const status = await researchControlPlaneStatus();
assert.equal(status.protocolVersion, RESEARCH_PROTOCOL_VERSION);
assert.equal(status.executionCapable, false);
assert.equal(status.workerDatabaseAccess, false);
assert.equal(status.workerVenueCredentialAccess, false);
assert.equal(status.datasets.ready, 1);
assert.equal(status.experiments.running, 1);
assert.equal(status.shards.completed, 1);
assert.equal(status.shards.leased, 1);
assert.equal(status.shards.queued, 2);

process.stdout.write(`${JSON.stringify({
  database: databaseName,
  experimentId: created.experiment.id,
  shardCount: created.shardCount,
  status,
})}\n`);
process.exit(0);
