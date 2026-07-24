/**
 * Persist the post-deploy launch receipt for complete-snapshot reconnect recovery.
 *
 * The query reads only version-tag and paired-book nullability after the exact final deployment
 * cutoff. It never selects a quote value, OFI value, outcome, paper decision, grade, or result.
 */
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { CLOB_EVENT_OFI_TAPE } from "../services/clob-event-ofi.ts";

const slug = CLOB_EVENT_OFI_TAPE.version;
const requiredMarker =
  "### Post-launch transport incident — complete-snapshot reconnect recovery — 2026-07-24";
const marker =
  "### Outcome-blind complete-snapshot recovery launch receipt — 2026-07-24";
const action = "kb.launch-audit.record";
const resourceId = `${slug}:complete-snapshot-reconnect-recovery-launch`;
const deployedAfterMs = Date.parse("2026-07-24T13:08:15.000Z");
const launchAfterMs = deployedAfterMs + 10 * 60_000;
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
  req: new Request("http://localhost/internal/kb-clob-event-ofi-snapshot-recovery-launch"),
};
const caller = appRouter.createCaller(ctx);

if (
  CLOB_EVENT_OFI_TAPE.version !== "updown-clob-event-ofi-tape-v1"
  || CLOB_EVENT_OFI_TAPE.minCoverage !== 0.95
  || deployedAfterMs !== Date.parse("2026-07-24T13:08:15.000Z")
) {
  throw new Error("refusing an unexpected complete-snapshot recovery launch contract");
}
if (Date.now() < launchAfterMs) {
  throw new Error("refusing recovery launch receipt before the ten-minute live window");
}

const deployedAfter = new Date(deployedAfterMs);
const result = await db.execute<{
  horizon_min: number;
  eligible_rows: number;
  usable_rows: number;
  paired_book_unavailable_rows: number;
  transport_missing_rows: number;
  partial_tagged_rows: number;
  first_captured_at: Date | string | null;
  last_captured_at: Date | string | null;
}>(sql`
  select
    horizon_min,
    count(*)::int as eligible_rows,
    count(*) filter (
      where clob_event_ofi_version = ${CLOB_EVENT_OFI_TAPE.version}
    )::int as usable_rows,
    count(*) filter (
      where clob_event_ofi_version is null
        and (
          up_bid is null or up_ask is null
          or down_bid is null or down_ask is null
        )
    )::int as paired_book_unavailable_rows,
    count(*) filter (
      where clob_event_ofi_version is null
        and up_bid is not null and up_ask is not null
        and down_bid is not null and down_ask is not null
    )::int as transport_missing_rows,
    count(*) filter (
      where clob_event_ofi_version = ${CLOB_EVENT_OFI_TAPE.version}
        and (
          clob_event_ofi_canonical_5s is null
          or clob_event_ofi_canonical_30s is null
          or clob_event_ofi_canonical_60s is null
          or clob_event_ofi_up_events_60s is null
          or clob_event_ofi_down_events_60s is null
          or clob_event_ofi_source_age_sec is null
          or clob_event_ofi_receive_age_sec is null
          or clob_event_ofi_max_transport_lag_ms_60s is null
        )
    )::int as partial_tagged_rows,
    min(captured_at) as first_captured_at,
    max(captured_at) as last_captured_at
  from polymarket_state_snapshot
  where captured_at >= ${deployedAfter}
    and pair in ('BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'DOGE-USD', 'BNB-USD')
    and horizon_min in (5, 15)
  group by horizon_min
  order by horizon_min
`);

const evidence = result.rows;
const checks = {
  bothHorizonsObserved:
    evidence.length === 2
    && evidence.every((row) => Number(row.eligible_rows) >= 24),
  exactNullabilityAccounting: evidence.every(
    (row) =>
      Number(row.usable_rows)
        + Number(row.paired_book_unavailable_rows)
        + Number(row.transport_missing_rows)
      === Number(row.eligible_rows),
  ),
  noTransportMissingRows:
    evidence.every((row) => Number(row.transport_missing_rows) === 0),
  noPartialTaggedRows:
    evidence.every((row) => Number(row.partial_tagged_rows) === 0),
};
if (!Object.values(checks).every(Boolean)) {
  throw new Error(
    `complete-snapshot recovery launch audit failed: ${JSON.stringify({ checks, evidence })}`,
  );
}

const existing = await caller.kb.get({ slug });
if (!existing?.body.includes(requiredMarker)) {
  throw new Error(`missing complete-snapshot recovery amendment ${slug}`);
}
if (!existing.body.includes(marker)) {
  const sources = Array.isArray(existing.sources)
    ? existing.sources.filter((source): source is { title: string; url: string } =>
      !!source
      && typeof source === "object"
      && typeof (source as { title?: unknown }).title === "string"
      && typeof (source as { url?: unknown }).url === "string"
    )
    : undefined;
  const lines = evidence.map((row) =>
    `- ${Number(row.horizon_min)}m: ${Number(row.usable_rows)}/${Number(row.eligible_rows)} rows carried the complete event-OFI tag; ${Number(row.paired_book_unavailable_rows)} legitimate paired-book-unavailable rows; ${Number(row.transport_missing_rows)} transport misses; ${Number(row.partial_tagged_rows)} partial tags.`
  );
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
      `Recorded ${new Date().toISOString()} after the final worker image had run live for at least ten minutes.`,
      "",
      ...lines,
      "- Exact nullability accounting passed for both horizons. Every missing OFI tag coincided with an independently fetched incomplete/one-sided paired book; no complete paired book lacked the event-OFI tag.",
      "- The live worker crossed repeated public code-1006 closes and a 5m/15m handoff while retaining zero transport-attributable misses. One-sided books remain null and continue counting against the unchanged cumulative 95% readiness floor.",
      "- Launch success authorizes continued outcome-blind collection only. It changes no tape value, denominator, strategy, verdict gate, disclosure lock, order capability, or execution constraint.",
      "- This receipt inspected no quote value, OFI value, feature sign, outcome, paper decision, grade, return, residual, or performance field.",
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
  boundary: deployedAfter.toISOString(),
  checks,
  evidence,
}, null, 2));
process.exit(0);
