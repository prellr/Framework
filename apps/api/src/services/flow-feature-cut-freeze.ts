/**
 * Immutable, outcome-blind preprocessing artifact for the compact public flow tapes.
 *
 * This freezes only per-asset/per-horizon reference cuts after both inherited tape gates pass.
 * It does not choose a side, define a trading threshold, create a paper decision, or touch an
 * account/order path. A later strategy must use a separately registered future boundary.
 */
import { createHash } from "node:crypto";
import { db, kbArticles } from "@framework/db";
import { eq } from "drizzle-orm";
import { FLOW_DISTRIBUTION_AUDIT } from "./flow-distribution-contract.ts";

const PAIRS = ["BNB-USD", "BTC-USD", "DOGE-USD", "ETH-USD", "SOL-USD", "XRP-USD"] as const;
const HORIZONS = [5, 15] as const;
const FORBIDDEN_ARTIFACT_KEY =
  /(?:outcome|resolution|label|grade|pnl|winRate|profit|loss|paper|decision|chosenSide|fill)/i;

export const FLOW_FEATURE_CUT_FREEZE = {
  planVersion: "updown-flow-feature-cut-freeze-plan-v1",
  artifactVersion: "updown-flow-feature-cuts-v1",
  prerequisiteVersion: FLOW_DISTRIBUTION_AUDIT.version,
  artifactSlug: "updown-flow-feature-cuts-v1",
  minimumBoundaryDelayMs: 30 * 60_000,
  boundaryGridMs: 15 * 60_000,
  requiredBuckets: PAIRS.length * HORIZONS.length,
  signedMetrics: {
    hyperliquid: "imbalance60s",
    clobEventOfi: "canonical60s",
  },
  referenceMetrics: {
    hyperliquid: [
      "absoluteImbalance60s",
      "logNotional60s",
      "tradeCount60s",
      "maxTradeShare60s",
    ],
    clobEventOfi: [
      "absoluteCanonical60s",
      "totalEvents60s",
      "receiveAgeSec",
      "maxTransportLagMs60s",
    ],
  },
} as const;

export const FLOW_FEATURE_CUT_ARTIFACT_START = "<!-- FLOW_FEATURE_CUT_ARTIFACT_V1_START -->";
export const FLOW_FEATURE_CUT_ARTIFACT_END = "<!-- FLOW_FEATURE_CUT_ARTIFACT_V1_END -->";

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
  rows: number;
  metrics: Record<string, MetricLike>;
};

export type FlowDistributionReportLike = {
  buckets: DistributionBucketLike[];
};

type RobustReference = Quantiles & {
  n: number;
  iqr: number;
};

export type FlowFeatureCutBucket = {
  pair: string;
  horizonMin: 5 | 15;
  hyperliquid: {
    imbalance60s: RobustReference;
    absoluteImbalance60sP75: number;
    logNotional60sP25: number;
    tradeCount60sP25: number;
    maxTradeShare60sP95: number;
  };
  clobEventOfi: {
    canonical60s: RobustReference;
    absoluteCanonical60sP75: number;
    totalEvents60sP25: number;
    receiveAgeSecP95: number;
    maxTransportLagMs60sP95: number;
  };
};

export type FlowFeatureCutArtifact = {
  version: typeof FLOW_FEATURE_CUT_FREEZE.artifactVersion;
  planVersion: typeof FLOW_FEATURE_CUT_FREEZE.planVersion;
  prerequisiteVersion: typeof FLOW_FEATURE_CUT_FREEZE.prerequisiteVersion;
  tapeVersions: {
    hyperliquid: string;
    clobEventOfi: string;
  };
  frozenAtMs: number;
  strategyNotBeforeMs: number;
  boundaryDelayMs: number;
  boundaryGridMs: number;
  buckets: FlowFeatureCutBucket[];
};

export type FlowFeatureCutEnvelope = {
  sha256: string;
  artifact: FlowFeatureCutArtifact;
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
      throw new Error(`flow feature-cut artifact blocked at ${path}.${key}`);
    }
    assertOutcomeBlindKeys(child, `${path}.${key}`);
  }
}

function finite(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`invalid flow feature cut: ${label}`);
  return parsed;
}

