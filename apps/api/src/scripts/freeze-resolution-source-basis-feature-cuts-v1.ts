/**
 * Freeze the preregistered outcome-blind basis references after the inherited tape floor passes.
 *
 * Before readiness, the distribution service returns no report and does not execute its feature
 * query. The first successful run writes one immutable hashed KB artifact. No market outcome,
 * paper decision, result, account, position, wallet, or order is selected or joined.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { resolutionSourceBasisDistributionAudit } from "../services/resolution-source-basis-distribution.ts";
import {
  RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE,
  buildResolutionSourceBasisFeatureCutEnvelope,
  parseResolutionSourceBasisFeatureCutEnvelope,
  serializeResolutionSourceBasisFeatureCutEnvelope,
} from "../services/resolution-source-basis-feature-cut-freeze.ts";

const contract = RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE;
const slug = contract.artifactSlug;
const planMarker = "## Outcome-blind resolution-source basis feature-cut freeze plan v1";
const marker = "# Frozen outcome-blind resolution-source basis feature cuts v1";
const action = "kb.feature-cuts.freeze";
const user = {
  id: "agent",
  name: "Agent",
  email: "agent@localhost",
  role: "operator" as const,
  banned: false,
  banReason: null,
  banExpires: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  emailVerified: false,
  image: null,
};
const ctx = {
  user,
  session: null,
  req: new Request("http://localhost/internal/freeze-resolution-source-basis-feature-cuts"),
};
const caller = appRouter.createCaller(ctx);

const ensureAudit = async (metadata: Record<string, unknown>) => {
  const [existing] = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(and(
      eq(auditLogs.action, action),
      eq(auditLogs.resourceType, "kbArticle"),
      eq(auditLogs.resourceId, slug),
    ))
    .limit(1);
  if (existing) return false;
  await audit(ctx, action, {
    resourceType: "kbArticle",
    resourceId: slug,
    newValue: metadata,
  });
  return true;
};

const existing = await caller.kb.get({ slug });
if (existing) {
  if (!existing.body.includes(marker)) {
    throw new Error(`refusing to replace existing KB article without marker: ${slug}`);
  }
  const envelope = parseResolutionSourceBasisFeatureCutEnvelope(existing.body);
  console.log(JSON.stringify({
    frozen: true,
    updated: false,
    auditInserted: await ensureAudit({
      sha256: envelope.sha256,
      frozenAtMs: envelope.artifact.frozenAtMs,
      strategyNotBeforeMs: envelope.artifact.strategyNotBeforeMs,
      pairs: envelope.artifact.buckets.length,
    }),
    slug,
    sha256: envelope.sha256,
    frozenAt: new Date(envelope.artifact.frozenAtMs).toISOString(),
    strategyNotBefore: new Date(envelope.artifact.strategyNotBeforeMs).toISOString(),
    reason: "immutable_artifact_already_exists",
  }, null, 2));
  process.exit(0);
}

const plan = await caller.kb.get({ slug: contract.planVersion });
if (!plan?.body.includes(planMarker)) {
  throw new Error(`missing preregistered basis feature-cut plan: ${contract.planVersion}`);
}

const distribution = await resolutionSourceBasisDistributionAudit();
if (
  distribution.version !== contract.prerequisiteVersion
  || distribution.tapeVersion !== contract.tapeVersion
  || !distribution.inheritedTapeReady
  || distribution.tape.pairs.length !== contract.requiredPairs
  || distribution.tape.pairs.some((pair) => !pair.readyForFrozenDiagnostic)
  || !distribution.report
) {
  const readyPairs = distribution.tape.pairs.filter(
    (pair) => pair.readyForFrozenDiagnostic,
  ).length;
  throw new Error(
    `refusing resolution-source feature-cut freeze: ${readyPairs}/${contract.requiredPairs} pair distributions ready`,
  );
}

const envelope = buildResolutionSourceBasisFeatureCutEnvelope({
  distributionVersion: distribution.version,
  tapeVersion: distribution.tapeVersion,
  report: distribution.report,
  frozenAtMs: Date.now(),
});
const body = [
  marker,
  "",
  `Frozen ${new Date(envelope.artifact.frozenAtMs).toISOString()} from the fully ready \`${distribution.version}\` report.`,
  "",
  "## Scope",
  "",
  `- ${envelope.artifact.buckets.length} exact pair-level preprocessing buckets from \`${envelope.artifact.tapeVersion}\`.`,
  `- Metrics: ${contract.metrics.join(", ")}.`,
  `- SHA-256: \`${envelope.sha256}\`.`,
  `- No prospective experiment or strategy may begin before \`${new Date(envelope.artifact.strategyNotBeforeMs).toISOString()}\`.`,
  "",
  "## Restrictions",
  "",
  "- The artifact contains outcome-free distribution references only. It selects no horizon, direction, formula, threshold, market, side, or paper decision.",
  "- Formula Lab use requires a separately registered live-data experiment and complete trial ledger. Any Polymarket rule requires independent 5m/15m identities, fee-adjusted paired-book asks, a later future boundary, and the unchanged familywise verdict gate.",
  "",
  serializeResolutionSourceBasisFeatureCutEnvelope(envelope),
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Frozen outcome-blind resolution-source basis feature cuts v1",
  category: "research",
  tags: [
    "alchemy",
    "formula-lab",
    "polymarket",
    "updown",
    "chainlink",
    "hyperliquid",
    "basis",
    "paper-only",
  ],
  body,
  sources: [
    {
      title: "Outcome-free resolution-source basis distribution audit v1",
      url: "https://jester.wisco.wine/knowledge/updown-resolution-source-basis-distribution-audit-v1",
    },
  ],
  status: "active",
});
const auditInserted = await ensureAudit({
  sha256: envelope.sha256,
  frozenAtMs: envelope.artifact.frozenAtMs,
  strategyNotBeforeMs: envelope.artifact.strategyNotBeforeMs,
  pairs: envelope.artifact.buckets.length,
});

console.log(JSON.stringify({
  frozen: true,
  updated: true,
  auditInserted,
  slug,
  sha256: envelope.sha256,
  frozenAt: new Date(envelope.artifact.frozenAtMs).toISOString(),
  strategyNotBefore: new Date(envelope.artifact.strategyNotBeforeMs).toISOString(),
  pairs: envelope.artifact.buckets.length,
}, null, 2));
process.exit(0);
