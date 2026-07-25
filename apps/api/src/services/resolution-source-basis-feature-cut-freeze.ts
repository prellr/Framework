/**
 * Immutable, outcome-blind preprocessing references for the Chainlink × Hyperliquid basis tape.
 *
 * The artifact can be created only from the separately preregistered distribution audit after all
 * six venue-tape pairs pass their inherited row/span/block floors. It freezes per-pair quantiles
 * and a later strategy boundary; it does not choose a direction, threshold, horizon, market, or
 * paper decision.
 */
import { createHash } from "node:crypto";
import { db, kbArticles } from "@framework/db";
import { eq } from "drizzle-orm";
import {
  RESOLUTION_SOURCE_BASIS_DISTRIBUTION_AUDIT,
} from "./resolution-source-basis-distribution-contract.ts";

const PAIRS = ["BNB-USD", "BTC-USD", "DOGE-USD", "ETH-USD", "SOL-USD", "XRP-USD"] as const;
const METRICS = RESOLUTION_SOURCE_BASIS_DISTRIBUTION_AUDIT.metrics;
const FORBIDDEN_ARTIFACT_KEY =
  /(?:outcome|resolution|label|grade|pnl|winRate|profit|loss|paper|decision|chosenSide|fill|return)/i;

export const RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE = {
  planVersion: "updown-resolution-source-basis-feature-cut-freeze-plan-v1",
  artifactVersion: "updown-resolution-source-basis-feature-cuts-v1",
  prerequisiteVersion: RESOLUTION_SOURCE_BASIS_DISTRIBUTION_AUDIT.version,
  tapeVersion: RESOLUTION_SOURCE_BASIS_DISTRIBUTION_AUDIT.tapeVersion,
  artifactSlug: "updown-resolution-source-basis-feature-cuts-v1",
  minimumBoundaryDelayMs: 30 * 60_000,
  boundaryGridMs: 15 * 60_000,
  requiredPairs: PAIRS.length,
  metrics: METRICS,
  referencePolicy:
    "Retain p05/p25/p50/p75/p95, count, and IQR by pair; no pooled reference is transferable.",
} as const;

export const RESOLUTION_SOURCE_BASIS_FEATURE_CUT_ARTIFACT_START =
  "<!-- RESOLUTION_SOURCE_BASIS_FEATURE_CUT_ARTIFACT_V1_START -->";
export const RESOLUTION_SOURCE_BASIS_FEATURE_CUT_ARTIFACT_END =
  "<!-- RESOLUTION_SOURCE_BASIS_FEATURE_CUT_ARTIFACT_V1_END -->";

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
  rows: number;
  metrics: Record<string, MetricLike>;
};

export type ResolutionSourceBasisDistributionReportLike = {
  buckets: DistributionBucketLike[];
};

export type ResolutionSourceBasisFeatureReference = Quantiles & {
  n: number;
  iqr: number;
};

export type ResolutionSourceBasisFeatureCutBucket = {
  pair: (typeof PAIRS)[number];
  basisBps: ResolutionSourceBasisFeatureReference;
  absoluteBasisBps: ResolutionSourceBasisFeatureReference;
  basisChange1sBps: ResolutionSourceBasisFeatureReference;
  sameSignPersistence5s: ResolutionSourceBasisFeatureReference;
  chainlinkAgeMs: ResolutionSourceBasisFeatureReference;
  hlAgeMs: ResolutionSourceBasisFeatureReference;
};

export type ResolutionSourceBasisFeatureCutArtifact = {
  version: typeof RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.artifactVersion;
  planVersion: typeof RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.planVersion;
  prerequisiteVersion: typeof RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.prerequisiteVersion;
  tapeVersion: typeof RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.tapeVersion;
  frozenAtMs: number;
  strategyNotBeforeMs: number;
  boundaryDelayMs: number;
  boundaryGridMs: number;
  referencePolicy: typeof RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.referencePolicy;
  buckets: ResolutionSourceBasisFeatureCutBucket[];
};

