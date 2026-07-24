/**
 * Language-neutral wire contracts for Alchemy research compute.
 *
 * These objects are deliberately made only from JSON values. A TypeScript formula worker, a
 * Python ML worker, or a future GPU service can therefore implement the same protocol without
 * importing application code or receiving database, exchange, wallet, or trading credentials.
 */

export const RESEARCH_PROTOCOL_VERSION = "alchemy-research-v2" as const;

export type ResearchStage = "discovery" | "validation";
export type ResearchResourceClass = "cpu" | "memory" | "gpu";
export type ResearchArtifactFormat =
  | "parquet"
  | "arrow"
  | "jsonl"
  | "json"
  | "onnx"
  | "safetensors"
  | "text";

export interface ResearchArtifactRef {
  contentHash: string;
  uri: string;
  format: ResearchArtifactFormat;
  byteSize?: number;
  schemaVersion: string;
}

export interface ResearchColumn {
  name: string;
  dataType:
    | "float64"
    | "float32"
    | "int64"
    | "int32"
    | "boolean"
    | "utf8"
    | "timestamp_ms";
  role: "id" | "event_clock" | "source_clock" | "receive_clock" | "feature" | "label";
  nullable: boolean;
}

export interface ResearchBoundary {
  discoveryStart: string;
  discoveryEnd: string;
  embargoMs: number;
  validationStart?: string;
  validationEnd?: string;
}

export interface ResearchDatasetManifest {
  protocolVersion: typeof RESEARCH_PROTOCOL_VERSION;
  datasetId: string;
  datasetVersion: string;
  contentHash: string;
  artifact: ResearchArtifactRef;
  rowCount: number;
  assets: string[];
  eventStart: string;
  eventEnd: string;
  frozenAt: string;
  availabilityClock: "receive_clock";
  columns: ResearchColumn[];
  boundary: ResearchBoundary;
  labelSpec: Record<string, unknown>;
  sourceSpecs: Array<Record<string, unknown>>;
  targetSpecs: Array<Record<string, unknown>>;
}

export interface ResearchCapitalPolicy {
  startingCapitalUsd: number;
  sizingMode:
    | "fixed-notional"
    | "equity-fraction-notional"
    | "fixed-risk"
    | "equity-fraction-risk";
  sizingValue: number;
  compound: boolean;
  maxGrossExposureFraction: number;
  maxConcurrentPositions: number;
  minNotionalUsd?: number;
  maxNotionalUsd?: number;
  liquidationFloorUsd: number;
}

export interface ResearchWorkerCapabilities {
  protocolVersion: typeof RESEARCH_PROTOCOL_VERSION;
  workerId: string;
  resourceClasses: ResearchResourceClass[];
  evaluatorVersions: string[];
  targetAdapterVersions: string[];
  maxCandidateBatch: number;
}

export interface ResearchShardJob {
  protocolVersion: typeof RESEARCH_PROTOCOL_VERSION;
  experimentId: string;
  shardId: string;
  attempt: number;
  leaseExpiresAt: string;
  stage: ResearchStage;
  resourceClass: ResearchResourceClass;
  dataset: ResearchArtifactRef;
  candidateManifest: ResearchArtifactRef;
  candidateStart: number;
  candidateEnd: number;
  targetId: string;
  targetAdapterVersion: string;
  evaluatorVersion: string;
  costModel: Record<string, unknown>;
  capitalPolicy: ResearchCapitalPolicy;
  seed: number;
}

export interface ResearchCandidateResult {
  candidateId: string;
  targetId: string;
  trades: number;
  grossMeanBps: number | null;
  netMeanBps: number | null;
  standardErrorBps: number | null;
  lowerConfidenceBoundBps: number | null;
  hitRate: number | null;
  selectionScore: number | null;
  capitalSummary?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
}

