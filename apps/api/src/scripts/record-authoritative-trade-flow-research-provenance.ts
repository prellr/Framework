/**
 * Record public, outcome-blind research provenance for the authoritative taker-flow tape.
 *
 * This script reads and updates only the KB article plus its audit receipt. It never queries the
 * collected tape, a market outcome, a paper decision, or performance, and it changes no collector,
 * readiness, strategy, or verdict constant.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";

const slug = "polymarket-authoritative-taker-flow-tape-v1";
const marker = "### External methodology confirmation — Dubach (2026)";
const action = "kb.research-provenance.record";
const resourceId = `${slug}:dubach-2026`;
const source = {
  title: "Dubach (2026) — The Anatomy of a Decentralized Prediction Market",
  url: "https://arxiv.org/abs/2604.24366",
};
const replication = {
  title: "Dubach (2026) — Polymarket microstructure replication package",
  url: "https://github.com/philippdubach/polymarket-microstructure",
};
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
  req: new Request("http://localhost/internal/kb-trade-flow-research-provenance"),
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
for (const item of [source, replication]) {
  if (!sources.some((existing) => existing.url === item.url)) sources.push(item);
}

const addition = [
  marker,
  "",
  "- A preregistered 600-market study joined a continuous public order-book archive to the authoritative Polygon fill record. Feed-inferred direction agreed with the on-chain sign on only about 59% of comparable buckets; effective-spread and Kyle-lambda signs frequently changed under the authoritative join.",
  "- Research implication: directional Polymarket microstructure must not use quote-side changes as a taker-side proxy. Jester therefore keeps flow signs, outcome relationships, and thresholds sealed until its chain-verified tape reaches every frozen readiness floor.",
  "- Contract distinction: the study reconstructs historical CTF Exchange V1 `OrderFilled` logs. Jester independently validates the current CTF Exchange V2 `OrdersMatched` receipt, exchange address, finality, token, side, amount, shares, and half-tick price tolerance; it does not assume the historical parser transfers unchanged.",
  "- This source confirms measurement architecture only. It does not supply a directional strategy, change a collector or readiness floor, authorize inspecting the live tape's signs, or permit execution.",
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
  sources: [source.url, replication.url],
}, null, 2));
process.exit(0);
