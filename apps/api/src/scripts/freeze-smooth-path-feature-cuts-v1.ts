/**
 * Freeze the preregistered Smooth Path quality references after both inherited gates pass.
 *
 * The only value source is the outcome-blind funnel report. This script has no paper-ledger,
 * outcome, result, account, wallet, signing, allocation, or order dependency.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import {
  buildSmoothPathFeatureCutEnvelope,
  parseSmoothPathFeatureCutEnvelope,
  serializeSmoothPathFeatureCutEnvelope,
  SMOOTH_PATH_FEATURE_CUT_FREEZE,
} from "../services/smooth-path-feature-cut-freeze.ts";
import { smoothPathFunnelStatus } from "../services/smooth-path-funnel-report.ts";

const slug = SMOOTH_PATH_FEATURE_CUT_FREEZE.artifactSlug;
const planMarker = "## Outcome-blind Smooth Path feature-cut freeze plan v1";
const marker = "# Frozen outcome-blind Smooth Path feature cuts v1";
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
  req: new Request("http://localhost/internal/freeze-smooth-path-feature-cuts-v1"),
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
  const envelope = parseSmoothPathFeatureCutEnvelope(existing.body);
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

const plan = await caller.kb.get({ slug: SMOOTH_PATH_FEATURE_CUT_FREEZE.planVersion });
if (!plan?.body.includes(planMarker)) {
  throw new Error(
    `missing preregistered Smooth Path feature-cut plan: ${SMOOTH_PATH_FEATURE_CUT_FREEZE.planVersion}`,
  );
}

const report = await smoothPathFunnelStatus();
if (!report.qualityTape.allVersionsReadyForThresholdDesign) {
  throw new Error("refusing Smooth Path feature-cut freeze: quality distributions are not ready");
}

const envelope = buildSmoothPathFeatureCutEnvelope({ report, frozenAtMs: Date.now() });
const body = [
  marker,
  "",
  `Frozen ${new Date(envelope.artifact.frozenAtMs).toISOString()} from both complete preregistered outcome-blind quality distributions.`,
  "",
  `- SHA-256: \`${envelope.sha256}\`.`,
  `- Frozen versions: ${envelope.artifact.versions.length}.`,
  `- Earliest later strategy boundary: ${new Date(envelope.artifact.strategyNotBeforeMs).toISOString()}.`,
  "- This is a preprocessing artifact only. It creates no orientation, threshold, paper decision, roster entry, verdict, or execution capability.",
  "",
  serializeSmoothPathFeatureCutEnvelope(envelope),
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Frozen outcome-blind Smooth Path feature cuts v1",
  category: "research" as (typeof categories)[number],
  tags: [
    "polymarket",
    "updown",
    "smooth-path",
    "feature-freeze",
    "paper-only",
  ],
  body,
  sources: [{
    title: "Outcome-blind Smooth Path feature-cut freeze plan v1",
    url: "https://jester.wisco.wine/knowledge/updown-smooth-path-feature-cut-freeze-plan-v1",
  }],
  status: "active" as (typeof statuses)[number],
});

console.log(JSON.stringify({
  updated: true,
  auditInserted: await ensureAudit(),
  slug,
  sha256: envelope.sha256,
  strategyNotBeforeMs: envelope.artifact.strategyNotBeforeMs,
}, null, 2));
process.exit(0);
