/**
 * Record the outcome-blind reduced-scope CLOB WebSocket probe disposition.
 *
 * The evidence below contains only transport counts, initialization counts, nullability coverage,
 * and host-load observations. It contains no quote value, feature value, outcome, paper decision,
 * grade, or performance result. The probe is diagnostic only and changes no collector contract.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { CLOB_EVENT_OFI_TAPE } from "../services/clob-event-ofi.ts";

const slug = CLOB_EVENT_OFI_TAPE.version;
const preregistrationMarker = "## Prospective registration — public CLOB event-OFI tape v1";
const marker = "### Outcome-blind reduced-scope WebSocket probe — 2026-07-24";
const action = "kb.operational-probe.record";
const resourceId = `${slug}:reduced-scope-websocket-probe`;
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
  req: new Request("http://localhost/internal/kb-clob-websocket-health-probe"),
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
      title: "Public py-clob-client issue: intermittent silent stream / code 1006",
      url: "https://github.com/Polymarket/py-clob-client/issues/292",
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
      `Recorded ${new Date().toISOString()} after a bounded five-minute Server2 probe.`,
      "",
      "- Scope: one read-only public market WebSocket, the exact six-asset 5m universe, 12 outcome tokens, 300 seconds, no database connection, no stored rows, and no service restart.",
      "- Probe transport: 2 connections, 1 abnormal code-1006 close, 29 PING / 29 PONG, 21,344 parsed market frames, 1 fully initialized connection, 214 ms median full-initialization latency, and 99.16% socket uptime.",
      "- Same-window live collector telemetry recorded 2 abnormal code-1006 closes. Outcome-blind state-tape nullability was 61 usable of 66 eligible rows (92.4%) from 11:38 through 11:43 UTC.",
      "- Server load remained bounded: the temporary probe settled near 0.14% CPU and 96 MiB; the live worker remained in its prior operating range. Postgres was not used by the probe.",
      "- Disposition: reducing the connection to 12 tokens did not eliminate the same failure mode, so token count is not accepted as the root cause and no collector-scope or reconnect change is authorized from this single run.",
      "- Existing gaps remain null and are never backfilled. The frozen 95% cumulative coverage floor, event transform, clocks, boundary, disclosure lock, paper rules, verdict gates, and execution prohibition remain unchanged.",
      "- No quote value, directional feature value, market outcome, paper decision, grade, return, or performance field was inspected.",
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
  disposition: "no-collector-change",
}, null, 2));
process.exit(0);
