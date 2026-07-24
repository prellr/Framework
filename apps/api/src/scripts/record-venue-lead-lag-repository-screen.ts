/**
 * Record an outcome-blind screen of public Polymarket lead/lag repositories.
 *
 * This updates only the existing observational-tape KB article and its audit receipt. It does not
 * query the venue tape, paper decisions, outcomes, or performance, and it changes no collector,
 * readiness floor, directional rule, strategy, verdict gate, or execution path.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";

const slug = "updown-venue-lead-lag-tape-v1";
const marker = "### External repository screen — cross-venue lag claims (2026-07-24)";
const action = "kb.research-provenance.record";
const resourceId = `${slug}:external-repository-screen-2026-07-24`;
const externalSources = [
  {
    title: "polymarket-research-toolkit — cross-venue research modules",
    url: "https://github.com/visione4906/polymarket-research-toolkit",
  },
  {
    title: "polymarket-research-toolkit — edge detector",
    url: "https://github.com/visione4906/polymarket-research-toolkit/blob/main/edge_detector.py",
  },
  {
    title: "polymarket-research-toolkit — price feed",
    url: "https://github.com/visione4906/polymarket-research-toolkit/blob/main/price_feed.py",
  },
  {
    title: "polymarket-research-toolkit — paper settlement",
    url: "https://github.com/visione4906/polymarket-research-toolkit/blob/main/paper_trader.py",
  },
  {
    title: "polyrec — synchronized Polymarket/Binance/Chainlink logger",
    url: "https://github.com/txbabaxyz/polyrec",
  },
  {
    title: "polyrec — impulse-fade backtest",
    url: "https://github.com/txbabaxyz/polyrec/blob/main/fade_impulse_backtest.py",
  },
] as const;
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
  req: new Request("http://localhost/internal/kb-venue-lead-lag-repository-screen"),
};
const caller = appRouter.createCaller(ctx);

const article = await caller.kb.get({ slug });
if (!article) throw new Error(`KB article not found: ${slug}`);
if (!categories.includes(article.category as (typeof categories)[number])) {
  throw new Error(`invalid KB category: ${article.category}`);
}
if (!statuses.includes(article.status as (typeof statuses)[number])) {
  throw new Error(`invalid KB status: ${article.status}`);
}

const existingSources = Array.isArray(article.sources)
  ? article.sources.filter((item): item is { title: string; url: string } =>
      !!item
      && typeof item === "object"
      && typeof (item as { title?: unknown }).title === "string"
      && typeof (item as { url?: unknown }).url === "string"
    )
  : [];
const sources = [...existingSources];
for (const source of externalSources) {
  if (!sources.some((existing) => existing.url === source.url)) sources.push(source);
}

const addition = [
  marker,
  "",
  "- Screened claim: a public toolkit asserts that Binance leads short-duration Polymarket odds by roughly two to three seconds and maps rolling CEX momentum through a Brownian-style probability bridge. The repository supplies no reproducible study supporting that latency estimate, and its slope constant is described as tuned on historical paper trades.",
  "- Measurement rejection: its Binance buffer stores 500 variable-rate aggregate trades, yet later treats the observations as one-second ticks and requests windows as long as five minutes. Volatility is calculated per received trade and then scaled as if every event were one second apart. It also lacks an explicit bounded-staleness gate on the latest CEX observation.",
  "- Contract rejection: simulated entry uses the displayed best ask without a fee-adjusted depth walk, and expiry settlement compares Binance at entry with Binance at exit rather than the market's frozen Chainlink strike and resolution rule. Those choices can manufacture both timing and payoff alpha.",
  "- A second logger contributes useful candidate measurements—synchronized Chainlink, Binance, and Polymarket observations; microprice; depth; and queue-consumption diagnostics—but its impulse backtest likewise omits taker fees and executable depth, sweeps an in-sample parameter grid, and cannot establish a forward edge.",
  "- Jester action: import no directional rule or threshold from either repository. The existing one-second Hyperliquid/Chainlink tape already preserves source and receive clocks, exact-grid gaps, bounded freshness, and frozen count/span/block floors. Lead/lag signs remain sealed until every pair reaches the preregistered diagnostic floor; any resulting side rule requires a separate later prospective registration and paper-only verdict gate.",
  "- This screen reads no collected tape values, market outcomes, paper returns, or performance. It changes no collector, readiness floor, strategy roster, or execution capability.",
].join("\n");
const bodyChanged = !article.body.includes(marker);
const sourcesChanged = sources.length !== existingSources.length;
if (bodyChanged || sourcesChanged) {
  await caller.kb.upsert({
    slug: article.slug,
    title: article.title,
    category: article.category as (typeof categories)[number],
    tags: article.tags ?? [],
    body: bodyChanged ? `${article.body.trim()}\n\n${addition}` : article.body,
    sources,
    status: article.status as (typeof statuses)[number],
    supersededBySlug: article.supersededBySlug ?? undefined,
  });
}

const [existingAudit] = await db
  .select({ id: auditLogs.id })
  .from(auditLogs)
  .where(and(
    eq(auditLogs.action, action),
    eq(auditLogs.resourceType, "kbArticle"),
    eq(auditLogs.resourceId, resourceId),
  ))
  .limit(1);
if (!existingAudit) {
  await audit(ctx, action, { resourceType: "kbArticle", resourceId });
}

console.log(JSON.stringify({
  updated: bodyChanged || sourcesChanged,
  auditInserted: !existingAudit,
  slug,
  marker,
  sources: externalSources.map((source) => source.url),
}, null, 2));
process.exit(0);
