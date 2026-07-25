/**
 * Deterministic, outcome-blind reference artifact for the Smooth Path quality tape.
 *
 * The artifact may be built only after both frozen v1/v2 quality distributions pass every
 * preregistered support floor. It stores unsigned distribution references only. It does not select
 * a direction, threshold, strategy identity, paper decision, or executable fill.
 */
import { createHash } from "node:crypto";
import {
  SMOOTH_PATH_CAUSAL_DISPLACEMENT,
  SMOOTH_PATH_DISPLACEMENT,
} from "./smooth-path-displacement.ts";
import { SMOOTH_PATH_QUALITY_TAPE } from "./smooth-path-quality-tape.ts";

const VERSION_ORDER = [
  SMOOTH_PATH_DISPLACEMENT.version,
  SMOOTH_PATH_CAUSAL_DISPLACEMENT.version,
] as const;
const METRICS = [
  "absDisplacementLog",
  "pathR2",
  "pathEfficiency",
  "continuationSlopePerSec",
  "continuationFreshLog",
] as const;
const FORBIDDEN_ARTIFACT_KEY =
  /(?:direction|outcome|resolution|resolved|label|grade|pnl|return|profit|loss|winRate|chosen|side|price|fill|paper|order|position|wallet|account)/i;

export const SMOOTH_PATH_FEATURE_CUT_FREEZE = {
  planVersion: "updown-smooth-path-feature-cut-freeze-plan-v1",
  artifactVersion: "updown-smooth-path-feature-cuts-v1",
  prerequisiteVersion: SMOOTH_PATH_QUALITY_TAPE.version,
  artifactSlug: "updown-smooth-path-feature-cuts-v1",
  minimumBoundaryDelayMs: 30 * 60_000,
  boundaryGridMs: 5 * 60_000,
  versions: VERSION_ORDER,
  metrics: METRICS,
} as const;

export const SMOOTH_PATH_FEATURE_CUT_ARTIFACT_START =
  "<!-- SMOOTH_PATH_FEATURE_CUT_ARTIFACT_V1_START -->";
export const SMOOTH_PATH_FEATURE_CUT_ARTIFACT_END =
  "<!-- SMOOTH_PATH_FEATURE_CUT_ARTIFACT_V1_END -->";

type Quantiles = {
  p10: number | null;
  p50: number | null;
  p90: number | null;
};

type QualityLike = {
  metricRows: number;
  weakestPairMetricRows: number;
  spanDays: number;
  coverage: number;
  readyForThresholdDesign: boolean;
} & Record<(typeof METRICS)[number], Quantiles>;

export type SmoothPathFunnelReportLike = {
  qualityTape: {
    version: string;
    allVersionsReadyForThresholdDesign: boolean;
  };
  versions: Array<{
    version: string;
    quality: QualityLike;
  }>;
};

export type SmoothPathReference = {
  p10: number;
  p50: number;
  p90: number;
};

export type SmoothPathFeatureCutVersion = {
  version: (typeof VERSION_ORDER)[number];
  metricRows: number;
  weakestPairMetricRows: number;
  spanDays: number;
  coverage: number;
  references: Record<(typeof METRICS)[number], SmoothPathReference>;
};

export type SmoothPathFeatureCutArtifact = {
  version: typeof SMOOTH_PATH_FEATURE_CUT_FREEZE.artifactVersion;
  planVersion: typeof SMOOTH_PATH_FEATURE_CUT_FREEZE.planVersion;
  prerequisiteVersion: typeof SMOOTH_PATH_FEATURE_CUT_FREEZE.prerequisiteVersion;
  frozenAtMs: number;
  strategyNotBeforeMs: number;
  boundaryDelayMs: number;
  boundaryGridMs: number;
  versions: SmoothPathFeatureCutVersion[];
};

