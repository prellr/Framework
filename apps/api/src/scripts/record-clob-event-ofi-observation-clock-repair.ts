/**
 * Record the outcome-blind launch incident and observation-clock repair for CLOB event-OFI v1.
 *
 * This script must run before the repaired worker is deployed. It reads only eligible/tagged row
 * counts and the boundary. It never reads feature values, outcomes, paper decisions, or performance.
 */
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { CLOB_EVENT_OFI_TAPE } from "../services/clob-event-ofi.ts";

const slug = CLOB_EVENT_OFI_TAPE.version;
const preregistrationMarker = "## Prospective registration — public CLOB event-OFI tape v1";
const marker = "### Post-boundary launch incident — observation-clock repair — 2026-07-24";
const action = "kb.preregistration.amend";
const resourceId = `${slug}:observation-clock-repair`;
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
  req: new Request("http://localhost/internal/kb-clob-event-ofi-observation-clock-repair"),
};
const caller = appRouter.createCaller(ctx);
const boundary = new Date(CLOB_EVENT_OFI_TAPE.evalStartMs);

const existing = await caller.kb.get({ slug });
if (!existing?.body.includes(preregistrationMarker)) {
  throw new Error(`missing CLOB event-OFI preregistration ${slug}`);
}

let evidence: {
  eligible_rows: number;
  tagged_rows: number;
  pre_boundary_rows: number;
} | null = null;
if (!existing.body.includes(marker)) {
  const result = await db.execute<{
    eligible_rows: number;
    tagged_rows: number;
    pre_boundary_rows: number;
  }>(sql`
    select
      count(*) filter (where captured_at >= ${boundary})::int as eligible_rows,
      count(*) filter (
        where captured_at >= ${boundary}
          and clob_event_ofi_version = ${CLOB_EVENT_OFI_TAPE.version}
      )::int as tagged_rows,
      count(*) filter (
        where captured_at < ${boundary}
          and clob_event_ofi_version is not null
      )::int as pre_boundary_rows
    from polymarket_state_snapshot
  `);
  evidence = result.rows[0] ?? null;
  if (
    !evidence
    || Number(evidence.tagged_rows) !== 0
    || Number(evidence.pre_boundary_rows) !== 0
  ) {
    throw new Error(
      `refusing observation-clock repair amendment after tagged evidence: ${JSON.stringify(evidence)}`,
    );
  }

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
      `Recorded ${new Date().toISOString()} after the frozen boundary and before deploying the repair.`,
      "",
      `- Launch diagnosis found ${Number(evidence.eligible_rows).toLocaleString()} eligible compact state rows, zero tagged CLOB event-OFI rows, and zero pre-boundary rows.`,
      "- The public socket, full-book initialization, price-change parsing, and state-tape scheduler were healthy. The state collector passed its tick-start timestamp into a continuously advancing socket accumulator after asynchronous discovery and book work.",
      "- Fresh socket receipts therefore appeared later than the stale read clock and correctly tripped the existing negative-age fail-closed guard for every candidate.",
      "- The repair samples the wall clock synchronously at the accumulator read. It changes no queue-event transform, rolling window, transport threshold, boundary, universe, readiness floor, disclosure lock, paper strategy, or execution constraint.",
      "- Because no v1 row existed before this operational repair, the first eventual tagged timestamp remains the beginning of the usable prospective tape. Launch success must still pass the original outcome-blind auditor.",
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
