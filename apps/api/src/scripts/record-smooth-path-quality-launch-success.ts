/**
 * Persist the post-grace launch audit for the outcome-blind Smooth Path quality tape.
 *
 * This script selects only version/bucket identities, row counts, metric nullability, timestamps,
 * and schema metadata. It never selects a metric value, direction, market outcome, grade, strategy
 * decision, return, P&L, account, position, or order.
 */
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import {
  SMOOTH_PATH_CAUSAL_DISPLACEMENT,
  SMOOTH_PATH_DISPLACEMENT,
} from "../services/smooth-path-displacement.ts";
import { SMOOTH_PATH_QUALITY_TAPE } from "../services/smooth-path-quality-tape.ts";

const slug = "updown-smooth-path-causal-displacement-v2";
const marker = "## Outcome-blind quality-tape launch success — 2026-07-24";
const requiredPreregistrationMarker = "## Prospective quality-distribution audit — 2026-07-24";
const action = "kb.launch-audit.record";
const resourceId = `${slug}:quality-launch-success-v1`;
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
  req: new Request("http://localhost/internal/kb-smooth-path-quality-launch-success"),
};
const caller = appRouter.createCaller(ctx);
const boundary = new Date(SMOOTH_PATH_QUALITY_TAPE.evalStartMs);
const graceMs = 5 * 60_000;
const expectedVersions = [
  {
    version: SMOOTH_PATH_DISPLACEMENT.version,
    botKey: "smoothPathDisplacement",
  },
  {
    version: SMOOTH_PATH_CAUSAL_DISPLACEMENT.version,
    botKey: "smoothPathCausalDisplacement",
  },
] as const;
const expectedPairs = [...SMOOTH_PATH_CAUSAL_DISPLACEMENT.pairs];

if (
  SMOOTH_PATH_QUALITY_TAPE.version !== "updown-smooth-path-quality-tape-v1"
  || boundary.toISOString() !== "2026-07-24T03:00:00.000Z"
) {
  throw new Error("Smooth Path quality executable contract does not match its preregistration");
}
if (Date.now() < SMOOTH_PATH_QUALITY_TAPE.evalStartMs + graceMs) {
  throw new Error("refusing quality launch success before the post-boundary grace window");
}

const completeMetrics = sql`
  abs_displacement_log is not null
  and path_r2 is not null
  and path_efficiency is not null
  and continuation_slope_per_sec is not null
  and continuation_fresh_log is not null
`;
const [versionResult, pairResult, integrityResult, schemaResult] = await Promise.all([
  db.execute(sql`
    select
      version,
      bot_key,
      count(*) filter (where window_start >= ${boundary})::int as post_boundary_rows,
      count(*) filter (
        where window_start >= ${boundary}
          and observed
      )::int as observed_rows,
      count(*) filter (
        where window_start >= ${boundary}
          and observed
          and ${completeMetrics}
      )::int as metric_rows,
      count(*) filter (
        where window_start >= ${boundary}
          and observed
          and not (${completeMetrics})
      )::int as incomplete_observed_rows,
      min(window_start) filter (
        where window_start >= ${boundary}
          and observed
          and ${completeMetrics}
      ) as first_metric_window,
      max(window_start) filter (
        where window_start >= ${boundary}
          and observed
          and ${completeMetrics}
      ) as last_metric_window,
      max(captured_at) filter (where window_start >= ${boundary}) as last_captured_at
    from polymarket_smooth_path_funnel
    group by version, bot_key
  `),
  db.execute(sql`
    select
      version,
      pair,
      count(*) filter (
        where window_start >= ${boundary}
          and observed
          and ${completeMetrics}
      )::int as metric_rows
    from polymarket_smooth_path_funnel
    group by version, pair
  `),
  db.execute(sql`
    select
      count(*) filter (
        where window_start < ${boundary}
          and ${completeMetrics}
      )::int as excluded_smoke_rows,
      count(*) filter (
        where window_start >= ${boundary}
          and version not in (
            ${SMOOTH_PATH_DISPLACEMENT.version},
            ${SMOOTH_PATH_CAUSAL_DISPLACEMENT.version}
          )
      )::int as unknown_version_rows,
      count(*) filter (
        where window_start >= ${boundary}
          and (
            pair not in ('BTC-USD','ETH-USD','SOL-USD','XRP-USD','DOGE-USD','BNB-USD')
            or (
              version = ${SMOOTH_PATH_DISPLACEMENT.version}
              and bot_key <> 'smoothPathDisplacement'
            )
            or (
              version = ${SMOOTH_PATH_CAUSAL_DISPLACEMENT.version}
              and bot_key <> 'smoothPathCausalDisplacement'
            )
          )
      )::int as mapping_violations
    from polymarket_smooth_path_funnel
  `),
  db.execute(sql`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'polymarket_smooth_path_funnel'
    order by ordinal_position
  `),
]);

