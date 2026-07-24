import { createHash, randomBytes } from "node:crypto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  lte,
  sql,
} from "drizzle-orm";
import {
  db,
  researchArtifacts,
  researchCandidateResults,
  researchDatasetManifests,
  researchExperiments,
  researchShards,
} from "@framework/db";
import {
  RESEARCH_PROTOCOL_VERSION,
  assertDatasetManifest,
  assertResearchCapitalPolicy,
  type ResearchArtifactRef,
  type ResearchCapitalPolicy,
  type ResearchDatasetManifest,
  type ResearchResourceClass,
  type ResearchShardJob,
  type ResearchShardResult,
  type ResearchStage,
  type ResearchWorkerCapabilities,
} from "@alchemy/research-protocol";

const sha256Pattern = /^sha256:[a-f0-9]{64}$/;
const defaultLeaseSeconds = 120;
const maxLeaseSeconds = 900;
const maxInlineResults = 500;

export interface ResearchExperimentInput {
  requestedByUserId?: string;
  name: string;
  kind: "formula" | "ml" | "hybrid";
  stage?: ResearchStage;
  datasetId: string;
  candidateManifest: ResearchArtifactRef;
  candidateCount: number;
  targetIds: string[];
  shardSize: number;
  resourceClass: ResearchResourceClass;
  evaluatorVersion: string;
  targetAdapterVersion: string;
  costModel: Record<string, unknown>;
  capitalPolicy: ResearchCapitalPolicy;
  selectionPolicy: Record<string, unknown>;
  seed: number;
  validationBoundaryAt?: Date;
  priority?: number;
  maxAttempts?: number;
}

export interface ResearchShardPlan {
  ordinal: number;
  stage: ResearchStage;
  targetId: string;
  candidateStart: number;
  candidateEnd: number;
  resourceClass: ResearchResourceClass;
  priority: number;
  maxAttempts: number;
}

export interface ResearchValidationEvidenceRow {
  key: string;
  candidateId: string;
  targetId: string;
  trades: number;
  netMeanBps: number | null;
  eligible: boolean;
  oneSidedPValue: number | null;
}

export interface ResearchValidationFamilySummary {
  expectedFamilySize: number;
  observedFamilySize: number;
  familyComplete: boolean;
  correction: "Holm";
  alpha: number;
  rows: Array<ResearchValidationEvidenceRow & {
    holmRank: number;
    holmThreshold: number;
    familywisePass: boolean;
  }>;
  passingCandidates: number;
  researchReviewEligible: boolean;
  strategyRegistrationAllowed: false;
  executionAllowed: false;
}

function assertHash(value: string, label: string): void {
  if (!sha256Pattern.test(value)) {
    throw new Error(`${label} must be sha256:<64 lowercase hex>`);
  }
}

