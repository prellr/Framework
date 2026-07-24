import { z } from "zod";
import { RESEARCH_PROTOCOL_VERSION } from "@alchemy/research-protocol";

const artifactSchema = z.object({
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  uri: z.string().min(1),
  format: z.enum([
    "parquet",
    "arrow",
    "jsonl",
    "json",
    "onnx",
    "safetensors",
    "text",
  ]),
  byteSize: z.number().int().nonnegative().optional(),
  schemaVersion: z.string().min(1),
}).strict();

const candidateResultSchema = z.object({
  candidateId: z.string().min(1),
  targetId: z.string().min(1),
  trades: z.number().int().nonnegative(),
  grossMeanBps: z.number().finite().nullable(),
  netMeanBps: z.number().finite().nullable(),
  standardErrorBps: z.number().finite().nullable(),
  lowerConfidenceBoundBps: z.number().finite().nullable(),
  hitRate: z.number().min(0).max(1).nullable(),
  selectionScore: z.number().finite().nullable(),
  capitalSummary: z.record(z.unknown()).optional(),
  metrics: z.record(z.unknown()).optional(),
}).strict();

/** The exact result envelope accepted from both TypeScript and non-JS workers. */
export const researchShardResultSchema = z.object({
  protocolVersion: z.literal(RESEARCH_PROTOCOL_VERSION),
  experimentId: z.string().uuid(),
  shardId: z.string().uuid(),
  attempt: z.number().int().positive(),
  status: z.enum(["completed", "failed"]),
  resultDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  runtimeMs: z.number().int().nonnegative(),
  evaluatedCandidates: z.number().int().nonnegative(),
  evaluatedRows: z.number().int().nonnegative(),
  candidateResultsArtifact: artifactSchema.optional(),
  predictionArtifact: artifactSchema.optional(),
  modelArtifact: artifactSchema.optional(),
  logArtifact: artifactSchema.optional(),
  inlineResults: z.array(candidateResultSchema).max(500).optional(),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
  }).strict().optional(),
}).strict().superRefine((value, context) => {
  if (value.status === "completed" && value.error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "completed results cannot include an error",
      path: ["error"],
    });
  }
  if (value.status === "failed" && !value.error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "failed results require an error",
      path: ["error"],
    });
  }
});
