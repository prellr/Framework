/**
 * Outcome-blind preregistration for a future Chainlink catch-up paper family.
 *
 * This contract fixes the complete transform before the inherited venue tape can disclose any
 * feature value. It is not imported by the paper engine and has no database, network, grading,
 * account, wallet, order, or execution dependency.
 */
import { createHash } from "node:crypto";
import { PAPER_FAMILYWISE_GATE } from "./paper-familywise-gate.ts";
import {
  RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE,
  assertResolutionSourceBasisFeatureCutEnvelope,
  nextResolutionSourceBasisStrategyBoundary,
  type ResolutionSourceBasisFeatureCutEnvelope,
} from "./resolution-source-basis-feature-cut-freeze.ts";
import { LEAD_LAG_REPORT, type LeadLagResult } from "./lead-lag-analysis.ts";

const PAIRS = ["BNB-USD", "BTC-USD", "DOGE-USD", "ETH-USD", "SOL-USD", "XRP-USD"] as const;
const HORIZONS = [5, 15] as const;

export const RESOLUTION_SOURCE_BASIS_CATCHUP_PLAN = {
  version: "updown-resolution-source-basis-catchup-preregistration-v1",
  status: "preregistered",
  prerequisiteVersions: {
    venueTape: RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.tapeVersion,
    distribution: RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.prerequisiteVersion,
    featureCuts: RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.artifactVersion,
    pairManifest: "updown-resolution-basis-catchup-pair-manifest-v1",
  },
  pairs: PAIRS,
  hypotheses: [
    {
      key: "resolutionBasisCatchup5m",
      name: "Resolution basis catch-up — 5m",
      horizonMin: 5,
    },
    {
      key: "resolutionBasisCatchup15m",
      name: "Resolution basis catch-up — 15m",
      horizonMin: 15,
    },
  ],
  fixedRule: {
    leadLagSec: 5,
    decisionElapsedSec: { minInclusive: 60, maxExclusive: 120 },
    absoluteBasisReference: "p75",
    persistenceReference: "p75",
    positiveWideningReference: "p75",
    negativeWideningReference: "p25",
    maxSourceAgeMs: 2_000,
    minSelectedAsk: 0.1,
    maxSelectedAsk: 0.55,
    minOppositeAsk: 0.02,
    maxOppositeAsk: 0.98,
    stakeUsd: 5,
    direction:
      "Positive Hyperliquid-minus-Chainlink basis maps to UP; negative basis maps to DOWN.",
    abstention:
      "Any unsupported pair, stale source, non-persistent or non-widening basis, non-extreme absolute basis, out-of-phase sample, missing paired fill, or out-of-range ask abstains.",
  },
  leadLagSupport: {
    lagSec: 5,
    requireReady: true,
    requirePositiveForwardCiLower: true,
    requirePositiveDifferenceCiLower: true,
    pairSpecific: true,
    archiveIfNoPairsQualify: true,
  },
  activation: {
    featureCutBoundaryField: "strategyNotBeforeMs",
    pairManifestBoundaryField: "strategyNotBeforeMs",
    pairManifestPolicy:
      "Freeze a hashed six-pair manifest from only the fixed five-second lead/lag row; no lag search, target outcome, paper result, caller-supplied eligibility, or fallback.",
    noAutomaticActivation: true,
    implementationRequiresLaterDeployment: true,
  },
  validation: {
    version: "updown-resolution-basis-catchup-familywise-gate-v1",
    hypotheses: ["resolutionBasisCatchup5m:5", "resolutionBasisCatchup15m:15"],
    primaryComparator: "same-tick opposite side",
    secondaryComparators: [
      "same-tick Always Down",
      "same-tick Always Up",
      "Chainlink-only pricer family",
      "smooth-path causal displacement",
    ],
    familywiseCorrection: PAPER_FAMILYWISE_GATE.correction,
    alpha: PAPER_FAMILYWISE_GATE.alpha,
    minimumEligibleMarkets: PAPER_FAMILYWISE_GATE.minMarkets,
    minimumSpanDays: PAPER_FAMILYWISE_GATE.minSpanDays,
    minimumBets: PAPER_FAMILYWISE_GATE.minBets,
    minimumClusters: PAPER_FAMILYWISE_GATE.minClusters,
    minimumResidual: PAPER_FAMILYWISE_GATE.minResidual,
    sessionMinimumBets: PAPER_FAMILYWISE_GATE.sessionMinBets,
    positiveSessionsNeeded: PAPER_FAMILYWISE_GATE.sessionsNeeded,
  },
  invariants: {
    readsFeatureValuesNow: false,
    readsLeadLagValuesNow: false,
    readsOutcomes: false,
    readsPaperResults: false,
    createsPaperBot: false,
    changesCollector: false,
    startsCrucibleRun: false,
    enablesExecution: false,
    preservesExistingFamilywiseGate: true,
  },
} as const;