export function hashLeaseToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function summarizeResearchValidationFamily(input: {
  expectedFamilySize: number;
  alpha: number;
  rows: ResearchValidationEvidenceRow[];
}): ResearchValidationFamilySummary {
  if (
    !Number.isSafeInteger(input.expectedFamilySize)
    || input.expectedFamilySize < 1
    || !Number.isFinite(input.alpha)
    || input.alpha <= 0
    || input.alpha >= 1
  ) {
    throw new Error("research validation family size and alpha are invalid");
  }
  if (
    input.rows.length > input.expectedFamilySize
    ||
    new Set(input.rows.map((row) => row.key)).size !== input.rows.length
    || input.rows.some((row) =>
      !row.key
      || !row.candidateId
      || !row.targetId
      || !Number.isSafeInteger(row.trades)
      || row.trades < 0
      || (
        row.netMeanBps != null
        && !Number.isFinite(row.netMeanBps)
      )
      || (
        row.oneSidedPValue != null
        && (
          !Number.isFinite(row.oneSidedPValue)
          || row.oneSidedPValue < 0
          || row.oneSidedPValue > 1
        )
      ))
  ) {
    throw new Error("research validation evidence rows are invalid or duplicated");
  }
  const familyComplete = input.rows.length === input.expectedFamilySize;
  const ranked = input.rows
    .map((row, index) => ({
      index,
      p:
        row.eligible && row.oneSidedPValue != null
          ? row.oneSidedPValue
          : Number.POSITIVE_INFINITY,
    }))
    .sort((left, right) =>
      left.p - right.p
      || input.rows[left.index].key.localeCompare(input.rows[right.index].key));
  const correction = new Map<number, {
    rank: number;
    threshold: number;
    pass: boolean;
  }>();
  let stepDownOpen = familyComplete;
  for (let index = 0; index < ranked.length; index++) {
    const row = ranked[index];
    const threshold = input.alpha / (input.expectedFamilySize - index);
    const pass =
      stepDownOpen
      && Number.isFinite(row.p)
      && row.p <= threshold;
    if (!pass) stepDownOpen = false;
    correction.set(row.index, {
      rank: index + 1,
      threshold,
      pass,
    });
  }
  const rows = input.rows.map((row, index) => {
    const adjusted = correction.get(index);
    return {
      ...row,
      holmRank: adjusted?.rank ?? input.expectedFamilySize,
      holmThreshold:
        adjusted?.threshold ?? input.alpha / input.expectedFamilySize,
      familywisePass: adjusted?.pass ?? false,
    };
  });
  const passingCandidates = rows.filter((row) => row.familywisePass).length;
  return {
    expectedFamilySize: input.expectedFamilySize,
    observedFamilySize: input.rows.length,
    familyComplete,
    correction: "Holm",
    alpha: input.alpha,
    rows,
    passingCandidates,
    researchReviewEligible: familyComplete && passingCandidates > 0,
    strategyRegistrationAllowed: false,
    executionAllowed: false,
  };
}

export function buildResearchShardPlan(input: ResearchExperimentInput): ResearchShardPlan[] {
  if (!Number.isSafeInteger(input.candidateCount) || input.candidateCount < 1) {
    throw new Error("candidateCount must be a positive safe integer");
  }
  if (!Number.isSafeInteger(input.shardSize) || input.shardSize < 1) {
    throw new Error("shardSize must be a positive safe integer");
  }
  if (input.targetIds.length === 0 || new Set(input.targetIds).size !== input.targetIds.length) {
    throw new Error("targetIds must be non-empty and unique");
  }
  if (input.targetIds.some((targetId) => targetId.trim().length === 0)) {
    throw new Error("targetIds cannot contain blank identifiers");
  }
  assertHash(input.candidateManifest.contentHash, "candidate manifest contentHash");
  assertResearchCapitalPolicy(input.capitalPolicy);
  if (
    input.stage === "validation"
    && input.kind === "formula"
    && (
      input.candidateManifest.format !== "json"
      || input.candidateManifest.schemaVersion
        !== "formula-validation-selection-v2"
    )
  ) {
    throw new Error(
      "formula validation requires a frozen v2 JSON selection manifest",
    );
  }

  const priority = input.priority ?? 0;
  const maxAttempts = input.maxAttempts ?? 3;
  if (!Number.isInteger(priority)) throw new Error("priority must be an integer");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new Error("maxAttempts must be an integer from 1 to 10");
  }

  const stage = input.stage ?? "discovery";
  const plan: ResearchShardPlan[] = [];
  let ordinal = 0;
  for (const targetId of input.targetIds) {
    for (
      let candidateStart = 0;
      candidateStart < input.candidateCount;
      candidateStart += input.shardSize
    ) {
      plan.push({
        ordinal,
        stage,
        targetId,
        candidateStart,
        candidateEnd: Math.min(input.candidateCount, candidateStart + input.shardSize),
        resourceClass: input.resourceClass,
        priority,
        maxAttempts,
      });
      ordinal += 1;
    }
  }
  return plan;
}

