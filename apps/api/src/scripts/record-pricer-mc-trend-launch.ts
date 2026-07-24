/**
 * Persist the post-grace launch audit for the prospective bootstrap-MC 5m trend child.
 *
 * This script reads only registry identities, timestamps, row counts, and frozen model metadata.
 * It never reads side, ask, outcome, grade, return, residual, or P&L.
 */
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { MARKET_REGIME_V1 } from "../services/market-regime.ts";
import { PRICER_MC_5M_TREND } from "../services/pricer-mc-trend.ts";

const slug = PRICER_MC_5M_TREND.version;
const marker = "## Outcome-blind paper launch success — 2026-07-24";
const requiredPreregistrationText =
  "The child was proposed only after the Scoreboard exposed one-day bootstrap-MC 5m results";
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
  req: new Request("http://localhost/internal/kb-pricer-mc-5m-trend-launch"),
};
const caller = appRouter.createCaller(ctx);
const boundary = new Date(PRICER_MC_5M_TREND.evalStartMs);
const graceMs = 5 * 60_000;

if (
  PRICER_MC_5M_TREND.version !== "updown-pricer-mc-5m-trend-v1"
  || boundary.toISOString() !== "2026-07-24T05:00:00.000Z"
  || PRICER_MC_5M_TREND.parentKey !== "pricerMC"
  || PRICER_MC_5M_TREND.regimeVersion !== MARKET_REGIME_V1.version
) {
  throw new Error("bootstrap-MC trend executable contract does not match its preregistration");
}
if (Date.now() < PRICER_MC_5M_TREND.evalStartMs + graceMs) {
  throw new Error("refusing bootstrap-MC trend launch success before the post-boundary grace window");
}

const result = await db.execute<{
  pre_boundary_rows: number;
  post_boundary_rows: number;
  markets: number;
  first_window: string | Date | null;
  last_window: string | Date | null;
  first_decided: string | Date | null;
  last_decided: string | Date | null;
  wrong_horizon_rows: number;
  wrong_pair_rows: number;
  model_metadata_violations: number;
  orphan_parent_rows: number;
}>(sql`
  select
    count(*) filter (
      where child.window_start < ${boundary}
    )::int as pre_boundary_rows,
    count(*) filter (
      where child.window_start >= ${boundary}
    )::int as post_boundary_rows,
    count(distinct child.condition_id) filter (
      where child.window_start >= ${boundary}
    )::int as markets,
    min(child.window_start) filter (
      where child.window_start >= ${boundary}
    ) as first_window,
    max(child.window_start) filter (
      where child.window_start >= ${boundary}
    ) as last_window,
    min(child.decided_at) filter (
      where child.window_start >= ${boundary}
    ) as first_decided,
    max(child.decided_at) filter (
      where child.window_start >= ${boundary}
    ) as last_decided,
    count(*) filter (
      where child.window_start >= ${boundary}
        and child.horizon_min <> 5
    )::int as wrong_horizon_rows,
    count(*) filter (
      where child.window_start >= ${boundary}
        and child.pair not in (
          'BTC-USD',
          'ETH-USD',
          'SOL-USD',
          'XRP-USD',
          'DOGE-USD',
          'BNB-USD'
        )
    )::int as wrong_pair_rows,
    count(*) filter (
      where child.window_start >= ${boundary}
        and (
          child.model_meta->>'version' is distinct from ${PRICER_MC_5M_TREND.version}
          or child.model_meta->>'parentVersion' is distinct from ${PRICER_MC_5M_TREND.parentVersion}
          or child.model_meta->'technicalRegime'->>'version' is distinct from ${PRICER_MC_5M_TREND.regimeVersion}
          or child.model_meta->'technicalRegime'->>'label' is distinct from 'trend'
        )
    )::int as model_metadata_violations,
    count(*) filter (
      where child.window_start >= ${boundary}
        and not exists (
          select 1
          from paper_trade parent
          where parent.bot_key = ${PRICER_MC_5M_TREND.parentKey}
            and parent.condition_id = child.condition_id
            and parent.window_start = child.window_start
        )
    )::int as orphan_parent_rows
  from paper_trade child
  where child.bot_key = 'pricerMC5mTrend'
`);

const evidence = result.rows[0];
const firstWindowMs = evidence?.first_window == null
  ? null
  : new Date(evidence.first_window).getTime();
const firstDecidedMs = evidence?.first_decided == null
  ? null
  : new Date(evidence.first_decided).getTime();
const checks = {
  exactVersion: PRICER_MC_5M_TREND.version === "updown-pricer-mc-5m-trend-v1",
  exactBoundary: boundary.toISOString() === "2026-07-24T05:00:00.000Z",
  emptyBeforeBoundary: Number(evidence?.pre_boundary_rows ?? 0) === 0,
  postBoundaryRows: Number(evidence?.post_boundary_rows ?? 0) > 0,
  uniqueMarketRows:
    Number(evidence?.markets ?? 0) === Number(evidence?.post_boundary_rows ?? 0),
  noEarlyWindow: firstWindowMs != null && firstWindowMs >= PRICER_MC_5M_TREND.evalStartMs,
  noEarlyDecision: firstDecidedMs != null && firstDecidedMs >= PRICER_MC_5M_TREND.evalStartMs,
  fiveMinuteOnly: Number(evidence?.wrong_horizon_rows ?? 0) === 0,
  frozenPairUniverse: Number(evidence?.wrong_pair_rows ?? 0) === 0,
  frozenModelMetadata: Number(evidence?.model_metadata_violations ?? 0) === 0,
  strictParentSubset: Number(evidence?.orphan_parent_rows ?? 0) === 0,
};
if (!Object.values(checks).every(Boolean)) {
  throw new Error(`bootstrap-MC trend launch audit failed: ${JSON.stringify({ checks, evidence })}`);
}

const existing = await caller.kb.get({ slug });
if (!existing) throw new Error(`missing preregistered KB article ${slug}`);
if (!existing.body.includes(requiredPreregistrationText)) {
  throw new Error("missing outcome-inspired provenance and contamination boundary");
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
      `- ${Number(evidence?.post_boundary_rows ?? 0).toLocaleString()} child rows across ${Number(evidence?.markets ?? 0).toLocaleString()} unique post-boundary markets.`,
      `- First eligible window ${new Date(evidence!.first_window!).toISOString()}; first decision ${new Date(evidence!.first_decided!).toISOString()}.`,
      "- Every row is 5m, belongs to the frozen six-asset universe, carries the exact child/parent/regime metadata, and has a matching parent row on the same market and window.",
      "- No child rows exist before the frozen boundary. This launch audit inspected no side, fill, outcome, grade, return, residual, or P&L.",
      "- Launch success authorizes continued paper collection only. It does not establish efficacy, relax any verdict floor, or create an execution route.",
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
  boundary: boundary.toISOString(),
  checks,
  evidence: {
    preBoundaryRows: Number(evidence?.pre_boundary_rows ?? 0),
    postBoundaryRows: Number(evidence?.post_boundary_rows ?? 0),
    markets: Number(evidence?.markets ?? 0),
    firstWindow: new Date(evidence!.first_window!).toISOString(),
    lastWindow: new Date(evidence!.last_window!).toISOString(),
    firstDecided: new Date(evidence!.first_decided!).toISOString(),
    lastDecided: new Date(evidence!.last_decided!).toISOString(),
  },
}, null, 2));
process.exit(0);