export type SmoothPathFeatureCutEnvelope = {
  sha256: string;
  artifact: SmoothPathFeatureCutArtifact;
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
      throw new Error(`Smooth Path feature-cut artifact blocked at ${path}.${key}`);
    }
    assertOutcomeBlindKeys(child, `${path}.${key}`);
  }
}

function finite(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`invalid Smooth Path reference: ${label}`);
  return parsed;
}

function reference(
  value: Quantiles,
  metric: (typeof METRICS)[number],
): SmoothPathReference {
  const result = {
    p10: finite(value.p10, `${metric}.p10`),
    p50: finite(value.p50, `${metric}.p50`),
    p90: finite(value.p90, `${metric}.p90`),
  };
  if (result.p10 > result.p50 || result.p50 > result.p90) {
    throw new Error(`non-monotone Smooth Path reference: ${metric}`);
  }
  if (
    (metric === "absDisplacementLog" && result.p10 < 0)
    || (
      (metric === "pathR2" || metric === "pathEfficiency")
      && (result.p10 < 0 || result.p90 > 1)
    )
  ) {
    throw new Error(`out-of-range Smooth Path reference: ${metric}`);
  }
  return result;
}

export function nextSmoothPathStrategyBoundary(frozenAtMs: number): number {
  if (!Number.isSafeInteger(frozenAtMs) || frozenAtMs <= 0) {
    throw new Error("invalid Smooth Path feature-freeze timestamp");
  }
  const earliest =
    frozenAtMs + SMOOTH_PATH_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs;
  return Math.ceil(earliest / SMOOTH_PATH_FEATURE_CUT_FREEZE.boundaryGridMs)
    * SMOOTH_PATH_FEATURE_CUT_FREEZE.boundaryGridMs;
}

const digest = (artifact: SmoothPathFeatureCutArtifact) =>
  createHash("sha256").update(JSON.stringify(artifact)).digest("hex");

export function buildSmoothPathFeatureCutEnvelope(input: {
  report: SmoothPathFunnelReportLike;
  frozenAtMs: number;
}): SmoothPathFeatureCutEnvelope {
  if (
    input.report.qualityTape.version !== SMOOTH_PATH_FEATURE_CUT_FREEZE.prerequisiteVersion
    || !input.report.qualityTape.allVersionsReadyForThresholdDesign
  ) {
    throw new Error("Smooth Path feature cuts require both ready quality distributions");
  }
  const byVersion = new Map(input.report.versions.map((row) => [row.version, row]));
  if (byVersion.size !== VERSION_ORDER.length || input.report.versions.length !== VERSION_ORDER.length) {
    throw new Error("Smooth Path feature cuts require exactly the frozen v1/v2 versions");
  }
  const versions = VERSION_ORDER.map((version) => {
    const row = byVersion.get(version);
    if (!row?.quality.readyForThresholdDesign) {
      throw new Error(`Smooth Path feature cuts require ready distribution: ${version}`);
    }
    const quality = row.quality;
    if (
      !Number.isSafeInteger(quality.metricRows)
      || quality.metricRows < SMOOTH_PATH_QUALITY_TAPE.minMetricRowsPerVersion
      || !Number.isSafeInteger(quality.weakestPairMetricRows)
      || quality.weakestPairMetricRows < SMOOTH_PATH_QUALITY_TAPE.minMetricRowsPerPair
      || quality.spanDays < SMOOTH_PATH_QUALITY_TAPE.minSpanDays
      || quality.coverage < SMOOTH_PATH_QUALITY_TAPE.minCoverage
      || quality.coverage > 1
    ) {
      throw new Error(`Smooth Path feature cuts have insufficient support: ${version}`);
    }
    return {
      version,
      metricRows: quality.metricRows,
      weakestPairMetricRows: quality.weakestPairMetricRows,
      spanDays: finite(quality.spanDays, `${version}.spanDays`),
      coverage: finite(quality.coverage, `${version}.coverage`),
      references: Object.fromEntries(
        METRICS.map((metric) => [metric, reference(quality[metric], metric)]),
      ) as SmoothPathFeatureCutVersion["references"],
    };
  });
  const artifact: SmoothPathFeatureCutArtifact = {
    version: SMOOTH_PATH_FEATURE_CUT_FREEZE.artifactVersion,
    planVersion: SMOOTH_PATH_FEATURE_CUT_FREEZE.planVersion,
    prerequisiteVersion: SMOOTH_PATH_FEATURE_CUT_FREEZE.prerequisiteVersion,
    frozenAtMs: input.frozenAtMs,
    strategyNotBeforeMs: nextSmoothPathStrategyBoundary(input.frozenAtMs),
    boundaryDelayMs: SMOOTH_PATH_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs,
    boundaryGridMs: SMOOTH_PATH_FEATURE_CUT_FREEZE.boundaryGridMs,
    versions,
  };
  assertOutcomeBlindKeys(artifact);
  return { sha256: digest(artifact), artifact };
}

