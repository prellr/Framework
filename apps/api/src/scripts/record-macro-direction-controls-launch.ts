/**
 * Persist the post-grace launch audit for the prospective macro-filtered UP/DOWN controls.
 *
 * This reads only bot identities, timestamps, row counts, frozen scope, causal macro metadata, and
 * matching unconditional parent presence. It never reads resolutions, grades, returns, or P&L.
 */
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { MACRO_BREADTH_ROUTER } from "../services/macro-breadth-router.ts";
import { MACRO_DIRECTION_CONTROLS } from "../services/macro-direction-controls.ts";

const slug = MACRO_DIRECTION_CONTROLS.version;
const marker = "## Outcome-blind paper launch success — 2026-07-24";
const requiredPreregistrationText =
  "## Prospective registration — macro-filtered UP/DOWN controls v1";
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
  req: new Request("http://localhost/internal/kb-macro-direction-controls-launch"),
};
const caller = appRouter.createCaller(ctx);
const boundary = new Date(MACRO_DIRECTION_CONTROLS.evalStartMs);
const graceMs = 5 * 60_000;

if (
  MACRO_DIRECTION_CONTROLS.version !== "updown-macro-direction-controls-v1"
  || boundary.toISOString() !== "2026-07-24T06:00:00.000Z"
  || MACRO_DIRECTION_CONTROLS.macroVersion !== MACRO_BREADTH_ROUTER.version
) {
  throw new Error("macro-direction control executable contract does not match its registration");
}
if (Date.now() < MACRO_DIRECTION_CONTROLS.evalStartMs + graceMs) {
  throw new Error("refusing macro-direction control launch success before the grace window");
}

const result = await db.execute<{
  bot_key: string;
  pre_boundary_rows: number;
  post_boundary_rows: number;
  markets: number;
  first_window: string | Date | null;
  last_window: string | Date | null;
  first_decided: string | Date | null;
  last_decided: string | Date | null;
  wrong_horizon_rows: number;
  wrong_pair_rows: number;
  metadata_violations: number;
  causal_alignment_violations: number;
  orphan_parent_rows: number;
}>(sql`
  select
    child.bot_key,
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
        and child.horizon_min not in (5,15)
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
          child.model_meta->>'version' is distinct from ${MACRO_DIRECTION_CONTROLS.version}
          or child.model_meta->'macroDirectionControl'->>'version'
            is distinct from ${MACRO_DIRECTION_CONTROLS.version}
          or child.model_meta->'macroBreadth'->>'version'
            is distinct from ${MACRO_DIRECTION_CONTROLS.macroVersion}
          or child.model_meta->'macroDirectionControl'->>'side'
            is distinct from case
              when child.bot_key = ${MACRO_DIRECTION_CONTROLS.upBotKey} then 'up'
              else 'down'
            end
          or child.model_meta->'macroBreadth'->>'state'
            is distinct from case
              when child.bot_key = ${MACRO_DIRECTION_CONTROLS.upBotKey} then 'up'
              else 'down'
            end
        )
    )::int as metadata_violations,
    count(*) filter (
      where child.window_start >= ${boundary}
        and (
          child.model_meta->'macroBreadth'->>'completedAtMs' is null
          or (child.model_meta->'macroBreadth'->>'completedAtMs')::bigint
            <> floor(extract(epoch from child.window_start) * 1000)::bigint
        )
    )::int as causal_alignment_violations,
    count(*) filter (
      where child.window_start >= ${boundary}
        and not exists (
          select 1
          from paper_trade parent
          where parent.bot_key = case
              when child.bot_key = ${MACRO_DIRECTION_CONTROLS.upBotKey}
                then 'alwaysUp'
              else 'drift'
            end
            and parent.condition_id = child.condition_id
            and parent.window_start = child.window_start
        )
    )::int as orphan_parent_rows
  from paper_trade child
  where child.bot_key in (
    ${MACRO_DIRECTION_CONTROLS.upBotKey},
    ${MACRO_DIRECTION_CONTROLS.downBotKey}
  )
  group by child.bot_key
  order by child.bot_key
`);

