/**
 * Preregister the exact post-readiness analysis for authoritative Polymarket taker flow.
 *
 * This script reads/writes KB and audit metadata only. It does not query a flow value, token
 * mapping, direction, outcome, paper decision, strategy result, account, wallet, or order.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import {
  AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT,
} from "../services/authoritative-taker-flow-distribution-contract.ts";

const slug = AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.version;
const marker = "## Outcome-free authoritative taker-flow distribution audit v1";
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
  req: new Request("http://localhost/internal/kb-authoritative-taker-flow-distribution-v1"),
};
const caller = appRouter.createCaller(ctx);

if (
  AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.version
    !== "updown-authoritative-taker-flow-distribution-audit-v1"
  || AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.quantileProbabilities.join(",")
    !== "0.05,0.25,0.5,0.75,0.95"
  || AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.expectedBuckets !== 12
  || AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.minMarketsPerBucket !== 25
) {
  throw new Error("authoritative taker-flow distribution contract does not match preregistration");
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

const metricLines = Object.entries(
  AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.definitions,
).map(([metric, definition]) => `- \`${metric}\`: ${definition}.`);
const body = [
  marker,
  "",
  `Registered ${new Date().toISOString()} before the inherited seven-day authoritative tape gate passed.`,
  "",
  "### Exact disclosure plan",
  "",
  `- Source: \`${AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.tapeVersion}\`; verified rows only; no new collector or historical backfill.`,
  `- Quantiles: ${AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.quantileProbabilities.join(", ")}.`,
  `- Dimensions: ${AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.dimensions.join(" × ")}.`,
  `- Required universe: one pooled row and all ${AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.expectedBuckets} six-asset × 5m/15m buckets.`,
  `- Minimum support: ${AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.minMarketsPerBucket} distinct verified markets in every asset × horizon bucket before an immutable cut artifact may be frozen.`,
  ...metricLines,
  "- No query groups by or returns token identity, reported taker side, decoded chain side, or outcome-token mapping. All price coordinates are absolute distances and all reconciliation coordinates are absolute errors.",
  `- The value query is unreachable until the inherited ${AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.tapeVersion} count/span/coverage/verification gate passes, and successful results are cached for ${AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.cacheMs / 60_000} minutes.`,
  "",
  "### Research and execution constraints",
  "",
  "- This audit may characterize liquidity intensity, event timing, and receipt quality only. It cannot choose a token, side, direction, threshold, decision minute, ask cap, paper identity, or verdict.",
  "- The report may not select or join market resolution, labels, paper decisions, fills, grades, returns, P&L, accounts, positions, wallets, credentials, or orders.",
  "- Any later directional transform requires a separately registered rule at or after the immutable cut artifact's future boundary, independent 5m/15m paper identities, fee-adjusted executable paired-book asks, chronological clustered validation, and the unchanged forward verdict gate.",
  "- This artifact adds no collector, subscription, table, polling loop, strategy, paper insertion, order route, signing capability, allocation, or fund-moving path.",
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Outcome-free authoritative taker-flow distribution audit v1",
  category: "research" as (typeof categories)[number],
  tags: [
    "polymarket",
    "updown",
    "taker-flow",
    "polygon",
    "provenance",
    "paper-only",
  ],
  body,
  sources: [
    {
      title: "Polymarket CLOB WebSocket market channel",
      url: "https://docs.polymarket.com/developers/CLOB/websocket/market-channel",
    },
    {
      title: "Polymarket CTF Exchange contracts",
      url: "https://docs.polymarket.com/developers/CTF/deployment-resources",
    },
  ],
  status: "active" as (typeof statuses)[number],
});

console.log(JSON.stringify({
  updated: true,
  auditInserted: await ensureAudit(),
  slug,
  expectedBuckets: AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.expectedBuckets,
  minMarketsPerBucket:
    AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.minMarketsPerBucket,
  metrics: AUTHORITATIVE_TAKER_FLOW_DISTRIBUTION_AUDIT.metrics,
}, null, 2));
process.exit(0);
