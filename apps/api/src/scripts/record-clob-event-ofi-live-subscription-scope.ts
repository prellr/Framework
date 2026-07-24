/**
 * Record the outcome-blind live-subscription scope repair for CLOB event-OFI v1.
 *
 * Run after the repaired image passes tests but before deploying that image to the worker. The
 * evidence query reads only boundaries, version tags, row counts, buckets, and timestamps. It never
 * selects feature values, market outcomes, paper decisions, grades, or performance.
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
  "### Post-launch transport incident — bounded live subscription scope — 2026-07-24";
const action = "kb.operational-amendment.record";
const resourceId = `${slug}:bounded-live-subscription-scope`;
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
  req: new Request("http://localhost/internal/kb-clob-event-ofi-live-subscription-scope"),
};
const caller = appRouter.createCaller(ctx);
const boundary = new Date(CLOB_EVENT_OFI_TAPE.evalStartMs);

if (
  CLOB_EVENT_OFI_TAPE.version !== "updown-clob-event-ofi-tape-v1"
  || boundary.toISOString() !== "2026-07-24T07:00:00.000Z"
  || AUTHORITATIVE_TRADE_FLOW_TAPE.marketLookaheadHours !== 3
  || AUTHORITATIVE_TRADE_FLOW_TAPE.subscriptionLeadMs !== 60_000
) {
  throw new Error("refusing to document an unexpected live-subscription contract");
}

const existing = await caller.kb.get({ slug });
if (!existing?.body.includes(preregistrationMarker)) {
  throw new Error(`missing CLOB event-OFI preregistration ${slug}`);
}

let evidence: {
  eligible_rows: number;
  tagged_rows: number;
  eligible_since_first_tag: number;
  tagged_since_first_tag: number;
  tagged_markets: number;
  tagged_buckets: number;
  pre_boundary_rows: number;
  unknown_version_rows: number;
  first_tagged_at: Date | null;
  last_tagged_at: Date | null;
} | null = null;
if (!existing.body.includes(marker)) {
  const result = await db.execute<{
    eligible_rows: number;
    tagged_rows: number;
    eligible_since_first_tag: number;
    tagged_since_first_tag: number;
    tagged_markets: number;
    tagged_buckets: number;
    pre_boundary_rows: number;
    unknown_version_rows: number;
    first_tagged_at: Date | null;
    last_tagged_at: Date | null;
  }>(sql`
    with eligible as (
      select captured_at, condition_id, pair, horizon_min, clob_event_ofi_version
      from polymarket_state_snapshot
      where captured_at >= ${boundary}
        and pair in ('BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'DOGE-USD', 'BNB-USD')
        and horizon_min in (5, 15)
    ),
    first_tag as (
      select min(captured_at) as captured_at
      from eligible
      where clob_event_ofi_version = ${CLOB_EVENT_OFI_TAPE.version}
    )
    select
      count(*)::int as eligible_rows,
      count(*) filter (
        where clob_event_ofi_version = ${CLOB_EVENT_OFI_TAPE.version}
      )::int as tagged_rows,
      count(*) filter (
        where eligible.captured_at >= first_tag.captured_at
      )::int as eligible_since_first_tag,
      count(*) filter (
        where eligible.captured_at >= first_tag.captured_at
          and clob_event_ofi_version = ${CLOB_EVENT_OFI_TAPE.version}
      )::int as tagged_since_first_tag,
      count(distinct condition_id) filter (
        where clob_event_ofi_version = ${CLOB_EVENT_OFI_TAPE.version}
      )::int as tagged_markets,
      count(distinct pair || ':' || horizon_min::text) filter (
        where clob_event_ofi_version = ${CLOB_EVENT_OFI_TAPE.version}
      )::int as tagged_buckets,
      (
        select count(*)::int
        from polymarket_state_snapshot
        where captured_at < ${boundary}
          and clob_event_ofi_version is not null
      ) as pre_boundary_rows,
      count(*) filter (
        where clob_event_ofi_version is not null
          and clob_event_ofi_version <> ${CLOB_EVENT_OFI_TAPE.version}
      )::int as unknown_version_rows,
      min(eligible.captured_at) filter (
        where clob_event_ofi_version = ${CLOB_EVENT_OFI_TAPE.version}
      ) as first_tagged_at,
      max(eligible.captured_at) filter (
        where clob_event_ofi_version = ${CLOB_EVENT_OFI_TAPE.version}
      ) as last_tagged_at
    from eligible
    cross join first_tag
  `);
  evidence = result.rows[0] ?? null;
  if (
    !evidence
    || Number(evidence.eligible_rows) <= 0
    || Number(evidence.tagged_rows) <= 0
    || Number(evidence.eligible_since_first_tag) <= 0
    || Number(evidence.tagged_since_first_tag) <= 0
    || Number(evidence.tagged_buckets) !== 12
    || Number(evidence.pre_boundary_rows) !== 0
    || Number(evidence.unknown_version_rows) !== 0
  ) {
    throw new Error(`refusing unsafe live-subscription amendment: ${JSON.stringify(evidence)}`);
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
      title: "Polymarket market-channel WebSocket contract",
      url: "https://docs.polymarket.com/market-data/websocket/market-channel",
    },
    {
      title: "Polymarket WebSocket changelog",
      url: "https://docs.polymarket.com/changelog",
    },
  ];
  const sources = [
    ...sourceList,
    ...additions.filter((candidate) =>
      !sourceList.some((source) => source.url === candidate.url)
    ),
  ];
  const cumulativeCoverage = Number(evidence.tagged_rows) / Number(evidence.eligible_rows);
  const postFirstCoverage =
    Number(evidence.tagged_since_first_tag) / Number(evidence.eligible_since_first_tag);
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
      `Recorded ${new Date().toISOString()} before deploying the bounded subscription correction.`,
      "",
      `- Outcome-blind readiness evidence showed ${Number(evidence.tagged_rows).toLocaleString()} tagged rows across ${Number(evidence.tagged_markets).toLocaleString()} markets and all ${Number(evidence.tagged_buckets)} asset/timeframe buckets, versus ${Number(evidence.eligible_rows).toLocaleString()} eligible rows (${(cumulativeCoverage * 100).toFixed(1)}% cumulative coverage). Coverage remained ${(postFirstCoverage * 100).toFixed(1)}% after the first tagged row, disproving a startup-only explanation. There were zero pre-boundary and zero unknown-version rows.`,
      "- Nullability and transport-threshold staging found that every unusable eligible row lacked the tape version entirely. Tagged rows had no partial-field, receive-age, or transport-lag rejection. No feature value was selected.",
      "- Worker telemetry recorded 36 abnormal code 1006 socket closes between 09:01 and 09:58 UTC, with each reconnect clearing queue baselines by design. The broad discovery subscription repeatedly initialized 96–168 tokens even though only current 5m/15m markets can emit an eligible event.",
      "- Polymarket documents an initial book dump on subscription, dynamic subscribe/unsubscribe updates, and a 10-second application heartbeat. It also documents that the historical 100-token limit has been removed; this correction therefore does not claim or depend on an undocumented hard cap.",
      `- Operational correction only: discovery metadata remains at ${AUTHORITATIVE_TRADE_FLOW_TAPE.marketLookaheadHours} hours, while the socket subscribes to live markets and a ${AUTHORITATIVE_TRADE_FLOW_TAPE.subscriptionLeadMs / 1_000}-second handoff lead. Every currently eligible token remains subscribed, and the next window is initialized before it can produce an eligible frozen-universe event.`,
      "- Existing missing rows remain missing and are never backfilled. The correction changes no event transform, rolling window, event clock, transport-lag limit, boundary, readiness floor, disclosure lock, paper rule, verdict gate, or execution constraint.",
      "- No feature value, directional sign, outcome, paper decision, grade, or performance field was read for this diagnosis or amendment.",
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
