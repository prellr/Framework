/**
 * Freeze the preregistered outcome-blind flow references after both inherited source floors pass.
 *
 * The first successful invocation writes one immutable, hashed KB artifact. Before readiness the
 * distribution service returns null reports without running feature-value queries, and this script
 * refuses to write. No market outcome, paper decision, result, account, position, or order is read.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { flowDistributionAudit } from "../services/flow-distribution-audit.ts";
import {
  FLOW_FEATURE_CUT_FREEZE,
  buildFlowFeatureCutEnvelope,
  parseFlowFeatureCutEnvelope,
  serializeFlowFeatureCutEnvelope,
} from "../services/flow-feature-cut-freeze.ts";

const slug = FLOW_FEATURE_CUT_FREEZE.artifactSlug;
const planMarker = "## Outcome-blind flow feature-cut freeze plan v1";
const marker = "# Frozen outcome-blind flow feature cuts v1";
const action = "kb.feature-cuts.freeze";
const categories = ["operations", "strategy", "research", "provider", "decision", "postmortem"] as const;
const statuses = ["active", "superseded", "archived"] as const;
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
  req: new Request("http://localhost/internal/freeze-flow-feature-cuts-v1"),
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
  const envelope = parseFlowFeatureCutEnvelope(existing.body);
  console.log(JSON.stringify({
    frozen: true,
    updated: false,
    auditInserted: await ensureAudit({
      sha256: envelope.sha256,
      frozenAtMs: envelope.artifact.frozenAtMs,
      strategyNotBeforeMs: envelope.artifact.strategyNotBeforeMs,
      buckets: envelope.artifact.buckets.length,
    }),
    slug,
    sha256: envelope.sha256,
    frozenAt: new Date(envelope.artifact.frozenAtMs).toISOString(),
    strategyNotBefore: new Date(envelope.artifact.strategyNotBeforeMs).toISOString(),
    reason: "immutable_artifact_already_exists",
  }, null, 2));
  process.exit(0);
}

const plan = await caller.kb.get({ slug: FLOW_FEATURE_CUT_FREEZE.planVersion });
if (!plan?.body.includes(planMarker)) {
  throw new Error(`missing preregistered flow feature-cut plan: ${FLOW_FEATURE_CUT_FREEZE.planVersion}`);
}

const distribution = await flowDistributionAudit();
if (
  distribution.version !== FLOW_FEATURE_CUT_FREEZE.prerequisiteVersion
  || distribution.readySources !== distribution.totalSources
  || !distribution.sources.hyperliquid.ready
  || !distribution.sources.clobEventOfi.ready
  || !distribution.sources.hyperliquid.report
  || !distribution.sources.clobEventOfi.report
) {
  throw new Error(
    `refusing flow feature-cut freeze: ${distribution.readySources}/${distribution.totalSources} source distributions ready`,
  );
}

const envelope = buildFlowFeatureCutEnvelope({
  distributionVersion: distribution.version,
  tapeVersions: {
    hyperliquid: distribution.sources.hyperliquid.tapeVersion,
    clobEventOfi: distribution.sources.clobEventOfi.tapeVersion,
  },
  hyperliquidReport: distribution.sources.hyperliquid.report,
  clobEventOfiReport: distribution.sources.clobEventOfi.report,
  frozenAtMs: Date.now(),
});
const body = [
  marker,
  "",
  `Frozen ${new Date(envelope.artifact.frozenAtMs).toISOString()} from the fully ready \`${distribution.version}\` report.`,
  "",
  "## Scope",
  "",
  `- ${envelope.artifact.buckets.length} exact asset × 5m/15m preprocessing buckets.`,
  `- Hyperliquid tape: \`${envelope.artifact.tapeVersions.hyperliquid}\`.`,
  `- CLOB event-OFI tape: \`${envelope.artifact.tapeVersions.clobEventOfi}\`.`,
  `- SHA-256: \`${envelope.sha256}\`.`,
  `- No prospective strategy may begin before \`${new Date(envelope.artifact.strategyNotBeforeMs).toISOString()}\`.`,
  "",
  "## Restrictions",
  "",
  "- This immutable artifact contains outcome-free preprocessing references only. It chooses no side or directional rule and creates no paper decision.",
  "- Any later candidate requires a separate preregistration, independent paper identity, fee-adjusted executable asks, future boundary, and unchanged verdict gate.",
  "",
  serializeFlowFeatureCutEnvelope(envelope),
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Frozen outcome-blind flow feature cuts v1",
  category: "research" as (typeof categories)[number],
  tags: ["polymarket", "updown", "hyperliquid", "order-flow", "ofi", "paper-only"],
  body,
  sources: [
    {
      title: "Outcome-free flow distribution audit v1",
      url: "https://jester.wisco.wine/knowledge/updown-flow-distribution-audit-v1",
    },
  ],
  status: "active" as (typeof statuses)[number],
});
const auditInserted = await ensureAudit({
  sha256: envelope.sha256,
  frozenAtMs: envelope.artifact.frozenAtMs,
  strategyNotBeforeMs: envelope.artifact.strategyNotBeforeMs,
  buckets: envelope.artifact.buckets.length,
});

console.log(JSON.stringify({
  frozen: true,
  updated: true,
  auditInserted,
  slug,
  sha256: envelope.sha256,
  frozenAt: new Date(envelope.artifact.frozenAtMs).toISOString(),
  strategyNotBefore: new Date(envelope.artifact.strategyNotBeforeMs).toISOString(),
  buckets: envelope.artifact.buckets.length,
}, null, 2));
process.exit(0);