function metricReference(
  bucket: DistributionBucketLike,
  metricName: string,
  requirePositiveIqr = false,
): RobustReference {
  const metric = bucket.metrics[metricName];
  if (!metric || !Number.isSafeInteger(metric.n) || metric.n <= 0 || !metric.quantiles) {
    throw new Error(
      `missing flow feature distribution for ${bucket.pair}/${bucket.horizonMin}/${metricName}`,
    );
  }
  const reference: RobustReference = {
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
      `non-monotone flow feature distribution for ${bucket.pair}/${bucket.horizonMin}/${metricName}`,
    );
  }
  reference.iqr = reference.p75 - reference.p25;
  if (requirePositiveIqr && reference.iqr <= 0) {
    throw new Error(
      `degenerate flow feature distribution for ${bucket.pair}/${bucket.horizonMin}/${metricName}`,
    );
  }
  return reference;
}

function bucketMap(report: FlowDistributionReportLike, source: string) {
  if (report.buckets.length !== FLOW_FEATURE_CUT_FREEZE.requiredBuckets) {
    throw new Error(
      `${source} flow feature freeze expected ${FLOW_FEATURE_CUT_FREEZE.requiredBuckets} buckets`,
    );
  }
  const map = new Map<string, DistributionBucketLike>();
  for (const bucket of report.buckets) {
    if (
      !PAIRS.includes(bucket.pair as (typeof PAIRS)[number])
      || !HORIZONS.includes(bucket.horizonMin as (typeof HORIZONS)[number])
    ) {
      throw new Error(`${source} flow feature freeze contains an out-of-scope bucket`);
    }
    const key = `${bucket.pair}:${bucket.horizonMin}`;
    if (map.has(key)) throw new Error(`${source} flow feature freeze contains duplicate ${key}`);
    map.set(key, bucket);
  }
  return map;
}

export function nextFlowFeatureStrategyBoundary(frozenAtMs: number): number {
  if (!Number.isSafeInteger(frozenAtMs) || frozenAtMs <= 0) {
    throw new Error("invalid flow feature freeze timestamp");
  }
  const earliest = frozenAtMs + FLOW_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs;
  return Math.ceil(earliest / FLOW_FEATURE_CUT_FREEZE.boundaryGridMs)
    * FLOW_FEATURE_CUT_FREEZE.boundaryGridMs;
}

function digestArtifact(artifact: FlowFeatureCutArtifact): string {
  return createHash("sha256").update(JSON.stringify(artifact)).digest("hex");
}

export function buildFlowFeatureCutEnvelope(input: {
  distributionVersion: string;
  tapeVersions: { hyperliquid: string; clobEventOfi: string };
  hyperliquidReport: FlowDistributionReportLike;
  clobEventOfiReport: FlowDistributionReportLike;
  frozenAtMs: number;
}): FlowFeatureCutEnvelope {
  if (input.distributionVersion !== FLOW_FEATURE_CUT_FREEZE.prerequisiteVersion) {
    throw new Error("flow feature freeze prerequisite version mismatch");
  }
  const hyperliquid = bucketMap(input.hyperliquidReport, "Hyperliquid");
  const clob = bucketMap(input.clobEventOfiReport, "CLOB event-OFI");
  const buckets: FlowFeatureCutBucket[] = [];

  for (const pair of PAIRS) {
    for (const horizonMin of HORIZONS) {
      const key = `${pair}:${horizonMin}`;
      const hyperliquidBucket = hyperliquid.get(key);
      const clobBucket = clob.get(key);
      if (!hyperliquidBucket || !clobBucket) {
        throw new Error(`flow feature freeze missing paired bucket ${key}`);
      }
      const hlSigned = metricReference(hyperliquidBucket, "imbalance60s", true);
      const hlAbs = metricReference(hyperliquidBucket, "absoluteImbalance60s");
      const hlNotional = metricReference(hyperliquidBucket, "logNotional60s");
      const hlTrades = metricReference(hyperliquidBucket, "tradeCount60s");
      const hlShare = metricReference(hyperliquidBucket, "maxTradeShare60s");
      const clobSigned = metricReference(clobBucket, "canonical60s", true);
      const clobAbs = metricReference(clobBucket, "absoluteCanonical60s");
      const clobEvents = metricReference(clobBucket, "totalEvents60s");
      const clobAge = metricReference(clobBucket, "receiveAgeSec");
      const clobLag = metricReference(clobBucket, "maxTransportLagMs60s");
      buckets.push({
        pair,
        horizonMin,
        hyperliquid: {
          imbalance60s: hlSigned,
          absoluteImbalance60sP75: hlAbs.p75,
          logNotional60sP25: hlNotional.p25,
          tradeCount60sP25: hlTrades.p25,
          maxTradeShare60sP95: hlShare.p95,
        },
        clobEventOfi: {
          canonical60s: clobSigned,
          absoluteCanonical60sP75: clobAbs.p75,
          totalEvents60sP25: clobEvents.p25,
          receiveAgeSecP95: clobAge.p95,
          maxTransportLagMs60sP95: clobLag.p95,
        },
      });
    }
  }

  const artifact: FlowFeatureCutArtifact = {
    version: FLOW_FEATURE_CUT_FREEZE.artifactVersion,
    planVersion: FLOW_FEATURE_CUT_FREEZE.planVersion,
    prerequisiteVersion: FLOW_FEATURE_CUT_FREEZE.prerequisiteVersion,
    tapeVersions: input.tapeVersions,
    frozenAtMs: input.frozenAtMs,
    strategyNotBeforeMs: nextFlowFeatureStrategyBoundary(input.frozenAtMs),
    boundaryDelayMs: FLOW_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs,
    boundaryGridMs: FLOW_FEATURE_CUT_FREEZE.boundaryGridMs,
    buckets,
  };
  assertOutcomeBlindKeys(artifact);
  return { sha256: digestArtifact(artifact), artifact };
}

