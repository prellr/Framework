/**
 * Freeze the preregistered outcome-blind state references after the inherited gate passes.
 *
 * The only value source is the outcome-free distribution audit. This script has no paper-ledger,
 * outcome, result, account, wallet, signing, allocation, or order dependency.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { microstructureStateDistributionAudit } from "../services/microstructure-state-distribution-audit.ts";
import {
  buildMicrostructureStateFeatureCutEnvelope,
  MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE,
  parseMicrostructureStateFeatureCutEnvelope,
  serializeMicrostructureStateFeatureCutEnvelope,
} from "../services/microstructure-state-feature-cut-freeze.ts";

const slug = MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.artifactSlug;
const planMarker = "## Outcome-blind microstructure state feature-cut freeze plan v1";
const marker = "# Frozen outcome-blind microstructure state feature cuts v1";
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
  req: new Request("http://localhost/internal/freeze-microstructure-state-feature-cuts-v1"),
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
  const envelope = parseMicrostructureStateFeatureCutEnvelope(existing.body);
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
  slug: MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.planVersion,
});
if (!plan?.body.includes(planMarker)) {
  throw new Error(
    `missing preregistered state feature-cut plan: ${MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.planVersion}`,
  );
}

const distribution = await microstructureStateDistributionAudit();
if (
  distribution.version !== MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.prerequisiteVersion
  || !distribution.inheritedTapeReady
  || !distribution.readyForCutFreeze
  || !distribution.report
) {
  throw new Error("refusing state feature-cut freeze: outcome-free distribution is not ready");
}

const envelope = buildMicrostructureStateFeatureCutEnvelope({
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
  "- This is a preprocessing artifact only. It creates no state definition, side, threshold, paper decision, roster entry, verdict, or execution capability.",
  "",
  serializeMicrostructureStateFeatureCutEnvelope(envelope),
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Frozen outcome-blind microstructure state feature cuts v1",
  category: "research" as (typeof categories)[number],
  tags: [
    "polymarket",
    "updown",
    "microstructure",
    "liquidity",
    "feature-freeze",
    "paper-only",
  ],
  body,
  sources: [{
    title: "Outcome-free microstructure state distribution audit v1",
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
