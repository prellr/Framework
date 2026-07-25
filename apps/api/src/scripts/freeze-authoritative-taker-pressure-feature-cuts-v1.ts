/**
 * Freeze preregistered unsigned taker-pressure references after every inherited gate passes.
 *
 * The only value source is the outcome-free distribution audit. This script has no paper-ledger,
 * outcome, account, wallet, position, signing, allocation, or order dependency.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { authoritativeTakerPressureDistributionAudit } from "../services/authoritative-taker-pressure-distribution-audit.ts";
import {
  AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE,
  buildAuthoritativeTakerPressureFeatureCutEnvelope,
  parseAuthoritativeTakerPressureFeatureCutEnvelope,
  serializeAuthoritativeTakerPressureFeatureCutEnvelope,
} from "../services/authoritative-taker-pressure-feature-cut-freeze.ts";

const slug = AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.artifactSlug;
const planMarker = "## Outcome-blind authoritative taker-pressure feature-cut plan v1";
const marker = "# Frozen outcome-blind authoritative taker-pressure feature cuts v1";
const action = "kb.feature-freeze.record";
const categories = [
  "operations",
  "strategy",
  "research",
  "provider",
  "decision",
  "postmortem",
] as const;
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
  req: new Request("http://localhost/internal/freeze-authoritative-taker-pressure-v1"),
};
const caller = appRouter.createCaller(ctx);

const ensureAudit = async () => {
  const [existing] = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, action),
        eq(auditLogs.resourceType, "kbArticle"),
        eq(auditLogs.resourceId, slug),
      ),
    )
    .limit(1);
  if (existing) return false;
  await audit(ctx, action, { resourceType: "kbArticle", resourceId: slug });
  return true;
};

const existing = await caller.kb.get({ slug });
if (existing?.body.includes(marker)) {
  const envelope = parseAuthoritativeTakerPressureFeatureCutEnvelope(existing.body);
  console.log(
    JSON.stringify(
      {
        updated: false,
        auditInserted: await ensureAudit(),
        slug,
        sha256: envelope.sha256,
        reason: "already_frozen",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
if (existing) throw new Error(`refusing to replace existing KB article without marker: ${slug}`);

const plan = await caller.kb.get({
  slug: AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.planVersion,
});
if (!plan?.body.includes(planMarker)) {
  throw new Error(
    `missing preregistered authoritative taker-pressure plan: ${AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.planVersion}`,
  );
}

const distribution = await authoritativeTakerPressureDistributionAudit();
if (
  distribution.version !== AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.prerequisiteVersion ||
  !distribution.inheritedTapeReady ||
  !distribution.readyForCutFreeze ||
  !distribution.report
) {
  throw new Error(
    "refusing authoritative taker-pressure freeze: outcome-free distribution is not ready",
  );
}

const envelope = buildAuthoritativeTakerPressureFeatureCutEnvelope({
  distributionVersion: distribution.version,
  tapeVersion: distribution.tapeVersion,
  observationWindowSec: distribution.observationWindowSec,
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
  "- This is an unsigned proxy-validation reference only. It creates no direction, paper decision, roster entry, verdict, or execution capability.",
  "",
  serializeAuthoritativeTakerPressureFeatureCutEnvelope(envelope),
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Frozen outcome-blind authoritative taker-pressure feature cuts v1",
  category: "research" as (typeof categories)[number],
  tags: [
    "polymarket",
    "updown",
    "taker-pressure",
    "feature-freeze",
    "proxy-validation",
    "paper-only",
  ],
  body,
  sources: [
    {
      title: "Outcome-free authoritative first-minute taker-pressure audit v1",
      url: "https://jester.wisco.wine/knowledge",
    },
  ],
  status: "active" as (typeof statuses)[number],
});

console.log(
  JSON.stringify(
    {
      updated: true,
      auditInserted: await ensureAudit(),
      slug,
      sha256: envelope.sha256,
      buckets: envelope.artifact.buckets.length,
      strategyNotBeforeMs: envelope.artifact.strategyNotBeforeMs,
    },
    null,
    2,
  ),
);
process.exit(0);
