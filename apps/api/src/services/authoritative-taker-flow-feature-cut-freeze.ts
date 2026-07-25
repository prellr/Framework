/**
 * Deterministic, outcome-blind normalization artifact for authoritative taker-flow intensity.
 *
 * The artifact freezes unsigned chain-derived liquidity/timing references only. It cannot select a
 * token, side, direction, outcome, paper identity, ask cap, decision time, or execution action.
 */
import { createHash } from "node:crypto";
import { db, kbArticles } from "@framework/db";
import { eq } from "drizzle-orm";
import {
  AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT,
  expectedAuthoritativeTakerFlowBucketKeys,
} from "./authoritative-taker-flow-distribution-contract.ts";

const METRICS = AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.metrics;
const FORBIDDEN_ARTIFACT_KEY =
  /(?:outcome|resolution|label|grade|pnl|winRate|profit|loss|paper|decision|direction|position|account|wallet|order|chosenSide|fill|side|token)/i;

export const AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE = {
  planVersion: "updown-authoritative-taker-flow-feature-cut-freeze-plan-v1",
  artifactVersion: "updown-authoritative-taker-flow-feature-cuts-v1",
  prerequisiteVersion: AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.version,
  artifactSlug: "updown-authoritative-taker-flow-feature-cuts-v1",
  minimumBoundaryDelayMs: 30 * 60_000,
  boundaryGridMs: 15 * 60_000,
  requiredBuckets: AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.expectedBuckets,
  minMarketsPerBucket: AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.minMarketsPerBucket,
  metrics: METRICS,
  positiveIqrMetrics: [
    "logChainNotionalUsd",
    "absoluteChainPriceDistanceBps",
    "secondsFromWindowStart",
  ] as const,
} as const;

export const AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_ARTIFACT_START =
  "<!-- AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_ARTIFACT_V1_START -->";
export const AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_ARTIFACT_END =
  "<!-- AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_ARTIFACT_V1_END -->";

type Quantiles = {
  p05: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
};
type MetricLike = { n: number; quantiles: Quantiles | null };
type DistributionBucketLike = {
  pair: string | null;
  horizonMin: number | null;
  markets: number;
  metrics: Record<string, MetricLike>;
};
export type AuthoritativeTakerFlowDistributionReportLike = {
  expectedBuckets: number;
  completeBuckets: number;
  missingBuckets: string[];
  minBucketMarkets: number;
  readyForCutFreeze: boolean;
  buckets: DistributionBucketLike[];
};
export type AuthoritativeTakerFlowRobustReference = Quantiles & {
  n: number;
  iqr: number;
};
export type AuthoritativeTakerFlowFeatureCutBucket = {
  pair: string;
  horizonMin: 5 | 15;
  markets: number;
  metrics: Record<
    (typeof METRICS)[number],
    AuthoritativeTakerFlowRobustReference
  >;
};
export type AuthoritativeTakerFlowFeatureCutArtifact = {
  version: typeof AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.artifactVersion;
  planVersion: typeof AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.planVersion;
  prerequisiteVersion:
    typeof AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.prerequisiteVersion;
  tapeVersion: typeof AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.tapeVersion;
  frozenAtMs: number;
  strategyNotBeforeMs: number;
  boundaryDelayMs: number;
  boundaryGridMs: number;
  buckets: AuthoritativeTakerFlowFeatureCutBucket[];
};
export type AuthoritativeTakerFlowFeatureCutEnvelope = {
  sha256: string;
  artifact: AuthoritativeTakerFlowFeatureCutArtifact;
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
      throw new Error(`authoritative taker-flow cut artifact blocked at ${path}.${key}`);
    }
    assertOutcomeBlindKeys(child, `${path}.${key}`);
  }
}

