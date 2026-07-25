/**
 * Preregister the immutable unsigned authoritative taker-flow feature-cut artifact.
 *
 * This script reads/writes KB and audit metadata only. It does not query a flow value, direction,
 * token mapping, outcome, paper decision, result, account, position, wallet, or order.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import {
  AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE,
} from "../services/authoritative-taker-flow-feature-cut-freeze.ts";

const slug = AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.planVersion;
const marker = "## Outcome-blind authoritative taker-flow feature-cut freeze plan v1";
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
  req: new Request("http://localhost/internal/kb-authoritative-taker-flow-feature-cut-plan-v1"),
};
const caller = appRouter.createCaller(ctx);

if (
  AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.planVersion
    !== "updown-authoritative-taker-flow-feature-cut-freeze-plan-v1"
  || AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.artifactVersion
    !== "updown-authoritative-taker-flow-feature-cuts-v1"
  || AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.requiredBuckets !== 12
  || AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.minMarketsPerBucket !== 25
  || AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs
    !== 30 * 60_000
  || AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.boundaryGridMs !== 15 * 60_000
) {
  throw new Error("authoritative taker-flow feature-cut contract does not match plan");
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
  `Registered ${new Date().toISOString()} before \`${AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.prerequisiteVersion}\` unlocked.`,
  "",
  "### Immutable artifact contract",
  "",
  `- Prerequisite: a complete ready \`${AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.prerequisiteVersion}\` report.`,
  `- Universe: exactly ${AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.requiredBuckets} asset × 5m/15m buckets, each with at least ${AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.minMarketsPerBucket} distinct verified markets.`,
  `- Metrics: ${AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.metrics.join(", ")}.`,
  "- Every metric stores n, p05, p25, p50, p75, p95, and IQR. Log chain notional, absolute chain-price distance, and event timing require positive IQR; incomplete, non-monotone, negative, degenerate, under-confirmed, duplicate, or out-of-scope artifacts fail closed.",
  "- Buckets use deterministic pair → horizon order. The full JSON artifact is SHA-256 hashed and round-trip validated before persistence.",
  `- A strategy boundary is the first ${AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.boundaryGridMs / 60_000}-minute grid point at least ${AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs / 60_000} minutes after the freeze timestamp.`,
  "",
  "### Constraints",
  "",
  "- The artifact standardizes unsigned liquidity/timing coordinates only. It chooses no token, side, direction, threshold, decision minute, ask cap, paper identity, or verdict.",
  "- The freeze may read only the preregistered outcome-free distribution after every inherited readiness floor passes. It may not select or join token mapping, directions, outcomes, labels, paper decisions, fills, grades, returns, P&L, accounts, positions, wallets, credentials, or orders.",
  "- A later rule must be separately registered after this artifact exists, at or after its embedded future boundary, retain independent 5m/15m paper identities and an intensity-only comparator, and pass the unchanged verdict gate.",
  "- This plan adds no collector, table, subscription, polling loop, paper insertion, order route, signing capability, allocation, or fund-moving path.",
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Outcome-blind authoritative taker-flow feature-cut freeze plan v1",
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
  artifactVersion: AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.artifactVersion,
  requiredBuckets: AUTHORITATIVE_TAKER_FLOW_FEATURE_CUT_FREEZE.requiredBuckets,
}, null, 2));
process.exit(0);
