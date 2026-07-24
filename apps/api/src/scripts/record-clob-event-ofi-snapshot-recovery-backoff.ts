/**
 * Record the outcome-blind reconnect-debt correction for the public CLOB event-OFI tape.
 *
 * Run after the repaired image passes tests but before deploying it to the worker. This script
 * reads only the readiness-locked count/coverage/health surface and writes an operational KB
 * amendment. It never selects OFI values, quote values, outcomes, paper decisions, or performance.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import {
  assertOutcomeBlindClobEventStatus,
  clobEventOfiTapeStatus,
} from "../services/clob-event-ofi-report.ts";
import { CLOB_EVENT_OFI_TAPE } from "../services/clob-event-ofi.ts";
import {
  AUTHORITATIVE_TRADE_FLOW_TAPE,
  tradeFlowCurrentSnapshotsReady,
} from "../services/polymarket-trade-flow-tape.ts";

const slug = CLOB_EVENT_OFI_TAPE.version;
const preregistrationMarker = "## Prospective registration — public CLOB event-OFI tape v1";
const marker =
  "### Post-launch transport incident — complete-snapshot reconnect recovery — 2026-07-24";
const action = "kb.operational-amendment.record";
const resourceId = `${slug}:complete-snapshot-reconnect-recovery`;
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
  req: new Request("http://localhost/internal/kb-clob-event-ofi-snapshot-recovery-backoff"),
};
const caller = appRouter.createCaller(ctx);

if (
  CLOB_EVENT_OFI_TAPE.version !== "updown-clob-event-ofi-tape-v1"
  || CLOB_EVENT_OFI_TAPE.minCoverage !== 0.95
  || AUTHORITATIVE_TRADE_FLOW_TAPE.currentBookInitGraceMs !== 15_000
  || AUTHORITATIVE_TRADE_FLOW_TAPE.reconnectStableMs !== 60_000
  || AUTHORITATIVE_TRADE_FLOW_TAPE.subscriptionLeadMs !== 60_000
  || !tradeFlowCurrentSnapshotsReady(24, 24)
  || tradeFlowCurrentSnapshotsReady(24, 23)
  || tradeFlowCurrentSnapshotsReady(0, 0)
) {
  throw new Error("refusing to document an unexpected snapshot-recovery contract");
}

const existing = await caller.kb.get({ slug });
if (!existing?.body.includes(preregistrationMarker)) {
  throw new Error(`missing CLOB event-OFI preregistration ${slug}`);
}

let evidence: Awaited<ReturnType<typeof clobEventOfiTapeStatus>> | null = null;
if (!existing.body.includes(marker)) {
  evidence = await clobEventOfiTapeStatus();
  assertOutcomeBlindClobEventStatus(evidence);
  if (
    evidence.buckets.length !== 12
    || evidence.eligibleRows <= 0
    || evidence.usableRows <= 0
    || evidence.operationalCoverage.eligibleRows <= 0
    || evidence.operationalCoverage.coverage == null
  ) {
    throw new Error(`refusing incomplete reconnect-recovery evidence: ${JSON.stringify(evidence)}`);
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
  const operational = evidence.operationalCoverage;
  const operationalCoverage = operational.coverage;
  if (operationalCoverage == null) {
    throw new Error("refusing reconnect-recovery record without operational coverage");
  }

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
      `Recorded ${new Date().toISOString()} after tests passed and before deploying the recovery correction.`,
      "",
      `- Pre-deploy readiness was ${evidence.usableRows.toLocaleString()} usable of ${evidence.eligibleRows.toLocaleString()} eligible rows (${(evidence.coverage * 100).toFixed(1)}% cumulative). The latest ${operational.windowMin}-minute window was ${operational.usableRows}/${operational.eligibleRows} (${(operationalCoverage * 100).toFixed(1)}%), below the frozen ${(CLOB_EVENT_OFI_TAPE.minCoverage * 100).toFixed(0)}% floor. All twelve asset/timeframe buckets remained present.`,
      "- Worker telemetry isolated repeated abnormal code-1006 closes. Fully initialized connections were still required to survive 60 seconds before reconnect debt reset, so several routine short-lived closes compounded into 8–30 second gaps.",
      "- Two concurrent, database-free five-minute probes held the exact current six-asset 5m and 15m token sets on separate 12-token sockets. Each saw one code-1006 close, 29/29 PING/PONG, one fully initialized connection in under 220 ms, and 99.15% uptime. The failure mode remained, but fixed two-second recovery prevented material reconnect debt.",
      "- Operational correction only: exponential reconnect debt now resets when every currently trading token has delivered a full `book` baseline. TCP-open, PONG, elapsed lifetime, partial snapshots, and an empty current set cannot reset debt. Partial/dead connections retain the existing grace, watchdog, and exponential backoff.",
      "- The correction adds no socket, subscription, poll, table, row, raw-frame retention, feature, or directional rule. Discovery, live-plus-handoff scope, event transform, receipt verifier, rolling windows, source/receipt clocks, lag limits, boundary, and every readiness floor are unchanged.",
      "- Existing gaps remain null and are never backfilled. No OFI value, quote value, feature sign, outcome, paper decision, grade, return, or performance field was inspected.",
      "- Server2 remained within the load budget during diagnosis: one-minute load 1.40 across 10 CPUs, the live worker near 9% CPU and 245 MiB, and 73 GiB free. The repair reduces reconnect initialization churn rather than adding work.",
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
  evidence,
  disposition: "deploy-complete-snapshot-reconnect-recovery",
}, null, 2));
process.exit(0);
