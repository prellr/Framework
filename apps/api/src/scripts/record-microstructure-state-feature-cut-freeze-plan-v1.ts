/**
 * Preregister the immutable outcome-blind paired-book state feature-cut artifact.
 *
 * This script reads/writes KB and audit metadata only. It does not query a state feature value,
 * outcome, paper decision, result, account, position, wallet, or order.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE } from "../services/microstructure-state-feature-cut-freeze.ts";

const slug = MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.planVersion;
const marker = "## Outcome-blind microstructure state feature-cut freeze plan v1";
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
  req: new Request("http://localhost/internal/kb-state-feature-cut-freeze-plan-v1"),
};
const caller = appRouter.createCaller(ctx);

if (
  MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.planVersion
    !== "updown-microstructure-state-feature-cut-freeze-plan-v1"
  || MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.artifactVersion
    !== "updown-microstructure-state-feature-cuts-v1"
  || MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.requiredBuckets !== 120
  || MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.minMarketsPerBucket !== 50
  || MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs !== 30 * 60_000
  || MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.boundaryGridMs !== 15 * 60_000
) {
  throw new Error("microstructure-state feature-cut executable contract does not match plan");
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
  `Registered ${new Date().toISOString()} before \`${MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.prerequisiteVersion}\` unlocked.`,
  "",
  "### Immutable artifact contract",
  "",
  `- Prerequisite: a complete ready \`${MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.prerequisiteVersion}\` report.`,
  `- Universe: exactly ${MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.requiredBuckets} asset × horizon × sample-minute buckets, each with at least ${MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.minMarketsPerBucket} distinct markets.`,
  `- Metrics: ${MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.metrics.join(", ")}.`,
  "- Every metric stores n, p05, p25, p50, p75, p95, and IQR. Signed microprice skew and signed touch pressure require positive IQR; an incomplete, non-monotone, degenerate, duplicate, or out-of-scope artifact fails closed.",
  "- Buckets use the preregistered deterministic pair → horizon → sample-minute order. The full JSON artifact is SHA-256 hashed and round-trip validated before persistence.",
  `- A strategy boundary is the first ${MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.boundaryGridMs / 60_000}-minute grid point at least ${MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs / 60_000} minutes after the freeze timestamp.`,
  "",
  "### Constraints",
  "",
  "- The artifact standardizes state coordinates only. It chooses no liquidity state, direction, magnitude threshold, ask cap, decision minute, strategy identity, or verdict.",
  "- The freeze may read the preregistered outcome-free state distribution only after every inherited readiness floor passes. It may not select or join outcomes, labels, paper decisions, fills, grades, returns, P&L, accounts, positions, wallets, or orders.",
  "- A later state rule must be separately registered after the artifact exists, at or after its embedded future boundary, retain independent 5m/15m paper identities and a state-only comparator, and pass the unchanged verdict gate.",
  "- This plan adds no collector, table, subscription, polling loop, paper insertion, order route, signing capability, allocation, or fund-moving path.",
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Outcome-blind microstructure state feature-cut freeze plan v1",
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
  artifactVersion: MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.artifactVersion,
  requiredBuckets: MICROSTRUCTURE_STATE_FEATURE_CUT_FREEZE.requiredBuckets,
}, null, 2));
process.exit(0);
