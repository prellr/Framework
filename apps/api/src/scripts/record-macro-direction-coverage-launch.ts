/**
 * Persist the post-grace launch audit for macro-direction opportunity coverage.
 *
 * Reads only frozen metadata, market identifiers, timestamps, and child-row presence. It never
 * reads resolutions, grades, fills, returns, residuals, or P&L.
 */
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { MACRO_DIRECTION_CONTROLS } from "../services/macro-direction-controls.ts";
import { MACRO_DIRECTION_COVERAGE } from "../services/macro-direction-coverage.ts";

const slug = MACRO_DIRECTION_CONTROLS.version;
const requiredMarker = "## Prospective instrumentation — macro-direction opportunity coverage v1";
const marker = "## Outcome-blind opportunity coverage launch — 2026-07-24";
const action = "kb.launch-audit.record";
const resourceId = `${MACRO_DIRECTION_COVERAGE.version}:launch-success`;
const launchAfterMs = MACRO_DIRECTION_COVERAGE.evalStartMs + 15 * 60_000;
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
  req: new Request("http://localhost/internal/kb-macro-direction-coverage-launch"),
};
const caller = appRouter.createCaller(ctx);
const boundary = new Date(MACRO_DIRECTION_COVERAGE.evalStartMs);

if (
  MACRO_DIRECTION_COVERAGE.version !== "updown-macro-direction-coverage-v1"
  || boundary.toISOString() !== "2026-07-24T12:20:00.000Z"
  || launchAfterMs !== Date.parse("2026-07-24T12:35:00.000Z")
) {
  throw new Error("macro-direction coverage launch contract does not match registration");
}
if (Date.now() < launchAfterMs) {
  throw new Error("refusing macro-direction coverage launch audit before both horizons have a window");
}

const evidenceResult = await db.execute<{
  horizon_min: number;
  eligible_rows: number;
  available_rows: number;
  unavailable_rows: number;
  expected_rows: number;
  placed_rows: number;
  missing_rows: number;
  unexpected_rows: number;
  integrity_violations: number;
  first_window: Date | string | null;
  first_evaluated_at_ms: string | number | null;
  pre_boundary_metadata_rows: number;
}>(sql`
  with parents as (
    select
      condition_id,
      pair,
      horizon_min,
      window_start,
      model_meta->'macroDirectionCoverage' as coverage,
      (model_meta->'macroDirectionCoverage'->>'available')::boolean as available,
      (model_meta->'macroDirectionCoverage'->>'causalAligned')::boolean as causal_aligned,
      model_meta->'macroDirectionCoverage'->>'state' as macro_state,
      model_meta->'macroDirectionCoverage'->>'expectedChildKey' as expected_child_key
    from paper_trade
    where bot_key = ${MACRO_DIRECTION_COVERAGE.denominatorBotKey}
      and window_start >= ${boundary}
      and model_meta->'macroDirectionCoverage'->>'version'
        = ${MACRO_DIRECTION_COVERAGE.version}
  ),
  children as (
    select condition_id, window_start, horizon_min, bot_key
    from paper_trade
    where bot_key in (
      ${MACRO_DIRECTION_CONTROLS.upBotKey},
      ${MACRO_DIRECTION_CONTROLS.downBotKey}
    )
      and window_start >= ${boundary}
  )
  select
    horizon.horizon_min,
    count(parent.condition_id)::int as eligible_rows,
    count(parent.condition_id) filter (where parent.available)::int as available_rows,
    count(parent.condition_id) filter (where not parent.available)::int as unavailable_rows,
    count(parent.condition_id) filter (
      where parent.expected_child_key is not null
    )::int as expected_rows,
    count(child.condition_id) filter (
      where parent.expected_child_key is not null
    )::int as placed_rows,
    (
      count(parent.condition_id) filter (
        where parent.expected_child_key is not null
      )
      - count(child.condition_id) filter (
        where parent.expected_child_key is not null
      )
    )::int as missing_rows,
    (
      select count(*)::int
      from children candidate
      left join parents denominator
        on denominator.condition_id = candidate.condition_id
        and denominator.window_start = candidate.window_start
        and denominator.horizon_min = candidate.horizon_min
      where candidate.horizon_min = horizon.horizon_min
        and denominator.expected_child_key is distinct from candidate.bot_key
    ) as unexpected_rows,
    count(parent.condition_id) filter (
      where parent.pair not in (
          'BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'DOGE-USD', 'BNB-USD'
        )
        or (parent.coverage->>'evaluatedAtMs')::bigint < ${MACRO_DIRECTION_COVERAGE.evalStartMs}
        or (parent.coverage->>'windowStartMs')::bigint
          <> floor(extract(epoch from parent.window_start) * 1000)::bigint
        or parent.coverage->>'macroVersion' is distinct from ${MACRO_DIRECTION_COVERAGE.macroVersion}
        or (
          parent.available
          and (
            parent.macro_state not in ('up', 'down', 'range', 'neutral')
            or parent.coverage->>'completedAtMs' is null
          )
        )
        or (
          not parent.available
          and (
            parent.macro_state is not null
            or parent.coverage->>'completedAtMs' is not null
            or parent.causal_aligned
          )
        )
        or parent.causal_aligned is distinct from coalesce(
          (parent.coverage->>'completedAtMs')::bigint
            = floor(extract(epoch from parent.window_start) * 1000)::bigint,
          false
        )
        or parent.expected_child_key is distinct from case
          when parent.causal_aligned and parent.macro_state = 'up'
            then ${MACRO_DIRECTION_CONTROLS.upBotKey}
          when parent.causal_aligned and parent.macro_state = 'down'
            then ${MACRO_DIRECTION_CONTROLS.downBotKey}
          else null
        end
    )::int as integrity_violations,
    min(parent.window_start) as first_window,
    min((parent.coverage->>'evaluatedAtMs')::bigint) as first_evaluated_at_ms,
    (
      select count(*)::int
      from paper_trade historical
      where historical.window_start < ${boundary}
        and historical.model_meta->'macroDirectionCoverage'->>'version'
          = ${MACRO_DIRECTION_COVERAGE.version}
    ) as pre_boundary_metadata_rows
  from (values (5), (15)) as horizon(horizon_min)
  left join parents parent
    on parent.horizon_min = horizon.horizon_min
  left join children child
    on child.condition_id = parent.condition_id
    and child.window_start = parent.window_start
    and child.horizon_min = parent.horizon_min
    and child.bot_key = parent.expected_child_key
  group by horizon.horizon_min
  order by horizon.horizon_min
`);

