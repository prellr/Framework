/**
 * Record the outcome-blind partial-discovery retention repair for CLOB event-OFI v1.
 *
 * The evidence query uses version tags, timestamps, bucket identities, and touch nullability only.
 * It never selects a quote, flow value, direction, outcome, paper decision, grade, or performance.
 */
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { CLOB_EVENT_OFI_TAPE } from "../services/clob-event-ofi.ts";
import { AUTHORITATIVE_TRADE_FLOW_TAPE } from "../services/polymarket-trade-flow-tape.ts";

const slug = CLOB_EVENT_OFI_TAPE.version;
const preregistrationMarker = "## Prospective registration — public CLOB event-OFI tape v1";
const marker =
  "### Post-launch transport incident — partial discovery retention — 2026-07-24";
const action = "kb.operational-amendment.record";
const resourceId = `${slug}:partial-discovery-retention`;
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
  req: new Request("http://localhost/internal/kb-clob-event-ofi-partial-discovery"),
};
const caller = appRouter.createCaller(ctx);
const boundary = new Date(CLOB_EVENT_OFI_TAPE.evalStartMs);
const firstScopeRepairAt = new Date("2026-07-24T10:08:43.000Z");

if (
  CLOB_EVENT_OFI_TAPE.version !== "updown-clob-event-ofi-tape-v1"
  || boundary.toISOString() !== "2026-07-24T07:00:00.000Z"
  || AUTHORITATIVE_TRADE_FLOW_TAPE.marketLookaheadHours !== 3
  || AUTHORITATIVE_TRADE_FLOW_TAPE.marketRefreshMs !== 30_000
  || AUTHORITATIVE_TRADE_FLOW_TAPE.subscriptionLeadMs !== 60_000
) {
  throw new Error("refusing to document an unexpected discovery-retention contract");
}

const existing = await caller.kb.get({ slug });
if (!existing?.body.includes(preregistrationMarker)) {
  throw new Error(`missing CLOB event-OFI preregistration ${slug}`);
}

let evidence: {
  eligible_rows: number;
  tagged_rows: number;
  two_sided_rows: number;
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
    two_sided_rows: number;
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
        where up_bid is not null
          and up_ask is not null
          and down_bid is not null
          and down_ask is not null
      )::int as two_sided_rows,
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
    || Number(evidence.two_sided_rows) <= 0
    || Number(evidence.two_sided_missing_rows) <= 0
    || Number(evidence.tagged_buckets) !== 12
  ) {
    throw new Error(`refusing unsafe partial-discovery amendment: ${JSON.stringify(evidence)}`);
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
      title: "Polymarket market-channel WebSocket contract",
      url: "https://docs.polymarket.com/market-data/websocket/market-channel",
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
      `Recorded ${new Date().toISOString()} before deploying the partial-discovery correction.`,
      "",
      `- From the first bounded-scope deployment, outcome-blind evidence contained ${Number(evidence.eligible_rows).toLocaleString()} eligible rows, ${Number(evidence.tagged_rows).toLocaleString()} tagged rows, and all ${Number(evidence.tagged_buckets)} asset/timeframe buckets.`,
      `- Touch nullability separated ${Number(evidence.one_sided_missing_rows).toLocaleString()} legitimate one-sided-book nulls from ${Number(evidence.two_sided_missing_rows).toLocaleString()} rows that remained untagged despite a complete two-sided REST book. No touch price or flow value was selected.`,
      "- Worker telemetry then showed a reconnect subscribing to only 16 tokens. The frozen live universe requires 24 tokens when all six assets have concurrent 5m and 15m markets. At 10:17 UTC the independent state-tape discovery returned only two of six 15m markets; one minute later all six returned, directly demonstrating a successful but partial Gamma page.",
      "- Root cause: each successful refresh replaced the entire token map. A temporarily partial discovery response therefore unsubscribed still-live markets and discarded their queue state.",
      "- Operational correction only: refreshes now merge newly discovered rows with previously discovered metadata until each row's immutable market end. Expired rows are pruned, newly discovered rows replace the same token, and the live plus one-minute subscription scope remains unchanged.",
      "- Existing missing rows remain missing and are never backfilled. This correction changes no universe, event transform, rolling window, event clock, transport-lag limit, boundary, readiness floor, disclosure lock, paper rule, verdict gate, or execution constraint.",
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