function finite(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid authoritative taker-flow cut: ${label}`);
  }
  return parsed;
}

function metricReference(
  bucket: DistributionBucketLike,
  metricName: (typeof METRICS)[number],
): AuthoritativeTakerFlowRobustReference {
  const metric = bucket.metrics[metricName];
  if (!metric || !Number.isSafeInteger(metric.n) || metric.n <= 0 || !metric.quantiles) {
    throw new Error(
      `missing authoritative taker-flow distribution for ${bucket.pair}/${bucket.horizonMin}/${metricName}`,
    );
  }
  const reference: AuthoritativeTakerFlowRobustReference = {
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
      `non-monotone authoritative taker-flow distribution for ${bucket.pair}/${bucket.horizonMin}/${metricName}`,
    );
  }
  reference.iqr = reference.p75 - reference.p25;
  if (
    AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.positiveIqrMetrics.includes(
      metricName as
        (typeof AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.positiveIqrMetrics)[number],
    )
    && reference.iqr <= 0
  ) {
    throw new Error(
      `degenerate authoritative taker-flow distribution for ${bucket.pair}/${bucket.horizonMin}/${metricName}`,
    );
  }
  if (reference.p05 < 0) {
    throw new Error(
      `negative authoritative taker-flow reference for ${bucket.pair}/${bucket.horizonMin}/${metricName}`,
    );
  }
  if (
    metricName === "secondsFromWindowStart"
    && reference.p95 > Number(bucket.horizonMin) * 60
  ) {
    throw new Error(
      `out-of-window authoritative taker-flow reference for ${bucket.pair}/${bucket.horizonMin}`,
    );
  }
  if (
    metricName === "chainConfirmations"
    && reference.p05 < 20
  ) {
    throw new Error(
      `under-confirmed authoritative taker-flow reference for ${bucket.pair}/${bucket.horizonMin}`,
    );
  }
  return reference;
}

function bucketMap(report: AuthoritativeTakerFlowDistributionReportLike) {
  if (
    !report.readyForCutFreeze
    || report.expectedBuckets !== AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.requiredBuckets
    || report.completeBuckets !== AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.requiredBuckets
    || report.missingBuckets.length !== 0
    || report.minBucketMarkets
      < AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.minMarketsPerBucket
    || report.buckets.length !== AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.requiredBuckets
  ) {
    throw new Error("authoritative taker-flow feature cuts require a complete ready distribution");
  }
  const expected = new Set(expectedAuthoritativeTakerFlowBucketKeys());
  const map = new Map<string, DistributionBucketLike>();
  for (const bucket of report.buckets) {
    const key = `${bucket.pair}:${bucket.horizonMin}`;
    if (!expected.has(key)) {
      throw new Error("authoritative taker-flow feature cuts contain an out-of-scope bucket");
    }
    if (
      !Number.isSafeInteger(bucket.markets)
      || bucket.markets < AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.minMarketsPerBucket
    ) {
      throw new Error(`authoritative taker-flow feature cuts have insufficient support for ${key}`);
    }
    if (map.has(key)) {
      throw new Error(`authoritative taker-flow feature cuts contain duplicate ${key}`);
    }
    map.set(key, bucket);
  }
  return map;
}

export function nextAuthoritativeTakerFlowStrategyBoundary(frozenAtMs: number): number {
  if (!Number.isSafeInteger(frozenAtMs) || frozenAtMs <= 0) {
    throw new Error("invalid authoritative taker-flow feature freeze timestamp");
  }
  const earliest =
    frozenAtMs + AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs;
  return Math.ceil(
    earliest / AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.boundaryGridMs,
  ) * AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.boundaryGridMs;
}

function digestArtifact(artifact: AuthoritativeTakerFlowFeatureCutArtifact): string {
  return createHash("sha256").update(JSON.stringify(artifact)).digest("hex");
}

export function buildAuthoritativeTakerFlowFeatureCutEnvelope(input: {
  distributionVersion: string;
  tapeVersion: string;
  report: AuthoritativeTakerFlowDistributionReportLike;
  frozenAtMs: number;
}): AuthoritativeTakerFlowFeatureCutEnvelope {
  if (
    input.distributionVersion
      !== AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.prerequisiteVersion
    || input.tapeVersion !== AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.tapeVersion
  ) {
    throw new Error("authoritative taker-flow feature freeze prerequisite version mismatch");
  }
  const source = bucketMap(input.report);
  const buckets = expectedAuthoritativeTakerFlowBucketKeys().map((key) => {
    const bucket = source.get(key);
    if (!bucket || bucket.pair == null || bucket.horizonMin == null) {
      throw new Error(`authoritative taker-flow feature freeze missing bucket ${key}`);
    }
    const metrics = Object.fromEntries(
      METRICS.map((metricName) => [metricName, metricReference(bucket, metricName)]),
    ) as AuthoritativeTakerFlowFeatureCutBucket["metrics"];
    return {
      pair: bucket.pair,
      horizonMin: bucket.horizonMin as 5 | 15,
      markets: bucket.markets,
      metrics,
    };
  });
  const artifact: AuthoritativeTakerFlowFeatureCutArtifact = {
    version: AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.artifactVersion,
    planVersion: AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.planVersion,
    prerequisiteVersion:
      AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.prerequisiteVersion,
    tapeVersion: AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.tapeVersion,
    frozenAtMs: input.frozenAtMs,
    strategyNotBeforeMs: nextAuthoritativeTakerFlowStrategyBoundary(input.frozenAtMs),
    boundaryDelayMs: AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs,
    boundaryGridMs: AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.boundaryGridMs,
    buckets,
  };
  assertOutcomeBlindKeys(artifact);
  return { sha256: digestArtifact(artifact), artifact };
}

export function serializeAuthoritativeTakerFlowFeatureCutEnvelope(
  envelope: AuthoritativeTakerFlowFeatureCutEnvelope,
): string {
  assertAuthoritativeTakerFlowFeatureCutEnvelope(envelope);
  return [
    AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_ARTIFACT_START,
    "```json",
    JSON.stringify(envelope, null, 2),
    "```",
    AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_ARTIFACT_END,
  ].join("\n");
}

