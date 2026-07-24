/**
 * Record the outcome-blind repair that narrows current-market discovery with Polymarket's official
 * `Up or Down` tag before bounded pagination.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import {
  CURRENT_UPDOWN_DISCOVERY,
  fetchCurrentCryptoUpDown,
  updownHorizonMinutes,
  type GammaMarket,
} from "../services/polymarket.ts";

const slug = "updown-current-discovery-tag-repair-2026-07-24";
const marker = "## Current Up/Down discovery tag repair — 2026-07-24";
const action = "kb.collection-correction.record";
const categories = ["operations", "strategy", "research", "provider", "decision", "postmortem"] as const;
const statuses = ["active", "superseded", "archived"] as const;
const targetPairs = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD", "BNB-USD"] as const;

const pairOf = (market: GammaMarket): (typeof targetPairs)[number] | null => {
  const question = market.question.toLowerCase();
  if (/bitcoin|\bbtc\b/.test(question)) return "BTC-USD";
  if (/ethereum|\beth\b/.test(question)) return "ETH-USD";
  if (/solana|\bsol\b/.test(question)) return "SOL-USD";
  if (/\bxrp\b/.test(question)) return "XRP-USD";
  if (/dogecoin|\bdoge\b/.test(question)) return "DOGE-USD";
  if (/\bbnb\b/.test(question)) return "BNB-USD";
  return null;
};

if (
  CURRENT_UPDOWN_DISCOVERY.lookaheadMin !== 15
  || CURRENT_UPDOWN_DISCOVERY.tagId !== 102_127
  || CURRENT_UPDOWN_DISCOVERY.pageSize !== 100
  || CURRENT_UPDOWN_DISCOVERY.maxPages !== 3
  || CURRENT_UPDOWN_DISCOVERY.cacheMs !== 20_000
) {
  throw new Error("current Up/Down discovery tag-repair contract changed");
}

const observedAtMs = Date.now();
const discovered = await fetchCurrentCryptoUpDown();
const liveBuckets = discovered.flatMap((market) => {
  const pair = pairOf(market);
  const horizonMin = updownHorizonMinutes(market.question);
  const endMs = market.endDate ? new Date(market.endDate).getTime() : NaN;
  if (
    !pair
    || (horizonMin !== 5 && horizonMin !== 15)
    || !Number.isFinite(endMs)
    || observedAtMs < endMs - horizonMin * 60_000
    || observedAtMs >= endMs
  ) return [];
  return [`${pair}:${horizonMin}`];
});
const bucketCounts = new Map<string, number>();
for (const bucket of liveBuckets) bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
const expectedBuckets = targetPairs.flatMap((pair) => [5, 15].map((horizon) => `${pair}:${horizon}`));
if (
  expectedBuckets.some((bucket) => bucketCounts.get(bucket) !== 1)
  || [...bucketCounts.keys()].some((bucket) => !expectedBuckets.includes(bucket))
) {
  throw new Error(`tagged current discovery is incomplete or duplicated: ${
    JSON.stringify(Object.fromEntries(bucketCounts))
  }`);
}

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
  req: new Request("http://localhost/internal/kb-current-updown-discovery-tag-repair"),
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
  console.log(JSON.stringify({
    updated: false,
    auditInserted: await ensureAudit(),
    slug,
    reason: "already_recorded",
  }, null, 2));
  process.exit(0);
}
if (existing) throw new Error(`refusing to replace existing KB article without marker: ${slug}`);

const body = [
  marker,
  "",
  `Verified ${new Date(observedAtMs).toISOString()} from public Gamma metadata only.`,
  "",
  "### Cause",
  "",
  "- A 15-minute generic active-market window expanded to 638 mixed markets over seven pages during a same-expiry sports burst. The five-page fail-closed guard correctly returned no partial target universe.",
  "- Polymarket's official `Up or Down` tag (ID 102127) reduced the same public window to one page. Jester still applies its independent title/asset predicate after the server-side tag.",
  "",
  "### Repair and verification",
  "",
  `- Discovery is fixed at a ${CURRENT_UPDOWN_DISCOVERY.lookaheadMin}-minute window, ${CURRENT_UPDOWN_DISCOVERY.pageSize}-row pages, a ${CURRENT_UPDOWN_DISCOVERY.maxPages}-page fail-closed cap, and ${CURRENT_UPDOWN_DISCOVERY.cacheMs / 1_000}-second in-worker coalescing.`,
  `- The post-repair live snapshot contained exactly ${expectedBuckets.length} unique target buckets: one current 5m and one current 15m market for each of BTC, ETH, SOL, XRP, DOGE, and BNB.`,
  "- Downstream collectors retain their own horizon, asset, timing, book-coherence, and readiness guards. No missing historical row is backfilled.",
  "",
  "### Scope",
  "",
  "- Operational discovery repair only. It changes no signal, state, side, threshold, ask, fee, size, boundary, outcome, paper grade, verdict gate, or execution constraint.",
  "- The verification read no outcome, label, paper decision, grade, P&L, account, position, wallet, order, signature, merge, or fund-moving state.",
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Current Up/Down discovery tag repair — 2026-07-24",
  category: "operations" as (typeof categories)[number],
  tags: [
    "polymarket",
    "updown",
    "discovery",
    "collector-health",
    "paper-only",
  ],
  body,
  sources: [
    {
      title: "Polymarket — List markets",
      url: "https://docs.polymarket.com/api-reference/markets/list-markets",
    },
    {
      title: "Polymarket — Fetching markets by tag",
      url: "https://docs.polymarket.com/market-data/fetching-markets",
    },
  ],
  status: "active" as (typeof statuses)[number],
});

console.log(JSON.stringify({
  updated: true,
  auditInserted: await ensureAudit(),
  slug,
  discovered: discovered.length,
  liveBuckets: expectedBuckets.length,
  tagId: CURRENT_UPDOWN_DISCOVERY.tagId,
}, null, 2));
process.exit(0);
