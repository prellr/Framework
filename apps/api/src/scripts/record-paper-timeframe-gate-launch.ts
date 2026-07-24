/**
 * Persist the post-grace launch audit for the strategy × timeframe verdict gate.
 *
 * This script reads only bot/bucket identities, row counts, and decision timestamps. It never reads
 * side, ask, control ask, status, outcome, grade, return, residual, or P&L.
 */
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, db, paperTrades } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { PAPER_BOTS, paperBotBucketUniverse } from "../services/paper-floor.ts";
import { PAPER_TIMEFRAME_GATE } from "../services/paper-timeframe-gate.ts";

const slug = PAPER_TIMEFRAME_GATE.version;
const marker = "## Outcome-blind split-gate launch success — 2026-07-24";
const action = "kb.launch-audit.record";
const resourceId = `${slug}:launch-success`;
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
  req: new Request("http://localhost/internal/kb-paper-timeframe-gate-launch"),
};
const caller = appRouter.createCaller(ctx);
const boundary = new Date(PAPER_TIMEFRAME_GATE.evalStartMs);
const graceMs = 5 * 60_000;

if (
  PAPER_TIMEFRAME_GATE.version !== "updown-timeframe-verdict-gate-v1"
  || boundary.toISOString() !== "2026-07-24T04:00:00.000Z"
) {
  throw new Error("timeframe gate executable contract does not match its preregistration");
}
if (Date.now() < PAPER_TIMEFRAME_GATE.evalStartMs + graceMs) {
  throw new Error("refusing split-gate launch success before the post-boundary grace window");
}

const [summaryResult, groupRows] = await Promise.all([
  db.execute(sql`
    select
      count(*)::int as rows,
      count(distinct ${paperTrades.conditionId})::int as markets,
      count(*) filter (where ${paperTrades.horizonMin} = 5)::int as five_min_rows,
      count(*) filter (where ${paperTrades.horizonMin} = 15)::int as fifteen_min_rows,
      min(${paperTrades.windowStart}) as first_window,
      max(${paperTrades.windowStart}) as last_window,
      min(${paperTrades.decidedAt}) as first_decided,
      max(${paperTrades.decidedAt}) as last_decided
    from ${paperTrades}
    where ${paperTrades.windowStart} >= ${boundary}
  `),
  db
    .select({
      botKey: paperTrades.botKey,
      pair: paperTrades.pair,
      horizonMin: paperTrades.horizonMin,
      rows: sql<number>`count(*)::int`,
    })
    .from(paperTrades)
    .where(sql`${paperTrades.windowStart} >= ${boundary}`)
    .groupBy(paperTrades.botKey, paperTrades.pair, paperTrades.horizonMin),
]);

const summary = summaryResult.rows[0];
const registeredBuckets = new Map(
  PAPER_BOTS.map((bot) => [
    bot.key,
    new Set(paperBotBucketUniverse(bot).map((bucket) => `${bucket.pair}:${bucket.horizonMin}`)),
  ]),
);
const mappingViolations = groupRows.filter((row) =>
  !registeredBuckets.get(row.botKey)?.has(`${row.pair}:${row.horizonMin}`)
);
const firstWindowMs = summary?.first_window == null
  ? null
  : new Date(String(summary.first_window)).getTime();
const firstDecidedMs = summary?.first_decided == null
  ? null
  : new Date(String(summary.first_decided)).getTime();
const checks = {
  exactVersion: PAPER_TIMEFRAME_GATE.version === "updown-timeframe-verdict-gate-v1",
  exactBoundary: boundary.toISOString() === "2026-07-24T04:00:00.000Z",
  postBoundaryRows: Number(summary?.rows ?? 0) > 0,
  postBoundaryMarkets: Number(summary?.markets ?? 0) > 0,
  fiveMinuteCollection: Number(summary?.five_min_rows ?? 0) > 0,
  fifteenMinuteCollection: Number(summary?.fifteen_min_rows ?? 0) > 0,
  noEarlyWindow: firstWindowMs != null && firstWindowMs >= PAPER_TIMEFRAME_GATE.evalStartMs,
  noEarlyDecision: firstDecidedMs != null && firstDecidedMs >= PAPER_TIMEFRAME_GATE.evalStartMs,
  registeredBotBucketsOnly: mappingViolations.length === 0,
};
if (!Object.values(checks).every(Boolean)) {
  throw new Error(`timeframe gate launch audit failed: ${JSON.stringify({
    checks,
    mappingViolations,
  })}`);
}

const existing = await caller.kb.get({ slug });
if (!existing) throw new Error(`missing preregistered KB article ${slug}`);
if (!existing.body.includes(marker)) {
  const sources = Array.isArray(existing.sources)
    ? existing.sources.filter((source): source is { title: string; url: string } =>
      !!source
      && typeof source === "object"
      && typeof (source as { title?: unknown }).title === "string"
      && typeof (source as { url?: unknown }).url === "string"
    )
    : undefined;
  await caller.kb.upsert({
    slug: existing.slug,
    title: existing.title,
    category: existing.category as (typeof categories)[number],
    tags: existing.tags ?? [],
    body: [
      existing.body,
      "",
      marker,
      "",
      `Recorded ${new Date().toISOString()} after the five-minute grace window.`,
      "",
      `- ${Number(summary?.rows ?? 0).toLocaleString()} paper rows across ${Number(summary?.markets ?? 0).toLocaleString()} unique post-boundary markets.`,
      `- ${Number(summary?.five_min_rows ?? 0).toLocaleString()} 5m rows and ${Number(summary?.fifteen_min_rows ?? 0).toLocaleString()} 15m rows; every observed bot × asset × horizon group belongs to the frozen registry.`,
      `- First eligible window ${new Date(String(summary?.first_window)).toISOString()}; first decision ${new Date(String(summary?.first_decided)).toISOString()}.`,
      "- This launch audit inspected no side, fill, outcome, grade, residual, or performance field.",
      "- Launch success authorizes continued paper collection only. Every cohort remains subject to its independent market, span, paired-bet, bootstrap, and session floors; execution remains unavailable.",
    ].join("\n"),
    sources,
    status: existing.status as (typeof statuses)[number],
    supersededBySlug: existing.supersededBySlug ?? undefined,
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
  updated: !existing.body.includes(marker),
  auditInserted: !existingAudit,
  slug,
  boundary: boundary.toISOString(),
  checks,
  evidence: {
    rows: Number(summary?.rows ?? 0),
    markets: Number(summary?.markets ?? 0),
    fiveMinRows: Number(summary?.five_min_rows ?? 0),
    fifteenMinRows: Number(summary?.fifteen_min_rows ?? 0),
    firstWindow: new Date(String(summary?.first_window)).toISOString(),
    lastWindow: new Date(String(summary?.last_window)).toISOString(),
    firstDecided: new Date(String(summary?.first_decided)).toISOString(),
    lastDecided: new Date(String(summary?.last_decided)).toISOString(),
  },
}, null, 2));
process.exit(0);
