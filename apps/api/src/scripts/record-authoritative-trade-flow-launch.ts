/**
 * Idempotently record the authoritative taker-flow launch proof in the Jester knowledge base.
 *
 * Run only after both authoritative trade-flow audits pass. The status query is outcome-blind and
 * the receipt facts below are public chain evidence from the independently reverified launch row.
 */
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { authoritativeTradeFlowTapeStatus } from "../services/polymarket-trade-flow-report.ts";

const slug = "polymarket-authoritative-taker-flow-tape-v1";
const marker = "## Launch evidence — 2026-07-23 20:00 UTC";
const exceptionMarker = "### First fail-closed receipt exception";
const capacityMarker = "### Outcome-blind verifier capacity correction — 2026-07-23";
const storageMarker = "### Raw-tape storage budget — 2026-07-23";
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
  req: new Request("http://localhost/internal/kb-launch-audit"),
};
const caller = appRouter.createCaller(ctx);
const ensureAudit = async (action: string) => {
  const [existing] = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(and(
      eq(auditLogs.action, action),
      eq(auditLogs.resourceType, "kbArticle"),
      eq(auditLogs.resourceId, slug),
    ))
    .limit(1);
  if (existing) return false;
  await audit(ctx, action, {
    resourceType: "kbArticle",
    resourceId: slug,
  });
  return true;
};
const ensureLaunchAudit = () => ensureAudit("kb.launch-evidence.record");
const ensureCapacityAudit = () => ensureAudit("kb.operational-amendment.record");
const ensureStorageAudit = () => ensureAudit("kb.storage-amendment.record");
const article = await caller.kb.get({ slug });
if (!article) throw new Error(`KB article not found: ${slug}`);
if (!categories.includes(article.category as typeof categories[number])) {
  throw new Error(`invalid KB category: ${article.category}`);
}
if (!statuses.includes(article.status as typeof statuses[number])) {
  throw new Error(`invalid KB status: ${article.status}`);
}