export interface ResearchShardResult {
  protocolVersion: typeof RESEARCH_PROTOCOL_VERSION;
  experimentId: string;
  shardId: string;
  attempt: number;
  status: "completed" | "failed";
  resultDigest: string;
  runtimeMs: number;
  evaluatedCandidates: number;
  evaluatedRows: number;
  candidateResultsArtifact?: ResearchArtifactRef;
  predictionArtifact?: ResearchArtifactRef;
  modelArtifact?: ResearchArtifactRef;
  logArtifact?: ResearchArtifactRef;
  inlineResults?: ResearchCandidateResult[];
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

const hashPattern = "^sha256:[a-f0-9]{64}$";
const artifactRefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["contentHash", "uri", "format", "schemaVersion"],
  properties: {
    contentHash: { type: "string", pattern: hashPattern },
    uri: { type: "string", minLength: 1 },
    format: {
      enum: ["parquet", "arrow", "jsonl", "json", "onnx", "safetensors", "text"],
    },
    byteSize: { type: "integer", minimum: 0 },
    schemaVersion: { type: "string", minLength: 1 },
  },
} as const;

const capitalPolicySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "startingCapitalUsd",
    "sizingMode",
    "sizingValue",
    "compound",
    "maxGrossExposureFraction",
    "maxConcurrentPositions",
    "liquidationFloorUsd",
  ],
  properties: {
    startingCapitalUsd: { type: "number", exclusiveMinimum: 0 },
    sizingMode: {
      enum: [
        "fixed-notional",
        "equity-fraction-notional",
        "fixed-risk",
        "equity-fraction-risk",
      ],
    },
    sizingValue: { type: "number", exclusiveMinimum: 0 },
    compound: { type: "boolean" },
    maxGrossExposureFraction: { type: "number", exclusiveMinimum: 0 },
    maxConcurrentPositions: { type: "integer", minimum: 1 },
    minNotionalUsd: { type: "number", minimum: 0 },
    maxNotionalUsd: { type: "number", exclusiveMinimum: 0 },
    liquidationFloorUsd: { type: "number", minimum: 0 },
  },
} as const;

const candidateResultSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "candidateId",
    "targetId",
    "trades",
    "grossMeanBps",
    "netMeanBps",
    "standardErrorBps",
    "lowerConfidenceBoundBps",
    "hitRate",
    "selectionScore",
  ],
  properties: {
    candidateId: { type: "string", minLength: 1 },
    targetId: { type: "string", minLength: 1 },
    trades: { type: "integer", minimum: 0 },
    grossMeanBps: { type: ["number", "null"] },
    netMeanBps: { type: ["number", "null"] },
    standardErrorBps: { type: ["number", "null"] },
    lowerConfidenceBoundBps: { type: ["number", "null"] },
    hitRate: {
      anyOf: [
        { type: "number", minimum: 0, maximum: 1 },
        { type: "null" },
      ],
    },
    selectionScore: { type: ["number", "null"] },
    capitalSummary: { type: "object" },
    metrics: { type: "object" },
  },
} as const;

/**
 * JSON Schemas are exported with the TypeScript contracts so non-JS workers can validate the
 * exact same envelopes. The control plane will reject unknown fields and mismatched versions.
 */
