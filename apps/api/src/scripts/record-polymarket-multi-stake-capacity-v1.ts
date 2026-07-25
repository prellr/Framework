/**
 * Idempotently preregister the outcome-blind $5/$10/$20 capacity tape before its future boundary.
 *
 * Metadata only: no state values, books, outcomes, labels, decisions, trades, or P&L are queried.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { POLYMARKET_MULTI_STAKE_CAPACITY } from "../services/polymarket-multi-stake-capacity.ts";

const slug = POLYMARKET_MULTI_STAKE_CAPACITY.version;
const marker = "## Prospective registration — Polymarket multi-stake capacity tape v1";
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
  req: new Request("http://localhost/internal/kb-polymarket-multi-stake-capacity-v1"),
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

if (
  POLYMARKET_MULTI_STAKE_CAPACITY.version !== "polymarket-multi-stake-capacity-v1" ||
  new Date(POLYMARKET_MULTI_STAKE_CAPACITY.evalStartMs).toISOString() !== "2026-07-25T22:00:00.000Z"
) {
  throw new Error("multi-stake capacity executable contract does not match its preregistration");
}
if (Date.now() >= POLYMARKET_MULTI_STAKE_CAPACITY.evalStartMs) {
  throw new Error("multi-stake capacity registration boundary has already passed");
}

const existing = await caller.kb.get({ slug });
if (existing?.body.includes(marker)) {
  console.log(
    JSON.stringify({
      updated: false,
      auditInserted: await ensureAudit(),
      slug,
      reason: "already_registered",
    }),
  );
  process.exit(0);
}
if (existing)
  throw new Error(`refusing to replace pre-existing KB article without marker: ${slug}`);

const body = [
  marker,
  "",
  `Registered ${new Date().toISOString()} for the frozen boundary ${new Date(POLYMARKET_MULTI_STAKE_CAPACITY.evalStartMs).toISOString()}.`,
  "",
  "### Question",
  "",
  "- Polymarket orders are not restricted to a fixed $5 stake. Can the currently modeled $5 paper opportunity still be filled at $10 or $20 without assuming linear capacity?",
  "- This tape measures executable public-book capacity only. It is not an alpha hypothesis and cannot improve or disqualify a strategy verdict.",
  "",
  "### Frozen collection contract",
  "",
  `- Version \`${POLYMARKET_MULTI_STAKE_CAPACITY.version}\`; modeled total outlays $${POLYMARKET_MULTI_STAKE_CAPACITY.modeledStakeUsd.join("/$")}.`,
  "- At each existing state-tape market-minute, reuse the one UP and one DOWN public CLOB book already fetched for the $5 fee-adjusted fill.",
  "- Walk each same in-memory book at exactly $10 and $20 total outlay using the already captured taker-fee curve. Store fee-adjusted effective VWAP for each side and stake.",
  "- A null value means that side lacked sufficient displayed ask depth or valid fee metadata. Preserve a valid $10 walk even when the same side cannot fill $20.",
  "- Do not add a CLOB request, WebSocket, polling loop, raw-book table, account channel, outcome lookup, strategy join, decision, paper trade, wallet, signature, order, cancellation, allocation, or fund path.",
  "",
  "### Frozen readiness and disclosure",
  "",
  `- Readiness requires ${POLYMARKET_MULTI_STAKE_CAPACITY.minMarkets.toLocaleString()} distinct markets, ${POLYMARKET_MULTI_STAKE_CAPACITY.minSpanDays} elapsed days, ${POLYMARKET_MULTI_STAKE_CAPACITY.minMarketsPerAssetTimeframe} markets in every one of the six asset × 5m/15m buckets, and ${(POLYMARKET_MULTI_STAKE_CAPACITY.minCoverage * 100).toFixed(0)}% rows with paired $10 and $20 fills on both outcomes.`,
  "- Before every floor passes, surfaces may show only version, boundary, stakes, row/market counts, span, coverage, and bucket counts.",
  "- After readiness, a separately preregistered descriptive report may compare unsigned effective-VWAP deterioration and fill availability across stakes. It must not read resolution labels, strategy sides, decisions, grades, P&L, or verdicts.",
  "- Any later stake-sizing rule requires a separate future hypothesis, paper registration, fee/slippage accounting, capital/exposure controls, and the unchanged verdict gate.",
  "",
  "### Server-load consequence",
  "",
  "- External request count is unchanged: the collector still fetches exactly one UP and one DOWN book per market-minute.",
  "- Incremental work is four bounded in-memory ask walks and five nullable scalar columns on the row already written. No new service or background job is introduced.",
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Polymarket multi-stake capacity tape v1",
  category: "research" as (typeof categories)[number],
  tags: ["polymarket", "updown", "liquidity", "capacity", "fees", "paper-only"],
  body,
  sources: [
    {
      title: "Polymarket create order",
      url: "https://docs.polymarket.com/trading/orders/create",
    },
    {
      title: "Polymarket order book",
      url: "https://docs.polymarket.com/trading/orderbook",
    },
    {
      title: "Polymarket prices and order book",
      url: "https://docs.polymarket.com/concepts/prices-orderbook",
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
      version: POLYMARKET_MULTI_STAKE_CAPACITY.version,
      boundary: new Date(POLYMARKET_MULTI_STAKE_CAPACITY.evalStartMs).toISOString(),
      stakes: POLYMARKET_MULTI_STAKE_CAPACITY.modeledStakeUsd,
      readsFeatureValues: false,
      readsOutcomes: false,
      addsExternalRequests: false,
      createsPaperBot: false,
      executionCapability: false,
    },
    null,
    2,
  ),
);
process.exit(0);