const versionRows = versionResult.rows.map((row) => ({
  version: String(row.version),
  botKey: String(row.bot_key),
  postBoundaryRows: Number(row.post_boundary_rows ?? 0),
  observedRows: Number(row.observed_rows ?? 0),
  metricRows: Number(row.metric_rows ?? 0),
  incompleteObservedRows: Number(row.incomplete_observed_rows ?? 0),
  firstMetricWindow: row.first_metric_window == null
    ? null
    : new Date(String(row.first_metric_window)),
  lastMetricWindow: row.last_metric_window == null
    ? null
    : new Date(String(row.last_metric_window)),
  lastCapturedAt: row.last_captured_at == null
    ? null
    : new Date(String(row.last_captured_at)),
}));
const pairRows = pairResult.rows.map((row) => ({
  version: String(row.version),
  pair: String(row.pair),
  metricRows: Number(row.metric_rows ?? 0),
}));
const integrity = integrityResult.rows[0];
const nowMs = Date.now();
const forbiddenColumnTokens = [
  "direction",
  "side",
  "price",
  "outcome",
  "result",
  "grade",
  "return",
  "pnl",
  "account",
  "wallet",
  "credential",
  "order",
  "position",
];
const schemaColumns = schemaResult.rows.map((row) => String(row.column_name));
const forbiddenSchemaColumns = schemaColumns.filter((column) =>
  forbiddenColumnTokens.some((token) => column.includes(token))
);
const versionEvidence = expectedVersions.map((expected) => {
  const row = versionRows.find(
    (candidate) =>
      candidate.version === expected.version
      && candidate.botKey === expected.botKey,
  );
  const pairs = expectedPairs.map((pair) =>
    pairRows.find(
      (candidate) => candidate.version === expected.version && candidate.pair === pair,
    ) ?? { version: expected.version, pair, metricRows: 0 }
  );
  const coverage = row && row.observedRows > 0 ? row.metricRows / row.observedRows : 0;
  const spanDays = row?.firstMetricWindow && row.lastMetricWindow
    ? (row.lastMetricWindow.getTime() - row.firstMetricWindow.getTime()) / 86_400_000
    : 0;
  const weakestPairMetricRows = Math.min(...pairs.map((pair) => pair.metricRows));
  const readyForThresholdDesign = Boolean(
    row
    && row.metricRows >= SMOOTH_PATH_QUALITY_TAPE.minMetricRowsPerVersion
    && weakestPairMetricRows >= SMOOTH_PATH_QUALITY_TAPE.minMetricRowsPerPair
    && spanDays >= SMOOTH_PATH_QUALITY_TAPE.minSpanDays
    && coverage >= SMOOTH_PATH_QUALITY_TAPE.minCoverage,
  );
  return {
    ...expected,
    postBoundaryRows: row?.postBoundaryRows ?? 0,
    observedRows: row?.observedRows ?? 0,
    metricRows: row?.metricRows ?? 0,
    incompleteObservedRows: row?.incompleteObservedRows ?? 0,
    coverage,
    spanDays,
    weakestPairMetricRows,
    lastCaptureAgeSec: row?.lastCapturedAt
      ? (nowMs - row.lastCapturedAt.getTime()) / 1_000
      : null,
    sixPairsPresent: pairs.every((pair) => pair.metricRows > 0),
    readyForThresholdDesign,
  };
});
const checks = {
  exactTapeVersion: SMOOTH_PATH_QUALITY_TAPE.version === "updown-smooth-path-quality-tape-v1",
  exactBoundary: boundary.toISOString() === "2026-07-24T03:00:00.000Z",
  twoFrozenVersions: versionEvidence.length === 2
    && versionEvidence.every((version) => version.postBoundaryRows > 0),
  twelveVersionPairBuckets: versionEvidence.every((version) => version.sixPairsPresent),
  completeObservedMetrics: versionEvidence.every(
    (version) => version.observedRows > 0 && version.incompleteObservedRows === 0,
  ),
  coverageFloorAtLaunch: versionEvidence.every(
    (version) => version.coverage >= SMOOTH_PATH_QUALITY_TAPE.minCoverage,
  ),
  collectionFresh: versionEvidence.every(
    (version) =>
      version.lastCaptureAgeSec != null
      && version.lastCaptureAgeSec >= 0
      && version.lastCaptureAgeSec <= 12 * 60,
  ),
  quantilesRemainLocked: versionEvidence.every(
    (version) => !version.readyForThresholdDesign,
  ),
  excludedInstrumentationRows: Number(integrity?.excluded_smoke_rows ?? 0) > 0,
  noUnknownVersionRows: Number(integrity?.unknown_version_rows ?? -1) === 0,
  noMappingViolations: Number(integrity?.mapping_violations ?? -1) === 0,
  outcomeBlindSchema: forbiddenSchemaColumns.length === 0,
};
if (!Object.values(checks).every(Boolean)) {
  throw new Error(`Smooth Path quality launch audit failed: ${JSON.stringify({
    checks,
    versionEvidence,
    forbiddenSchemaColumns,
  })}`);
}