const status = await authoritativeTradeFlowTapeStatus();
if (
  status.rawEvents <= 0
  || status.verifiedEvents <= 0
  || status.distinctMarkets <= 0
  || status.mappingViolations !== 0
) {
  throw new Error("launch status is not safe to record");
}
const storageResult = await db.execute(sql`
  select
    count(*) filter (where created_at >= now() - interval '15 minutes')::integer as rows_15m,
    pg_total_relation_size('polymarket_trade_flow_event')::bigint as total_bytes
  from polymarket_trade_flow_event
`);
const storageSnapshot = storageResult.rows[0] as {
  rows_15m?: number | string;
  total_bytes?: number | string;
} | undefined;
const rows15m = Number(storageSnapshot?.rows_15m ?? 0);
const totalBytes = Number(storageSnapshot?.total_bytes ?? 0);
if (!(rows15m > 0) || !(totalBytes > 0)) {
  throw new Error("raw-tape storage snapshot is unavailable");
}
const bytesPerRow = totalBytes / status.rawEvents;
const projectedBytesPerDay = rows15m * 96 * bytesPerRow;
const gib = (bytes: number) => (bytes / 1024 ** 3).toFixed(2);
const capacityBody = [
  capacityMarker,
  "",
  "- The fail-closed health guard exposed a verifier-throughput bottleneck while collection remained fresh: the five-minute arrival rate was 588 raw events/minute against a configured maximum of 600 receipt checks/minute.",
  "- At detection the queue held 2,026 pending rows, including 383 older than the 180-second health limit; the oldest was 221 seconds. Readiness stayed closed and Strategy Lab showed the unhealthy state.",
  "- Operational correction only: receipt-verification batch size increased from 100 to 200 while the 10-second cadence, 20-confirmation finality rule, receipt reconciliation, frozen readiness floors, and absence of a directional rule all remained unchanged. Capacity is now 20 checks/second.",
  "- Server-load guard: the verifier now defers a whole cycle when one-minute host load reaches 0.75 per available CPU and emits bounded five-minute batch-size, hash-count, duration, and normalized-load telemetry. Deferred work remains visible through pending-age health, so load shedding cannot silently pass readiness.",
  "- Clean-baseline check: five stale one-off audit test containers were stopped without touching production services. Server2 then showed load 1.11 on 10 cores, 69% memory free, no swap, worker CPU 7–18%, and Postgres generally below 5% with one 14% pulse during a 20-second sample.",
  `- Post-correction check: old pending ${status.operationalHealth.oldPendingEvents}, oldest pending ${status.operationalHealth.oldestPendingAgeSec.toFixed(1)}s, p99 ingestion ${status.operationalHealth.p99IngestionLatencyMs == null ? "unavailable" : `${status.operationalHealth.p99IngestionLatencyMs.toFixed(0)}ms`}, hash coverage ${(status.hashCoverage * 100).toFixed(2)}%, terminal verification ${(status.chainVerificationRate * 100).toFixed(2)}%, operational health ${status.operationalHealth.healthy ? "PASS" : "FAIL"}.`,
  "- Production service tests, the paper-only/outcome-blind safety audit, and an independent official-exchange receipt proof all passed after the correction. No trade direction, price distribution, outcome, or P&L was inspected.",
].join("\n");
const storageBody = [
  storageMarker,
  "",
  `- Measured snapshot: ${status.rawEvents.toLocaleString()} raw events occupy ${gib(totalBytes)} GiB including indexes; ${rows15m.toLocaleString()} rows arrived in the latest 15 minutes.`,
  `- At the measured row size and recent arrival rate, projected growth is about ${gib(projectedBytesPerDay)} GiB/day and ${gib(projectedBytesPerDay * 7)} GiB over the frozen seven-day span.`,
  "- Server2 had 74 GiB host-disk headroom at this rollout check, so the frozen collection floor is comfortably covered. Indefinite unbounded retention is not.",
  "- No raw event may be pruned before every frozen readiness floor passes. Any later partition, archive, compression, or retention change must preserve the prospective evidence and be separately documented; no automatic destructive cleanup was enabled.",
  "- The decision-funnel tape is a separate bounded relation: at most 12 unique rows per five-minute cycle, negligible beside raw trade flow. CPU shedding remains governed by the independent 0.75 normalized-load verifier guard.",
  "- This budget uses only row counts, timestamps, and relation size. No direction distribution, price distribution, market outcome, grade, or P&L was inspected.",
].join("\n");
if (article.body.includes(marker)) {
  const recordFirstException =
    status.revertedEvents > 0 && !article.body.includes(exceptionMarker);
  const recordCapacityCorrection = !article.body.includes(capacityMarker);
  const recordStorageBudget = !article.body.includes(storageMarker);
  const additions: string[] = [];
  if (recordFirstException) {
    additions.push([
      exceptionMarker,
      "",
      "- The first genuine fail-closed exception arrived at 2026-07-23T20:10:03.948Z: BTC-USD 5m transaction `0xa9b4697dc7e5e8a28960397532c3ad0da703414edd98c0ccc12f1857b498617a`.",
      "- Polygon returned receipt status `0x0`; at 27 confirmations the collector classified the stream event as `reverted`, did not count it as verified flow, and surfaced it as a receipt failure in Strategy Lab.",
      `- At this record check the tape had ${status.revertedEvents} reversion(s), ${status.mismatchEvents} mismatches, and terminal verification ${(status.chainVerificationRate * 100).toFixed(2)}%. This is settlement-integrity evidence, not an outcome or performance observation.`,
    ].join("\n"));
  }
  if (recordCapacityCorrection) additions.push(capacityBody);
  if (recordStorageBudget) additions.push(storageBody);
  if (additions.length > 0) {
    await caller.kb.upsert({
      slug,
      title: article.title,
      category: article.category as typeof categories[number],
      tags: article.tags ?? undefined,
      body: `${article.body.trim()}\n\n${additions.join("\n\n")}`,
      sources: Array.isArray(article.sources)
        ? article.sources.filter((source): source is { title: string; url: string } =>
            !!source
            && typeof source === "object"
            && typeof (source as { title?: unknown }).title === "string"
            && typeof (source as { url?: unknown }).url === "string"
          )
        : undefined,
      status: article.status as typeof statuses[number],
      supersededBySlug: article.supersededBySlug,
    });
  }
  const launchAuditInserted = await ensureLaunchAudit();
  const capacityAuditInserted = await ensureCapacityAudit();
  const storageAuditInserted = await ensureStorageAudit();
  console.log(JSON.stringify({
    updated: additions.length > 0,
    launchAuditInserted,
    capacityAuditInserted,
    storageAuditInserted,
    slug,
    recorded: {
      firstFailClosedException: recordFirstException,
      verifierCapacityCorrection: recordCapacityCorrection,
      rawTapeStorageBudget: recordStorageBudget,
    },
  }));
  process.exit(0);
}

