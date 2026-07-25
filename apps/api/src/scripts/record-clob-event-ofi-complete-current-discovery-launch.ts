/**
 * Record the outcome-blind launch receipt for complete current-market discovery.
 *
 * The evidence query selects collection tags, bucket identity, timestamps, and touch nullability
 * only. It never selects a quote, OFI value, direction, outcome, paper decision, grade, or result.
 */
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { CLOB_EVENT_OFI_TAPE } from "../services/clob-event-ofi.ts";
import { CURRENT_UPDOWN_DISCOVERY } from "../services/polymarket.ts";

const slug = CLOB_EVENT_OFI_TAPE.version;
const amendmentMarker =
  "### Post-launch transport incident — complete current-market discovery — 2026-07-24";
const launchMarker =
  "### Complete current-market discovery launch receipt — 2026-07-24";
const action = "kb.launch-audit.record";
const resourceId = `${slug}:complete-current-market-discovery-launch`;
const deployedAt = new Date("2026-07-24T10:33:17.000Z");
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
  req: new Request("http://localhost/internal/kb-clob-event-ofi-complete-discovery-launch"),
};
const caller = appRouter.createCaller(ctx);

if (
  CLOB_EVENT_OFI_TAPE.version !== "updown-clob-event-ofi-tape-v1"
  || new Date(CLOB_EVENT_OFI_TAPE.evalStartMs).toISOString()
    !== "2026-07-24T07:00:00.000Z"
  || CLOB_EVENT_OFI_TAPE.minCoverage !== 0.95
  // This recorder is an immutable receipt for the 2026-07-24 launch contract, not the current
  // discovery configuration.
  || (CURRENT_UPDOWN_DISCOVERY as { lookaheadMin: number }).lookaheadMin !== 15
  || CURRENT_UPDOWN_DISCOVERY.pageSize !== 100
  || Number(CURRENT_UPDOWN_DISCOVERY.maxPages) !== 5
  || CURRENT_UPDOWN_DISCOVERY.cacheMs !== 20_000
) {
  throw new Error("refusing to record an unexpected complete-discovery launch contract");
}

const existing = await caller.kb.get({ slug });
if (!existing?.body.includes(amendmentMarker)) {
  throw new Error(`missing complete-current discovery amendment for ${slug}`);
}

let evidence: {
  eligible_rows: number;
  tagged_rows: number;
  two_sided_missing_rows: number;
  one_sided_missing_rows: number;
  tagged_buckets: number;
  first_captured_at: Date | null;
  last_captured_at: Date | null;
} | null = null;

if (!existing.body.includes(launchMarker)) {
  const result = await db.execute<{
    eligible_rows: number;
    tagged_rows: number;
    two_sided_missing_rows: number;
    one_sided_missing_rows: number;
    tagged_buckets: number;
    first_captured_at: Date | null;
    last_captured_at: Date | null;
  }>(sql`
    select
      count(*)::int as eligible_rows,
      count(*) filter (
        where clob_event_ofi_version = ${CLOB_EVENT_OFI_TAPE.version}
      )::int as tagged_rows,
      count(*) filter (
        where clob_event_ofi_version is distinct from ${CLOB_EVENT_OFI_TAPE.version}
          and up_bid is not null
          and up_ask is not null
          and down_bid is not null
          and down_ask is not null
      )::int as two_sided_missing_rows,
      count(*) filter (
        where clob_event_ofi_version is distinct from ${CLOB_EVENT_OFI_TAPE.version}
          and (up_bid is null or up_ask is null or down_bid is null or down_ask is null)
      )::int as one_sided_missing_rows,
      count(distinct pair || ':' || horizon_min::text) filter (
        where clob_event_ofi_version = ${CLOB_EVENT_OFI_TAPE.version}
      )::int as tagged_buckets,
      min(captured_at) as first_captured_at,
      max(captured_at) as last_captured_at
    from polymarket_state_snapshot
    where captured_at >= ${deployedAt}
      and pair in ('BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'DOGE-USD', 'BNB-USD')
      and horizon_min in (5, 15)
  `);
  evidence = result.rows[0] ?? null;
  const eligibleRows = Number(evidence?.eligible_rows ?? 0);
  const taggedRows = Number(evidence?.tagged_rows ?? 0);
  const coverage = eligibleRows > 0 ? taggedRows / eligibleRows : 0;
  if (
    !evidence
    || eligibleRows < 144
    || taggedRows <= 0
    || coverage < CLOB_EVENT_OFI_TAPE.minCoverage
    || Number(evidence.tagged_buckets) !== 12
  ) {
    throw new Error(
      `refusing unsafe complete-discovery launch receipt: ${JSON.stringify({
        evidence,
        coverage,
      })}`,
    );
  }

  const sources = Array.isArray(existing.sources)
    ? existing.sources.filter((source): source is { title: string; url: string } =>
      !!source
      && typeof source === "object"
      && typeof (source as { title?: unknown }).title === "string"
      && typeof (source as { url?: unknown }).url === "string"
    )
    : [];
  await caller.kb.upsert({
    slug: existing.slug,
    title: existing.title,
    category: existing.category as (typeof categories)[number],
    tags: existing.tags ?? [],
    body: [
      existing.body,
      "",
      launchMarker,
      "",
      `Recorded ${new Date().toISOString()} after the repaired worker had collected multiple complete windows.`,
      "",
      `- Outcome-blind evidence since the ${deployedAt.toISOString()} deployment contained ${eligibleRows.toLocaleString()} eligible rows, ${taggedRows.toLocaleString()} tagged rows (${(coverage * 100).toFixed(2)}% coverage), ${Number(evidence.two_sided_missing_rows).toLocaleString()} two-sided-book transport misses, ${Number(evidence.one_sided_missing_rows).toLocaleString()} one-sided-book nulls, and all ${Number(evidence.tagged_buckets)} asset/timeframe buckets.`,
      `- The launch cleared the unchanged frozen ${Math.round(CLOB_EVENT_OFI_TAPE.minCoverage * 100)}% operational coverage floor for this post-repair slice. Cumulative readiness remains governed by the original boundary and every original floor; no older row was deleted, relabeled, or backfilled.`,
      "- The worker startup log showed a complete 24-token current subscription and 24/24 initialized books. A later public-socket code-1006 interval remained null and recovered naturally; the collector did not synthesize the missing interval.",
      "- Before launch, the rebuilt source passed 255 API tests and TypeScript checking, including the fail-closed no-order/signing/funding/execution assertions. The public service remained healthy and the repair required no API, web, database, or execution deployment.",
      "- This receipt changes no discovery contract, strategy rule, feature transform, rolling window, event clock, transport-lag limit, evaluation boundary, readiness floor, disclosure lock, verdict gate, or execution constraint.",
      "- No quote value, OFI sign, outcome, paper decision, grade, or performance field was read for this receipt.",
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
  updated: !existing.body.includes(launchMarker),
  auditInserted: !existingAudit,
  slug,
  launchMarker,
  deployedAt: deployedAt.toISOString(),
  evidence,
}, null, 2));
process.exit(0);