const byKey = new Map(result.rows.map((row) => [row.bot_key, row]));
const expectedKeys = [
  MACRO_DIRECTION_CONTROLS.upBotKey,
  MACRO_DIRECTION_CONTROLS.downBotKey,
] as const;
const checksByBot = Object.fromEntries(expectedKeys.map((botKey) => {
  const evidence = byKey.get(botKey);
  const firstWindowMs = evidence?.first_window == null
    ? null
    : new Date(evidence.first_window).getTime();
  const firstDecidedMs = evidence?.first_decided == null
    ? null
    : new Date(evidence.first_decided).getTime();
  return [botKey, {
    hasRows: Number(evidence?.post_boundary_rows ?? 0) > 0,
    emptyBeforeBoundary: Number(evidence?.pre_boundary_rows ?? 0) === 0,
    uniqueMarketRows:
      Number(evidence?.markets ?? 0) === Number(evidence?.post_boundary_rows ?? 0),
    noEarlyWindow:
      firstWindowMs != null && firstWindowMs >= MACRO_DIRECTION_CONTROLS.evalStartMs,
    noEarlyDecision:
      firstDecidedMs != null && firstDecidedMs >= MACRO_DIRECTION_CONTROLS.evalStartMs,
    frozenHorizons: Number(evidence?.wrong_horizon_rows ?? 0) === 0,
    frozenPairs: Number(evidence?.wrong_pair_rows ?? 0) === 0,
    frozenMetadata: Number(evidence?.metadata_violations ?? 0) === 0,
    causalAlignment: Number(evidence?.causal_alignment_violations ?? 0) === 0,
    parentPresent: Number(evidence?.orphan_parent_rows ?? 0) === 0,
  }];
}));
const checks = {
  exactVersion: MACRO_DIRECTION_CONTROLS.version === "updown-macro-direction-controls-v1",
  exactBoundary: boundary.toISOString() === "2026-07-24T06:00:00.000Z",
  bothControlsObserved: expectedKeys.every((botKey) => byKey.has(botKey)),
  perControl: checksByBot,
};
if (
  !checks.exactVersion
  || !checks.exactBoundary
  || !checks.bothControlsObserved
  || !Object.values(checksByBot).every((botChecks) =>
    Object.values(botChecks).every(Boolean)
  )
) {
  throw new Error(`macro-direction control launch audit failed: ${JSON.stringify(checks)}`);
}

const existing = await caller.kb.get({ slug });
if (!existing) throw new Error(`missing preregistered KB article ${slug}`);
if (!existing.body.includes(requiredPreregistrationText)) {
  throw new Error("missing macro-direction control prospective registration marker");
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
  const evidenceLines = expectedKeys.map((botKey) => {
    const row = byKey.get(botKey)!;
    return `- \`${botKey}\`: ${Number(row.post_boundary_rows).toLocaleString()} rows across ${Number(row.markets).toLocaleString()} unique markets; first window ${new Date(row.first_window!).toISOString()}; first decision ${new Date(row.first_decided!).toISOString()}.`;
  });
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
      `Recorded ${new Date().toISOString()} after both frozen macro states produced post-boundary rows.`,
      "",
      ...evidenceLines,
      "- Every row is in the frozen six-asset 5m/15m scope, has an exactly aligned completed macro bar, carries the exact version/state metadata, and has its matching unconditional parent row.",
      "- Zero child rows exist before the frozen boundary. This audit inspected no resolution, grade, return, residual, or P&L.",
      "- Launch success authorizes continued paper collection only. It does not establish efficacy, relax a verdict floor, or permit execution.",
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
  evidence: Object.fromEntries(expectedKeys.map((botKey) => {
    const row = byKey.get(botKey)!;
    return [botKey, {
      postBoundaryRows: Number(row.post_boundary_rows),
      markets: Number(row.markets),
      firstWindow: new Date(row.first_window!).toISOString(),
      lastWindow: new Date(row.last_window!).toISOString(),
      firstDecided: new Date(row.first_decided!).toISOString(),
      lastDecided: new Date(row.last_decided!).toISOString(),
    }];
  })),
}, null, 2));
process.exit(0);