export async function registerResearchDataset(manifest: ResearchDatasetManifest) {
  assertDatasetManifest(manifest);
  const values = {
    protocolVersion: manifest.protocolVersion,
    datasetKey: manifest.datasetId,
    datasetVersion: manifest.datasetVersion,
    contentHash: manifest.contentHash,
    artifactUri: manifest.artifact.uri,
    artifactFormat: manifest.artifact.format,
    artifactSchemaVersion: manifest.artifact.schemaVersion,
    rowCount: manifest.rowCount,
    assets: manifest.assets,
    columns: manifest.columns,
    eventStart: new Date(manifest.eventStart),
    eventEnd: new Date(manifest.eventEnd),
    frozenAt: new Date(manifest.frozenAt),
    availabilityClock: manifest.availabilityClock,
    boundary: manifest.boundary,
    labelSpec: manifest.labelSpec,
    sourceSpecs: manifest.sourceSpecs,
    targetSpecs: manifest.targetSpecs,
  };
  const [inserted] = await db
    .insert(researchDatasetManifests)
    .values(values)
    .onConflictDoNothing({ target: researchDatasetManifests.contentHash })
    .returning();
  if (inserted) return inserted;

  const [existing] = await db
    .select()
    .from(researchDatasetManifests)
    .where(eq(researchDatasetManifests.contentHash, manifest.contentHash))
    .limit(1);
  if (!existing) throw new Error("dataset registration lost a content-hash race");
  if (
    existing.datasetKey !== manifest.datasetId
    || existing.datasetVersion !== manifest.datasetVersion
    || existing.artifactUri !== manifest.artifact.uri
    || existing.rowCount !== manifest.rowCount
  ) {
    throw new Error("content hash is already registered with different dataset metadata");
  }
  return existing;
}

export async function createResearchExperiment(input: ResearchExperimentInput) {
  const plan = buildResearchShardPlan(input);
  const [dataset] = await db
    .select()
    .from(researchDatasetManifests)
    .where(eq(researchDatasetManifests.id, input.datasetId))
    .limit(1);
  if (!dataset || dataset.status !== "ready") {
    throw new Error("research experiment requires a ready immutable dataset");
  }
  if (input.stage === "validation") {
    const boundaryAt = input.validationBoundaryAt?.getTime();
    const manifestBoundaryAt = dataset.boundary.validationStart == null
      ? null
      : Date.parse(dataset.boundary.validationStart);
    if (
      boundaryAt == null
      || !Number.isFinite(boundaryAt)
      || manifestBoundaryAt == null
      || boundaryAt !== manifestBoundaryAt
    ) {
      throw new Error("validation requires the dataset's exact frozen future boundary");
    }
  }

  return db.transaction(async (tx) => {
    const [experiment] = await tx
      .insert(researchExperiments)
      .values({
        requestedByUserId: input.requestedByUserId,
        name: input.name,
        kind: input.kind,
        status: "queued",
        stage: input.stage ?? "discovery",
        datasetId: input.datasetId,
        candidateManifestHash: input.candidateManifest.contentHash,
        candidateManifestUri: input.candidateManifest.uri,
        candidateManifestFormat: input.candidateManifest.format,
        candidateManifestSchemaVersion: input.candidateManifest.schemaVersion,
        candidateCount: input.candidateCount,
        targetIds: input.targetIds,
        familySize: input.candidateCount * input.targetIds.length,
        shardSize: input.shardSize,
        resourceClass: input.resourceClass,
        evaluatorVersion: input.evaluatorVersion,
        targetAdapterVersion: input.targetAdapterVersion,
        costModel: input.costModel,
        capitalPolicy: input.capitalPolicy,
        selectionPolicy: input.selectionPolicy,
        seed: input.seed,
        validationBoundaryAt: input.validationBoundaryAt,
        paperOnly: true,
      })
      .returning();
    if (!experiment) throw new Error("research experiment insert returned no row");

    await tx.insert(researchShards).values(
      plan.map((shard) => ({
        experimentId: experiment.id,
        ...shard,
      })),
    );
    return { experiment, shardCount: plan.length };
  });
}