export function assertAuthoritativeTakerFlowFeatureCutEnvelope(
  value: unknown,
): asserts value is AuthoritativeTakerFlowFeatureCutEnvelope {
  if (
    !isRecord(value)
    || typeof value.sha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(value.sha256)
    || !isRecord(value.artifact)
  ) {
    throw new Error("invalid authoritative taker-flow feature-cut envelope");
  }
  assertOutcomeBlindKeys(value);
  const artifact = value.artifact as unknown as AuthoritativeTakerFlowFeatureCutArtifact;
  if (
    artifact.version !== AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.artifactVersion
    || artifact.planVersion !== AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.planVersion
    || artifact.prerequisiteVersion
      !== AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.prerequisiteVersion
    || artifact.tapeVersion !== AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.tapeVersion
    || !Number.isSafeInteger(artifact.frozenAtMs)
    || artifact.frozenAtMs <= 0
    || !Number.isSafeInteger(artifact.strategyNotBeforeMs)
    || artifact.boundaryDelayMs
      !== AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs
    || artifact.boundaryGridMs
      !== AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.boundaryGridMs
    || artifact.strategyNotBeforeMs
      !== nextAuthoritativeTakerFlowStrategyBoundary(artifact.frozenAtMs)
    || !Array.isArray(artifact.buckets)
    || artifact.buckets.length !== AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.requiredBuckets
  ) {
    throw new Error("invalid authoritative taker-flow feature-cut artifact contract");
  }
  const keys = artifact.buckets.map((bucket) => `${bucket.pair}:${bucket.horizonMin}`);
  if (
    JSON.stringify(keys)
      !== JSON.stringify(expectedAuthoritativeTakerFlowBucketKeys())
  ) {
    throw new Error("invalid authoritative taker-flow feature-cut bucket order");
  }
  for (const bucket of artifact.buckets) {
    if (
      !isRecord(bucket)
      || typeof bucket.pair !== "string"
      || (bucket.horizonMin !== 5 && bucket.horizonMin !== 15)
      || !Number.isSafeInteger(bucket.markets)
      || bucket.markets < AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.minMarketsPerBucket
      || !isRecord(bucket.metrics)
      || JSON.stringify(Object.keys(bucket.metrics))
        !== JSON.stringify([...METRICS])
    ) {
      throw new Error("invalid authoritative taker-flow feature-cut bucket contract");
    }
    for (const metricName of METRICS) {
      const stored = bucket.metrics[metricName];
      if (!isRecord(stored)) {
        throw new Error("invalid authoritative taker-flow feature-cut metric contract");
      }
      const reference = metricReference(
        {
          pair: bucket.pair,
          horizonMin: bucket.horizonMin,
          markets: bucket.markets,
          metrics: {
            [metricName]: {
              n: stored.n as number,
              quantiles: {
                p05: stored.p05 as number,
                p25: stored.p25 as number,
                p50: stored.p50 as number,
                p75: stored.p75 as number,
                p95: stored.p95 as number,
              },
            },
          },
        },
        metricName,
      );
      if (
        !Number.isFinite(stored.iqr)
        || stored.iqr !== reference.iqr
        || JSON.stringify(Object.keys(stored))
          !== JSON.stringify(["n", "p05", "p25", "p50", "p75", "p95", "iqr"])
      ) {
        throw new Error("invalid authoritative taker-flow feature-cut metric contract");
      }
    }
  }
  if (digestArtifact(artifact) !== value.sha256) {
    throw new Error("authoritative taker-flow feature-cut artifact hash mismatch");
  }
}

export function parseAuthoritativeTakerFlowFeatureCutEnvelope(
  body: string,
): AuthoritativeTakerFlowFeatureCutEnvelope {
  const start = body.indexOf(AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_ARTIFACT_START);
  const end = body.indexOf(AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_ARTIFACT_END);
  if (start < 0 || end <= start) {
    throw new Error("authoritative taker-flow feature-cut artifact markers missing");
  }
  const block = body
    .slice(start + AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_ARTIFACT_START.length, end)
    .trim()
    .replace(/^```json\s*/, "")
    .replace(/\s*```$/, "");
  const parsed: unknown = JSON.parse(block);
  assertAuthoritativeTakerFlowFeatureCutEnvelope(parsed);
  return parsed;
}

export async function readAuthoritativeTakerFlowFeatureCutEnvelope():
Promise<AuthoritativeTakerFlowFeatureCutEnvelope | null> {
  const [article] = await db
    .select({ body: kbArticles.body })
    .from(kbArticles)
    .where(eq(
      kbArticles.slug,
      AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.artifactSlug,
    ))
    .limit(1);
  return article
    ? parseAuthoritativeTakerFlowFeatureCutEnvelope(article.body)
    : null;
}
