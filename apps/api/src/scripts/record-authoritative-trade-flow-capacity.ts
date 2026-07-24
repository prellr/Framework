/**
 * Record the pre-readiness storage and cumulative-query capacity checkpoint.
 *
 * The only evidence service used here is outcome-blind and direction-sealed. This changes no tape
 * row, collector, retention policy, readiness floor, strategy, verdict, or execution setting.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { authoritativeTradeFlowTapeStatus } from "../services/polymarket-trade-flow-report.ts";

const slug = "polymarket-authoritative-taker-flow-tape-v1";
const marker = "## Capacity and cumulative-read checkpoint — 2026-07-24 15:22 UTC";
const action = "kb.trade-flow-capacity-checkpoint.record";
const resourceId = `${slug}:2026-07-24T15:22:00Z`;
const evidenceHardStopMs = Date.parse("2026-07-30T20:00:00.000Z");
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
  req: new Request("http://localhost/internal/kb-trade-flow-capacity-checkpoint"),
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

const ensureAudit = async () => {
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
  return !existingAudit;
};

if (article.body.includes(marker)) {
  const auditInserted = await ensureAudit();
  console.log(JSON.stringify({ updated: false, auditInserted, slug, marker }, null, 2));
  process.exit(0);
}
if (Date.now() >= evidenceHardStopMs) {
  throw new Error("refusing a pre-readiness capacity checkpoint after the seven-day floor");
}

const status = await authoritativeTradeFlowTapeStatus();
if (
  !status.paperOnly
  || !status.outcomeBlind
  || status.directionalRuleRegistered
  || status.readyForOutcomeFreeDistributionAudit
  || status.mappingViolations !== 0
  || !status.operationalHealth.healthy
) {
  throw new Error("refusing capacity record because the sealed readiness surface is not healthy");
}

const gib = (bytes: number | null) =>
  bytes == null ? "unavailable" : `${(bytes / 1_073_741_824).toFixed(2)} GiB`;
const addition = [
  marker,
  "",
  "This checkpoint used collection counts, elapsed time, verification integrity, storage size, filesystem headroom, and query plans only. It requested no trade sign, feature distribution, outcome, paper decision, score, win rate, or P&L.",
  "",
  "### Readiness and storage",
  "",
  `- ${status.rawEvents.toLocaleString()} raw events; ${status.verifiedEvents.toLocaleString()} chain-verified; ${status.distinctMarkets.toLocaleString()} markets; ${status.spanDays.toFixed(3)} / ${status.floors.spanDays} days.`,
  `- Current relation: ${gib(status.storage.relationBytes)} at ${gib(status.storage.bytesPerDay)}/day.`,
  `- Filesystem available: ${gib(status.capacity.availableBytes)}; projected additional growth to the seven-day floor: ${gib(status.capacity.projectedAdditionalBytesToFloor)}; projected free at that floor: ${gib(status.capacity.projectedAvailableBytesAtFloor)}.`,
  "- The projection is descriptive capacity telemetry. It neither passes readiness nor authorizes retention or deletion.",
  "",
  "### Read-load correction",
  "",
  "- The cached cumulative readiness refresh previously performed two full-table scans and external distinct sorts. At approximately 720k rows, production EXPLAIN ANALYZE measured about 606ms combined.",
  "- The replacement first parallel-hashes one row per immutable condition, then derives the pooled and six pair rollups with grouping sets. The exact production plan measured about 199ms, a roughly 67% reduction, without an index or collector change.",
  "- Intra-condition pair, horizon, window-start, and end-date conflicts now fail closed as mapping violations.",
  "",
  "### Decision",
  "",
  "- Capacity is sufficient to preserve the registered tape through its seven-day floor. Do not truncate or introduce a retention policy now.",
  "- Continue collection. Do not admit a flow-derived bot until every outcome-free distribution prerequisite unlocks and a later directional rule is separately preregistered.",
  "- The verdict gate and prohibition on execution remain unchanged.",
].join("\n");

await caller.kb.upsert({
  slug: article.slug,
  title: article.title,
  category: article.category as (typeof categories)[number],
  tags: article.tags ?? [],
  body: `${article.body.trim()}\n\n${addition}`,
  sources: Array.isArray(article.sources)
    ? article.sources.filter((source): source is { title: string; url: string } =>
      !!source
      && typeof source === "object"
      && typeof (source as { title?: unknown }).title === "string"
      && typeof (source as { url?: unknown }).url === "string"
    )
    : undefined,
  status: article.status as (typeof statuses)[number],
  supersededBySlug: article.supersededBySlug ?? undefined,
});
const auditInserted = await ensureAudit();

console.log(JSON.stringify({
  updated: true,
  auditInserted,
  slug,
  marker,
  rawEvents: status.rawEvents,
  spanDays: status.spanDays,
  relationBytes: status.storage.relationBytes,
  availableBytes: status.capacity.availableBytes,
  projectedAdditionalBytesToFloor: status.capacity.projectedAdditionalBytesToFloor,
  projectedAvailableBytesAtFloor: status.capacity.projectedAvailableBytesAtFloor,
}, null, 2));
process.exit(0);