export const RESEARCH_JSON_SCHEMAS = {
  artifactRef: artifactRefSchema,
  datasetManifest: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://alchemy.local/schemas/research-dataset-manifest-v2.json",
    type: "object",
    additionalProperties: false,
    required: [
      "protocolVersion",
      "datasetId",
      "datasetVersion",
      "contentHash",
      "artifact",
      "rowCount",
      "assets",
      "eventStart",
      "eventEnd",
      "frozenAt",
      "availabilityClock",
      "columns",
      "boundary",
      "labelSpec",
      "sourceSpecs",
      "targetSpecs",
    ],
    properties: {
      protocolVersion: { const: RESEARCH_PROTOCOL_VERSION },
      datasetId: { type: "string", minLength: 1 },
      datasetVersion: { type: "string", minLength: 1 },
      contentHash: { type: "string", pattern: hashPattern },
      artifact: artifactRefSchema,
      rowCount: { type: "integer", minimum: 1 },
      assets: {
        type: "array",
        minItems: 1,
        uniqueItems: true,
        items: { type: "string", minLength: 1 },
      },
      eventStart: { type: "string", format: "date-time" },
      eventEnd: { type: "string", format: "date-time" },
      frozenAt: { type: "string", format: "date-time" },
      availabilityClock: { const: "receive_clock" },
      columns: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "dataType", "role", "nullable"],
          properties: {
            name: { type: "string", minLength: 1 },
            dataType: {
              enum: [
                "float64",
                "float32",
                "int64",
                "int32",
                "boolean",
                "utf8",
                "timestamp_ms",
              ],
            },
            role: {
              enum: ["id", "event_clock", "source_clock", "receive_clock", "feature", "label"],
            },
            nullable: { type: "boolean" },
          },
        },
      },
      boundary: {
        type: "object",
        additionalProperties: false,
        required: ["discoveryStart", "discoveryEnd", "embargoMs"],
        properties: {
          discoveryStart: { type: "string", format: "date-time" },
          discoveryEnd: { type: "string", format: "date-time" },
          embargoMs: { type: "integer", minimum: 0 },
          validationStart: { type: "string", format: "date-time" },
          validationEnd: { type: "string", format: "date-time" },
        },
      },
      labelSpec: { type: "object" },
      sourceSpecs: { type: "array", items: { type: "object" } },
      targetSpecs: { type: "array", minItems: 1, items: { type: "object" } },
    },
  },
  shardJob: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://alchemy.local/schemas/research-shard-job-v2.json",
    type: "object",
    additionalProperties: false,
    required: [
      "protocolVersion",
      "experimentId",
      "shardId",
      "attempt",
      "leaseExpiresAt",
      "stage",
      "resourceClass",
      "dataset",
      "candidateManifest",
      "candidateStart",
      "candidateEnd",
      "targetId",
      "targetAdapterVersion",
      "evaluatorVersion",
      "costModel",
      "capitalPolicy",
      "seed",
    ],
    properties: {
      protocolVersion: { const: RESEARCH_PROTOCOL_VERSION },
      experimentId: { type: "string", format: "uuid" },
      shardId: { type: "string", format: "uuid" },
      attempt: { type: "integer", minimum: 1 },
      leaseExpiresAt: { type: "string", format: "date-time" },
      stage: { enum: ["discovery", "validation"] },
      resourceClass: { enum: ["cpu", "memory", "gpu"] },
      dataset: artifactRefSchema,
      candidateManifest: artifactRefSchema,
      candidateStart: { type: "integer", minimum: 0 },
      candidateEnd: { type: "integer", minimum: 1 },
      targetId: { type: "string", minLength: 1 },
      targetAdapterVersion: { type: "string", minLength: 1 },
      evaluatorVersion: { type: "string", minLength: 1 },
      costModel: { type: "object" },
      capitalPolicy: capitalPolicySchema,
      seed: { type: "integer" },
    },
  },
  shardResult: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://alchemy.local/schemas/research-shard-result-v2.json",
    type: "object",
    additionalProperties: false,
    required: [
      "protocolVersion",
      "experimentId",
      "shardId",
      "attempt",
      "status",
      "resultDigest",
      "runtimeMs",
      "evaluatedCandidates",
      "evaluatedRows",
    ],
    properties: {
      protocolVersion: { const: RESEARCH_PROTOCOL_VERSION },
      experimentId: { type: "string", format: "uuid" },
      shardId: { type: "string", format: "uuid" },
      attempt: { type: "integer", minimum: 1 },
      status: { enum: ["completed", "failed"] },
      resultDigest: { type: "string", pattern: hashPattern },
      runtimeMs: { type: "integer", minimum: 0 },
      evaluatedCandidates: { type: "integer", minimum: 0 },
      evaluatedRows: { type: "integer", minimum: 0 },
      candidateResultsArtifact: artifactRefSchema,
      predictionArtifact: artifactRefSchema,
      modelArtifact: artifactRefSchema,
      logArtifact: artifactRefSchema,
      inlineResults: {
        type: "array",
        maxItems: 500,
        items: candidateResultSchema,
      },
      error: {
        type: "object",
        additionalProperties: false,
        required: ["code", "message", "retryable"],
        properties: {
          code: { type: "string", minLength: 1 },
          message: { type: "string", minLength: 1 },
          retryable: { type: "boolean" },
        },
      },
    },
  },
} as const;

