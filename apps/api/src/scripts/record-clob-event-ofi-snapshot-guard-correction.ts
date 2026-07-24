/**
 * Record the immediate validation correction for the CLOB OFI partial-subscription watchdog.
 *
 * This must run before deploying the corrected snapshot-receipt guard. It reads only version tags,
 * row counts, and boundaries; no feature value, direction, outcome, paper decision, or performance.
 */
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { CLOB_EVENT_OFI_TAPE } from "../services/clob-event-ofi.ts";
import { AUTHORITATIVE_TRADE_FLOW_TAPE } from "../services/polymarket-trade-flow-tape.ts";

const slug = CLOB_EVENT_OFI_TAPE.version;
const incidentMarker =
  "### Post-launch transport incident — partial current-book initialization — 2026-07-24";
const marker =
  "### Immediate validation correction — snapshot receipt vs two-sided quote — 2026-07-24";
const action = "kb.operational-amendment.record";
const resourceId = `${slug}:snapshot-receipt-guard-correction`;
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
  req: new Request("http://localhost/internal/kb-clob-event-ofi-snapshot-guard-correction"),
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
if (!existing?.body.includes(incidentMarker)) {
  throw new Error(`missing partial-initialization incident record for ${slug}`);
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
    throw new Error(`refusing unsafe snapshot-guard correction: ${JSON.stringify(evidence)}`);
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
      `Recorded ${new Date().toISOString()} before deploying the corrected guard.`,
      "",
      "- The first guarded worker run immediately distinguished 86 received book snapshots from 82 valid two-sided queue baselines. Its current-market check then reported 20/24 and 16/24 valid baselines on successive connections.",
      "- A received snapshot with an empty or one-sided book is legitimate market-liquidity evidence. It cannot support paired event flow, but reconnecting cannot make it transport-complete and would create unnecessary socket churn.",
      "- The corrected watchdog therefore requires one parsed `book` snapshot for every currently trading token after the same 15-second grace. It separately reports how many snapshots contain valid two-sided queues, but quote completeness cannot trigger a reconnect.",
      "- Empty or one-sided books remain null in the compact tape and continue to count against the frozen 95% coverage floor. The system does not impute, carry forward, or conceal them.",
      "- The delayed reconnect-backoff reset remains in force. The corrected guard adds no socket, REST request, stored column, strategy input, or execution path.",
      "- No feature value, directional sign, market outcome, paper decision, grade, or performance field was read for this correction.",
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
