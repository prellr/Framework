/**
 * Persist the successful post-grace launch audit for Hyperliquid flow v2.
 *
 * This reads only version, boundary, bucket, nullability, timing, and freshness metadata. It never
 * selects flow values, market direction, outcomes, grades, strategy decisions, or P&L.
 */
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import {
  assertOutcomeBlindFlowStatus,
  hyperliquidFlowTapeStatus,
} from "../services/hyperliquid-flow-report.ts";
import { HYPERLIQUID_FLOW_TAPE } from "../services/hl-rtds.ts";

const slug = "updown-hyperliquid-taker-flow-tape-v2";
const marker = "## Outcome-blind launch success — 2026-07-24";
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
  req: new Request("http://localhost/internal/kb-hyperliquid-flow-launch-success"),
};
const caller = appRouter.createCaller(ctx);
const boundary = new Date(HYPERLIQUID_FLOW_TAPE.evalStartMs);
const graceMs = 5 * 60_000;

if (Date.now() < HYPERLIQUID_FLOW_TAPE.evalStartMs + graceMs) {
  throw new Error("refusing launch success record before the post-boundary grace window");
}

const [status, integrityResult] = await Promise.all([
  hyperliquidFlowTapeStatus(),
  db.execute(sql`
    select
      count(*) filter (
        where hl_flow_version = ${HYPERLIQUID_FLOW_TAPE.version}
      )::int as tagged_rows,
      count(*) filter (
        where hl_flow_version = ${HYPERLIQUID_FLOW_TAPE.version}
          and captured_at < ${boundary}
      )::int as pre_boundary_rows,
      count(*) filter (
        where captured_at >= ${boundary}
          and hl_flow_version is not null
          and hl_flow_version <> ${HYPERLIQUID_FLOW_TAPE.version}
      )::int as unknown_version_rows,
      count(*) filter (
        where hl_flow_version = ${HYPERLIQUID_FLOW_TAPE.version}
          and (
            pair not in ('BTC-USD','ETH-USD','SOL-USD','XRP-USD','DOGE-USD','BNB-USD')
            or horizon_min not in (5,15)
          )
      )::int as mapping_violations,
      count(*) filter (
        where hl_flow_version = ${HYPERLIQUID_FLOW_TAPE.version}
          and (
            hl_flow_imbalance_60s is null
            or hl_flow_notional_60s is null
            or hl_flow_trade_count_60s is null
            or hl_flow_max_trade_share_60s is null
            or hl_flow_source_age_sec is null
            or hl_flow_receive_age_sec is null
            or hl_flow_max_transport_lag_ms_60s is null
          )
      )::int as required_nulls,
      min(captured_at) filter (
        where hl_flow_version = ${HYPERLIQUID_FLOW_TAPE.version}
      ) as first_tagged_at,
      max(captured_at) filter (
        where hl_flow_version = ${HYPERLIQUID_FLOW_TAPE.version}
      ) as last_tagged_at
    from polymarket_state_snapshot
  `),
]);
assertOutcomeBlindFlowStatus(status);
const integrity = integrityResult.rows[0];
const taggedRows = Number(integrity?.tagged_rows ?? 0);
const checks = {
  exactVersion: status.version === HYPERLIQUID_FLOW_TAPE.version,
  exactBoundary: status.evalStartMs === HYPERLIQUID_FLOW_TAPE.evalStartMs,
  twelveBuckets: status.buckets.length === 12,
  taggedRows: taggedRows > 0,
  usableRows: status.usableRows > 0,
  healthy: status.operationalHealth.healthy,
  noPreBoundaryRows: Number(integrity?.pre_boundary_rows ?? -1) === 0,
  noUnknownVersionRows: Number(integrity?.unknown_version_rows ?? -1) === 0,
  noMappingViolations: Number(integrity?.mapping_violations ?? -1) === 0,
  noRequiredNulls: Number(integrity?.required_nulls ?? -1) === 0,
};
if (!Object.values(checks).every(Boolean)) {
  throw new Error(`Hyperliquid v2 launch audit failed: ${JSON.stringify(checks)}`);
}

const existing = await caller.kb.get({ slug });
if (!existing) throw new Error(`missing preregistered KB article ${slug}`);
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
      `- Operational health passed: last capture age ${status.operationalHealth.lastCaptureAgeSec?.toFixed(1)}s, latest included trade age ${status.operationalHealth.latestLastTradeAgeSec?.toFixed(1)}s, maximum recent transport lag ${status.operationalHealth.latestMaxTransportLagMs?.toFixed(0)}ms.`,
      "- Zero pre-boundary rows, unknown versions, universe mappings, or required-field nulls. All twelve asset × horizon buckets are present.",
      "- This launch result authorizes continued outcome-blind collection only. It does not disclose a sign, select a threshold, create a strategy rule, or permit execution.",
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
  boundary: new Date(status.evalStartMs).toISOString(),
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
