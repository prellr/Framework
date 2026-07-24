/**
 * Record the outcome-blind source-clock tolerance for CLOB event-OFI v1.
 *
 * Run before deploying the tolerance. The database query reads only version tags, counts, and the
 * frozen boundary. The diagnostic evidence is transport timing only—never feature values, direction,
 * outcomes, paper decisions, grades, or performance.
 */
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { CLOB_EVENT_OFI_TAPE } from "../services/clob-event-ofi.ts";

const slug = CLOB_EVENT_OFI_TAPE.version;
const priorMarker =
  "### Immediate validation correction — snapshot receipt vs two-sided quote — 2026-07-24";
const marker = "### Post-launch source-clock tolerance — 2026-07-24";
const action = "kb.operational-amendment.record";
const resourceId = `${slug}:source-clock-tolerance`;
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
  req: new Request("http://localhost/internal/kb-clob-event-ofi-source-clock-tolerance"),
};
const caller = appRouter.createCaller(ctx);
const boundary = new Date(CLOB_EVENT_OFI_TAPE.evalStartMs);

if (
  CLOB_EVENT_OFI_TAPE.version !== "updown-clob-event-ofi-tape-v1"
  || boundary.toISOString() !== "2026-07-24T07:00:00.000Z"
  || CLOB_EVENT_OFI_TAPE.maxSourceClockLeadMs !== 250
  || CLOB_EVENT_OFI_TAPE.maxTransportLagMs !== 30_000
) {
  throw new Error("refusing to document an unexpected causal timing contract");
}

const existing = await caller.kb.get({ slug });
if (!existing?.body.includes(priorMarker)) {
  throw new Error(`missing snapshot-guard correction for ${slug}`);
}

let evidence: {
  eligible_rows: number;
  tagged_rows: number;
  pre_boundary_rows: number;
  unknown_version_rows: number;
} | null = null;
if (!existing.body.includes(marker)) {
  const result = await db.execute<{
    eligible_rows: number;
    tagged_rows: number;
    pre_boundary_rows: number;
    unknown_version_rows: number;
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
      count(*) filter (
        where captured_at < ${boundary}
          and clob_event_ofi_version is not null
      )::int as pre_boundary_rows,
      count(*) filter (
        where captured_at >= ${boundary}
          and clob_event_ofi_version is not null
          and clob_event_ofi_version <> ${CLOB_EVENT_OFI_TAPE.version}
      )::int as unknown_version_rows
    from polymarket_state_snapshot
  `);
  evidence = result.rows[0] ?? null;
  if (
    !evidence
    || Number(evidence.eligible_rows) <= 0
    || Number(evidence.tagged_rows) <= 0
    || Number(evidence.pre_boundary_rows) !== 0
    || Number(evidence.unknown_version_rows) !== 0
  ) {
    throw new Error(`refusing unsafe source-clock amendment: ${JSON.stringify(evidence)}`);
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
      `Recorded ${new Date().toISOString()} before deploying the bounded clock tolerance.`,
      "",
      "- After snapshot delivery and quote completeness were separated, a fresh production slice still failed closed despite live market traffic, 166/168 valid queues, and no stale socket.",
      "- A bounded current-market timing probe observed 21,198 price-change frames with zero frames over the frozen 30-second lateness limit; p95 transport latency was 59 ms and maximum latency was 288 ms.",
      "- A second 10-second probe observed 11,116 book/price-change frames. Because Polymarket's source clock led Server2 slightly, 9,008 frames (81.0%) appeared 1–36 ms in the future at local receipt time. The strict negative source-age check could therefore reject a fully causal local receipt.",
      `- Operational correction only: a source-clock lead up to ${CLOB_EVENT_OFI_TAPE.maxSourceClockLeadMs} ms clamps the stored diagnostic source age to zero. Larger future timestamps still fail closed.`,
      "- Rolling 5s/30s/60s inclusion remains keyed exclusively to local receipt time. The normalized event transform, event ordering, 30-second late-event limit, socket freshness, boundary, universe, schema, readiness floors, and disclosure lock are unchanged.",
      "- No feature value, directional sign, market outcome, paper decision, grade, or performance field was read for this diagnosis or amendment.",
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