const existing = await caller.kb.get({ slug });
if (!existing?.body.includes(requiredPreregistrationMarker)) {
  throw new Error("missing Smooth Path quality preregistration");
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
  const evidenceLines = versionEvidence.map((version) =>
    `- ${version.version}: ${version.metricRows.toLocaleString()} complete of ${version.observedRows.toLocaleString()} observed rows (${(version.coverage * 100).toFixed(1)}%); weakest asset bucket ${version.weakestPairMetricRows.toLocaleString()}; last capture age ${version.lastCaptureAgeSec?.toFixed(1)}s.`
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
      `Recorded ${new Date().toISOString()} after the five-minute grace window.`,
      "",
      ...evidenceLines,
      `- ${Number(integrity?.excluded_smoke_rows ?? 0).toLocaleString()} pre-boundary instrumentation rows remain permanently excluded.`,
      "- All twelve frozen-version × asset buckets are populated; observed rows have complete metric nullability and current coverage exceeds 95%.",
      "- The dedicated relation still contains no outcome, direction, price, grade, P&L, account, order, or position field.",
      "- Distribution quantiles remain disclosure-locked because the frozen row, bucket, and multi-day floors are not met.",
      "- This launch result authorizes continued outcome-blind collection only. It does not select a threshold, create a strategy rule, change either frozen bot, or permit execution.",
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
  qualityTape: {
    version: SMOOTH_PATH_QUALITY_TAPE.version,
    boundary: boundary.toISOString(),
  },
  checks,
  evidence: {
    excludedSmokeRows: Number(integrity?.excluded_smoke_rows ?? 0),
    versionEvidence,
  },
}, null, 2));
process.exit(0);