const evidence = evidenceResult.rows;
const checks = {
  bothHorizonsObserved:
    evidence.length === 2 && evidence.every((row) => Number(row.eligible_rows) > 0),
  exactAccounting: evidence.every(
    (row) =>
      Number(row.available_rows) + Number(row.unavailable_rows)
        === Number(row.eligible_rows),
  ),
  noIntegrityViolations: evidence.every((row) => Number(row.integrity_violations) === 0),
  noMissingChildren: evidence.every((row) => Number(row.missing_rows) === 0),
  noUnexpectedChildren: evidence.every((row) => Number(row.unexpected_rows) === 0),
  noPreBoundaryMetadata:
    evidence.every((row) => Number(row.pre_boundary_metadata_rows) === 0),
};
if (!Object.values(checks).every(Boolean)) {
  throw new Error(
    `macro-direction coverage launch audit failed: ${JSON.stringify({ checks, evidence })}`,
  );
}

const existing = await caller.kb.get({ slug });
if (!existing?.body.includes(requiredMarker)) {
  throw new Error(`missing macro-direction coverage preregistration ${slug}`);
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
  const evidenceLines = evidence.map((row) =>
    `- ${Number(row.horizon_min)}m: ${Number(row.eligible_rows)} denominator rows; ${Number(row.available_rows)} available / ${Number(row.unavailable_rows)} unavailable; ${Number(row.placed_rows)}/${Number(row.expected_rows)} expected children present; ${Number(row.missing_rows)} missing and ${Number(row.unexpected_rows)} unexpected.`
  );
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
      `Recorded ${new Date().toISOString()} after both frozen horizons produced prospective denominator rows.`,
      "",
      ...evidenceLines,
      "- Every row is in the frozen six-asset scope, starts at or after the registered boundary, and has internally consistent availability, completed-bar alignment, state, and expected-child metadata.",
      "- Launch success authorizes continued paper instrumentation only. It changes no strategy, result disclosure, verdict floor, or execution constraint.",
      "- This audit inspected no resolution, grade, fill result, return, residual, or P&L.",
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
  version: MACRO_DIRECTION_COVERAGE.version,
  boundary: boundary.toISOString(),
  checks,
  evidence,
}, null, 2));
process.exit(0);