export function assertSmoothPathFeatureCutEnvelope(
  envelope: SmoothPathFeatureCutEnvelope,
): void {
  if (!isRecord(envelope) || !isRecord(envelope.artifact)) {
    throw new Error("invalid Smooth Path feature-cut envelope");
  }
  assertOutcomeBlindKeys(envelope.artifact);
  if (envelope.sha256 !== digest(envelope.artifact as SmoothPathFeatureCutArtifact)) {
    throw new Error("Smooth Path feature-cut artifact hash mismatch");
  }
  if (
    envelope.artifact.version !== SMOOTH_PATH_FEATURE_CUT_FREEZE.artifactVersion
    || envelope.artifact.planVersion !== SMOOTH_PATH_FEATURE_CUT_FREEZE.planVersion
    || envelope.artifact.prerequisiteVersion !== SMOOTH_PATH_FEATURE_CUT_FREEZE.prerequisiteVersion
    || envelope.artifact.boundaryDelayMs !== SMOOTH_PATH_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs
    || envelope.artifact.boundaryGridMs !== SMOOTH_PATH_FEATURE_CUT_FREEZE.boundaryGridMs
    || !Array.isArray(envelope.artifact.versions)
    || envelope.artifact.versions.length !== VERSION_ORDER.length
    || envelope.artifact.strategyNotBeforeMs
      !== nextSmoothPathStrategyBoundary(Number(envelope.artifact.frozenAtMs))
  ) {
    throw new Error("Smooth Path feature-cut artifact contract mismatch");
  }
  const versionOrder = envelope.artifact.versions.map((row) =>
    isRecord(row) ? row.version : null
  );
  if (JSON.stringify(versionOrder) !== JSON.stringify(VERSION_ORDER)) {
    throw new Error("Smooth Path feature-cut artifact version order mismatch");
  }
}

export function serializeSmoothPathFeatureCutEnvelope(
  envelope: SmoothPathFeatureCutEnvelope,
): string {
  assertSmoothPathFeatureCutEnvelope(envelope);
  return [
    SMOOTH_PATH_FEATURE_CUT_ARTIFACT_START,
    JSON.stringify(envelope),
    SMOOTH_PATH_FEATURE_CUT_ARTIFACT_END,
  ].join("\n");
}

export function parseSmoothPathFeatureCutEnvelope(body: string): SmoothPathFeatureCutEnvelope {
  const start = body.indexOf(SMOOTH_PATH_FEATURE_CUT_ARTIFACT_START);
  const end = body.indexOf(SMOOTH_PATH_FEATURE_CUT_ARTIFACT_END);
  if (start < 0 || end <= start) throw new Error("missing Smooth Path feature-cut artifact");
  const json = body
    .slice(start + SMOOTH_PATH_FEATURE_CUT_ARTIFACT_START.length, end)
    .trim();
  const envelope = JSON.parse(json) as SmoothPathFeatureCutEnvelope;
  assertSmoothPathFeatureCutEnvelope(envelope);
  return envelope;
}