export type ResolutionBasisCatchupPair = (typeof PAIRS)[number];
export type ResolutionBasisCatchupHorizon = (typeof HORIZONS)[number];

export interface ResolutionBasisCatchupPairEligibility {
  pair: ResolutionBasisCatchupPair;
  lagSec: typeof RESOLUTION_SOURCE_BASIS_CATCHUP_PLAN.fixedRule.leadLagSec;
  rows: number;
  spanDays: number;
  blocks: number;
  forwardCi: readonly [number | null, number | null];
  differenceCi: readonly [number | null, number | null];
  qualified: boolean;
}

export interface ResolutionBasisCatchupPairManifest {
  version: typeof RESOLUTION_SOURCE_BASIS_CATCHUP_PLAN.prerequisiteVersions.pairManifest;
  prerequisiteVenueTapeVersion: typeof RESOLUTION_SOURCE_BASIS_CATCHUP_PLAN.prerequisiteVersions.venueTape;
  featureCutsVersion: typeof RESOLUTION_SOURCE_BASIS_CATCHUP_PLAN.prerequisiteVersions.featureCuts;
  featureCutsSha256: string;
  frozenAtMs: number;
  strategyNotBeforeMs: number;
  fixedLagSec: typeof RESOLUTION_SOURCE_BASIS_CATCHUP_PLAN.fixedRule.leadLagSec;
  rows: ResolutionBasisCatchupPairEligibility[];
}

export interface ResolutionBasisCatchupPairManifestEnvelope {
  sha256: string;
  artifact: ResolutionBasisCatchupPairManifest;
}

export const RESOLUTION_BASIS_CATCHUP_PAIR_MANIFEST_START =
  "<!-- RESOLUTION_BASIS_CATCHUP_PAIR_MANIFEST_V1_START -->";
export const RESOLUTION_BASIS_CATCHUP_PAIR_MANIFEST_END =
  "<!-- RESOLUTION_BASIS_CATCHUP_PAIR_MANIFEST_V1_END -->";

export interface ResolutionBasisCatchupObservation {
  pair: ResolutionBasisCatchupPair;
  horizonMin: ResolutionBasisCatchupHorizon;
  windowStartMs: number;
  observedAtMs: number;
  basisBps: number;
  basisChange1sBps: number;
  sameSignPersistence5s: number;
  chainlinkAgeMs: number;
  hlAgeMs: number;
  upFill: number;
  downFill: number;
}

