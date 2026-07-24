/**
 * Deterministic, outcome-blind normalization artifact for paired-book liquidity state.
 *
 * This freezes complete per-asset/per-horizon/per-sample-minute references after the inherited
 * distribution gate passes. It chooses no eligible state, side, ask cap, decision minute, or paper
 * identity and has no account/order dependency.
 */
import { createHash } from "node:crypto";
import { db, kbArticles } from "@framework/db";
import { eq } from "drizzle-orm";
import {
  expectedMicrostructureStateBucketKeys,
  MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT,
} from "./microstructure-state-distribution-contract.ts";

const METRICS = MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.metrics;
const FORBIDDEN_ARTIFACT_KEY =
  /(?:outcome|resolution|label|grade|pnl|winRate|profit|loss|paper|decision|chosenSide|fill)/i;

export const MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE = {
  planVersion: "updown-microstructure-state-feature-cut-freeze-plan-v1",
  artifactVersion: "updown-microstructure-state-feature-cuts-v1",
  prerequisiteVersion: MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.version,
  artifactSlug: "updown-microstructure-state-feature-cuts-v1",
  minimumBoundaryDelayMs: 30 * 60_000,
  boundaryGridMs: 15 * 60_000,
  requiredBuckets: MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.expectedBuckets,
  minMarketsPerBucket: MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.minMarketsPerBucket,
  metrics: METRICS,
  positiveIqrMetrics: ["micropriceSkew", "touchPressure"] as const,
} as const;

export const STATE_FEATURE_CUT_ARTIFACT_START =
  "<!-- MICROSTRUCTURE_STATE_FEATURE_CUT_ARTIFACT_V1_START -->";
export const STATE_FEATURE_CUT_ARTIFACT_END =
  "<!-- MICROSTRUCTURE_STATE_FEATURE_CUT_ARTIFACT_V1_END -->";

type Quantiles = {
  p05: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
};

type MetricLike = {
  n: number;
  quantiles: Quantiles | null;
};

type DistributionBucketLike = {
  pair: string | null;
  horizonMin: number | null;
  sampleMinute: number | null;
  markets: number;
  metrics: Record<string, MetricLike>;
};

export type StateDistributionReportLike = {
  expectedBuckets: number;
  completeBuckets: number;
  missingBuckets: string[];
  minBucketMarkets: number;
  readyForCutFreeze: boolean;
  buckets: DistributionBucketLike[];
};

export type StateRobustReference = Quantiles & {
  n: number;
  iqr: number;
};

export type MicrostructureStateFeatureCutBucket = {
  pair: string;
  horizonMin: 5 | 15;
  sampleMinute: number;
  markets: number;
  metrics: Record<(typeof METRICS)[number], StateRobustReference>;
};

export type MicrostructureStateFeatureCutArtifact = {
  version: typeof MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.artifactVersion;
  planVersion: typeof MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.planVersion;
  prerequisiteVersion: typeof MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.prerequisiteVersion;
  tapeVersion: typeof MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.tapeVersion;
  frozenAtMs: number;
  strategyNotBeforeMs: number;
  boundaryDelayMs: number;
  boundaryGridMs: number;
  buckets: MicrostructureStateFeatureCutBucket[];
};

export type MicrostructureStateFeatureCutEnvelope = {
  sha256: string;
  artifact: MicrostructureStateFeatureCutArtifact;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

function assertOutcomeBlindKeys(value: unknown, path = "artifact"): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertOutcomeBlindKeys(child, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_ARTIFACT_KEY.test(key)) {
      throw new Error(`microstructure-state cut artifact blocked at ${path}.${key}`);
    }
    assertOutcomeBlindKeys(child, `${path}.${key}`);
  }
}

function finite(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`invalid microstructure-state cut: ${label}`);
  return parsed;
}