async function expireResearchLeases(now: Date): Promise<void> {
  const expired = await db
    .select({
      id: researchShards.id,
      attempt: researchShards.attempt,
      maxAttempts: researchShards.maxAttempts,
    })
    .from(researchShards)
    .where(and(
      eq(researchShards.status, "leased"),
      lte(researchShards.leaseExpiresAt, now),
    ));
  if (expired.length === 0) return;

  await db.transaction(async (tx) => {
    for (const shard of expired) {
      const exhausted = shard.attempt >= shard.maxAttempts;
      await tx
        .update(researchShards)
        .set({
          status: exhausted ? "failed" : "queued",
          leasedBy: null,
          leaseTokenHash: null,
          leasedAt: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          error: exhausted ? "lease expired after maximum attempts" : "lease expired; requeued",
          updatedAt: now,
        })
        .where(and(
          eq(researchShards.id, shard.id),
          eq(researchShards.status, "leased"),
          lte(researchShards.leaseExpiresAt, now),
        ));
    }
  });
}

export async function leaseResearchShard(
  capabilities: ResearchWorkerCapabilities,
  requestedLeaseSeconds = defaultLeaseSeconds,
): Promise<{ leaseToken: string; job: ResearchShardJob } | null> {
  if (capabilities.protocolVersion !== RESEARCH_PROTOCOL_VERSION) {
    throw new Error(`unsupported worker protocol ${capabilities.protocolVersion}`);
  }
  if (
    capabilities.workerId.trim().length === 0
    || capabilities.resourceClasses.length === 0
    || capabilities.evaluatorVersions.length === 0
    || capabilities.targetAdapterVersions.length === 0
  ) {
    throw new Error("worker capabilities are incomplete");
  }
  const leaseSeconds = Math.min(
    maxLeaseSeconds,
    Math.max(30, Math.floor(requestedLeaseSeconds)),
  );
  const now = new Date();
  await expireResearchLeases(now);

  const leaseToken = randomBytes(32).toString("base64url");
  const leaseTokenHash = hashLeaseToken(leaseToken);
  const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1_000);

  const leased = await db.transaction(async (tx) => {
    const compatibleExperiments = tx
      .select({ id: researchExperiments.id })
      .from(researchExperiments)
      .where(and(
        inArray(researchExperiments.evaluatorVersion, capabilities.evaluatorVersions),
        inArray(
          researchExperiments.targetAdapterVersion,
          capabilities.targetAdapterVersions,
        ),
        inArray(researchExperiments.status, [
          "queued",
          "running",
          "validation_running",
        ]),
      ));
    const [candidate] = await tx
      .select()
      .from(researchShards)
      .where(and(
        eq(researchShards.status, "queued"),
        inArray(researchShards.resourceClass, capabilities.resourceClasses),
        inArray(researchShards.experimentId, compatibleExperiments),
        sql`${researchShards.candidateEnd} - ${researchShards.candidateStart}
          <= ${capabilities.maxCandidateBatch}`,
      ))
      .orderBy(
        desc(researchShards.priority),
        asc(researchShards.createdAt),
        asc(researchShards.ordinal),
      )
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;

    const [experiment] = await tx
      .select()
      .from(researchExperiments)
      .where(eq(researchExperiments.id, candidate.experimentId))
      .limit(1);
    if (
      !experiment
      || experiment.status === "canceled"
    ) {
      return null;
    }

    const [updated] = await tx
      .update(researchShards)
      .set({
        status: "leased",
        attempt: candidate.attempt + 1,
        leasedBy: capabilities.workerId,
        leaseTokenHash,
        leasedAt: now,
        leaseExpiresAt,
        heartbeatAt: now,
        error: null,
        updatedAt: now,
      })
      .where(and(
        eq(researchShards.id, candidate.id),
        eq(researchShards.status, "queued"),
      ))
      .returning();
    if (!updated) return null;
    if (experiment.status === "queued") {
      await tx
        .update(researchExperiments)
        .set({
          status: experiment.stage === "validation" ? "validation_running" : "running",
          startedAt: experiment.startedAt ?? now,
          updatedAt: now,
        })
        .where(eq(researchExperiments.id, experiment.id));
    }
    return { shard: updated, experiment };
  });
  if (!leased) return null;

  const [dataset] = await db
    .select()
    .from(researchDatasetManifests)
    .where(eq(researchDatasetManifests.id, leased.experiment.datasetId))
    .limit(1);
  if (!dataset) throw new Error("leased experiment dataset disappeared");

  return {
    leaseToken,
    job: {
      protocolVersion: RESEARCH_PROTOCOL_VERSION,
      experimentId: leased.experiment.id,
      shardId: leased.shard.id,
      attempt: leased.shard.attempt,
      leaseExpiresAt: leaseExpiresAt.toISOString(),
      stage: leased.shard.stage,
      resourceClass: leased.shard.resourceClass,
      dataset: {
        contentHash: dataset.contentHash,
        uri: dataset.artifactUri,
        format: dataset.artifactFormat as ResearchArtifactRef["format"],
        schemaVersion: dataset.artifactSchemaVersion,
      },
      candidateManifest: {
        contentHash: leased.experiment.candidateManifestHash,
        uri: leased.experiment.candidateManifestUri,
        format: leased.experiment.candidateManifestFormat as ResearchArtifactRef["format"],
        schemaVersion: leased.experiment.candidateManifestSchemaVersion,
      },
      candidateStart: leased.shard.candidateStart,
      candidateEnd: leased.shard.candidateEnd,
      targetId: leased.shard.targetId,
      targetAdapterVersion: leased.experiment.targetAdapterVersion,
      evaluatorVersion: leased.experiment.evaluatorVersion,
      costModel: leased.experiment.costModel,
      capitalPolicy: leased.experiment.capitalPolicy,
      seed: leased.experiment.seed + leased.shard.ordinal,
    },
  };
}