export interface ResolutionBasisCatchupDecision {
  side: "up" | "down";
  selectedAsk: number;
  oppositeAsk: number;
  stakeUsd: number;
  basisBps: number;
  basisChange1sBps: number;
  sameSignPersistence5s: number;
  featureCutsSha256: string;
  pairManifestSha256: string;
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

/** Fixed pair-level activation test; it never searches across the five preregistered lags. */
export function resolutionBasisLeadLagSupported(result: LeadLagResult): boolean {
  const lowerForward = result.forwardCi[0];
  const lowerDifference = result.differenceCi[0];
  return (
    result.lagSec === RESOLUTION_SOURCE_BASIS_CATCHUP_PLAN.leadLagSupport.lagSec &&
    result.ready &&
    lowerForward != null &&
    lowerForward > 0 &&
    lowerDifference != null &&
    lowerDifference > 0
  );
}

function manifestDigest(artifact: ResolutionBasisCatchupPairManifest): string {
  return createHash("sha256").update(JSON.stringify(artifact)).digest("hex");
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length
    || actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new Error(`invalid resolution-basis pair manifest ${label} keys`);
  }
}

function assertCi(value: unknown, label: string): asserts value is [number | null, number | null] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`invalid resolution-basis pair manifest ${label}`);
  }
  const [lower, upper] = value;
  if (
    (lower !== null && !Number.isFinite(lower))
    || (upper !== null && !Number.isFinite(upper))
    || ((lower === null) !== (upper === null))
    || (lower !== null && upper !== null && lower > upper)
  ) {
    throw new Error(`invalid resolution-basis pair manifest ${label}`);
  }
}

function asPair(value: string): ResolutionBasisCatchupPair {
  if (!PAIRS.includes(value as ResolutionBasisCatchupPair)) {
    throw new Error(`resolution-basis pair manifest contains out-of-scope pair: ${value}`);
  }
  return value as ResolutionBasisCatchupPair;
}

/**
 * Deterministically freezes pair eligibility after the locked diagnostic is allowed to disclose.
 *
 * A complete six-pair, fixed-lag input is required so a later implementation cannot choose a
 * favorable subset or lag. The resulting boundary is never earlier than either prerequisite.
 */
export function buildResolutionBasisCatchupPairManifest(input: {
  featureCuts: ResolutionSourceBasisFeatureCutEnvelope;
  leadLagResults: LeadLagResult[];
  frozenAtMs: number;
}): ResolutionBasisCatchupPairManifestEnvelope {
  assertResolutionSourceBasisFeatureCutEnvelope(input.featureCuts);
  if (!Number.isSafeInteger(input.frozenAtMs) || input.frozenAtMs <= 0) {
    throw new Error("invalid resolution-basis pair manifest freeze timestamp");
  }
  if (
    input.leadLagResults.length !== PAIRS.length ||
    input.leadLagResults.some(
      (row) => row.lagSec !== RESOLUTION_SOURCE_BASIS_CATCHUP_PLAN.fixedRule.leadLagSec,
    )
  ) {
    throw new Error("resolution-basis pair manifest requires exactly six fixed-lag rows");
  }
  const rowsByPair = new Map<ResolutionBasisCatchupPair, LeadLagResult>();
  for (const row of input.leadLagResults) {
    const pair = asPair(row.pair);
    if (rowsByPair.has(pair)) {
      throw new Error(`resolution-basis pair manifest contains duplicate pair: ${pair}`);
    }
    rowsByPair.set(pair, row);
  }
  if (rowsByPair.size !== PAIRS.length) {
    throw new Error("resolution-basis pair manifest is missing a required pair");
  }

  const artifact: ResolutionBasisCatchupPairManifest = {
    version: RESOLUTION_SOURCE_BASIS_CATCHUP_PLAN.prerequisiteVersions.pairManifest,
    prerequisiteVenueTapeVersion:
      RESOLUTION_SOURCE_BASIS_CATCHUP_PLAN.prerequisiteVersions.venueTape,
    featureCutsVersion: RESOLUTION_SOURCE_BASIS_CATCHUP_PLAN.prerequisiteVersions.featureCuts,
    featureCutsSha256: input.featureCuts.sha256,
    frozenAtMs: input.frozenAtMs,
    strategyNotBeforeMs: Math.max(
      input.featureCuts.artifact.strategyNotBeforeMs,
      nextResolutionSourceBasisStrategyBoundary(input.frozenAtMs),
    ),
    fixedLagSec: RESOLUTION_SOURCE_BASIS_CATCHUP_PLAN.fixedRule.leadLagSec,
    rows: PAIRS.map((pair) => {
      const row = rowsByPair.get(pair)!;
      return {
        pair,
        lagSec: RESOLUTION_SOURCE_BASIS_CATCHUP_PLAN.fixedRule.leadLagSec,
        rows: row.rows,
        spanDays: row.spanDays,
        blocks: row.blocks,
        forwardCi: row.forwardCi,
        differenceCi: row.differenceCi,
        qualified: resolutionBasisLeadLagSupported(row),
      };
    }),
  };
  const envelope = { sha256: manifestDigest(artifact), artifact };
  assertResolutionBasisCatchupPairManifestEnvelope(envelope, input.featureCuts);
  return envelope;
}

