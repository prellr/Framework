import {
  bigint,
  bigserial,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type {
  ResearchBoundary,
  ResearchCapitalPolicy,
  ResearchColumn,
  ResearchResourceClass,
  ResearchStage,
} from "@alchemy/research-protocol";
import { users } from "./users.ts";

const utcTimestamp = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

/**
 * Immutable, content-addressed research datasets.
 *
 * Compute workers read the artifact URI from a leased job. They never query production market
 * tables directly, which protects live collection and makes an experiment exactly reproducible.
 */
export const researchDatasetManifests = pgTable(
  "research_dataset_manifest",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    protocolVersion: text("protocol_version").notNull(),
    datasetKey: text("dataset_key").notNull(),
    datasetVersion: text("dataset_version").notNull(),
    contentHash: text("content_hash").notNull(),
    artifactUri: text("artifact_uri").notNull(),
    artifactFormat: text("artifact_format").notNull(),
    artifactSchemaVersion: text("artifact_schema_version").notNull(),
    rowCount: bigint("row_count", { mode: "number" }).notNull(),
    assets: jsonb("assets").$type<string[]>().notNull(),
    columns: jsonb("columns").$type<ResearchColumn[]>().notNull(),
    eventStart: utcTimestamp("event_start").notNull(),
    eventEnd: utcTimestamp("event_end").notNull(),
    frozenAt: utcTimestamp("frozen_at").notNull(),
    availabilityClock: text("availability_clock").notNull(),
    boundary: jsonb("boundary").$type<ResearchBoundary>().notNull(),
    labelSpec: jsonb("label_spec").$type<Record<string, unknown>>().notNull(),
    sourceSpecs: jsonb("source_specs").$type<Array<Record<string, unknown>>>().notNull(),
    targetSpecs: jsonb("target_specs").$type<Array<Record<string, unknown>>>().notNull(),
    status: text("status").notNull().default("ready"),
    error: text("error"),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("research_dataset_content_hash_uniq").on(t.contentHash),
    uniqueIndex("research_dataset_version_uniq").on(t.datasetKey, t.datasetVersion),
    index("research_dataset_status_idx").on(t.status, t.createdAt),
    check("research_dataset_positive_rows", sql`${t.rowCount} > 0`),
    check(
      "research_dataset_receive_clock",
      sql`${t.availabilityClock} = 'receive_clock'`,
    ),
    check(
      "research_dataset_status_check",
      sql`${t.status} in ('ready', 'superseded', 'failed')`,
    ),
    check(
      "research_dataset_time_order",
      sql`${t.eventEnd} > ${t.eventStart} and ${t.frozenAt} >= ${t.eventEnd}`,
    ),
  ],
);

/**
 * The durable control-plane record for formula, ML, and hybrid experiments.
 *
 * `paperOnly` is both an application statement and a database invariant. This table has no
 * strategy-registration, order, wallet, venue credential, or execution fields.
 */
export const researchExperiments = pgTable(
  "research_experiment",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestedByUserId: text("requested_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    kind: text("kind").notNull(), // formula | ml | hybrid
    status: text("status").notNull().default("draft"),
    stage: text("stage").$type<ResearchStage>().notNull().default("discovery"),
    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => researchDatasetManifests.id, { onDelete: "restrict" }),
    candidateManifestHash: text("candidate_manifest_hash").notNull(),
    candidateManifestUri: text("candidate_manifest_uri").notNull(),
    candidateManifestFormat: text("candidate_manifest_format").notNull(),
    candidateManifestSchemaVersion: text("candidate_manifest_schema_version").notNull(),
    candidateCount: integer("candidate_count").notNull(),
    targetIds: jsonb("target_ids").$type<string[]>().notNull(),
    familySize: bigint("family_size", { mode: "number" }).notNull(),
    shardSize: integer("shard_size").notNull(),
    resourceClass: text("resource_class").$type<ResearchResourceClass>().notNull(),
    evaluatorVersion: text("evaluator_version").notNull(),
    targetAdapterVersion: text("target_adapter_version").notNull(),
    costModel: jsonb("cost_model").$type<Record<string, unknown>>().notNull(),
    capitalPolicy: jsonb("capital_policy").$type<ResearchCapitalPolicy>().notNull(),
    selectionPolicy: jsonb("selection_policy").$type<Record<string, unknown>>().notNull(),
    seed: integer("seed").notNull(),
    validationBoundaryAt: utcTimestamp("validation_boundary_at"),
    paperOnly: boolean("paper_only").notNull().default(true),
    error: text("error"),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    startedAt: utcTimestamp("started_at"),
    completedAt: utcTimestamp("completed_at"),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("research_experiment_status_idx").on(t.status, t.createdAt),
    index("research_experiment_dataset_idx").on(t.datasetId, t.createdAt),
    check(
      "research_experiment_kind_check",
      sql`${t.kind} in ('formula', 'ml', 'hybrid')`,
    ),
    check(
      "research_experiment_status_check",
      sql`${t.status} in (
        'draft', 'queued', 'running', 'discovery_complete', 'frozen',
        'validation_running', 'completed', 'failed', 'canceled'
      )`,
    ),
    check(
      "research_experiment_stage_check",
      sql`${t.stage} in ('discovery', 'validation')`,
    ),
    check(
      "research_experiment_resource_check",
      sql`${t.resourceClass} in ('cpu', 'memory', 'gpu')`,
    ),
    check(
      "research_experiment_positive_counts",
      sql`${t.candidateCount} > 0 and ${t.familySize} > 0 and ${t.shardSize} > 0`,
    ),
    check("research_experiment_paper_only", sql`${t.paperOnly} = true`),
  ],
);