export function assertResearchBoundary(boundary: ResearchBoundary): void {
  const discoveryStart = Date.parse(boundary.discoveryStart);
  const discoveryEnd = Date.parse(boundary.discoveryEnd);
  const validationStart = boundary.validationStart == null
    ? null
    : Date.parse(boundary.validationStart);
  const validationEnd = boundary.validationEnd == null
    ? null
    : Date.parse(boundary.validationEnd);

  if (!Number.isFinite(discoveryStart) || !Number.isFinite(discoveryEnd)) {
    throw new Error("research boundary requires valid discovery timestamps");
  }
  if (discoveryEnd <= discoveryStart) {
    throw new Error("research discoveryEnd must be after discoveryStart");
  }
  if (!Number.isInteger(boundary.embargoMs) || boundary.embargoMs < 0) {
    throw new Error("research embargoMs must be a non-negative integer");
  }
  if ((validationStart == null) !== (validationEnd == null)) {
    throw new Error("research validationStart and validationEnd must be supplied together");
  }
  if (
    validationStart != null
    && validationEnd != null
    && (
      !Number.isFinite(validationStart)
      || !Number.isFinite(validationEnd)
      || validationStart < discoveryEnd + boundary.embargoMs
      || validationEnd <= validationStart
    )
  ) {
    throw new Error("research validation interval must begin after discovery plus embargo");
  }
}

export function assertResearchCapitalPolicy(policy: ResearchCapitalPolicy): void {
  const sizingModes = new Set<ResearchCapitalPolicy["sizingMode"]>([
    "fixed-notional",
    "equity-fraction-notional",
    "fixed-risk",
    "equity-fraction-risk",
  ]);
  if (!Number.isFinite(policy.startingCapitalUsd) || policy.startingCapitalUsd <= 0) {
    throw new Error("research startingCapitalUsd must be finite and positive");
  }
  if (
    !sizingModes.has(policy.sizingMode)
    || !Number.isFinite(policy.sizingValue)
    || policy.sizingValue <= 0
    || (
      (policy.sizingMode === "equity-fraction-notional"
        || policy.sizingMode === "equity-fraction-risk")
      && policy.sizingValue > 1
    )
  ) {
    throw new Error("research capital sizing mode or value is invalid");
  }
  if (
    typeof policy.compound !== "boolean"
    || !Number.isFinite(policy.maxGrossExposureFraction)
    || policy.maxGrossExposureFraction <= 0
    || !Number.isSafeInteger(policy.maxConcurrentPositions)
    || policy.maxConcurrentPositions < 1
  ) {
    throw new Error("research capital exposure or concurrency policy is invalid");
  }
  const minimum = policy.minNotionalUsd ?? 0;
  const maximum = policy.maxNotionalUsd ?? Number.POSITIVE_INFINITY;
  if (
    !Number.isFinite(minimum)
    || minimum < 0
    || maximum <= 0
    || maximum < minimum
    || !Number.isFinite(policy.liquidationFloorUsd)
    || policy.liquidationFloorUsd < 0
    || policy.liquidationFloorUsd >= policy.startingCapitalUsd
  ) {
    throw new Error("research capital notional or liquidation policy is invalid");
  }
}

export function assertDatasetManifest(manifest: ResearchDatasetManifest): void {
  if (manifest.protocolVersion !== RESEARCH_PROTOCOL_VERSION) {
    throw new Error(`unsupported research protocol ${manifest.protocolVersion}`);
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.contentHash)) {
    throw new Error("dataset contentHash must be sha256:<64 lowercase hex>");
  }
  if (manifest.artifact.contentHash !== manifest.contentHash) {
    throw new Error("dataset and artifact content hashes must match");
  }
  if (!Number.isSafeInteger(manifest.rowCount) || manifest.rowCount < 1) {
    throw new Error("dataset rowCount must be a positive safe integer");
  }
  if (manifest.assets.length === 0 || new Set(manifest.assets).size !== manifest.assets.length) {
    throw new Error("dataset assets must be non-empty and unique");
  }
  if (manifest.availabilityClock !== "receive_clock") {
    throw new Error("research datasets must gate features on receive_clock");
  }
  const receiveClocks = manifest.columns.filter((column) => column.role === "receive_clock");
  if (receiveClocks.length === 0) {
    throw new Error("research dataset must declare at least one receive_clock column");
  }
  assertResearchBoundary(manifest.boundary);
}
