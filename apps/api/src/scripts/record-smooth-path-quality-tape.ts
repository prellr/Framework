/**
 * Idempotently record the additive, outcome-blind Smooth Path quality tape.
 *
 * This script reads only KB/audit metadata and direction-invariant funnel counts. It never reads a
 * selected side, market resolution, grade, strategy return, P&L, account, position, or order.
 */
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, db, polymarketSmoothPathFunnel } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";

const slug = "updown-smooth-path-causal-displacement-v2";
const resourceId = `${slug}:quality-tape-v1`;
const marker = "## Outcome-blind quality telemetry — 2026-07-24";
const requiredRegistrationMarker = "## Prospective registration — causal delivery v2";
const action = "kb.operational-amendment.record";
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
  req: new Request("http://localhost/internal/kb-smooth-path-quality-tape"),
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

const existing = await caller.kb.get({ slug });
if (!existing?.body.includes(requiredRegistrationMarker)) {
  throw new Error("refusing quality-tape record without the original prospective registration");
}
if (existing.body.includes(marker)) {
  console.log(JSON.stringify({
    updated: false,
    auditInserted: await ensureAudit(),
    slug,
    reason: "already_recorded",
  }));
  process.exit(0);
}

const [counts] = await db
  .select({
    rows: sql<number>`count(*)::int`,
    metricRows: sql<number>`count(*) filter (where
      ${polymarketSmoothPathFunnel.absDisplacementLog} is not null
      and ${polymarketSmoothPathFunnel.pathR2} is not null
      and ${polymarketSmoothPathFunnel.pathEfficiency} is not null
      and ${polymarketSmoothPathFunnel.continuationSlopePerSec} is not null
      and ${polymarketSmoothPathFunnel.continuationFreshLog} is not null
    )::int`,
  })
  .from(polymarketSmoothPathFunnel);

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
  `Recorded ${new Date().toISOString()} with ${Number(counts?.rows ?? 0).toLocaleString()} pre-existing funnel rows and ${Number(counts?.metricRows ?? 0).toLocaleString()} rows carrying the new quality fields.`,
  "",
  "- V1 and v2 remain frozen and unchanged. This additive tape cannot alter eligibility, a path decision, a paper insertion, grading, or gate membership.",
  "- New nullable fields retain only absolute displacement magnitude, path R², path efficiency, slope aligned to the observed displacement, and the ten-second move aligned to that displacement.",
  "- The fields are invariant to whether the market moved UP or DOWN. The relation still contains no selected side, price, outcome, grade, P&L, account, wallet, credential, order, or position.",
  "- Existing rows remain null and are not backfilled. New observations alone populate the fields, preserving the exact telemetry start boundary.",
  "- Strategy Lab may disclose only aggregate unsigned quantiles and coverage. Any v3 threshold must be chosen from those outcome-free distributions, registered at a later future boundary, assigned an independent paper bot, and evaluated through the existing verdict gate.",
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
  preExistingRows: Number(counts?.rows ?? 0),
  populatedMetricRows: Number(counts?.metricRows ?? 0),
}, null, 2));
process.exit(0);