export type ResolutionSourceBasisFeatureCutEnvelope = {
  sha256: string;
  artifact: ResolutionSourceBasisFeatureCutArtifact;
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
      throw new Error(`resolution-source feature-cut artifact blocked at ${path}.${key}`);
    }
    assertOutcomeBlindKeys(child, `${path}.${key}`);
  }
}

function finite(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid resolution-source feature cut: ${label}`);
  }
  return parsed;
}

function metricReference(
  bucket: DistributionBucketLike,
  metricName: (typeof METRICS)[number],
  requirePositiveIqr = false,
): ResolutionSourceBasisFeatureReference {
  const metric = bucket.metrics[metricName];
  if (!metric || !Number.isSafeInteger(metric.n) || metric.n <= 0 || !metric.quantiles) {
    throw new Error(`missing resolution-source feature distribution for ${bucket.pair}/${metricName}`);
  }
  const reference: ResolutionSourceBasisFeatureReference = {
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
    throw new Error(`non-monotone resolution-source distribution for ${bucket.pair}/${metricName}`);
  }
  reference.iqr = reference.p75 - reference.p25;
  if (requirePositiveIqr && reference.iqr <= 0) {
    throw new Error(`degenerate resolution-source distribution for ${bucket.pair}/${metricName}`);
  }
  if (
    metricName === "absoluteBasisBps"
    || metricName === "chainlinkAgeMs"
    || metricName === "hlAgeMs"
  ) {
    if (reference.p05 < 0) {
      throw new Error(`negative non-negative resolution-source metric for ${bucket.pair}/${metricName}`);
    }
  }
  if (
    (metricName === "chainlinkAgeMs" || metricName === "hlAgeMs")
    && reference.p95 > RESOLUTION_SOURCE_BASIS_DISTRIBUTION_AUDIT.maximumSourceAgeMs
  ) {
    throw new Error(`stale resolution-source age reference for ${bucket.pair}/${metricName}`);
  }
  if (
    metricName === "sameSignPersistence5s"
    && (reference.p05 < 0 || reference.p95 > 1)
  ) {
    throw new Error(`invalid persistence reference for ${bucket.pair}/${metricName}`);
  }
  return reference;
}

function assertFrozenReference(
  value: unknown,
  pair: string,
  metricName: (typeof METRICS)[number],
  requirePositiveIqr = false,
): asserts value is ResolutionSourceBasisFeatureReference {
  if (!isRecord(value) || !Number.isSafeInteger(value.n) || Number(value.n) <= 0) {
    throw new Error(`invalid frozen resolution-source reference for ${pair}/${metricName}`);
  }
  const reference = {
    n: Number(value.n),
    p05: finite(value.p05, `${metricName}.p05`),
    p25: finite(value.p25, `${metricName}.p25`),
    p50: finite(value.p50, `${metricName}.p50`),
    p75: finite(value.p75, `${metricName}.p75`),
    p95: finite(value.p95, `${metricName}.p95`),
    iqr: finite(value.iqr, `${metricName}.iqr`),
  };
  const ordered = [
    reference.p05,
    reference.p25,
    reference.p50,
    reference.p75,
    reference.p95,
  ];
  if (ordered.some((item, index) => index > 0 && item < ordered[index - 1])) {
    throw new Error(`non-monotone frozen resolution-source reference for ${pair}/${metricName}`);
  }
  if (Math.abs(reference.iqr - (reference.p75 - reference.p25)) > 1e-12) {
    throw new Error(`invalid frozen resolution-source IQR for ${pair}/${metricName}`);
  }
  if (requirePositiveIqr && reference.iqr <= 0) {
    throw new Error(`degenerate frozen resolution-source reference for ${pair}/${metricName}`);
  }
  if (
    (metricName === "absoluteBasisBps"
      || metricName === "chainlinkAgeMs"
      || metricName === "hlAgeMs")
    && reference.p05 < 0
  ) {
    throw new Error(`negative frozen resolution-source reference for ${pair}/${metricName}`);
  }
  if (
    (metricName === "chainlinkAgeMs" || metricName === "hlAgeMs")
    && reference.p95 > RESOLUTION_SOURCE_BASIS_DISTRIBUTION_AUDIT.maximumSourceAgeMs
  ) {
    throw new Error(`stale frozen resolution-source reference for ${pair}/${metricName}`);
  }
  if (
    metricName === "sameSignPersistence5s"
    && (reference.p05 < 0 || reference.p95 > 1)
  ) {
    throw new Error(`invalid frozen persistence reference for ${pair}/${metricName}`);
  }
}

function pairMap(report: ResolutionSourceBasisDistributionReportLike) {
  if (report.buckets.length !== RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.requiredPairs) {
    throw new Error(
      `resolution-source feature freeze expected ${RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.requiredPairs} pair buckets`,
    );
  }
  const map = new Map<(typeof PAIRS)[number], DistributionBucketLike>();
  for (const bucket of report.buckets) {
    if (!PAIRS.includes(bucket.pair as (typeof PAIRS)[number])) {
      throw new Error("resolution-source feature freeze contains an out-of-scope pair");
    }
    const pair = bucket.pair as (typeof PAIRS)[number];
    if (map.has(pair)) {
      throw new Error(`resolution-source feature freeze contains duplicate ${pair}`);
    }
    map.set(pair, bucket);
  }
  return map;
}

export function nextResolutionSourceBasisStrategyBoundary(frozenAtMs: number): number {
  if (!Number.isSafeInteger(frozenAtMs) || frozenAtMs <= 0) {
    throw new Error("invalid resolution-source feature freeze timestamp");
  }
  const earliest =
    frozenAtMs + RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs;
  return Math.ceil(
    earliest / RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.boundaryGridMs,
  ) * RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.boundaryGridMs;
}

function digestArtifact(artifact: ResolutionSourceBasisFeatureCutArtifact): string {
  return createHash("sha256").update(JSON.stringify(artifact)).digest("hex");
}

export function buildResolutionSourceBasisFeatureCutEnvelope(input: {
  distributionVersion: string;
  tapeVersion: string;
  report: ResolutionSourceBasisDistributionReportLike;
  frozenAtMs: number;
}): ResolutionSourceBasisFeatureCutEnvelope {
  if (
    input.distributionVersion
      !== RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.prerequisiteVersion
    || input.tapeVersion !== RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.tapeVersion
  ) {
    throw new Error("resolution-source feature freeze prerequisite version mismatch");
  }
  const byPair = pairMap(input.report);
  const buckets = PAIRS.map((pair): ResolutionSourceBasisFeatureCutBucket => {
    const bucket = byPair.get(pair);
    if (!bucket) throw new Error(`resolution-source feature freeze missing ${pair}`);
    return {
      pair,
      basisBps: metricReference(bucket, "basisBps", true),
      absoluteBasisBps: metricReference(bucket, "absoluteBasisBps"),
      basisChange1sBps: metricReference(bucket, "basisChange1sBps", true),
      sameSignPersistence5s: metricReference(bucket, "sameSignPersistence5s"),
      chainlinkAgeMs: metricReference(bucket, "chainlinkAgeMs"),
      hlAgeMs: metricReference(bucket, "hlAgeMs"),
    };
  });
  const artifact: ResolutionSourceBasisFeatureCutArtifact = {
    version: RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.artifactVersion,
    planVersion: RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.planVersion,
    prerequisiteVersion: RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.prerequisiteVersion,
    tapeVersion: RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.tapeVersion,
    frozenAtMs: input.frozenAtMs,
    strategyNotBeforeMs: nextResolutionSourceBasisStrategyBoundary(input.frozenAtMs),
    boundaryDelayMs: RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs,
    boundaryGridMs: RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.boundaryGridMs,
    referencePolicy: RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.referencePolicy,
    buckets,
  };
  assertOutcomeBlindKeys(artifact);
  return { sha256: digestArtifact(artifact), artifact };
}

export function assertResolutionSourceBasisFeatureCutEnvelope(
  value: unknown,
): asserts value is ResolutionSourceBasisFeatureCutEnvelope {
  if (!isRecord(value) || typeof value.sha256 !== "string" || !isRecord(value.artifact)) {
    throw new Error("invalid resolution-source feature-cut envelope");
  }
  assertOutcomeBlindKeys(value);
  const artifact = value.artifact as unknown as ResolutionSourceBasisFeatureCutArtifact;
  if (
    artifact.version !== RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.artifactVersion
    || artifact.planVersion !== RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.planVersion
    || artifact.prerequisiteVersion
      !== RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.prerequisiteVersion
    || artifact.tapeVersion !== RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.tapeVersion
    || !Number.isSafeInteger(artifact.frozenAtMs)
    || !Number.isSafeInteger(artifact.strategyNotBeforeMs)
    || artifact.boundaryDelayMs
      !== RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs
    || artifact.boundaryGridMs !== RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.boundaryGridMs
    || artifact.referencePolicy !== RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.referencePolicy
    || artifact.strategyNotBeforeMs < artifact.frozenAtMs + artifact.boundaryDelayMs
    || artifact.strategyNotBeforeMs % artifact.boundaryGridMs !== 0
    || !Array.isArray(artifact.buckets)
    || artifact.buckets.length !== RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.requiredPairs
  ) {
    throw new Error("invalid resolution-source feature-cut artifact contract");
  }
  for (let index = 0; index < PAIRS.length; index++) {
    const expectedPair = PAIRS[index];
    const bucket: unknown = artifact.buckets[index];
    if (!isRecord(bucket) || bucket.pair !== expectedPair) {
      throw new Error("invalid resolution-source feature-cut artifact pair order");
    }
    assertFrozenReference(bucket.basisBps, expectedPair, "basisBps", true);
    assertFrozenReference(bucket.absoluteBasisBps, expectedPair, "absoluteBasisBps");
    assertFrozenReference(bucket.basisChange1sBps, expectedPair, "basisChange1sBps", true);
    assertFrozenReference(
      bucket.sameSignPersistence5s,
      expectedPair,
      "sameSignPersistence5s",
    );
    assertFrozenReference(bucket.chainlinkAgeMs, expectedPair, "chainlinkAgeMs");
    assertFrozenReference(bucket.hlAgeMs, expectedPair, "hlAgeMs");
  }
  if (digestArtifact(artifact) !== value.sha256) {
    throw new Error("resolution-source feature-cut artifact hash mismatch");
  }
}

export function serializeResolutionSourceBasisFeatureCutEnvelope(
  envelope: ResolutionSourceBasisFeatureCutEnvelope,
): string {
  assertResolutionSourceBasisFeatureCutEnvelope(envelope);
  return [
    RESOLUTION_SOURCE_BASIS_FEATURE_CUT_ARTIFACT_START,
    "```json",
    JSON.stringify(envelope, null, 2),
    "```",
    RESOLUTION_SOURCE_BASIS_FEATURE_CUT_ARTIFACT_END,
  ].join("\n");
}