export function serializeFlowFeatureCutEnvelope(envelope: FlowFeatureCutEnvelope): string {
  assertFlowFeatureCutEnvelope(envelope);
  return [
    FLOW_FEATURE_CUT_ARTIFACT_START,
    "```json",
    JSON.stringify(envelope, null, 2),
    "```",
    FLOW_FEATURE_CUT_ARTIFACT_END,
  ].join("\n");
}

export function assertFlowFeatureCutEnvelope(value: unknown): asserts value is FlowFeatureCutEnvelope {
  if (!isRecord(value) || typeof value.sha256 !== "string" || !isRecord(value.artifact)) {
    throw new Error("invalid flow feature-cut envelope");
  }
  assertOutcomeBlindKeys(value);
  const artifact = value.artifact as unknown as FlowFeatureCutArtifact;
  if (
    artifact.version !== FLOW_FEATURE_CUT_FREEZE.artifactVersion
    || artifact.planVersion !== FLOW_FEATURE_CUT_FREEZE.planVersion
    || artifact.prerequisiteVersion !== FLOW_FEATURE_CUT_FREEZE.prerequisiteVersion
    || !Number.isSafeInteger(artifact.frozenAtMs)
    || !Number.isSafeInteger(artifact.strategyNotBeforeMs)
    || artifact.boundaryDelayMs !== FLOW_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs
    || artifact.boundaryGridMs !== FLOW_FEATURE_CUT_FREEZE.boundaryGridMs
    || artifact.strategyNotBeforeMs < artifact.frozenAtMs + artifact.boundaryDelayMs
    || artifact.strategyNotBeforeMs % artifact.boundaryGridMs !== 0
    || !Array.isArray(artifact.buckets)
    || artifact.buckets.length !== FLOW_FEATURE_CUT_FREEZE.requiredBuckets
  ) {
    throw new Error("invalid flow feature-cut artifact contract");
  }
  const keys = artifact.buckets.map((bucket) => `${bucket.pair}:${bucket.horizonMin}`);
  const expectedKeys = PAIRS.flatMap((pair) => HORIZONS.map((horizon) => `${pair}:${horizon}`));
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new Error("invalid flow feature-cut artifact bucket order");
  }
  if (digestArtifact(artifact) !== value.sha256) {
    throw new Error("flow feature-cut artifact hash mismatch");
  }
}

export function parseFlowFeatureCutEnvelope(body: string): FlowFeatureCutEnvelope {
  const start = body.indexOf(FLOW_FEATURE_CUT_ARTIFACT_START);
  const end = body.indexOf(FLOW_FEATURE_CUT_ARTIFACT_END);
  if (start < 0 || end <= start) throw new Error("flow feature-cut artifact markers missing");
  const block = body
    .slice(start + FLOW_FEATURE_CUT_ARTIFACT_START.length, end)
    .trim()
    .replace(/^```json\s*/, "")
    .replace(/\s*```$/, "");
  const parsed: unknown = JSON.parse(block);
  assertFlowFeatureCutEnvelope(parsed);
  return parsed;
}

export async function readFlowFeatureCutEnvelope(): Promise<FlowFeatureCutEnvelope | null> {
  const [article] = await db
    .select({ body: kbArticles.body })
    .from(kbArticles)
    .where(eq(kbArticles.slug, FLOW_FEATURE_CUT_FREEZE.artifactSlug))
    .limit(1);
  return article ? parseFlowFeatureCutEnvelope(article.body) : null;
}
