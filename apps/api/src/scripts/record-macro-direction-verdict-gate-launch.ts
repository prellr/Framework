/**
 * Persist the outcome-blind launch receipt for the symmetric macro-direction verdict gate.
 *
 * This inspects only prospective decision identity/timing, frozen causal macro metadata, and the
 * two fee-adjusted fills captured on the same paper row. It never reads resolution, grade, return,
 * residual, or P&L, and it cannot create or alter a paper decision.
 */
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { MACRO_BREADTH_ROUTER } from "../services/macro-breadth-router.ts";
import { MACRO_DIRECTION_CONTROLS } from "../services/macro-direction-controls.ts";
import { MACRO_DIRECTION_VERDICT_GATE } from "../services/macro-direction-verdict-gate.ts";

const slug = MACRO_DIRECTION_VERDICT_GATE.version;
const marker = "## Outcome-blind symmetric-gate launch success — 2026-07-24";
const requiredPreregistrationText =
  "## Prospective registration — symmetric macro-direction verdict v1";
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
  req: new Request("http://localhost/internal/kb-macro-direction-verdict-launch"),
};
const caller = appRouter.createCaller(ctx);
const boundary = new Date(MACRO_DIRECTION_VERDICT_GATE.evalStartMs);
const graceMs = 5 * 60_000;

if (
  MACRO_DIRECTION_VERDICT_GATE.version
    !== "updown-macro-direction-opposite-side-gate-v1"
  || boundary.toISOString() !== "2026-07-24T09:30:00.000Z"
  || MACRO_DIRECTION_CONTROLS.version !== "updown-macro-direction-controls-v1"
  || MACRO_DIRECTION_CONTROLS.macroVersion !== MACRO_BREADTH_ROUTER.version
) {
  throw new Error("macro-direction verdict launch contract does not match preregistration");
}
if (Date.now() < MACRO_DIRECTION_VERDICT_GATE.evalStartMs + graceMs) {
  throw new Error("refusing symmetric-gate launch success before the post-boundary grace window");
}

