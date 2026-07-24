/**
 * Persist the successful post-grace launch audit for the public CLOB event-OFI tape.
 *
 * This reads only version, boundary, bucket, nullability, timing, and freshness metadata. It never
 * selects rolling feature values, market direction, resolutions, paper decisions, or performance.
 */
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import {
  assertOutcomeBlindClobEventStatus,
  clobEventOfiTapeStatus,
} from "../services/clob-event-ofi-report.ts";
import { CLOB_EVENT_OFI_TAPE } from "../services/clob-event-ofi.ts";

const slug = CLOB_EVENT_OFI_TAPE.version;
const marker = "## Outcome-blind launch success — 2026-07-24";
const requiredPreregistrationText =
  "## Prospective registration — public CLOB event-OFI tape v1";
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
  req: new Request("http://localhost/internal/kb-clob-event-ofi-launch-success"),
};
const caller = appRouter.createCaller(ctx);
const boundary = new Date(CLOB_EVENT_OFI_TAPE.evalStartMs);
const graceMs = 5 * 60_000;

if (
  CLOB_EVENT_OFI_TAPE.version !== "updown-clob-event-ofi-tape-v1"
  || boundary.toISOString() !== "2026-07-24T07:00:00.000Z"
) {
  throw new Error("CLOB event-OFI executable contract does not match its preregistration");
}
if (Date.now() < CLOB_EVENT_OFI_TAPE.evalStartMs + graceMs) {
  throw new Error("refusing CLOB event-OFI launch success before the post-boundary grace window");
}

const [status, integrityResult] = await Promise.all([
  clobEventOfiTapeStatus(),
  db.execute(sql`
    select
      count(*) filter (
        where clob_event_ofi_version = ${CLOB_EVENT_OFI_TAPE.version}
      )::int as tagged_rows,
      count(*) filter (
        where clob_event_ofi_version = ${CLOB_EVENT_OFI_TAPE.version}
          and captured_at < ${boundary}
      )::int as pre_boundary_rows,
      count(*) filter (
        where captured_at >= ${boundary}
          and clob_event_ofi_version is not null
          and clob_event_ofi_version <> ${CLOB_EVENT_OFI_TAPE.version}
      )::int as unknown_version_rows,
      count(*) filter (
        where clob_event_ofi_version = ${CLOB_EVENT_OFI_TAPE.version}
          and (
            pair not in ('BTC-USD','ETH-USD','SOL-USD','XRP-USD','DOGE-USD','BNB-USD')
            or horizon_min not in (5,15)
          )
      )::int as mapping_violations,
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
      )::int as required_nulls,
      min(captured_at) filter (
        where clob_event_ofi_version = ${CLOB_EVENT_OFI_TAPE.version}
      ) as first_tagged_at,
      max(captured_at) filter (
        where clob_event_ofi_version = ${CLOB_EVENT_OFI_TAPE.version}
      ) as last_tagged_at
    from polymarket_state_snapshot
  `),
]);
assertOutcomeBlindClobEventStatus(status);
const integrity = integrityResult.rows[0];
const taggedRows = Number(integrity?.tagged_rows ?? 0);
const checks = {
  exactVersion: status.version === CLOB_EVENT_OFI_TAPE.version,
  exactBoundary: status.evalStartMs === CLOB_EVENT_OFI_TAPE.evalStartMs,
  twelvePopulatedBuckets:
    status.buckets.length === 12 && status.buckets.every((bucket) => bucket.rows > 0),
  taggedRows: taggedRows > 0,
  usableRows: status.usableRows > 0,
  healthy: status.operationalHealth.healthy,
  noPreBoundaryRows: Number(integrity?.pre_boundary_rows ?? -1) === 0,
  noUnknownVersionRows: Number(integrity?.unknown_version_rows ?? -1) === 0,
  noMappingViolations: Number(integrity?.mapping_violations ?? -1) === 0,
  noRequiredNulls: Number(integrity?.required_nulls ?? -1) === 0,
};
if (!Object.values(checks).every(Boolean)) {
  throw new Error(`CLOB event-OFI launch audit failed: ${JSON.stringify(checks)}`);
}

const existing = await caller.kb.get({ slug });
if (!existing) throw new Error(`missing preregistered KB article ${slug}`);
if (!existing.body.includes(requiredPreregistrationText)) {
  throw new Error("missing prospective CLOB event-OFI registration marker");
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
      `- ${taggedRows.toLocaleString()} tagged rows; ${status.usableRows.toLocaleString()} usable of ${status.eligibleRows.toLocaleString()} eligible (${(status.coverage * 100).toFixed(1)}% coverage).`,
      `- First tagged ${new Date(String(integrity?.first_tagged_at)).toISOString()}; latest ${new Date(String(integrity?.last_tagged_at)).toISOString()}.`,
      `- Operational health passed: last capture age ${status.operationalHealth.lastCaptureAgeSec?.toFixed(1)}s, latest parsed market-data age ${status.operationalHealth.latestMarketDataAgeSec?.toFixed(1)}s, maximum recent transport lag ${status.operationalHealth.latestMaxTransportLagMs?.toFixed(0)}ms.`,
      "- Zero pre-boundary rows, unknown versions, universe mappings, or required-field nulls. All twelve asset × horizon buckets are populated.",
      "- This launch result authorizes continued outcome-blind collection only. It does not disclose a feature sign or magnitude, select a threshold, create a strategy rule, or permit execution.",
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
  version: status.version,
  boundary: boundary.toISOString(),
  checks,
  evidence: {
    taggedRows,
    eligibleRows: status.eligibleRows,
    usableRows: status.usableRows,
    coverage: status.coverage,
    operationalHealth: status.operationalHealth,
  },
}, null, 2));
process.exit(0);
