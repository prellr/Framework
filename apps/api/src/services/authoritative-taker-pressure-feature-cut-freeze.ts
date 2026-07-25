/**
 * Immutable, outcome-blind references for first-minute chain-verified taker pressure.
 *
 * This artifact freezes unsigned market-level activity, pressure-magnitude, and concentration
 * references only. It cannot choose a direction, create a paper decision, or authorize execution.
 */
import { createHash } from "node:crypto";
import { db, kbArticles } from "@framework/db";
import { eq } from "drizzle-orm";
import {
  AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT,
  expectedAuthoritativeTakerPressureBucketKeys,
} from "./authoritative-taker-pressure-distribution-contract.ts";

const METRICS = AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.metrics;
const PAIRS = AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.pairs;
const HORIZONS = AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.horizons;
const FORBIDDEN_ARTIFACT_KEY =
  /(?:outcome|resolution|label|grade|pnl|winRate|profit|loss|paper|decision|direction|signed|position|account|wallet|order|chosenSide|fill|side|token)/i;

export const AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE = {
  planVersion: "updown-authoritative-taker-pressure-feature-cut-freeze-plan-v1",
  artifactVersion: "updown-authoritative-taker-pressure-feature-cuts-v1",
  prerequisiteVersion: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.version,
  artifactSlug: "updown-authoritative-taker-pressure-feature-cuts-v1",
  minimumBoundaryDelayMs: 30 * 60_000,
  boundaryGridMs: 15 * 60_000,
  requiredBuckets: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.expectedBuckets,
  minMarketsPerBucket: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.minMarketsPerBucket,
  metrics: METRICS,
  positiveIqrMetrics: ["logGrossShares", "absoluteSharePressure"] as const,
  cuts: {
    minimumGrossShares: "logGrossShares.p25",
    minimumEvents: "eventCount.p25",
    minimumUniqueReceipts: "uniqueReceiptCount.p25",
    minimumAbsolutePressure: "absoluteSharePressure.p75",
    maximumSingleEventFraction: "maxEventShareFraction.p95",
  },
} as const;

export const AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_ARTIFACT_START =
  "<!-- AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_ARTIFACT_V1_START -->";
export const AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_ARTIFACT_END =
  "<!-- AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_ARTIFACT_V1_END -->";

type Quantiles = {
  p05: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
};

const QUANTILE_KEYS = ["p05", "p25", "p50", "p75", "p95"] as const;

type MetricLike = {
  n: number;
  quantiles: Quantiles | null;
};

type DistributionBucketLike = {
  pair: string | null;
  horizonMin: number | null;
  markets: number;
  metrics: Record<string, MetricLike>;
};

export type AuthoritativeTakerPressureDistributionReportLike = {
  expectedBuckets: number;
  completeBuckets: number;
  missingBuckets: string[];
  minBucketMarkets: number;
  readyForCutFreeze: boolean;
  buckets: DistributionBucketLike[];
};

export type AuthoritativeTakerPressureRobustReference = Quantiles & {
  n: number;
  iqr: number;
};

export type AuthoritativeTakerPressureFeatureCutBucket = {
  pair: (typeof PAIRS)[number];
  horizonMin: (typeof HORIZONS)[number];
  markets: number;
  metrics: Record<(typeof METRICS)[number], AuthoritativeTakerPressureRobustReference>;
  cuts: {
    logGrossSharesP25: number;
    eventCountP25: number;
    uniqueReceiptCountP25: number;
    absoluteSharePressureP75: number;
    maxEventShareFractionP95: number;
  };
};

export type AuthoritativeTakerPressureFeatureCutArtifact = {
  version: typeof AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.artifactVersion;
  planVersion: typeof AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.planVersion;
  prerequisiteVersion: typeof AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.prerequisiteVersion;
  tapeVersion: typeof AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.tapeVersion;
  observationWindowSec: typeof AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.observationWindowSec;
  frozenAtMs: number;
  strategyNotBeforeMs: number;
  boundaryDelayMs: number;
  boundaryGridMs: number;
  buckets: AuthoritativeTakerPressureFeatureCutBucket[];
};