const result = await db.execute<{
  bot_key: string;
  horizon_min: number;
  rows: number;
  markets: number;
  first_window: string | Date | null;
  last_window: string | Date | null;
  first_decided: string | Date | null;
  last_decided: string | Date | null;
  wrong_pair_rows: number;
  wrong_side_rows: number;
  metadata_violations: number;
  causal_violations: number;
  paired_book_violations: number;
}>(sql`
  select
    child.bot_key,
    child.horizon_min,
    count(*)::int as rows,
    count(distinct child.condition_id)::int as markets,
    min(child.window_start) as first_window,
    max(child.window_start) as last_window,
    min(child.decided_at) as first_decided,
    max(child.decided_at) as last_decided,
    count(*) filter (
      where child.pair not in (
        'BTC-USD',
        'ETH-USD',
        'SOL-USD',
        'XRP-USD',
        'DOGE-USD',
        'BNB-USD'
      )
    )::int as wrong_pair_rows,
    count(*) filter (
      where child.side is distinct from case
        when child.bot_key = ${MACRO_DIRECTION_CONTROLS.upBotKey} then 'up'
        else 'down'
      end
    )::int as wrong_side_rows,
    count(*) filter (
      where (
        child.model_meta->>'version'
          is distinct from ${MACRO_DIRECTION_CONTROLS.version}
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
      where case
      when (
        jsonb_typeof(child.model_meta->'macroBreadth'->'asOfMs') = 'number'
        and jsonb_typeof(child.model_meta->'macroBreadth'->'completedAtMs') = 'number'
        and jsonb_typeof(child.model_meta->'macroBreadth'->'evaluatedAtMs') = 'number'
        and jsonb_typeof(child.model_meta->'macroBreadth'->'ageSec') = 'number'
      ) then not (
        (child.model_meta->'macroBreadth'->>'completedAtMs')::bigint
          = floor(extract(epoch from child.window_start) * 1000)::bigint
        and (child.model_meta->'macroBreadth'->>'asOfMs')::bigint
          = floor(extract(epoch from child.window_start) * 1000)::bigint
            - ${MACRO_BREADTH_ROUTER.barMs}
        and (child.model_meta->'macroBreadth'->>'ageSec')::double precision
          between 0 and ${MACRO_BREADTH_ROUTER.maxCompletedBarAgeSec}
        and (child.model_meta->'macroBreadth'->>'evaluatedAtMs')::bigint
          >= (child.model_meta->'macroBreadth'->>'completedAtMs')::bigint
        and (child.model_meta->'macroBreadth'->>'evaluatedAtMs')::bigint
          <= floor(extract(epoch from child.decided_at) * 1000)::bigint
        and (
          (child.model_meta->'macroBreadth'->>'evaluatedAtMs')::bigint
          - (child.model_meta->'macroBreadth'->>'completedAtMs')::bigint
        ) between 0 and ${MACRO_BREADTH_ROUTER.maxCompletedBarAgeSec * 1_000}
        and abs(
          (
            (child.model_meta->'macroBreadth'->>'evaluatedAtMs')::bigint
            - (child.model_meta->'macroBreadth'->>'completedAtMs')::bigint
          )::double precision / 1000
          - (child.model_meta->'macroBreadth'->>'ageSec')::double precision
        ) <= 0.001
        and (
          extract(epoch from child.decided_at)
          - (child.model_meta->'macroBreadth'->>'completedAtMs')::double precision / 1000
        ) between 0 and ${MACRO_BREADTH_ROUTER.maxCompletedBarAgeSec + 2}
      )
      else true
      end
    )::int as causal_violations,
    count(*) filter (
      where case
      when (
        jsonb_typeof(child.model_meta->'bookExecution'->'totalBudgetUsd') = 'number'
        and jsonb_typeof(
          child.model_meta->'bookExecution'->'up'->'effectiveVwap'
        ) = 'number'
        and jsonb_typeof(
          child.model_meta->'bookExecution'->'down'->'effectiveVwap'
        ) = 'number'
        and jsonb_typeof(
          child.model_meta->'bookExecution'->'up'->'totalCostUsd'
        ) = 'number'
        and jsonb_typeof(
          child.model_meta->'bookExecution'->'down'->'totalCostUsd'
        ) = 'number'
        and child.control_ask_paid is not null
      ) then not coalesce((
        child.model_meta->'bookExecution'->>'version'
          = 'fee-adjusted-total-budget-v1'
        and child.model_meta->'bookExecution'->'up'->>'version'
          = 'fee-adjusted-total-budget-v1'
        and child.model_meta->'bookExecution'->'down'->>'version'
          = 'fee-adjusted-total-budget-v1'
        and jsonb_typeof(child.model_meta->'bookExecution'->'fee') = 'object'
        and (child.model_meta->'bookExecution'->>'totalBudgetUsd')::double precision = 5
        and (child.model_meta->'bookExecution'->'up'->>'effectiveVwap')::double precision
          > 0.02
        and (child.model_meta->'bookExecution'->'up'->>'effectiveVwap')::double precision
          < 0.98
        and (child.model_meta->'bookExecution'->'down'->>'effectiveVwap')::double precision
          > 0.02
        and (child.model_meta->'bookExecution'->'down'->>'effectiveVwap')::double precision
          < 0.98
        and abs(
          (child.model_meta->'bookExecution'->'up'->>'totalCostUsd')::double precision
          - 5
        ) <= 0.00000001
        and abs(
          (child.model_meta->'bookExecution'->'down'->>'totalCostUsd')::double precision
          - 5
        ) <= 0.00000001
        and abs(
          child.ask_paid - case
            when child.side = 'up'
              then (child.model_meta->'bookExecution'->'up'->>'effectiveVwap')::double precision
            else (child.model_meta->'bookExecution'->'down'->>'effectiveVwap')::double precision
          end
        ) < 0.000000001
        and abs(
          child.control_ask_paid
            - (child.model_meta->'bookExecution'->'down'->>'effectiveVwap')::double precision
        ) < 0.000000001
      ), false)
      else true
      end
    )::int as paired_book_violations
  from paper_trade child
  where child.bot_key in (
    ${MACRO_DIRECTION_CONTROLS.upBotKey},
    ${MACRO_DIRECTION_CONTROLS.downBotKey}
  )
    and child.window_start >= ${boundary}
  group by child.bot_key, child.horizon_min
  order by child.bot_key, child.horizon_min
`);

