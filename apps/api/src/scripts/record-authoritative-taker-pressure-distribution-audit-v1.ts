/**
 * Preregister first-minute chain-verified taker-pressure distributions.
 *
 * This script reads/writes KB and audit metadata only. It does not query flow values, directions,
 * outcomes, paper decisions, results, accounts, wallets, positions, or orders.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT } from "../services/authoritative-taker-pressure-distribution-contract.ts";

const slug = AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.version;
const marker = "## Outcome-free authoritative first-minute taker-pressure audit v1";
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
  req: new Request("http://localhost/internal/kb-authoritative-taker-pressure-v1"),
};
const caller = appRouter.createCaller(ctx);

if (
  AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.version !==
    "updown-authoritative-taker-pressure-distribution-audit-v1" ||
  AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.observationWindowSec !== 60 ||
  AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.expectedBuckets !== 12 ||
  AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.minMarketsPerBucket !== 25
) {
  throw new Error("authoritative taker-pressure contract does not match preregistration");
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

const metricLines = Object.entries(AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.definitions).map(
  ([metric, definition]) => `- \`${metric}\`: ${definition}.`,
);
const body = [
  marker,
  "",
  `Registered ${new Date().toISOString()} before the inherited seven-day authoritative tape gate passed.`,
  "",
  "### Frozen transform",
  "",
  `- Source: \`${AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.tapeVersion}\`; independently verified receipt rows only; no collector or backfill.`,
  `- Observation clock: \`[window_start, window_start + ${AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.observationWindowSec}s)\`. Events arriving later are excluded from the transform.`,
  "- Canonical sign: buy UP = +1, sell UP = -1, buy DOWN = -1, sell DOWN = +1. Shares, rather than cash notional, are the weight so complementary outcome books are symmetric.",
  "- Aggregate to exactly one market row before any quantile or disclosure. The signed market value never leaves the private query.",
  `- Quantiles: ${AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.quantileProbabilities.join(", ")} across one pooled row and all ${AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.expectedBuckets} asset × horizon buckets.`,
  `- Minimum support: ${AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.minMarketsPerBucket} active verified first-minute markets per bucket.`,
  ...metricLines,
  "",
  "### Interpretation and constraints",
  "",
  `- Intended use: ${AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.intendedUse}.`,
  `- Prohibited assumption: ${AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.prohibitedUse}. Polygon confirmations and replacement-hash reconciliation can arrive after the live decision clock.`,
  "- A later mechanism audit may compare public-stream OFI with this authoritative reference on the same market panel. That comparison remains outcome-free and cannot create a paper rule by itself.",
  "- No report key or value exposes signed pressure, token identity, token mapping, taker action, market resolution, label, paper activity, grade, return, P&L, account, wallet, position, credential, or order.",
  "- The value query is unreachable until the inherited tape passes every count/span/hash/verification/operational floor; successful reads use the existing 15-minute cache.",
  "- This registration adds no subscription, polling loop, table, paper roster member, order route, signing capability, allocation, or fund-moving path.",
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Outcome-free authoritative first-minute taker-pressure audit v1",
  category: "research" as (typeof categories)[number],
  tags: ["polymarket", "updown", "taker-pressure", "polygon", "proxy-validation", "paper-only"],
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

console.log(
  JSON.stringify(
    {
      updated: true,
      auditInserted: await ensureAudit(),
      slug,
      observationWindowSec: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.observationWindowSec,
      expectedBuckets: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.expectedBuckets,
      metrics: AUTHORITATIVE_TAKER_PRESSURE_DISTRIBUTION_AUDIT.metrics,
    },
    null,
    2,
  ),
);
process.exit(0);
