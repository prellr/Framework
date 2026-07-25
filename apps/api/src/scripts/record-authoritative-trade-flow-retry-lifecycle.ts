/**
 * Record the outcome-blind Polymarket retry-lifecycle correction in the existing tape KB article.
 *
 * The evidence below was produced from public identifiers and execution facts only. This script
 * reads and writes the KB plus audit receipt; it never queries outcomes, paper decisions, P&L,
 * strategy scores, credentials, wallets, orders, or positions.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { AUTHORITATIVE_TRADE_FLOW_TAPE } from "../services/polymarket-trade-flow-tape.ts";

const slug = AUTHORITATIVE_TRADE_FLOW_TAPE.version;
const marker =
  "### Post-launch receipt incident — documented retry-lifecycle recovery — 2026-07-25";
const action = "kb.operational-amendment.record";
const resourceId = `${slug}:retry-lifecycle-recovery`;
const sourcesToAdd = [
  {
    title: "Polymarket trade lifecycle and RETRYING status",
    url: "https://docs.polymarket.com/trading/manage-orders",
  },
  {
    title: "Polymarket Data API — trades for markets",
    url: "https://docs.polymarket.com/api-reference/core/get-trades-for-a-user-or-markets",
  },
];
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
  req: new Request("http://localhost/internal/kb-trade-flow-retry-lifecycle"),
};
const caller = appRouter.createCaller(ctx);

if (
  AUTHORITATIVE_TRADE_FLOW_TAPE.verifyInitialDelayMs !== 60_000
  || AUTHORITATIVE_TRADE_FLOW_TAPE.verifyRetryBaseMs !== 600_000
  || AUTHORITATIVE_TRADE_FLOW_TAPE.verifyRetryMaxMs !== 21_600_000
  || AUTHORITATIVE_TRADE_FLOW_TAPE.replacementLookupDelayMs !== 600_000
  || AUTHORITATIVE_TRADE_FLOW_TAPE.replacementWindowSec !== 60
  || AUTHORITATIVE_TRADE_FLOW_TAPE.replacementConditionBatch !== 4
) {
  throw new Error("refusing to document an unexpected receipt-recovery contract");
}

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
const sources = [
  ...existingSources,
  ...sourcesToAdd.filter((candidate) =>
    !existingSources.some((existing) => existing.url === candidate.url)
  ),
];
const addition = [
  marker,
  "",
  `Recorded ${new Date().toISOString()} after the recovery implementation passed focused tests.`,
  "",
  "- Official lifecycle contract: a matched trade may enter `RETRYING` after a failed transaction or reorganization; the operator can resubmit it and a later transaction hash becomes the mined record. Therefore a canonical public-stream hash can be structurally valid yet never produce a Polygon receipt.",
  "- Outcome-blind incident sample: 300 pending rows older than ten minutes were joined only to the official market trade index and public Polygon receipts. Two hundred original hashes existed in both sources and were ordinary verifier backlog. One hundred existed in neither source and were stale lifecycle hashes.",
  "- Strict replacement screen on those 100 stale rows required the same condition, token, reported side, shares within 1e-6, price within the frozen half-tick tolerance, and an official timestamp from the source second through +60 seconds. Fifty-three rows had exactly one replacement 12–15 seconds later; all 53 passed the existing finalized V2 receipt decoder with zero token, side, share, price, reversion, finality, or missing-receipt failures. Forty-seven had multiple candidates and remain unresolved. No row had zero candidates.",
  "- Implementation contract: the original stream hash remains immutable. Recovery starts only after one finalized direct lookup has returned no receipt and ten minutes have elapsed. The original hash always wins if it appears in the official trade index. A unique Data API candidate is only a locator; it becomes verified only after the existing V2 receipt decoder independently matches exchange, finality, token, side, shares, and price.",
  "- Ambiguous, missing, unfinalized, reverted, malformed, or receipt-mismatched replacement candidates remain pending. They cannot raise readiness. The verified receipt hash and verification method are stored separately for audit.",
  "- Load bound: at most four unique condition IDs are queried in one ten-second verifier cycle, responses are cached for 60 seconds, and only candidate hashes receive a second batched read-only Polygon lookup. Data API or replacement-RPC failure cannot block the direct receipt lane.",
  "- This is a source-provenance correction only. It changes no strategy, direction, threshold, cohort, frozen family, readiness floor, verdict, or execution control, and it adds no capability to create, sign, submit, or cancel an order.",
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
  sources: sourcesToAdd.map((source) => source.url),
}, null, 2));
process.exit(0);
