/**
 * Freeze preregistered unsigned taker-flow references after the inherited gate passes.
 *
 * The only value source is the outcome-free distribution audit. This script has no token-direction,
 * paper-ledger, outcome, result, account, wallet, signing, allocation, or order dependency.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import {
  authoritativeTakerFlowDistributionAudit,
} from "../services/authoritative-taker-flow-distribution-audit.ts";
import {
  AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE,
  buildAuthoritativeTakerFlowFeatureCutEnvelope,
  parseAuthoritativeTakerFlowFeatureCutEnvelope,
  serializeAuthoritativeTakerFlowFeatureCutEnvelope,
} from "../services/authoritative-taker-flow-feature-cut-freeze.ts";

const slug = AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.artifactSlug;
const planMarker = "## Outcome-blind authoritative taker-flow feature-cut freeze plan v1";
const marker = "# Frozen outcome-blind authoritative taker-flow feature cuts v1";
const action = "kb.feature-freeze.record";
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
  req: new Request("http://localhost/internal/freeze-authoritative-taker-flow-feature-cuts-v1"),
};
const caller = appRouter.createCaller(ctx);

const ensureAudit = async () => {
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
  await audit(ctx, action, { resourceType: "kbArticle", resourceId: slug });
  return true;
};

const existing = await caller.kb.get({ slug });
if (existing?.body.includes(marker)) {
  const envelope = parseAuthoritativeTakerFlowFeatureCutEnvelope(existing.body);
  console.log(JSON.stringify({
    updated: false,
    auditInserted: await ensureAudit(),
    slug,
    sha256: envelope.sha256,
    reason: "already_frozen",
  }, null, 2));
  process.exit(0);
}
if (existing) throw new Error(`refusing to replace existing KB article without marker: ${slug}`);

const plan = await caller.kb.get({
  slug: AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.planVersion,
});
if (!plan?.body.includes(planMarker)) {
  throw new Error(
    `missing preregistered authoritative taker-flow cut plan: ${AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.planVersion}`,
  );
}

const distribution = await authoritativeTakerFlowDistributionAudit();
if (
  distribution.version !== AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.prerequisiteVersion
  || !distribution.inheritedTapeReady
  || !distribution.readyForCutFreeze
  || !distribution.report
) {
  throw new Error(
    "refusing authoritative taker-flow feature-cut freeze: outcome-free distribution is not ready",
  );
}

const envelope = buildAuthoritativeTakerFlowFeatureCutEnvelope({
  distributionVersion: distribution.version,
  tapeVersion: distribution.tapeVersion,
  report: distribution.report,
  frozenAtMs: Date.now(),
});
const body = [
  marker,
  "",
  `Frozen ${new Date(envelope.artifact.frozenAtMs).toISOString()} from the complete preregistered outcome-free distribution.`,
  "",
  `- SHA-256: \`${envelope.sha256}\`.`,
  `- Buckets: ${envelope.artifact.buckets.length}.`,
  `- Earliest later strategy boundary: ${new Date(envelope.artifact.strategyNotBeforeMs).toISOString()}.`,
  "- This is an unsigned preprocessing artifact only. It creates no token choice, direction, threshold, paper decision, roster entry, verdict, or execution capability.",
  "",
  serializeAuthoritativeTakerFlowFeatureCutEnvelope(envelope),
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Frozen outcome-blind authoritative taker-flow feature cuts v1",
  category: "research" as (typeof categories)[number],
  tags: [
    "polymarket",
    "updown",
    "taker-flow",
    "liquidity",
    "feature-freeze",
    "paper-only",
  ],
  body,
  sources: [{
    title: "Outcome-free authoritative taker-flow distribution audit v1",
    url: "https://jester.wisco.wine/knowledge",
  }],
  status: "active" as (typeof statuses)[number],
});

console.log(JSON.stringify({
  updated: true,
  auditInserted: await ensureAudit(),
  slug,
  sha256: envelope.sha256,
  buckets: envelope.artifact.buckets.length,
  strategyNotBeforeMs: envelope.artifact.strategyNotBeforeMs,
}, null, 2));
process.exit(0);
