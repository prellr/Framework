/**
 * Record the outcome-blind partial-subscription incident and transport hardening for CLOB OFI v1.
 *
 * Run after the repaired image passes tests but before deploying that image to the worker. The
 * evidence query reads only boundaries, version tags, row counts, and timestamps. It never selects
 * feature values, market outcomes, paper decisions, grades, or performance.
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
  "### Post-launch transport incident — partial current-book initialization — 2026-07-24";
const action = "kb.operational-amendment.record";
const resourceId = `${slug}:partial-current-book-initialization`;
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
  req: new Request("http://localhost/internal/kb-clob-event-ofi-partial-initialization"),
};
const caller = appRouter.createCaller(ctx);
const boundary = new Date(CLOB_EVENT_OFI_TAPE.evalStartMs);

if (
  CLOB_EVENT_OFI_TAPE.version !== "updown-clob-event-ofi-tape-v1"
  || boundary.toISOString() !== "2026-07-24T07:00:00.000Z"
  || AUTHORITATIVE_TRADE_FLOW_TAPE.currentBookInitGraceMs !== 15_000
  || AUTHORITATIVE_TRADE_FLOW_TAPE.reconnectStableMs !== 60_000
) {
  throw new Error("refusing to document an unexpected transport contract");
}

const existing = await caller.kb.get({ slug });
if (!existing?.body.includes(preregistrationMarker)) {
  throw new Error(`missing CLOB event-OFI preregistration ${slug}`);
}

let evidence: {
  eligible_rows: number;
  tagged_rows: number;
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
    tagged_markets: number;
    tagged_buckets: number;
    pre_boundary_rows: number;
    unknown_version_rows: number;
    first_tagged_at: Date | null;
    last_tagged_at: Date | null;
  }>(sql`
    select
      count(*) filter (
        where captured_at >= ${boundary}
          and pair in ('BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'DOGE-USD', 'BNB-USD')
          and horizon_min in (5, 15)
      )::int as eligible_rows,
      count(*) filter (
        where captured_at >= ${boundary}
          and clob_event_ofi_version = ${CLOB_EVENT_OFI_TAPE.version}
      )::int as tagged_rows,
      count(distinct condition_id) filter (
        where captured_at >= ${boundary}
          and clob_event_ofi_version = ${CLOB_EVENT_OFI_TAPE.version}
      )::int as tagged_markets,
      count(distinct pair || ':' || horizon_min::text) filter (
        where captured_at >= ${boundary}
          and clob_event_ofi_version = ${CLOB_EVENT_OFI_TAPE.version}
      )::int as tagged_buckets,
      count(*) filter (
        where captured_at < ${boundary}
          and clob_event_ofi_version is not null
      )::int as pre_boundary_rows,
      count(*) filter (
        where captured_at >= ${boundary}
          and clob_event_ofi_version is not null
          and clob_event_ofi_version <> ${CLOB_EVENT_OFI_TAPE.version}
      )::int as unknown_version_rows,
      min(captured_at) filter (
        where clob_event_ofi_version = ${CLOB_EVENT_OFI_TAPE.version}
      ) as first_tagged_at,
      max(captured_at) filter (
        where clob_event_ofi_version = ${CLOB_EVENT_OFI_TAPE.version}
      ) as last_tagged_at
    from polymarket_state_snapshot
  `);
  evidence = result.rows[0] ?? null;
  if (
    !evidence
    || Number(evidence.eligible_rows) <= 0
    || Number(evidence.tagged_rows) <= 0
    || Number(evidence.tagged_buckets) !== 12
    || Number(evidence.pre_boundary_rows) !== 0
    || Number(evidence.unknown_version_rows) !== 0
  ) {
    throw new Error(`refusing unsafe transport amendment: ${JSON.stringify(evidence)}`);
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
      title: "Polymarket real-time market stream",
      url: "https://docs.polymarket.com/market-data/realtime-data#market-stream",
    },
    {
      title: "Polymarket CLOB socket partial/silent stream report #292",
      url: "https://github.com/Polymarket/py-clob-client/issues/292",
    },
  ];
  const sources = [
    ...sourceList,
    ...additions.filter((candidate) =>
      !sourceList.some((source) => source.url === candidate.url)
    ),
  ];
  const coverage = Number(evidence.tagged_rows) / Number(evidence.eligible_rows);
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
      `Recorded ${new Date().toISOString()} before deploying the transport correction.`,
      "",
      `- Outcome-blind readiness evidence showed ${Number(evidence.tagged_rows).toLocaleString()} tagged rows across ${Number(evidence.tagged_markets).toLocaleString()} markets and all ${Number(evidence.tagged_buckets)} asset/timeframe buckets, versus ${Number(evidence.eligible_rows).toLocaleString()} eligible rows (${(coverage * 100).toFixed(1)}% coverage). There were zero pre-boundary and zero unknown-version rows.`,
      "- Worker telemetry showed repeated abnormal code 1006 closes and connections that continued receiving some market traffic while most currently trading token books lacked a complete queue baseline. The existing any-market liveness check could not distinguish that partial state.",
      "- A bounded, outcome-blind Server2 probe compared a full 84-token subscription with the same connection initialized current-market-first. Both modes received all 84 book baselines, including all 24 currently trading tokens, within 12 seconds and without a close. Token count and subscription order were therefore not accepted as the root cause.",
      "- Polymarket documents a single public market connection with one or more token IDs, dynamic subscription updates, and 10-second application heartbeats. Its public issue tracker separately records intermittent partial/silent streams and code 1006 failures even with very small subscriptions.",
      `- Operational correction only: after a ${AUTHORITATIVE_TRADE_FLOW_TAPE.currentBookInitGraceMs / 1_000}-second grace, a connection missing any currently trading token baseline reconnects. Exponential backoff now resets only after ${AUTHORITATIVE_TRADE_FLOW_TAPE.reconnectStableMs / 1_000} seconds of continuous uptime, preventing rapid reconnect storms.`,
      "- The correction keeps one socket, the same token universe, and the same compact row schema. It changes no event transform, rolling window, transport-lag limit, boundary, readiness floor, disclosure lock, paper rule, verdict gate, or execution constraint.",
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