const launchBody = [
  marker,
  "",
  `Recorded ${new Date().toISOString()} after the launch audit and independent receipt audit both passed.`,
  "",
  `- Frozen boundary: ${new Date(status.evalStartMs).toISOString()}; first persisted event: ${status.firstEventAtMs == null ? "missing" : new Date(status.firstEventAtMs).toISOString()}.`,
  `- Snapshot: ${status.rawEvents.toLocaleString()} raw events, ${status.verifiedEvents.toLocaleString()} chain-verified, ${status.pendingEvents.toLocaleString()} pending finality, ${status.distinctMarkets.toLocaleString()} markets.`,
  `- Integrity: ${status.missingHashEvents} missing hashes, ${status.mismatchEvents} mismatches, ${status.revertedEvents} reversions, ${status.mappingViolations} mapping violations; hash coverage ${(status.hashCoverage * 100).toFixed(2)}%, terminal verification ${(status.chainVerificationRate * 100).toFixed(2)}%.`,
  "- Universe proof: BTC, ETH, SOL, XRP, DOGE, and BNB were present at both 5m and 15m; no pre-boundary row was present.",
  "- Hardest-case independent receipt proof: row 1183, transaction `0x9cb9795127a91830cd16825e280d84e6cc57035665eb3bd2220dce66dd4615fd`, ETH-USD 5m, official V2 CTF Exchange, 113 confirmations at audit time. Block, exchange, token, taker side, maker/taker amounts, and share quantity all matched; share difference was zero.",
  "- Representation finding: the public market stream price is quantized to the $0.01 CLOB tick, while V2 OrdersMatched carries aggregate six-decimal taker amounts. Across the first 1,100 decoded receipts, the maximum absolute difference was exactly $0.005 and the maximum share difference was zero. The reconciliation bound was corrected outcome-blind to one half-tick; 104 existing price-only failures were reclassified only after official exchange, finality, token, side, shares, and half-tick checks all passed.",
  "- Safety audit: paper-only, outcome-blind, no directional rule, read-only Polygon RPC methods only, no outcome/P&L/account/order/wallet fields or dependencies, and all database boundary/mapping checks passed.",
  "- Readiness remains closed. No taker-flow direction, price distribution, outcomes, or P&L may be inspected until every frozen count/span/coverage floor passes. Any later directional rule requires a separate future registration boundary.",
].join("\n");

const existingSources = Array.isArray(article.sources)
  ? article.sources.filter((source): source is { title: string; url: string } =>
      !!source
      && typeof source === "object"
      && typeof (source as { title?: unknown }).title === "string"
      && typeof (source as { url?: unknown }).url === "string"
    )
  : [];
const addedSources = [
  {
    title: "Polymarket CTF Exchange V2 — Events.sol",
    url: "https://github.com/Polymarket/ctf-exchange-v2/blob/main/src/exchange/mixins/Events.sol",
  },
  {
    title: "Polymarket real-time market stream",
    url: "https://docs.polymarket.com/market-data/realtime-data#market-stream",
  },
];
const sources = [...existingSources];
for (const source of addedSources) {
  if (!sources.some((existing) => existing.url === source.url)) sources.push(source);
}

await caller.kb.upsert({
  slug,
  title: article.title,
  category: article.category as typeof categories[number],
  tags: article.tags ?? undefined,
  body: `${article.body.trim()}\n\n${launchBody}\n\n${capacityBody}\n\n${storageBody}`,
  sources,
  status: article.status as typeof statuses[number],
  supersededBySlug: article.supersededBySlug,
});
const launchAuditInserted = await ensureLaunchAudit();
const capacityAuditInserted = await ensureCapacityAudit();
const storageAuditInserted = await ensureStorageAudit();
console.log(JSON.stringify({
  updated: true,
  launchAuditInserted,
  capacityAuditInserted,
  storageAuditInserted,
  slug,
  priorRevisionCount: article.revisionCount,
  recorded: {
    rawEvents: status.rawEvents,
    verifiedEvents: status.verifiedEvents,
    distinctMarkets: status.distinctMarkets,
  },
}, null, 2));
process.exit(0);
