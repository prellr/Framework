/**
 * Record the pre-boundary evaluation-clock clarification for the symmetric macro-direction gate.
 *
 * This amendment reads no paper rows, feature values, outcomes, grades, returns, or performance.
 * It changes no decision rule or floor. It only freezes how the launch auditor reconciles the
 * macro observation's batch-evaluation clock with the later sequential database-insert clock.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { MACRO_BREADTH_ROUTER } from "../services/macro-breadth-router.ts";
import { MACRO_DIRECTION_VERDICT_GATE } from "../services/macro-direction-verdict-gate.ts";

const slug = MACRO_DIRECTION_VERDICT_GATE.version;
const preregistrationMarker =
  "## Prospective registration — symmetric macro-direction verdict v1";
const marker =
  "## Pre-boundary evaluation-clock clarification — 2026-07-24";
const action = "kb.preregistration.amend";
const resourceId = `${slug}:evaluation-clock`;
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
  req: new Request("http://localhost/internal/kb-macro-direction-verdict-evaluation-clock"),
};
const caller = appRouter.createCaller(ctx);
const boundary = new Date(MACRO_DIRECTION_VERDICT_GATE.evalStartMs);

if (
  MACRO_DIRECTION_VERDICT_GATE.version
    !== "updown-macro-direction-opposite-side-gate-v1"
  || boundary.toISOString() !== "2026-07-24T09:30:00.000Z"
  || MACRO_BREADTH_ROUTER.maxCompletedBarAgeSec !== 120
) {
  throw new Error("macro-direction evaluation-clock contract does not match registration");
}
if (Date.now() >= MACRO_DIRECTION_VERDICT_GATE.evalStartMs) {
  throw new Error("refusing evaluation-clock clarification after the verdict boundary");
}

const existing = await caller.kb.get({ slug });
if (!existing?.body.includes(preregistrationMarker)) {
  throw new Error(`missing symmetric macro-direction verdict preregistration ${slug}`);
}
const alreadyRecorded = existing.body.includes(marker);
if (!alreadyRecorded) {
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
      `Recorded ${new Date().toISOString()} before the frozen boundary ${boundary.toISOString()}.`,
      "",
      "- One paper-floor batch evaluates the completed BTC/ETH/SOL macro bar once, then processes the registered market books and database inserts sequentially.",
      "- `macroBreadth.ageSec` is therefore defined at the frozen batch-evaluation instant, now stored explicitly as `macroBreadth.evaluatedAtMs`; `decidedAt` remains the later row-insert instant.",
      `- The outcome-blind launch auditor requires evaluatedAtMs − completedAtMs to equal ageSec, requires evaluatedAtMs no later than decidedAt, and independently requires decidedAt − completedAtMs to remain within ${MACRO_BREADTH_ROUTER.maxCompletedBarAgeSec + 2} seconds.`,
      "- The two-second allowance applies only to timestamp serialization/scheduling at the existing 120-second freshness boundary. It is not an entry grace period and does not admit a stale macro observation.",
      "- The auditor also rejects any cohort outside macro UP/DOWN × 5m/15m.",
      "- This clarification changes no macro classifier, side, asset, timeframe, ask, entry, abstention, boundary, sample floor, residual rule, bootstrap, session requirement, paper-only constraint, or execution lock.",
      "- No paper row, feature value, market outcome, grade, return, residual, or performance field was read to make or record this amendment.",
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
  updated: !alreadyRecorded,
  auditInserted: !existingAudit,
  slug,
  marker,
  boundary: boundary.toISOString(),
}, null, 2));
process.exit(0);
