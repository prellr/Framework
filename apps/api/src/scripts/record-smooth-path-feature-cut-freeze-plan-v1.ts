/**
 * Preregister the immutable outcome-blind Smooth Path feature-reference artifact.
 *
 * This script reads/writes KB and audit metadata only. It does not query feature values, outcomes,
 * paper decisions, results, accounts, positions, wallets, or orders.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { SMOOTH_PATH_FEATURE_CUT_FREEZE } from "../services/smooth-path-feature-cut-freeze.ts";

const slug = SMOOTH_PATH_FEATURE_CUT_FREEZE.planVersion;
const marker = "## Outcome-blind Smooth Path feature-cut freeze plan v1";
const action = "kb.preregistration.record";
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
  req: new Request("http://localhost/internal/kb-smooth-path-feature-cut-freeze-plan-v1"),
};
const caller = appRouter.createCaller(ctx);

if (
  SMOOTH_PATH_FEATURE_CUT_FREEZE.planVersion
    !== "updown-smooth-path-feature-cut-freeze-plan-v1"
  || SMOOTH_PATH_FEATURE_CUT_FREEZE.artifactVersion
    !== "updown-smooth-path-feature-cuts-v1"
  || SMOOTH_PATH_FEATURE_CUT_FREEZE.versions.length !== 2
  || SMOOTH_PATH_FEATURE_CUT_FREEZE.metrics.length !== 5
  || SMOOTH_PATH_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs !== 30 * 60_000
  || SMOOTH_PATH_FEATURE_CUT_FREEZE.boundaryGridMs !== 5 * 60_000
) {
  throw new Error("Smooth Path feature-cut executable contract does not match plan");
}

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
  console.log(JSON.stringify({
    updated: false,
    auditInserted: await ensureAudit(),
    slug,
    reason: "already_registered",
  }, null, 2));
  process.exit(0);
}
if (existing) throw new Error(`refusing to replace existing KB article without marker: ${slug}`);

const body = [
  marker,
  "",
  `Registered ${new Date().toISOString()} before \`${SMOOTH_PATH_FEATURE_CUT_FREEZE.prerequisiteVersion}\` unlocked.`,
  "",
  "### Immutable artifact contract",
  "",
  `- Prerequisite: both frozen Smooth Path versions must independently pass every \`${SMOOTH_PATH_FEATURE_CUT_FREEZE.prerequisiteVersion}\` row, per-asset, span, and coverage floor.`,
  `- Versions, in fixed order: ${SMOOTH_PATH_FEATURE_CUT_FREEZE.versions.join(", ")}.`,
  `- Metrics: ${SMOOTH_PATH_FEATURE_CUT_FREEZE.metrics.join(", ")}.`,
  "- Each version stores support counts, span, coverage, and the already-preregistered p10/p50/p90 references. Missing, non-monotone, out-of-range, incomplete, duplicate, or extra-version artifacts fail closed.",
  "- The complete JSON artifact is SHA-256 hashed and round-trip validated before persistence.",
  `- A strategy boundary is the first ${SMOOTH_PATH_FEATURE_CUT_FREEZE.boundaryGridMs / 60_000}-minute grid point at least ${SMOOTH_PATH_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs / 60_000} minutes after the freeze timestamp.`,
  "",
  "### Constraints",
  "",
  "- The artifact records unsigned quality references only. It selects no orientation, threshold, asset, eligible state, strategy identity, paper row, comparator, or verdict.",
  "- The freeze may read only the preregistered outcome-blind Smooth Path funnel report after both versions pass every inherited floor. It may not join outcomes, labels, paper decisions, grades, returns, P&L, accounts, positions, wallets, credentials, or orders.",
  "- Any later v3 rule must be separately preregistered after this artifact exists, state its exact transform and cut, use a new paper identity and a later future boundary, retain executable fee-adjusted paired-book fills, and pass the unchanged familywise verdict gate.",
  "- This plan adds no collector, table, subscription, polling loop, paper insertion, order route, signing capability, allocation, or fund-moving path.",
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Outcome-blind Smooth Path feature-cut freeze plan v1",
  category: "research" as (typeof categories)[number],
  tags: [
    "polymarket",
    "updown",
    "smooth-path",
    "feature-freeze",
    "paper-only",
    "preregistered",
  ],
  body,
  sources: [{
    title: "Smooth Path causal displacement v2",
    url: "https://jester.wisco.wine/knowledge/updown-smooth-path-causal-displacement-v2",
  }],
  status: "active" as (typeof statuses)[number],
});

console.log(JSON.stringify({
  updated: true,
  auditInserted: await ensureAudit(),
  slug,
  artifactVersion: SMOOTH_PATH_FEATURE_CUT_FREEZE.artifactVersion,
}, null, 2));
process.exit(0);
