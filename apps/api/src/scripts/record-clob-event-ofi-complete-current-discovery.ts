/**
 * Record the outcome-blind complete-current-market discovery repair.
 *
 * The evidence query uses collection tags and touch nullability only. It never selects a quote,
 * flow value, direction, outcome, paper decision, grade, or performance.
 */
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { CLOB_EVENT_OFI_TAPE } from "../services/clob-event-ofi.ts";
import { CURRENT_UPDOWN_DISCOVERY } from "../services/polymarket.ts";

const slug = CLOB_EVENT_OFI_TAPE.version;
const preregistrationMarker = "## Prospective registration — public CLOB event-OFI tape v1";
const marker =
  "### Post-launch transport incident — complete current-market discovery — 2026-07-24";
const action = "kb.operational-amendment.record";
const resourceId = `${slug}:complete-current-market-discovery`;
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
  req: new Request("http://localhost/internal/kb-clob-event-ofi-complete-discovery"),
};
const caller = appRouter.createCaller(ctx);
const boundary = new Date(CLOB_EVENT_OFI_TAPE.evalStartMs);
const firstScopeRepairAt = new Date("2026-07-24T10:08:43.000Z");

if (
  CLOB_EVENT_OFI_TAPE.version !== "updown-clob-event-ofi-tape-v1"
  || boundary.toISOString() !== "2026-07-24T07:00:00.000Z"
  // This recorder is an immutable receipt for the 2026-07-24 repair contract, not the current
  // discovery configuration.
  || (CURRENT_UPDOWN_DISCOVERY as { lookaheadMin: number }).lookaheadMin !== 15
  || CURRENT_UPDOWN_DISCOVERY.pageSize !== 100
  || Number(CURRENT_UPDOWN_DISCOVERY.maxPages) !== 5
  || CURRENT_UPDOWN_DISCOVERY.cacheMs !== 20_000
) {
  throw new Error("refusing to document an unexpected current-discovery contract");
}

const existing = await caller.kb.get({ slug });
if (!existing?.body.includes(preregistrationMarker)) {
  throw new Error(`missing CLOB event-OFI preregistration ${slug}`);
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
if (!existing.body.includes(marker)) {
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
    where captured_at >= ${firstScopeRepairAt}
      and pair in ('BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'DOGE-USD', 'BNB-USD')
      and horizon_min in (5, 15)
  `);
  evidence = result.rows[0] ?? null;
  if (
    !evidence
    || Number(evidence.eligible_rows) <= 0
    || Number(evidence.tagged_rows) <= 0
    || Number(evidence.two_sided_missing_rows) <= 0
    || Number(evidence.tagged_buckets) !== 12
  ) {
    throw new Error(`refusing unsafe complete-discovery amendment: ${JSON.stringify(evidence)}`);
  }

  const sourceList = Array.isArray(existing.sources)
    ? existing.sources.filter((source): source is { title: string; url: string } =>
      !!source
      && typeof source === "object"
      && typeof (source as { title?: unknown }).title === "string"
      && typeof (source as { url?: unknown }).url === "string"
    )
    : [];
  const additions = [
    {
      title: "Polymarket market discovery guidance",
      url: "https://docs.polymarket.com/market-data/fetching-markets",
    },
    {
      title: "Polymarket list-markets API",
      url: "https://docs.polymarket.com/api-reference/markets/list-markets",
    },
  ];
  const sources = [
    ...sourceList,
    ...additions.filter((candidate) =>
      !sourceList.some((source) => source.url === candidate.url)
    ),
  ];
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
      `Recorded ${new Date().toISOString()} before deploying complete current-market discovery.`,
      "",
      `- Outcome-blind evidence since the first subscription-scope repair contained ${Number(evidence.eligible_rows).toLocaleString()} eligible rows, ${Number(evidence.tagged_rows).toLocaleString()} tagged rows, ${Number(evidence.two_sided_missing_rows).toLocaleString()} two-sided-book misses, ${Number(evidence.one_sided_missing_rows).toLocaleString()} one-sided-book nulls, and all ${Number(evidence.tagged_buckets)} asset/timeframe buckets.`,
      "- Three repeated public Gamma probes showed both the old three-hour query and a tight 15-minute query returning the 100-row maximum while exposing only ten target markets (20 tokens) on page one. The next tight-window page completed 24 target markets without needing a third page.",
      "- Root cause: Gamma applies its 100-row page limit before Jester's crypto filter. A successful one-page response was therefore not a complete current-market snapshot. Retention repairs later pages only after a token has been discovered at least once, so a cold start still opened with 20 instead of the expected live universe.",
      `- Operational correction only: current paper/read-only collectors now share an active-only ${CURRENT_UPDOWN_DISCOVERY.lookaheadMin}-minute discovery snapshot, paginate ${CURRENT_UPDOWN_DISCOVERY.pageSize}-row pages up to a fail-closed ${CURRENT_UPDOWN_DISCOVERY.maxPages}-page bound, deduplicate conditions, and coalesce calls for ${CURRENT_UPDOWN_DISCOVERY.cacheMs / 1_000} seconds.`,
      "- The generic multi-hour explorer remains unchanged. The bounded current snapshot is used only by the paper floor, state tape, trade-flow socket, complete-set audit, cross-horizon audit, and live book capture.",
      "- Existing missing rows remain missing and are never backfilled. This correction changes no strategy rule, asset/timeframe universe, event transform, rolling window, event clock, transport-lag limit, boundary, readiness floor, disclosure lock, verdict gate, or execution constraint.",
      "- No quote value, flow sign, outcome, paper decision, grade, or performance field was read for this diagnosis or amendment.",
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
  marker,
  boundary: boundary.toISOString(),
  evidence,
}, null, 2));
process.exit(0);