/**
 * A bounded unit of research work. External workers acquire short leases through the control API,
 * heartbeat them, and commit one content-hashed result. Lease tokens are stored only as hashes.
 */
export const researchShards = pgTable(
  "research_shard",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    experimentId: uuid("experiment_id")
      .notNull()
      .references(() => researchExperiments.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    stage: text("stage").$type<ResearchStage>().notNull(),
    targetId: text("target_id").notNull(),
    candidateStart: integer("candidate_start").notNull(),
    candidateEnd: integer("candidate_end").notNull(),
    resourceClass: text("resource_class").$type<ResearchResourceClass>().notNull(),
    priority: integer("priority").notNull().default(0),
    status: text("status").notNull().default("queued"),
    attempt: integer("attempt").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    leasedBy: text("leased_by"),
    leaseTokenHash: text("lease_token_hash"),
    leasedAt: utcTimestamp("leased_at"),
    leaseExpiresAt: utcTimestamp("lease_expires_at"),
    heartbeatAt: utcTimestamp("heartbeat_at"),
    resultDigest: text("result_digest"),
    runtimeMs: integer("runtime_ms"),
    evaluatedCandidates: integer("evaluated_candidates"),
    evaluatedRows: bigint("evaluated_rows", { mode: "number" }),
    error: text("error"),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
    completedAt: utcTimestamp("completed_at"),
  },
  (t) => [
    uniqueIndex("research_shard_ordinal_uniq").on(t.experimentId, t.ordinal),
    uniqueIndex("research_shard_partition_uniq").on(
      t.experimentId,
      t.stage,
      t.targetId,
      t.candidateStart,
      t.candidateEnd,
    ),
    index("research_shard_lease_idx").on(
      t.status,
      t.resourceClass,
      t.priority,
      t.leaseExpiresAt,
    ),
    index("research_shard_experiment_idx").on(t.experimentId, t.status),
    check(
      "research_shard_status_check",
      sql`${t.status} in ('queued', 'leased', 'completed', 'failed', 'canceled')`,
    ),
    check(
      "research_shard_stage_check",
      sql`${t.stage} in ('discovery', 'validation')`,
    ),
    check(
      "research_shard_resource_check",
      sql`${t.resourceClass} in ('cpu', 'memory', 'gpu')`,
    ),
    check(
      "research_shard_candidate_range",
      sql`${t.candidateStart} >= 0 and ${t.candidateEnd} > ${t.candidateStart}`,
    ),
    check(
      "research_shard_attempts",
      sql`${t.attempt} >= 0 and ${t.maxAttempts} > 0`,
    ),
  ],
);

/**
 * Content-addressed outputs. Large predictions, models, trades, and logs live outside Postgres;
 * only their immutable provenance and storage reference are retained here.
 */
export const researchArtifacts = pgTable(
  "research_artifact",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    experimentId: uuid("experiment_id")
      .notNull()
      .references(() => researchExperiments.id, { onDelete: "cascade" }),
    shardId: uuid("shard_id").references(() => researchShards.id, {
      onDelete: "set null",
    }),
    kind: text("kind").notNull(),
    contentHash: text("content_hash").notNull(),
    storageUri: text("storage_uri").notNull(),
    format: text("format").notNull(),
    schemaVersion: text("schema_version").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("research_artifact_content_uniq").on(
      t.experimentId,
      t.kind,
      t.contentHash,
    ),
    index("research_artifact_shard_idx").on(t.shardId, t.kind),
    check(
      "research_artifact_kind_check",
      sql`${t.kind} in (
        'candidate-results', 'predictions', 'model', 'trades', 'equity',
        'segments', 'logs', 'selection-manifest'
      )`,
    ),
    check(
      "research_artifact_byte_size",
      sql`${t.byteSize} is null or ${t.byteSize} >= 0`,
    ),
  ],
);

/**
 * Compact query model for ranking and visualization. Full prediction/trade series stay in the
 * associated artifact so UI reads cannot overload the collection database.
 */
export const researchCandidateResults = pgTable(
  "research_candidate_result",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    experimentId: uuid("experiment_id")
      .notNull()
      .references(() => researchExperiments.id, { onDelete: "cascade" }),
    shardId: uuid("shard_id")
      .notNull()
      .references(() => researchShards.id, { onDelete: "cascade" }),
    stage: text("stage").$type<ResearchStage>().notNull(),
    candidateId: text("candidate_id").notNull(),
    targetId: text("target_id").notNull(),
    trades: integer("trades").notNull(),
    grossMeanBps: doublePrecision("gross_mean_bps"),
    netMeanBps: doublePrecision("net_mean_bps"),
    standardErrorBps: doublePrecision("standard_error_bps"),
    lowerConfidenceBoundBps: doublePrecision("lower_confidence_bound_bps"),
    hitRate: doublePrecision("hit_rate"),
    selectionScore: doublePrecision("selection_score"),
    capitalSummary: jsonb("capital_summary").$type<Record<string, unknown>>(),
    metrics: jsonb("metrics").$type<Record<string, unknown>>(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("research_candidate_result_uniq").on(
      t.experimentId,
      t.stage,
      t.candidateId,
      t.targetId,
    ),
    index("research_candidate_rank_idx").on(
      t.experimentId,
      t.stage,
      t.selectionScore,
    ),
    index("research_candidate_target_idx").on(
      t.experimentId,
      t.targetId,
      t.netMeanBps,
    ),
    check(
      "research_candidate_result_stage_check",
      sql`${t.stage} in ('discovery', 'validation')`,
    ),
    check("research_candidate_result_trades", sql`${t.trades} >= 0`),
    check(
      "research_candidate_result_hit_rate",
      sql`${t.hitRate} is null or (${t.hitRate} >= 0 and ${t.hitRate} <= 1)`,
    ),
  ],
);