export async function heartbeatResearchShard(input: {
  shardId: string;
  workerId: string;
  leaseToken: string;
  extendSeconds?: number;
}): Promise<{ leaseExpiresAt: Date }> {
  const now = new Date();
  const extendSeconds = Math.min(
    maxLeaseSeconds,
    Math.max(30, Math.floor(input.extendSeconds ?? defaultLeaseSeconds)),
  );
  const leaseExpiresAt = new Date(now.getTime() + extendSeconds * 1_000);
  const [updated] = await db
    .update(researchShards)
    .set({ heartbeatAt: now, leaseExpiresAt, updatedAt: now })
    .where(and(
      eq(researchShards.id, input.shardId),
      eq(researchShards.status, "leased"),
      eq(researchShards.leasedBy, input.workerId),
      eq(researchShards.leaseTokenHash, hashLeaseToken(input.leaseToken)),
      sql`${researchShards.leaseExpiresAt} > ${now}`,
    ))
    .returning({ leaseExpiresAt: researchShards.leaseExpiresAt });
  if (!updated) throw new Error("research shard lease is missing, expired, or owned elsewhere");
  return { leaseExpiresAt: updated.leaseExpiresAt! };
}

function resultArtifacts(result: ResearchShardResult): Array<{
  kind: "candidate-results" | "predictions" | "model" | "logs";
  artifact: ResearchArtifactRef;
}> {
  const artifacts: Array<{
    kind: "candidate-results" | "predictions" | "model" | "logs";
    artifact: ResearchArtifactRef;
  }> = [];
  if (result.candidateResultsArtifact) {
    artifacts.push({ kind: "candidate-results", artifact: result.candidateResultsArtifact });
  }
  if (result.predictionArtifact) {
    artifacts.push({ kind: "predictions", artifact: result.predictionArtifact });
  }
  if (result.modelArtifact) {
    artifacts.push({ kind: "model", artifact: result.modelArtifact });
  }
  if (result.logArtifact) {
    artifacts.push({ kind: "logs", artifact: result.logArtifact });
  }
  return artifacts;
}