function metricReference(
  bucket: DistributionBucketLike,
  metricName: (typeof METRICS)[number],
): StateRobustReference {
  const metric = bucket.metrics[metricName];
  if (!metric || !Number.isSafeInteger(metric.n) || metric.n <= 0 || !metric.quantiles) {
    throw new Error(
      `missing microstructure-state distribution for ${bucket.pair}/${bucket.horizonMin}/${bucket.sampleMinute}/${metricName}`,
    );
  }
  const reference: StateRobustReference = {
    n: metric.n,
    p05: finite(metric.quantiles.p05, `${metricName}.p05`),
    p25: finite(metric.quantiles.p25, `${metricName}.p25`),
    p50: finite(metric.quantiles.p50, `${metricName}.p50`),
    p75: finite(metric.quantiles.p75, `${metricName}.p75`),
    p95: finite(metric.quantiles.p95, `${metricName}.p95`),
    iqr: 0,
  };
  const ordered = [
    reference.p05,
    reference.p25,
    reference.p50,
    reference.p75,
    reference.p95,
  ];
  if (ordered.some((value, index) => index > 0 && value < ordered[index - 1])) {
    throw new Error(
      `non-monotone microstructure-state distribution for ${bucket.pair}/${bucket.horizonMin}/${bucket.sampleMinute}/${metricName}`,
    );
  }
  reference.iqr = reference.p75 - reference.p25;
  if (
    MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.positiveIqrMetrics.includes(
      metricName as (typeof MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.positiveIqrMetrics)[number],
    )
    && reference.iqr <= 0
  ) {
    throw new Error(
      `degenerate microstructure-state distribution for ${bucket.pair}/${bucket.horizonMin}/${bucket.sampleMinute}/${metricName}`,
    );
  }
  return reference;
}

function bucketMap(report: StateDistributionReportLike) {
  if (
    !report.readyForCutFreeze
    || report.expectedBuckets !== MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.requiredBuckets
    || report.completeBuckets !== MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.requiredBuckets
    || report.missingBuckets.length !== 0
    || report.minBucketMarkets < MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.minMarketsPerBucket
    || report.buckets.length !== MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.requiredBuckets
  ) {
    throw new Error("microstructure-state feature cuts require a complete ready distribution");
  }
  const expected = new Set(expectedMicrostructureStateBucketKeys());
  const map = new Map<string, DistributionBucketLike>();
  for (const bucket of report.buckets) {
    const key = `${bucket.pair}:${bucket.horizonMin}:${bucket.sampleMinute}`;
    if (!expected.has(key)) {
      throw new Error("microstructure-state feature cuts contain an out-of-scope bucket");
    }
    if (
      !Number.isSafeInteger(bucket.markets)
      || bucket.markets < MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.minMarketsPerBucket
    ) {
      throw new Error(`microstructure-state feature cuts have insufficient support for ${key}`);
    }
    if (map.has(key)) {
      throw new Error(`microstructure-state feature cuts contain duplicate ${key}`);
    }
    map.set(key, bucket);
  }
  return map;
}

export function nextMicrostructureStateStrategyBoundary(frozenAtMs: number): number {
  if (!Number.isSafeInteger(frozenAtMs) || frozenAtMs <= 0) {
    throw new Error("invalid microstructure-state feature freeze timestamp");
  }
  const earliest =
    frozenAtMs + MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs;
  return Math.ceil(earliest / MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.boundaryGridMs)
    * MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.boundaryGridMs;
}

function digestArtifact(artifact: MicrostructureStateFeatureCutArtifact): string {
  return createHash("sha256").update(JSON.stringify(artifact)).digest("hex");
}

export function buildMicrostructureStateFeatureCutEnvelope(input: {
  distributionVersion: string;
  tapeVersion: string;
  report: StateDistributionReportLike;
  frozenAtMs: number;
}): MicrostructureStateFeatureCutEnvelope {
  if (
    input.distributionVersion
      !== MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.prerequisiteVersion
    || input.tapeVersion !== MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.tapeVersion
  ) {
    throw new Error("microstructure-state feature freeze prerequisite version mismatch");
  }
  const source = bucketMap(input.report);
  const buckets = expectedMicrostructureStateBucketKeys().map((key) => {
    const bucket = source.get(key);
    if (!bucket || bucket.pair == null || bucket.horizonMin == null || bucket.sampleMinute == null) {
      throw new Error(`microstructure-state feature freeze missing bucket ${key}`);
    }
    const metrics = Object.fromEntries(
      METRICS.map((metricName) => [metricName, metricReference(bucket, metricName)]),
    ) as MicrostructureStateFeatureCutBucket["metrics"];
    return {
      pair: bucket.pair,
      horizonMin: bucket.horizonMin as 5 | 15,
      sampleMinute: bucket.sampleMinute,
      markets: bucket.markets,
      metrics,
    };
  });
  const artifact: MicrostructureStateFeatureCutArtifact = {
    version: MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.artifactVersion,
    planVersion: MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.planVersion,
    prerequisiteVersion: MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.prerequisiteVersion,
    tapeVersion: MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.tapeVersion,
    frozenAtMs: input.frozenAtMs,
    strategyNotBeforeMs: nextMicrostructureStateStrategyBoundary(input.frozenAtMs),
    boundaryDelayMs: MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs,
    boundaryGridMs: MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.boundaryGridMs,
    buckets,
  };
  assertOutcomeBlindKeys(artifact);
  return { sha256: digestArtifact(artifact), artifact };
}

