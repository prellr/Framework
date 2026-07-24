/**
 * Preregister the deterministic post-readiness feature-cut freeze.
 *
 * This script reads/writes KB and audit metadata only. It does not query a flow value, outcome,
 * paper decision, result, account, position, or order.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { FLOW_FEATURE_CUT_FREEZE } from "../services/flow-feature-cut-freeze.ts";

const slug = FLOW_FEATURE_CUT_FREEZE.planVersion;
const marker = "## Outcome-blind flow feature-cut freeze plan v1";
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
  req: new Request("http://localhost/internal/kb-flow-feature-cut-freeze-plan-v1"),
};
const caller = appRouter.createCaller(ctx);

if (
  FLOW_FEATURE_CUT_FREEZE.planVersion !== "updown-flow-feature-cut-freeze-plan-v1"
  || FLOW_FEATURE_CUT_FREEZE.artifactVersion !== "updown-flow-feature-cuts-v1"
  || FLOW_FEATURE_CUT_FREEZE.prerequisiteVersion !== "updown-flow-distribution-audit-v1"
  || FLOW_FEATURE_CUT_FREEZE.requiredBuckets !== 12
  || FLOW_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs !== 30 * 60_000
  || FLOW_FEATURE_CUT_FREEZE.boundaryGridMs !== 15 * 60_000
) {
  throw new Error("flow feature-cut executable contract does not match preregistration");
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

const sources = [
  {
    title: "Hyperliquid WebSocket subscriptions",
    url: "https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions",
  },
  {
    title: "Polymarket CLOB WebSocket market channel",
    url: "https://docs.polymarket.com/developers/CLOB/websocket/market-channel",
  },
  {
    title: "Price Impact of Order Book Events",
    url: "https://arxiv.org/abs/1011.6402",
  },
];
const body = [
  marker,
  "",
  `Registered ${new Date().toISOString()} while both inherited feature reports were still locked.`,
  "",
  "### Mechanical freeze contract",
  "",
  `- Prerequisite: \`${FLOW_FEATURE_CUT_FREEZE.prerequisiteVersion}\` must return all ${FLOW_FEATURE_CUT_FREEZE.requiredBuckets} asset × 5m/15m buckets for both Hyperliquid aggressor flow and paired-book CLOB event-OFI.`,
  "- The freeze captures each bucket's 60-second signed p05/p25/p50/p75/p95 reference and IQR.",
  "- Hyperliquid reference cuts are absolute-imbalance p75, log-notional p25, trade-count p25, and maximum-trade-share p95.",
  "- CLOB reference cuts are absolute canonical-OFI p75, total-event-count p25, receive-age p95, and maximum transport-lag p95.",
  "- Every number comes from the already-preregistered outcome-free distribution report. No resolution, label, paper ledger, fill, grade, return, ranking, or P&L field is queried or joined.",
  "- The artifact is canonical JSON with a SHA-256 digest. An existing artifact is immutable: reruns verify and return it rather than recomputing against a later sample.",
  "",
  "### Contamination and strategy boundary",
  "",
  `- A prospective strategy may not begin before the first ${FLOW_FEATURE_CUT_FREEZE.boundaryGridMs / 60_000}-minute grid point at least ${FLOW_FEATURE_CUT_FREEZE.minimumBoundaryDelayMs / 60_000} minutes after the artifact is frozen.`,
  "- The artifact is preprocessing only. It does not define continuation versus reversal, choose UP or DOWN, select a magnitude threshold, choose an ask cap, register a bot, or authorize performance inspection.",
  "- A later directional rule must be separately preregistered after the artifact exists, receive an independent paper identity and future boundary, use fee-adjusted executable paired-book asks, and pass the unchanged verdict gate.",
  "- This plan adds no collector, subscription, polling loop, raw-data retention, paper insertion, account access, signing capability, order route, allocation, or fund-moving path.",
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Outcome-blind flow feature-cut freeze plan v1",
  category: "research" as (typeof categories)[number],
  tags: ["polymarket", "updown", "hyperliquid", "order-flow", "ofi", "paper-only"],
  body,
  sources,
  status: "active" as (typeof statuses)[number],
});

console.log(JSON.stringify({
  updated: true,
  auditInserted: await ensureAudit(),
  slug,
  prerequisite: FLOW_FEATURE_CUT_FREEZE.prerequisiteVersion,
  requiredBuckets: FLOW_FEATURE_CUT_FREEZE.requiredBuckets,
}, null, 2));
process.exit(0);
