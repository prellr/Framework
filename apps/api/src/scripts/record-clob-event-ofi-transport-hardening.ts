/**
 * Record the pre-boundary transport hardening applied to the public CLOB event-OFI tape.
 *
 * This amends provenance and operations only. It reads no tape rows, feature values, outcomes,
 * paper decisions, grades, or P&L and changes no frozen strategy or feature contract.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { CLOB_EVENT_OFI_TAPE } from "../services/clob-event-ofi.ts";

const slug = CLOB_EVENT_OFI_TAPE.version;
const preregistrationMarker = "## Prospective registration — public CLOB event-OFI tape v1";
const marker = "### Pre-boundary transport hardening — 2026-07-24";
const action = "kb.preregistration.amend";
const resourceId = `${slug}:transport-hardening`;
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
  req: new Request("http://localhost/internal/kb-clob-event-ofi-transport-hardening"),
};
const caller = appRouter.createCaller(ctx);

if (Date.now() >= CLOB_EVENT_OFI_TAPE.evalStartMs) {
  throw new Error("refusing to amend CLOB event-OFI preregistration after its boundary");
}

const existing = await caller.kb.get({ slug });
if (!existing?.body.includes(preregistrationMarker)) {
  throw new Error(`missing CLOB event-OFI preregistration ${slug}`);
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
    title: "Polymarket public socket silent-freeze report #292",
    url: "https://github.com/Polymarket/py-clob-client/issues/292",
  },
];
const sources = [
  ...sourceList,
  ...additions.filter((candidate) => !sourceList.some((source) => source.url === candidate.url)),
];

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
      `Recorded ${new Date().toISOString()}, before the frozen ${new Date(CLOB_EVENT_OFI_TAPE.evalStartMs).toISOString()} boundary.`,
      "",
      "- Polymarket documents `PONG` as transport heartbeat traffic, separately from `book` and `price_change` market events. Public client reports also document sockets that keep answering heartbeats while market data silently freezes.",
      "- Jester now tracks transport and actual market-data liveness independently. A fresh `PONG` cannot prevent a reconnect after 90 seconds without a recognized market event.",
      "- OFI receive freshness advances only after a successfully parsed `book` or `price_change` frame. Heartbeats, empty arrays, unrelated market frames, and error envelopes cannot make the queue tape look fresh.",
      "- Disconnect clears the bounded in-memory queues and rolling events. The first post-reconnect full book initializes a new baseline and cannot manufacture OFI across an unobserved gap.",
      "- This operational hardening changes no boundary, universe, queue-event transform, rolling window, readiness floor, disclosure lock, paper rule, or execution constraint.",
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
  boundary: new Date(CLOB_EVENT_OFI_TAPE.evalStartMs).toISOString(),
}, null, 2));
process.exit(0);