export function serializeMicrostructureStateFeatureCutEnvelope(
  envelope: MicrostructureStateFeatureCutEnvelope,
): string {
  assertMicrostructureStateFeatureCutEnvelope(envelope);
  return [
    STATE_FEATURE_CUT_ARTIFACT_START,
    "```json",
    JSON.stringify(envelope, null, 2),
    "```",
    STATE_FEATURE_CUT_ARTIFACT_END,
  ].join("\n");
}

export function assertMicrostructureStateFeatureCutEnvelope(
  value: unknown,
): asserts value is MicrostructureStateFeatureCutEnvelope {
  if (!isRecord(value) || typeof value.sha256 !== "string" || !isRecord(value.artifact)) {
    throw new Error("invalid microstructure-state feature-cut envelope");
  }
  assertOutcomeBlindKeys(value);
  const artifact = value.artifact as unknown as MicrostructureStateFeatureCutArtifact;
  if (
    artifact.version !== MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.artifactVersion
    || artifact.planVersion !== MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.planVersion
    || artifact.prerequisiteVersion
      !== MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.prerequisiteVersion
    || artifact.tapeVersion !== MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.tapeVersion
    || !Number.isSafeInteger(artifact.frozenAtMs)
    || !Number.isSafeInteger(artifact.strategyNotBeforeMs)
    || artifact.boundaryDelayMs
      !== MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs
    || artifact.boundaryGridMs !== MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.boundaryGridMs
    || artifact.strategyNotBeforeMs < artifact.frozenAtMs + artifact.boundaryDelayMs
    || artifact.strategyNotBeforeMs % artifact.boundaryGridMs !== 0
    || !Array.isArray(artifact.buckets)
    || artifact.buckets.length !== MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.requiredBuckets
  ) {
    throw new Error("invalid microstructure-state feature-cut artifact contract");
  }
  const keys = artifact.buckets.map(
    (bucket) => `${bucket.pair}:${bucket.horizonMin}:${bucket.sampleMinute}`,
  );
  if (JSON.stringify(keys) !== JSON.stringify(expectedMicrostructureStateBucketKeys())) {
    throw new Error("invalid microstructure-state feature-cut bucket order");
  }
  if (digestArtifact(artifact) !== value.sha256) {
    throw new Error("microstructure-state feature-cut artifact hash mismatch");
  }
}

export function parseMicrostructureStateFeatureCutEnvelope(
  body: string,
): MicrostructureStateFeatureCutEnvelope {
  const start = body.indexOf(STATE_FEATURE_CUT_ARTIFACT_START);
  const end = body.indexOf(STATE_FEATURE_CUT_ARTIFACT_END);
  if (start < 0 || end <= start) {
    throw new Error("microstructure-state feature-cut artifact markers missing");
  }
  const block = body
    .slice(start + STATE_FEATURE_CUT_ARTIFACT_START.length, end)
    .trim()
    .replace(/^```json\s*/, "")
    .replace(/\s*```$/, "");
  const parsed: unknown = JSON.parse(block);
  assertMicrostructureStateFeatureCutEnvelope(parsed);
  return parsed;
}

export async function readMicrostructureStateFeatureCutEnvelope():
Promise<MicrostructureStateFeatureCutEnvelope | null> {
  const [article] = await db
    .select({ body: kbArticles.body })
    .from(kbArticles)
    .where(eq(kbArticles.slug, MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.artifactSlug))
    .limit(1);
  return article ? parseMicrostructureStateFeatureCutEnvelope(article.body) : null;
}
