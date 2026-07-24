/**
 * Preregister the exact post-readiness analysis for the compact public flow tapes.
 *
 * This script reads/writes KB and audit metadata only. It does not query a flow column, market
 * outcome, paper decision, strategy result, account, position, or order.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { FLOW_DISTRIBUTION_AUDIT } from "../services/flow-distribution-contract.ts";

const slug = FLOW_DISTRIBUTION_AUDIT.version;
const marker = "## Outcome-free flow distribution audit v1";
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
  req: new Request("http://localhost/internal/kb-flow-distribution-audit-v1"),
};
const caller = appRouter.createCaller(ctx);

if (
  FLOW_DISTRIBUTION_AUDIT.version !== "updown-flow-distribution-audit-v1"
  || FLOW_DISTRIBUTION_AUDIT.quantileProbabilities.join(",") !== "0.05,0.25,0.5,0.75,0.95"
) {
  throw new Error("flow distribution executable contract does not match preregistration");
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
const metricLines = Object.entries(FLOW_DISTRIBUTION_AUDIT.sources).map(
  ([source, contract]) => `- ${source}: ${contract.metrics.join(", ")}.`,
);
const body = [
  marker,
  "",
  `Registered ${new Date().toISOString()} before either source passed its inherited readiness gate.`,
  "",
  "### Exact disclosure plan",
  "",
  `- Quantiles are fixed at ${FLOW_DISTRIBUTION_AUDIT.quantileProbabilities.join(", ")}.`,
  "- One pooled row and all twelve asset × 5m/15m buckets are required independently for each source.",
  ...metricLines,
  "- Each metric carries its own non-null sample count. Hyperliquid 5s/30s quiet-window nulls remain null; no value is imputed or backfilled.",
  "- The Hyperliquid and CLOB loaders are independently locked behind their original complete readiness predicates. A source that is not ready returns a null report and no feature-value query is invoked.",
  `- Successful reports are cached for ${FLOW_DISTRIBUTION_AUDIT.cacheMs / 60_000} minutes to bound Server2 database load.`,
  "",
  "### Research and execution constraints",
  "",
  "- Reports contain feature distributions only. They may not select or join market resolution, labels, paper decisions, fills, grades, returns, P&L, accounts, positions, wallets, or orders.",
  "- Readiness and quantiles do not authorize a trading rule. Any directional transform or threshold must be specified after this audit, registered at a later future boundary, assigned to an independent paper bot, use fee-adjusted executable paired-book fills, and pass the unchanged verdict gate.",
  "- This artifact adds no collector, subscription, table, polling loop, strategy, order route, signing capability, allocation, or fund-moving path.",
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Outcome-free flow distribution audit v1",
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
  quantiles: FLOW_DISTRIBUTION_AUDIT.quantileProbabilities,
  sources: Object.keys(FLOW_DISTRIBUTION_AUDIT.sources),
}, null, 2));
process.exit(0);
