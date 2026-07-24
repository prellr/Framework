/**
 * Record the outcome-blind isolated-versus-combined CLOB socket probe.
 *
 * The fixed evidence below contains transport, initialization, nullability, and host-load counts
 * only. It contains no quote/feature value, chosen side, outcome, grade, return, or performance
 * evidence and authorizes no collector change.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { CLOB_EVENT_OFI_TAPE } from "../services/clob-event-ofi.ts";

const slug = CLOB_EVENT_OFI_TAPE.version;
const preregistrationMarker = "## Prospective registration — public CLOB event-OFI tape v1";
const marker = "### Outcome-blind combined-scope differential probe — 2026-07-24";
const action = "kb.operational-probe.record";
const resourceId = `${slug}:combined-scope-websocket-probe`;
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
  req: new Request("http://localhost/internal/kb-clob-combined-scope-probe"),
};
const caller = appRouter.createCaller(ctx);

if (
  CLOB_EVENT_OFI_TAPE.version !== "updown-clob-event-ofi-tape-v1"
  || CLOB_EVENT_OFI_TAPE.minCoverage !== 0.95
) {
  throw new Error("refusing to document an unexpected CLOB event-OFI contract");
}

const existing = await caller.kb.get({ slug });
if (!existing?.body.includes(preregistrationMarker)) {
  throw new Error(`missing CLOB event-OFI preregistration ${slug}`);
}

if (!existing.body.includes(marker)) {
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
      `Recorded ${new Date().toISOString()} from bounded, write-free Server2 probes.`,
      "",
      "- Isolated 5m scope: 12 current tokens for 60 seconds; 1 connection, 0 closes, 0 errors, 5 PING / 5 PONG, all 12 books initialized, 206 ms full-initialization latency, and 99.60% socket uptime.",
      "- Isolated 15m scope: 12 current tokens for 60 seconds; 1 connection, 0 closes, 0 errors, 5 PING / 5 PONG, all 12 books initialized, 223 ms full-initialization latency, and 99.57% socket uptime.",
      "- Combined scope: the exact 24 current 5m + 15m tokens for 120 seconds; 4 connections, 3 abnormal code-1006 closes, 0 explicit errors, all 4 connections fully initialized, 299 ms median full-initialization latency, and 94.16% socket uptime.",
      "- Contemporaneous production telemetry remained fail-closed and usable: 291/312 recent state rows had event-OFI, 291/294 rows with complete independently fetched paired books had event-OFI, 18 rows had a real incomplete/one-sided paired book, and 3 complete-book rows were transport-missing.",
      "- Server2 remained bounded near load 1.48 with the live worker around 5% CPU and 307 MiB; the probes opened one temporary public socket at a time, used no database connection, stored no rows, and did not restart the worker.",
      "- Disposition: the combined scope reproduces materially more transport churn, but it does not prove that partitioning eliminates the public endpoint's intermittent code-1006 behavior; an earlier five-minute isolated probe also saw one abnormal close. No collector change is authorized immediately before the familywise boundary.",
      "- Any partitioned-socket correction must first pass a longer outcome-blind shadow comparison, prove complete current-book initialization and lower transport-null incidence for both horizons, quantify added connection/CPU cost, and preserve one immutable denominator. It must not backfill gaps or change a feature, strategy, gate, or execution capability.",
      "- Existing reconnect protection, null preservation, the frozen 95% cumulative coverage floor, event transform, clocks, boundary, disclosure lock, paper rules, verdict gates, and execution prohibition remain unchanged.",
      "- No quote value, directional feature value, chosen side, market outcome, paper grade, return, residual, rank, or performance field was inspected.",
    ].join("\n"),
    sources: Array.isArray(existing.sources)
      ? existing.sources.filter((source): source is { title: string; url: string } =>
        !!source
        && typeof source === "object"
        && typeof (source as { title?: unknown }).title === "string"
        && typeof (source as { url?: unknown }).url === "string"
      )
      : undefined,
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
  disposition: "no-collector-change-before-familywise-boundary",
}, null, 2));
process.exit(0);