const expectedCohorts = (
  [MACRO_DIRECTION_CONTROLS.upBotKey, MACRO_DIRECTION_CONTROLS.downBotKey] as const
).flatMap((botKey) =>
  ([5, 15] as const).map((horizonMin) => ({ botKey, horizonMin }))
);
const byCohort = new Map(
  result.rows.map((row) => [`${row.bot_key}:${Number(row.horizon_min)}`, row] as const),
);
const checksByCohort = Object.fromEntries(expectedCohorts.map(({ botKey, horizonMin }) => {
  const evidence = byCohort.get(`${botKey}:${horizonMin}`);
  const firstWindowMs = evidence?.first_window == null
    ? null
    : new Date(evidence.first_window).getTime();
  const firstDecidedMs = evidence?.first_decided == null
    ? null
    : new Date(evidence.first_decided).getTime();
  return [`${botKey}:${horizonMin}`, {
    hasRows: Number(evidence?.rows ?? 0) > 0,
    uniqueMarketRows: Number(evidence?.rows ?? 0) === Number(evidence?.markets ?? 0),
    noEarlyWindow:
      firstWindowMs != null && firstWindowMs >= MACRO_DIRECTION_VERDICT_GATE.evalStartMs,
    noEarlyDecision:
      firstDecidedMs != null && firstDecidedMs >= MACRO_DIRECTION_VERDICT_GATE.evalStartMs,
    frozenPairs: Number(evidence?.wrong_pair_rows ?? 0) === 0,
    frozenSide: Number(evidence?.wrong_side_rows ?? 0) === 0,
    frozenMetadata: Number(evidence?.metadata_violations ?? 0) === 0,
    causalMacro: Number(evidence?.causal_violations ?? 0) === 0,
    sameRowPairedBook: Number(evidence?.paired_book_violations ?? 0) === 0,
  }];
}));
const checks = {
  exactVersion:
    MACRO_DIRECTION_VERDICT_GATE.version
      === "updown-macro-direction-opposite-side-gate-v1",
  exactBoundary: boundary.toISOString() === "2026-07-24T09:30:00.000Z",
  allFourCohortsObserved: expectedCohorts.every(({ botKey, horizonMin }) =>
    byCohort.has(`${botKey}:${horizonMin}`)
  ),
  onlyRegisteredCohortsObserved:
    result.rows.length === expectedCohorts.length
    && result.rows.every((row) =>
      expectedCohorts.some(({ botKey, horizonMin }) =>
        row.bot_key === botKey && Number(row.horizon_min) === horizonMin
      )
    ),
  perCohort: checksByCohort,
};
if (
  !checks.exactVersion
  || !checks.exactBoundary
  || !checks.allFourCohortsObserved
  || !checks.onlyRegisteredCohortsObserved
  || !Object.values(checksByCohort).every((cohortChecks) =>
    Object.values(cohortChecks).every(Boolean)
  )
) {
  throw new Error(`macro-direction verdict launch audit failed: ${JSON.stringify(checks)}`);
}

const existing = await caller.kb.get({ slug });
if (!existing) throw new Error(`missing preregistered KB article ${slug}`);
if (!existing.body.includes(requiredPreregistrationText)) {
  throw new Error("missing symmetric macro-direction verdict preregistration marker");
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
  const evidenceLines = expectedCohorts.map(({ botKey, horizonMin }) => {
    const row = byCohort.get(`${botKey}:${horizonMin}`)!;
    return `- \`${botKey}:${horizonMin}\`: ${Number(row.rows).toLocaleString()} rows across ${Number(row.markets).toLocaleString()} unique markets; first window ${new Date(row.first_window!).toISOString()}; first decision ${new Date(row.first_decided!).toISOString()}.`;
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
      `Recorded ${new Date().toISOString()} after all four frozen cohorts produced post-boundary rows.`,
      "",
      ...evidenceLines,
      "- Every row is in the frozen universe, carries a causally aligned completed macro bar, and contains valid UP and DOWN fee-adjusted $5 fills from the same stored book-execution record.",
      "- The selected ask matches the selected-side fill and the existing control ask matches the DOWN fill exactly. The symmetric evaluator can therefore obtain the opposite side without another fetch or timestamp.",
      "- This launch receipt inspected no resolution, grade, return, residual, or P&L.",
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
  evidence: Object.fromEntries(expectedCohorts.map(({ botKey, horizonMin }) => {
    const row = byCohort.get(`${botKey}:${horizonMin}`)!;
    return [`${botKey}:${horizonMin}`, {
      rows: Number(row.rows),
      markets: Number(row.markets),
      firstWindow: new Date(row.first_window!).toISOString(),
      lastWindow: new Date(row.last_window!).toISOString(),
      firstDecided: new Date(row.first_decided!).toISOString(),
      lastDecided: new Date(row.last_decided!).toISOString(),
    }];
  })),
}, null, 2));
process.exit(0);
