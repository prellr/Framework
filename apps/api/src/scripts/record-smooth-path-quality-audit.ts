/**
 * Idempotently preregister the Smooth Path outcome-blind quality-distribution audit.
 *
 * This script reads only KB/audit metadata plus direction-invariant funnel coverage counts. It
 * never reads feature values, a selected side, market resolution, grade, strategy return, or P&L.
 */
import { and, count, eq, gte, isNotNull } from "drizzle-orm";
import { auditLogs, db, polymarketSmoothPathFunnel } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { SMOOTH_PATH_QUALITY_TAPE } from "../services/smooth-path-quality-tape.ts";

const slug = "updown-smooth-path-causal-displacement-v2";
const resourceId = `${slug}:quality-audit-v1`;
const marker = "## Prospective quality-distribution audit — 2026-07-24";
const requiredOperationalMarker = "## Outcome-blind quality telemetry — 2026-07-24";
const action = "kb.preregistration.record";
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
  req: new Request("http://localhost/internal/kb-smooth-path-quality-audit"),
};
const caller = appRouter.createCaller(ctx);

const ensureAudit = async () => {
  const [existing] = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(and(
      eq(auditLogs.action, action),
      eq(auditLogs.resourceType, "kbArticle"),
      eq(auditLogs.resourceId, resourceId),
    ))
    .limit(1);
  if (existing) return false;
  await audit(ctx, action, { resourceType: "kbArticle", resourceId });
  return true;
};

if (
  SMOOTH_PATH_QUALITY_TAPE.version !== "updown-smooth-path-quality-tape-v1"
  || new Date(SMOOTH_PATH_QUALITY_TAPE.evalStartMs).toISOString()
    !== "2026-07-24T03:00:00.000Z"
) {
  throw new Error("Smooth Path quality executable contract does not match its preregistration");
}

const existing = await caller.kb.get({ slug });
if (!existing?.body.includes(requiredOperationalMarker)) {
  throw new Error("refusing quality audit without the outcome-blind telemetry record");
}
if (existing.body.includes(marker)) {
  console.log(JSON.stringify({
    updated: false,
    auditInserted: await ensureAudit(),
    slug,
    reason: "already_registered",
  }));
  process.exit(0);
}
if (Date.now() >= SMOOTH_PATH_QUALITY_TAPE.evalStartMs) {
  throw new Error("Smooth Path quality audit boundary has already passed");
}

const completeMetrics = and(
  isNotNull(polymarketSmoothPathFunnel.absDisplacementLog),
  isNotNull(polymarketSmoothPathFunnel.pathR2),
  isNotNull(polymarketSmoothPathFunnel.pathEfficiency),
  isNotNull(polymarketSmoothPathFunnel.continuationSlopePerSec),
  isNotNull(polymarketSmoothPathFunnel.continuationFreshLog),
);
const [[smoke], [postBoundary]] = await Promise.all([
  db
    .select({ rows: count() })
    .from(polymarketSmoothPathFunnel)
    .where(completeMetrics),
  db
    .select({ rows: count() })
    .from(polymarketSmoothPathFunnel)
    .where(and(
      gte(
        polymarketSmoothPathFunnel.windowStart,
        new Date(SMOOTH_PATH_QUALITY_TAPE.evalStartMs),
      ),
      completeMetrics,
    )),
]);
if (Number(postBoundary?.rows ?? 0) !== 0) {
  throw new Error("refusing preregistration: post-boundary quality rows already exist");
}

const sources = Array.isArray(existing.sources)
  ? existing.sources.filter((source): source is { title: string; url: string } =>
      !!source
      && typeof source === "object"
      && typeof (source as { title?: unknown }).title === "string"
      && typeof (source as { url?: unknown }).url === "string"
    )
  : undefined;
const body = [
  existing.body,
  "",
  marker,
  "",
  `Registered ${new Date().toISOString()} for ${new Date(SMOOTH_PATH_QUALITY_TAPE.evalStartMs).toISOString()}.`,
  "",
  `- ${Number(smoke?.rows ?? 0).toLocaleString()} metric rows collected during instrumentation are permanently excluded. No threshold was selected from their values.`,
  "- The audit reads only direction-invariant feature magnitudes and quality statistics. Counts, coverage, span, and bucket minima may remain visible while quantiles stay disclosure-locked.",
  `- Each frozen Smooth Path version independently requires ${SMOOTH_PATH_QUALITY_TAPE.minMetricRowsPerVersion.toLocaleString()} complete metric rows, ${SMOOTH_PATH_QUALITY_TAPE.minMetricRowsPerPair.toLocaleString()} rows in every asset bucket, ${SMOOTH_PATH_QUALITY_TAPE.minSpanDays} days of span, and ${(SMOOTH_PATH_QUALITY_TAPE.minCoverage * 100).toFixed(0)}% metric coverage.`,
  "- Quantiles unlock only when every floor passes for that version. Thresholds, directional relationships, outcomes, grades, strategy comparisons, and P&L remain unavailable before then.",
  "- Readiness does not authorize a rule change. Any v3 must freeze an exact transform and threshold at a later future boundary, use an independent paper bot, retain executable fee-adjusted paired-book fills, and pass the existing verdict gate.",
].join("\n");

await caller.kb.upsert({
  slug: existing.slug,
  title: existing.title,
  category: existing.category as (typeof categories)[number],
  tags: existing.tags ?? [],
  body,
  sources,
  status: existing.status as (typeof statuses)[number],
  supersededBySlug: existing.supersededBySlug ?? undefined,
});

console.log(JSON.stringify({
  updated: true,
  auditInserted: await ensureAudit(),
  slug,
  version: SMOOTH_PATH_QUALITY_TAPE.version,
  boundary: new Date(SMOOTH_PATH_QUALITY_TAPE.evalStartMs).toISOString(),
  excludedSmokeRows: Number(smoke?.rows ?? 0),
  postBoundaryRows: Number(postBoundary?.rows ?? 0),
}, null, 2));
process.exit(0);