export function resolutionBasisCatchupPairManifestValid(
  envelope: ResolutionBasisCatchupPairManifestEnvelope,
  featureCuts: ResolutionSourceBasisFeatureCutEnvelope,
): boolean {
  try {
    assertResolutionBasisCatchupPairManifestEnvelope(envelope, featureCuts);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fail-closed validation for the persisted pair manifest.
 *
 * Eligibility is recomputed from the stored fixed-lag confidence bounds after the inherited
 * readiness floors are checked. A serialized caller therefore cannot choose its own roster.
 */
export function assertResolutionBasisCatchupPairManifestEnvelope(
  value: unknown,
  featureCuts?: ResolutionSourceBasisFeatureCutEnvelope,
): asserts value is ResolutionBasisCatchupPairManifestEnvelope {
  if (!isRecord(value)) {
    throw new Error("invalid resolution-basis pair manifest envelope");
  }
  assertExactKeys(value, ["sha256", "artifact"], "envelope");
  if (
    typeof value.sha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(value.sha256)
    || !isRecord(value.artifact)
  ) {
    throw new Error("invalid resolution-basis pair manifest envelope");
  }
  const artifact = value.artifact;
  const expectedBoundary = Math.max(
    featureCuts?.artifact.strategyNotBeforeMs ?? 0,
    nextResolutionSourceBasisStrategyBoundary(Number(artifact.frozenAtMs)),
  );
  assertExactKeys(
    artifact,
    [
      "version",
      "prerequisiteVenueTapeVersion",
      "featureCutsVersion",
      "featureCutsSha256",
      "frozenAtMs",
      "strategyNotBeforeMs",
      "fixedLagSec",
      "rows",
    ],
    "artifact",
  );
  if (
    artifact.version !== RESOLUTION_SOURCE_BASIS_CATCHUP_PLAN.prerequisiteVersions.pairManifest
    || artifact.prerequisiteVenueTapeVersion
      !== RESOLUTION_SOURCE_BASIS_CATCHUP_PLAN.prerequisiteVersions.venueTape
    || artifact.featureCutsVersion
      !== RESOLUTION_SOURCE_BASIS_CATCHUP_PLAN.prerequisiteVersions.featureCuts
    || typeof artifact.featureCutsSha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(artifact.featureCutsSha256)
    || !Number.isSafeInteger(artifact.frozenAtMs)
    || Number(artifact.frozenAtMs) <= 0
    || !Number.isSafeInteger(artifact.strategyNotBeforeMs)
    || artifact.strategyNotBeforeMs !== expectedBoundary
    || artifact.fixedLagSec !== RESOLUTION_SOURCE_BASIS_CATCHUP_PLAN.fixedRule.leadLagSec
    || !Array.isArray(artifact.rows)
    || artifact.rows.length !== PAIRS.length
  ) {
    throw new Error("invalid resolution-basis pair manifest artifact contract");
  }
  if (featureCuts) {
    assertResolutionSourceBasisFeatureCutEnvelope(featureCuts);
    if (
      artifact.featureCutsSha256 !== featureCuts.sha256
      || Number(artifact.strategyNotBeforeMs) < featureCuts.artifact.strategyNotBeforeMs
    ) {
      throw new Error("resolution-basis pair manifest feature-cut binding mismatch");
    }
  }
  for (let index = 0; index < PAIRS.length; index++) {
    const row: unknown = artifact.rows[index];
    if (!isRecord(row)) {
      throw new Error("invalid resolution-basis pair manifest row");
    }
    assertExactKeys(
      row,
      [
        "pair",
        "lagSec",
        "rows",
        "spanDays",
        "blocks",
        "forwardCi",
        "differenceCi",
        "qualified",
      ],
      "row",
    );
    assertCi(row.forwardCi, `${PAIRS[index]} forward CI`);
    assertCi(row.differenceCi, `${PAIRS[index]} difference CI`);
    const inheritedReady =
      Number.isSafeInteger(row.rows)
      && Number(row.rows) >= LEAD_LAG_REPORT.minRows
      && Number.isFinite(row.spanDays)
      && Number(row.spanDays) >= LEAD_LAG_REPORT.minSpanDays
      && Number.isSafeInteger(row.blocks)
      && Number(row.blocks) >= LEAD_LAG_REPORT.minBlocks;
    const expectedQualified =
      inheritedReady
      && row.forwardCi[0] != null
      && row.forwardCi[0] > 0
      && row.differenceCi[0] != null
      && row.differenceCi[0] > 0;
    if (
      row.pair !== PAIRS[index]
      || row.lagSec !== RESOLUTION_SOURCE_BASIS_CATCHUP_PLAN.fixedRule.leadLagSec
      || !inheritedReady
      || typeof row.qualified !== "boolean"
      || row.qualified !== expectedQualified
    ) {
      throw new Error("invalid resolution-basis pair manifest roster or eligibility");
    }
  }
  const envelope = value as unknown as ResolutionBasisCatchupPairManifestEnvelope;
  if (manifestDigest(envelope.artifact) !== envelope.sha256) {
    throw new Error("resolution-basis pair manifest hash mismatch");
  }
}

export function serializeResolutionBasisCatchupPairManifestEnvelope(
  envelope: ResolutionBasisCatchupPairManifestEnvelope,
  featureCuts?: ResolutionSourceBasisFeatureCutEnvelope,
): string {
  assertResolutionBasisCatchupPairManifestEnvelope(envelope, featureCuts);
  return [
    RESOLUTION_BASIS_CATCHUP_PAIR_MANIFEST_START,
    "```json",
    JSON.stringify(envelope, null, 2),
    "```",
    RESOLUTION_BASIS_CATCHUP_PAIR_MANIFEST_END,
  ].join("\n");
}

export function parseResolutionBasisCatchupPairManifestEnvelope(
  body: string,
  featureCuts?: ResolutionSourceBasisFeatureCutEnvelope,
): ResolutionBasisCatchupPairManifestEnvelope {
  const start = body.indexOf(RESOLUTION_BASIS_CATCHUP_PAIR_MANIFEST_START);
  const end = body.indexOf(RESOLUTION_BASIS_CATCHUP_PAIR_MANIFEST_END);
  if (start < 0 || end <= start) {
    throw new Error("resolution-basis pair manifest markers missing");
  }
  const block = body
    .slice(start + RESOLUTION_BASIS_CATCHUP_PAIR_MANIFEST_START.length, end)
    .trim()
    .replace(/^```json\s*/, "")
    .replace(/\s*```$/, "");
  const parsed: unknown = JSON.parse(block);
  assertResolutionBasisCatchupPairManifestEnvelope(parsed, featureCuts);
  return parsed;
}

function featureBucket(
  envelope: ResolutionSourceBasisFeatureCutEnvelope,
  pair: ResolutionBasisCatchupPair,
) {
  return envelope.artifact.buckets.find((bucket) => bucket.pair === pair) ?? null;
}

/**
 * Pure future transform over an already-frozen feature artifact and one causal observation.
 *
 * Keeping this function executable in tests removes ambiguity from the preregistration while the
 * runtime remains intentionally disconnected.
 */
export function resolutionBasisCatchupDecision(
  envelope: ResolutionSourceBasisFeatureCutEnvelope,
  pairManifest: ResolutionBasisCatchupPairManifestEnvelope,
  observation: ResolutionBasisCatchupObservation,
): ResolutionBasisCatchupDecision | null {
  const rule = RESOLUTION_SOURCE_BASIS_CATCHUP_PLAN.fixedRule;
  const hypothesis = RESOLUTION_SOURCE_BASIS_CATCHUP_PLAN.hypotheses.find(
    (candidate) => candidate.horizonMin === observation.horizonMin,
  );
  if (!hypothesis || !resolutionBasisCatchupPairManifestValid(pairManifest, envelope)) {
    return null;
  }
  const pairEligibility = pairManifest.artifact.rows.find((row) => row.pair === observation.pair);
  if (!pairEligibility?.qualified) return null;
  if (
    observation.windowStartMs <
      Math.max(envelope.artifact.strategyNotBeforeMs, pairManifest.artifact.strategyNotBeforeMs) ||
    observation.observedAtMs < observation.windowStartMs
  ) {
    return null;
  }
  const elapsedSec = (observation.observedAtMs - observation.windowStartMs) / 1_000;
  if (
    elapsedSec < rule.decisionElapsedSec.minInclusive ||
    elapsedSec >= rule.decisionElapsedSec.maxExclusive
  ) {
    return null;
  }
  const numeric = [
    observation.basisBps,
    observation.basisChange1sBps,
    observation.sameSignPersistence5s,
    observation.chainlinkAgeMs,
    observation.hlAgeMs,
    observation.upFill,
    observation.downFill,
  ];
  if (!numeric.every(finite)) return null;
  if (
    observation.chainlinkAgeMs < 0 ||
    observation.hlAgeMs < 0 ||
    observation.chainlinkAgeMs > rule.maxSourceAgeMs ||
    observation.hlAgeMs > rule.maxSourceAgeMs ||
    observation.sameSignPersistence5s < 0 ||
    observation.sameSignPersistence5s > 1
  ) {
    return null;
  }
  const bucket = featureBucket(envelope, observation.pair);
  if (!bucket) return null;
  if (
    Math.abs(observation.basisBps) < bucket.absoluteBasisBps.p75 ||
    observation.sameSignPersistence5s < bucket.sameSignPersistence5s.p75
  ) {
    return null;
  }

  const side =
    observation.basisBps > 0 && observation.basisChange1sBps >= bucket.basisChange1sBps.p75
      ? "up"
      : observation.basisBps < 0 && observation.basisChange1sBps <= bucket.basisChange1sBps.p25
        ? "down"
        : null;
  if (!side) return null;
  const selectedAsk = side === "up" ? observation.upFill : observation.downFill;
  const oppositeAsk = side === "up" ? observation.downFill : observation.upFill;
  if (
    selectedAsk < rule.minSelectedAsk ||
    selectedAsk > rule.maxSelectedAsk ||
    oppositeAsk <= rule.minOppositeAsk ||
    oppositeAsk >= rule.maxOppositeAsk
  ) {
    return null;
  }
  return {
    side,
    selectedAsk,
    oppositeAsk,
    stakeUsd: rule.stakeUsd,
    basisBps: observation.basisBps,
    basisChange1sBps: observation.basisChange1sBps,
    sameSignPersistence5s: observation.sameSignPersistence5s,
    featureCutsSha256: envelope.sha256,
    pairManifestSha256: pairManifest.sha256,
  };
}
