/**
 * Preregister immutable unsigned first-minute taker-pressure feature cuts.
 *
 * This script reads/writes KB and audit metadata only. It cannot query a pressure value, outcome,
 * paper decision, result, account, wallet, position, credential, or order.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE } from "../services/authoritative-taker-pressure-feature-cut-freeze.ts";

const slug = AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.planVersion;
const marker = "## Outcome-blind authoritative taker-pressure feature-cut plan v1";
const action = "kb.preregistration.record";
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
  req: new Request("http://localhost/internal/kb-authoritative-taker-pressure-cut-plan-v1"),
};
const caller = appRouter.createCaller(ctx);

if (
  AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.planVersion !==
    "updown-authoritative-taker-pressure-feature-cut-freeze-plan-v1" ||
  AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.artifactVersion !==
    "updown-authoritative-taker-pressure-feature-cuts-v1" ||
  AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.requiredBuckets !== 12 ||
  AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.minMarketsPerBucket !== 25 ||
  AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs !== 30 * 60_000 ||
  AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.boundaryGridMs !== 15 * 60_000
) {
  throw new Error("authoritative taker-pressure cut contract does not match preregistration");
}

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
  console.log(
    JSON.stringify(
      {
        updated: false,
        auditInserted: await ensureAudit(),
        slug,
        reason: "already_registered",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
if (existing) throw new Error(`refusing to replace existing KB article without marker: ${slug}`);

const body = [
  marker,
  "",
  `Registered ${new Date().toISOString()} before \`${AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.prerequisiteVersion}\` unlocked.`,
  "",
  "### Immutable artifact contract",
  "",
  `- Prerequisite: a complete ready \`${AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.prerequisiteVersion}\` report.`,
  `- Universe: exactly ${AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.requiredBuckets} asset × horizon buckets, each with at least ${AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.minMarketsPerBucket} verified first-minute markets.`,
  "- Every metric stores n, p05, p25, p50, p75, p95, and IQR. Absolute pressure and log gross shares require positive IQR; fraction metrics must remain in [0,1].",
  `- Frozen cut coordinates: ${Object.entries(AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.cuts)
    .map(([name, source]) => `${name} ← ${source}`)
    .join("; ")}.`,
  "- Deterministic pair → horizon ordering, full schema validation, and SHA-256 hashing are mandatory before persistence.",
  `- A later strategy boundary is the first ${AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.boundaryGridMs / 60_000}-minute grid point at least ${AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs / 60_000} minutes after the freeze.`,
  "",
  "### Constraints",
  "",
  "- The artifact is an unsigned preprocessing reference for proxy validation. It chooses no token, side, direction, ask, decision clock, paper identity, or verdict.",
  "- Chain-verified pressure is not presumed live-usable. Any direct decision-path use requires a later preregistered availability audit and future paper boundary.",
  "- A later strategy must retain independent 5m/15m identities, fee-adjusted executable paired-book asks, same-panel comparators, chronological clustered validation, and the unchanged forward verdict gate.",
  "- This plan adds no collector, subscription, table, polling loop, roster member, order route, signing capability, allocation, or fund-moving path.",
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Outcome-blind authoritative taker-pressure feature-cut plan v1",
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
      artifactVersion: AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.artifactVersion,
      requiredBuckets: AUTHORITATIVE_TAKER_PRESSURE_FEATURE_CUT_FREEZE.requiredBuckets,
    },
    null,
    2,
  ),
);
process.exit(0);