async function refreshResearchExperimentStatus(experimentId: string): Promise<void> {
  const counts = await db
    .select({ status: researchShards.status, rows: count() })
    .from(researchShards)
    .where(eq(researchShards.experimentId, experimentId))
    .groupBy(researchShards.status);
  const byStatus = new Map(counts.map((row) => [row.status, Number(row.rows)]));
  const active = (byStatus.get("queued") ?? 0) + (byStatus.get("leased") ?? 0);
  const failed = byStatus.get("failed") ?? 0;
  const [experiment] = await db
    .select({ stage: researchExperiments.stage })
    .from(researchExperiments)
    .where(eq(researchExperiments.id, experimentId))
    .limit(1);
  if (!experiment) return;

  const now = new Date();
  if (active > 0) {
    await db
      .update(researchExperiments)
      .set({
        status: experiment.stage === "validation" ? "validation_running" : "running",
        updatedAt: now,
      })
      .where(eq(researchExperiments.id, experimentId));
  } else if (failed > 0) {
    await db
      .update(researchExperiments)
      .set({ status: "failed", completedAt: now, updatedAt: now })
      .where(eq(researchExperiments.id, experimentId));
  } else {
    await db
      .update(researchExperiments)
      .set({
        status: experiment.stage === "validation" ? "completed" : "discovery_complete",
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(researchExperiments.id, experimentId));
  }
}

export async function commitResearchShardResult(input: {
  workerId: string;
  leaseToken: string;
  result: ResearchShardResult;
}): Promise<{ idempotent: boolean }> {
  const { result } = input;
  if (result.protocolVersion !== RESEARCH_PROTOCOL_VERSION) {
    throw new Error(`unsupported result protocol ${result.protocolVersion}`);
  }
  assertHash(result.resultDigest, "resultDigest");
  if (
    !Number.isSafeInteger(result.runtimeMs)
    || result.runtimeMs < 0
    || !Number.isSafeInteger(result.evaluatedCandidates)
    || result.evaluatedCandidates < 0
    || !Number.isSafeInteger(result.evaluatedRows)
    || result.evaluatedRows < 0
  ) {
    throw new Error("result runtime and evaluation counts must be non-negative integers");
  }
  if ((result.inlineResults?.length ?? 0) > maxInlineResults) {
    throw new Error(`inline result limit is ${maxInlineResults}; upload an artifact instead`);
  }
  for (const { artifact } of resultArtifacts(result)) {
    assertHash(artifact.contentHash, "artifact contentHash");
  }

  const idempotent = await db.transaction(async (tx) => {
    const [shard] = await tx
      .select()
      .from(researchShards)
      .where(eq(researchShards.id, result.shardId))
      .limit(1)
      .for("update");
    if (!shard || shard.experimentId !== result.experimentId) {
      throw new Error("result does not match a research shard");
    }
    const [experiment] = await tx
      .select({
        kind: researchExperiments.kind,
        stage: researchExperiments.stage,
      })
      .from(researchExperiments)
      .where(eq(researchExperiments.id, shard.experimentId))
      .limit(1);
    if (!experiment) {
      throw new Error("result experiment disappeared");
    }
    if (shard.status === "completed") {
      if (
        shard.resultDigest === result.resultDigest
        && shard.leasedBy === input.workerId
        && shard.leaseTokenHash === hashLeaseToken(input.leaseToken)
      ) {
        return true;
      }
      throw new Error("completed shard cannot accept a different result digest");
    }
    if (
      shard.status !== "leased"
      || shard.leasedBy !== input.workerId
      || shard.leaseTokenHash !== hashLeaseToken(input.leaseToken)
      || shard.attempt !== result.attempt
      || !shard.leaseExpiresAt
      || shard.leaseExpiresAt.getTime() <= Date.now()
    ) {
      throw new Error("result lease is missing, expired, stale, or owned elsewhere");
    }
    if (
      result.status === "completed"
      && experiment.kind === "formula"
      && experiment.stage === "validation"
    ) {
      const expectedCandidates = shard.candidateEnd - shard.candidateStart;
      const inline = result.inlineResults ?? [];
      const keys = inline.map(
        (candidate) => `${candidate.targetId}\0${candidate.candidateId}`,
      );
      if (
        result.evaluatedCandidates !== expectedCandidates
        || inline.length !== expectedCandidates
        || new Set(keys).size !== inline.length
        || inline.some((candidate) => {
          const metrics = candidate.metrics;
          const pValue = metrics?.oneSidedPValue;
          return (
            candidate.targetId !== shard.targetId
            || metrics?.stage !== "validation"
            || typeof metrics?.eligible !== "boolean"
            || typeof metrics?.featureCalibration !== "object"
            || metrics?.featureCalibration == null
            || typeof metrics?.outputCalibration !== "object"
            || metrics?.outputCalibration == null
            || (
              pValue != null
              && (
                typeof pValue !== "number"
                || !Number.isFinite(pValue)
                || pValue < 0
                || pValue > 1
              )
            )
          );
        })
      ) {
        throw new Error(
          "formula validation results must preserve every frozen family member and calibration",
        );
      }
    }

    const now = new Date();
    if (result.status === "failed") {
      const retryable = result.error?.retryable === true && shard.attempt < shard.maxAttempts;
      await tx
        .update(researchShards)
        .set({
          status: retryable ? "queued" : "failed",
          leasedBy: null,
          leaseTokenHash: null,
          leasedAt: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          resultDigest: result.resultDigest,
          runtimeMs: result.runtimeMs,
          evaluatedCandidates: result.evaluatedCandidates,
          evaluatedRows: result.evaluatedRows,
          error: result.error?.message ?? "worker reported failure",
          completedAt: retryable ? null : now,
          updatedAt: now,
        })
        .where(eq(researchShards.id, shard.id));
      return false;
    }

    for (const { kind, artifact } of resultArtifacts(result)) {
      await tx
        .insert(researchArtifacts)
        .values({
          experimentId: shard.experimentId,
          shardId: shard.id,
          kind,
          contentHash: artifact.contentHash,
          storageUri: artifact.uri,
          format: artifact.format,
          schemaVersion: artifact.schemaVersion,
          byteSize: artifact.byteSize,
          metadata: {},
        })
        .onConflictDoNothing();
    }
    if (result.inlineResults?.length) {
      await tx
        .insert(researchCandidateResults)
        .values(
          result.inlineResults.map((candidate) => ({
            experimentId: shard.experimentId,
            shardId: shard.id,
            stage: shard.stage,
            candidateId: candidate.candidateId,
            targetId: candidate.targetId,
            trades: candidate.trades,
            grossMeanBps: candidate.grossMeanBps,
            netMeanBps: candidate.netMeanBps,
            standardErrorBps: candidate.standardErrorBps,
            lowerConfidenceBoundBps: candidate.lowerConfidenceBoundBps,
            hitRate: candidate.hitRate,
            selectionScore: candidate.selectionScore,
            capitalSummary: candidate.capitalSummary,
            metrics: candidate.metrics,
          })),
        )
        .onConflictDoNothing();
    }
    await tx
      .update(researchShards)
      .set({
        status: "completed",
        resultDigest: result.resultDigest,
        runtimeMs: result.runtimeMs,
        evaluatedCandidates: result.evaluatedCandidates,
        evaluatedRows: result.evaluatedRows,
        leaseExpiresAt: null,
        heartbeatAt: now,
        error: null,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(researchShards.id, shard.id));
    return false;
  });

  await refreshResearchExperimentStatus(result.experimentId);
  return { idempotent };
}

export async function researchValidationFamilySummary(experimentId: string) {
  const [experiment] = await db
    .select({
      id: researchExperiments.id,
      kind: researchExperiments.kind,
      stage: researchExperiments.stage,
      status: researchExperiments.status,
      familySize: researchExperiments.familySize,
      selectionPolicy: researchExperiments.selectionPolicy,
      paperOnly: researchExperiments.paperOnly,
    })
    .from(researchExperiments)
    .where(eq(researchExperiments.id, experimentId))
    .limit(1);
  if (
    !experiment
    || experiment.kind !== "formula"
    || experiment.stage !== "validation"
    || !experiment.paperOnly
  ) {
    throw new Error(
      "validation summary requires a paper-only formula validation experiment",
    );
  }
  const alpha = experiment.selectionPolicy.alpha;
  if (typeof alpha !== "number") {
    throw new Error("validation experiment has no numeric familywise alpha");
  }
  const candidates = await db
    .select({
      candidateId: researchCandidateResults.candidateId,
      targetId: researchCandidateResults.targetId,
      trades: researchCandidateResults.trades,
      netMeanBps: researchCandidateResults.netMeanBps,
      metrics: researchCandidateResults.metrics,
    })
    .from(researchCandidateResults)
    .where(and(
      eq(researchCandidateResults.experimentId, experiment.id),
      eq(researchCandidateResults.stage, "validation"),
    ));
  const family = summarizeResearchValidationFamily({
    expectedFamilySize: experiment.familySize,
    alpha,
    rows: candidates.map((candidate) => {
      const pValue = candidate.metrics?.oneSidedPValue;
      const eligible = candidate.metrics?.eligible;
      return {
        key: `${candidate.targetId}\0${candidate.candidateId}`,
        candidateId: candidate.candidateId,
        targetId: candidate.targetId,
        trades: candidate.trades,
        netMeanBps: candidate.netMeanBps,
        eligible: eligible === true,
        oneSidedPValue:
          typeof pValue === "number" && Number.isFinite(pValue)
            ? pValue
            : null,
      };
    }),
  });
  return {
    experimentId: experiment.id,
    experimentStatus: experiment.status,
    ...family,
    researchReviewEligible:
      experiment.status === "completed"
      && family.researchReviewEligible,
    strategyRegistrationAllowed: false as const,
    executionAllowed: false as const,
  };
}

export async function researchControlPlaneStatus() {
  const [datasets, experiments, shards] = await Promise.all([
    db
      .select({ status: researchDatasetManifests.status, rows: count() })
      .from(researchDatasetManifests)
      .groupBy(researchDatasetManifests.status),
    db
      .select({ status: researchExperiments.status, rows: count() })
      .from(researchExperiments)
      .groupBy(researchExperiments.status),
    db
      .select({ status: researchShards.status, rows: count() })
      .from(researchShards)
      .groupBy(researchShards.status),
  ]);
  return {
    protocolVersion: RESEARCH_PROTOCOL_VERSION,
    executionCapable: false,
    transport: "pull-lease",
    workerDatabaseAccess: false,
    workerVenueCredentialAccess: false,
    datasets: Object.fromEntries(datasets.map((row) => [row.status, Number(row.rows)])),
    experiments: Object.fromEntries(experiments.map((row) => [row.status, Number(row.rows)])),
    shards: Object.fromEntries(shards.map((row) => [row.status, Number(row.rows)])),
  };
}