export function parseResolutionSourceBasisFeatureCutEnvelope(
  body: string,
): ResolutionSourceBasisFeatureCutEnvelope {
  const start = body.indexOf(RESOLUTION_SOURCE_BASIS_FEATURE_CUT_ARTIFACT_START);
  const end = body.indexOf(RESOLUTION_SOURCE_BASIS_FEATURE_CUT_ARTIFACT_END);
  if (start < 0 || end <= start) {
    throw new Error("resolution-source feature-cut artifact markers missing");
  }
  const block = body
    .slice(start + RESOLUTION_SOURCE_BASIS_FEATURE_CUT_ARTIFACT_START.length, end)
    .trim()
    .replace(/^```json\s*/, "")
    .replace(/\s*```$/, "");
  const parsed: unknown = JSON.parse(block);
  assertResolutionSourceBasisFeatureCutEnvelope(parsed);
  return parsed;
}

export async function readResolutionSourceBasisFeatureCutEnvelope():
  Promise<ResolutionSourceBasisFeatureCutEnvelope | null> {
  const [article] = await db
    .select({ body: kbArticles.body })
    .from(kbArticles)
    .where(eq(kbArticles.slug, RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.artifactSlug))
    .limit(1);
  return article ? parseResolutionSourceBasisFeatureCutEnvelope(article.body) : null;
}