export type AuthoritativeTakerPressureFeatureCutEnvelope = {
  sha256: string;
  artifact: AuthoritativeTakerPressureFeatureCutArtifact;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === [...expected].sort()[index])
  );
}

function assertOutcomeBlindKeys(value: unknown, path = "artifact"): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertOutcomeBlindKeys(child, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_ARTIFACT_KEY.test(key)) {
      throw new Error(`authoritative taker-pressure artifact blocked at ${path}.${key}`);
    }
    assertOutcomeBlindKeys(child, `${path}.${key}`);
  }
}

function finite(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid authoritative taker-pressure cut: ${label}`);
  }
  return parsed;
}

function metricReference(
  bucket: DistributionBucketLike,
  metricName: (typeof METRICS)[number],
): AuthoritativeTakerPressureRobustReference {
  const metric = bucket.metrics[metricName];
  if (
    !metric ||
    !Number.isSafeInteger(metric.n) ||
    !metric.quantiles
  ) {
    throw new Error(
      `missing authoritative taker-pressure distribution for ${bucket.pair}/${bucket.horizonMin}/${metricName}`,
    );
  }
  if (metric.n !== bucket.markets) {
    throw new Error(
      `authoritative taker-pressure metric count mismatch for ${bucket.pair}/${bucket.horizonMin}/${metricName}`,
    );
  }
  const reference: AuthoritativeTakerPressureRobustReference = {
    n: metric.n,
    p05: finite(metric.quantiles.p05, `${metricName}.p05`),
    p25: finite(metric.quantiles.p25, `${metricName}.p25`),
    p50: finite(metric.quantiles.p50, `${metricName}.p50`),
    p75: finite(metric.quantiles.p75, `${metricName}.p75`),
    p95: finite(metric.quantiles.p95, `${metricName}.p95`),
    iqr: 0,
  };
  const ordered = [reference.p05, reference.p25, reference.p50, reference.p75, reference.p95];
  if (ordered.some((value, index) => index > 0 && value < ordered[index - 1])) {
    throw new Error(
      `non-monotone authoritative taker-pressure distribution for ${bucket.pair}/${bucket.horizonMin}/${metricName}`,
    );
  }
  if (
    (metricName === "absoluteSharePressure" || metricName === "maxEventShareFraction") &&
    ordered.some((value) => value < 0 || value > 1)
  ) {
    throw new Error(
      `out-of-range authoritative taker-pressure distribution for ${bucket.pair}/${bucket.horizonMin}/${metricName}`,
    );
  }
  if (
    (metricName === "eventCount" || metricName === "uniqueReceiptCount") &&
    ordered.some((value) => value < 1)
  ) {
    throw new Error(
      `non-positive authoritative taker-pressure count for ${bucket.pair}/${bucket.horizonMin}/${metricName}`,
    );
  }
  if (metricName === "logGrossShares" && ordered.some((value) => value <= 0)) {
    throw new Error(
      `non-positive authoritative taker-pressure gross shares for ${bucket.pair}/${bucket.horizonMin}/${metricName}`,
    );
  }
  reference.iqr = reference.p75 - reference.p25;
  if (
    AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.positiveIqrMetrics.includes(
      metricName as (typeof AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.positiveIqrMetrics)[number],
    ) &&
    reference.iqr <= 0
  ) {
    throw new Error(
      `degenerate authoritative taker-pressure distribution for ${bucket.pair}/${bucket.horizonMin}/${metricName}`,
    );
  }
  return reference;
}

function assertMetricRelationships(
  bucket: Pick<DistributionBucketLike, "pair" | "horizonMin">,
  metrics: AuthoritativeTakerPressureFeatureCutBucket["metrics"],
): void {
  for (const quantile of QUANTILE_KEYS) {
    if (metrics.uniqueReceiptCount[quantile] > metrics.eventCount[quantile]) {
      throw new Error(
        `authoritative taker-pressure receipt count exceeds event count for ${bucket.pair}/${bucket.horizonMin}/${quantile}`,
      );
    }
  }
}

function bucketMap(report: AuthoritativeTakerPressureDistributionReportLike) {
  if (
    !report.readyForCutFreeze ||
    report.expectedBuckets !== AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.requiredBuckets ||
    report.completeBuckets !== AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.requiredBuckets ||
    report.missingBuckets.length !== 0 ||
    report.minBucketMarkets < AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.minMarketsPerBucket ||
    report.buckets.length !== AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.requiredBuckets
  ) {
    throw new Error("authoritative taker-pressure feature cuts require a complete ready report");
  }
  const expected = new Set(expectedAuthoritativeTakerPressureBucketKeys());
  const map = new Map<string, DistributionBucketLike>();
  for (const bucket of report.buckets) {
    const key = `${bucket.pair}:${bucket.horizonMin}`;
    if (!expected.has(key)) {
      throw new Error("authoritative taker-pressure feature cuts contain an out-of-scope bucket");
    }
    if (
      !Number.isSafeInteger(bucket.markets) ||
      bucket.markets < AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.minMarketsPerBucket
    ) {
      throw new Error(`authoritative taker-pressure support is insufficient for ${key}`);
    }
    if (map.has(key)) {
      throw new Error(`authoritative taker-pressure feature cuts contain duplicate ${key}`);
    }
    map.set(key, bucket);
  }
  return map;
}

export function nextAuthoritativeTakerPressureStrategyBoundary(frozenAtMs: number): number {
  if (!Number.isSafeInteger(frozenAtMs) || frozenAtMs <= 0) {
    throw new Error("invalid authoritative taker-pressure freeze timestamp");
  }
  const earliest =
    frozenAtMs + AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs;
  return (
    Math.ceil(earliest / AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.boundaryGridMs) *
    AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.boundaryGridMs
  );
}

function digestArtifact(artifact: AuthoritativeTakerPressureFeatureCutArtifact): string {
  return createHash("sha256").update(JSON.stringify(artifact)).digest("hex");
}

export function buildAuthoritativeTakerPressureFeatureCutEnvelope(input: {
  distributionVersion: string;
  tapeVersion: string;
  observationWindowSec: number;
  report: AuthoritativeTakerPressureDistributionReportLike;
  frozenAtMs: number;
}): AuthoritativeTakerPressureFeatureCutEnvelope {
  if (
    input.distributionVersion !==
      AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.prerequisiteVersion ||
    input.tapeVersion !== AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.tapeVersion ||
    input.observationWindowSec !==
      AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.observationWindowSec
  ) {
    throw new Error("authoritative taker-pressure feature-cut prerequisite mismatch");
  }
  const byKey = bucketMap(input.report);
  const buckets = expectedAuthoritativeTakerPressureBucketKeys().map((key) => {
    const bucket = byKey.get(key);
    if (!bucket) throw new Error(`missing authoritative taker-pressure bucket ${key}`);
    const metrics = Object.fromEntries(
      METRICS.map((metricName) => [metricName, metricReference(bucket, metricName)]),
    ) as AuthoritativeTakerPressureFeatureCutBucket["metrics"];
    assertMetricRelationships(bucket, metrics);
    return {
      pair: bucket.pair as AuthoritativeTakerPressureFeatureCutBucket["pair"],
      horizonMin: bucket.horizonMin as AuthoritativeTakerPressureFeatureCutBucket["horizonMin"],
      markets: bucket.markets,
      metrics,
      cuts: {
        logGrossSharesP25: metrics.logGrossShares.p25,
        eventCountP25: metrics.eventCount.p25,
        uniqueReceiptCountP25: metrics.uniqueReceiptCount.p25,
        absoluteSharePressureP75: metrics.absoluteSharePressure.p75,
        maxEventShareFractionP95: metrics.maxEventShareFraction.p95,
      },
    };
  });
  const artifact: AuthoritativeTakerPressureFeatureCutArtifact = {
    version: AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.artifactVersion,
    planVersion: AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.planVersion,
    prerequisiteVersion: AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.prerequisiteVersion,
    tapeVersion: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.tapeVersion,
    observationWindowSec: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.observationWindowSec,
    frozenAtMs: input.frozenAtMs,
    strategyNotBeforeMs: nextAuthoritativeTakerPressureStrategyBoundary(input.frozenAtMs),
    boundaryDelayMs: AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs,
    boundaryGridMs: AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.boundaryGridMs,
    buckets,
  };
  assertOutcomeBlindKeys(artifact);
  return { sha256: digestArtifact(artifact), artifact };
}

export function serializeAuthoritativeTakerPressureFeatureCutEnvelope(
  envelope: AuthoritativeTakerPressureFeatureCutEnvelope,
): string {
  if (
    !/^[a-f0-9]{64}$/.test(envelope.sha256) ||
    envelope.sha256 !== digestArtifact(envelope.artifact)
  ) {
    throw new Error("invalid authoritative taker-pressure feature-cut envelope hash");
  }
  assertOutcomeBlindKeys(envelope.artifact);
  return [
    AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_ARTIFACT_START,
    JSON.stringify(envelope),
    AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_ARTIFACT_END,
  ].join("\n");
}

function validateParsedEnvelope(value: unknown): AuthoritativeTakerPressureFeatureCutEnvelope {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["sha256", "artifact"]) ||
    typeof value.sha256 !== "string" ||
    !isRecord(value.artifact)
  ) {
    throw new Error("invalid authoritative taker-pressure feature-cut envelope");
  }
  const artifact = value.artifact;
  if (
    !hasExactKeys(artifact, [
      "version",
      "planVersion",
      "prerequisiteVersion",
      "tapeVersion",
      "observationWindowSec",
      "frozenAtMs",
      "strategyNotBeforeMs",
      "boundaryDelayMs",
      "boundaryGridMs",
      "buckets",
    ]) ||
    artifact.version !== AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.artifactVersion ||
    artifact.planVersion !== AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.planVersion ||
    artifact.prerequisiteVersion !==
      AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.prerequisiteVersion ||
    artifact.tapeVersion !== AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.tapeVersion ||
    artifact.observationWindowSec !==
      AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.observationWindowSec ||
    artifact.boundaryDelayMs !==
      AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs ||
    artifact.boundaryGridMs !== AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.boundaryGridMs ||
    !Number.isSafeInteger(artifact.frozenAtMs) ||
    !Number.isSafeInteger(artifact.strategyNotBeforeMs) ||
    artifact.strategyNotBeforeMs !==
      nextAuthoritativeTakerPressureStrategyBoundary(Number(artifact.frozenAtMs)) ||
    !Array.isArray(artifact.buckets) ||
    artifact.buckets.length !== AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.requiredBuckets
  ) {
    throw new Error("invalid authoritative taker-pressure feature-cut artifact schema");
  }
  const expectedKeys = expectedAuthoritativeTakerPressureBucketKeys();
  artifact.buckets.forEach((rawBucket, index) => {
    if (
      !isRecord(rawBucket) ||
      !hasExactKeys(rawBucket, ["pair", "horizonMin", "markets", "metrics", "cuts"]) ||
      !isRecord(rawBucket.metrics) ||
      !hasExactKeys(rawBucket.metrics, METRICS) ||
      !isRecord(rawBucket.cuts) ||
      !hasExactKeys(rawBucket.cuts, [
        "logGrossSharesP25",
        "eventCountP25",
        "uniqueReceiptCountP25",
        "absoluteSharePressureP75",
        "maxEventShareFractionP95",
      ])
    ) {
      throw new Error("invalid authoritative taker-pressure feature-cut bucket");
    }
    const key = `${rawBucket.pair}:${rawBucket.horizonMin}`;
    if (
      key !== expectedKeys[index] ||
      !Number.isSafeInteger(rawBucket.markets) ||
      Number(rawBucket.markets) <
        AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.minMarketsPerBucket
    ) {
      throw new Error("invalid authoritative taker-pressure feature-cut bucket identity");
    }
    const validatedMetrics = {} as AuthoritativeTakerPressureFeatureCutBucket["metrics"];
    for (const metricName of METRICS) {
      const rawMetric = rawBucket.metrics[metricName];
      if (
        !isRecord(rawMetric) ||
        !hasExactKeys(rawMetric, ["n", "p05", "p25", "p50", "p75", "p95", "iqr"])
      ) {
        throw new Error(`invalid authoritative taker-pressure feature metric ${metricName}`);
      }
      const validated = metricReference(
        {
          pair: String(rawBucket.pair),
          horizonMin: Number(rawBucket.horizonMin),
          markets: Number(rawBucket.markets),
          metrics: {
            [metricName]: {
              n: Number(rawMetric.n),
              quantiles: {
                p05: Number(rawMetric.p05),
                p25: Number(rawMetric.p25),
                p50: Number(rawMetric.p50),
                p75: Number(rawMetric.p75),
                p95: Number(rawMetric.p95),
              },
            },
          },
        },
        metricName,
      );
      if (Number(rawMetric.iqr) !== validated.iqr) {
        throw new Error(`invalid authoritative taker-pressure feature IQR ${metricName}`);
      }
      validatedMetrics[metricName] = validated;
    }
    assertMetricRelationships(
      {
        pair: String(rawBucket.pair),
        horizonMin: Number(rawBucket.horizonMin),
      },
      validatedMetrics,
    );
    const metrics = rawBucket.metrics as Record<string, Record<string, unknown>>;
    const cuts = rawBucket.cuts;
    const expectedCuts = {
      logGrossSharesP25: Number(metrics.logGrossShares?.p25),
      eventCountP25: Number(metrics.eventCount?.p25),
      uniqueReceiptCountP25: Number(metrics.uniqueReceiptCount?.p25),
      absoluteSharePressureP75: Number(metrics.absoluteSharePressure?.p75),
      maxEventShareFractionP95: Number(metrics.maxEventShareFraction?.p95),
    };
    for (const [cutName, expected] of Object.entries(expectedCuts)) {
      if (!Number.isFinite(expected) || Number(cuts[cutName]) !== expected) {
        throw new Error(`invalid authoritative taker-pressure feature cut ${cutName}`);
      }
    }
  });
  assertOutcomeBlindKeys(artifact);
  const envelope = value as unknown as AuthoritativeTakerPressureFeatureCutEnvelope;
  if (
    !/^[a-f0-9]{64}$/.test(envelope.sha256) ||
    envelope.sha256 !== digestArtifact(envelope.artifact)
  ) {
    throw new Error("authoritative taker-pressure feature-cut hash mismatch");
  }
  return envelope;
}

export function parseAuthoritativeTakerPressureFeatureCutEnvelope(
  body: string,
): AuthoritativeTakerPressureFeatureCutEnvelope {
  const start = body.indexOf(AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_ARTIFACT_START);
  const end = body.indexOf(AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_ARTIFACT_END);
  if (start < 0 || end <= start) {
    throw new Error("authoritative taker-pressure feature-cut artifact markers missing");
  }
  const raw = body
    .slice(start + AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_ARTIFACT_START.length, end)
    .trim();
  return validateParsedEnvelope(JSON.parse(raw));
}

export async function readAuthoritativeTakerPressureFeatureCutEnvelope(): Promise<AuthoritativeTakerPressureFeatureCutEnvelope | null> {
  const [row] = await db
    .select({ body: kbArticles.body })
    .from(kbArticles)
    .where(eq(kbArticles.slug, AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.artifactSlug))
    .limit(1);
  if (!row) return null;
  return parseAuthoritativeTakerPressureFeatureCutEnvelope(row.body);
}
