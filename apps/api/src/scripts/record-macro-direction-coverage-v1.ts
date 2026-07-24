/**
 * Preregister the outcome-blind opportunity tape for the macro-direction controls.
 *
 * This script runs before the future instrumentation boundary and reads no paper or outcome ledger.
 * The tape changes no decision; it makes unavailable/neutral/range opportunities distinguishable
 * from a missing child insert during later operational audits.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { MACRO_BREADTH_ROUTER } from "../services/macro-breadth-router.ts";
import { MACRO_DIRECTION_CONTROLS } from "../services/macro-direction-controls.ts";
import { MACRO_DIRECTION_COVERAGE } from "../services/macro-direction-coverage.ts";

const slug = MACRO_DIRECTION_CONTROLS.version;
const requiredMarker = "## Prospective registration — macro-filtered UP/DOWN controls v1";
const marker = "## Prospective instrumentation — macro-direction opportunity coverage v1";
const action = "kb.preregister.instrumentation";
const resourceId = `${MACRO_DIRECTION_COVERAGE.version}:preregistration`;
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
  req: new Request("http://localhost/internal/kb-macro-direction-coverage-v1"),
};
const caller = appRouter.createCaller(ctx);
const boundary = new Date(MACRO_DIRECTION_COVERAGE.evalStartMs);

if (
  MACRO_DIRECTION_COVERAGE.version !== "updown-macro-direction-coverage-v1"
  || boundary.toISOString() !== "2026-07-24T12:20:00.000Z"
  || MACRO_DIRECTION_COVERAGE.denominatorBotKey !== "drift"
  || MACRO_DIRECTION_COVERAGE.macroVersion !== MACRO_BREADTH_ROUTER.version
  || MACRO_DIRECTION_COVERAGE.controlVersion !== MACRO_DIRECTION_CONTROLS.version
) {
  throw new Error("macro-direction coverage contract does not match registration");
}
if (Date.now() >= MACRO_DIRECTION_COVERAGE.evalStartMs) {
  throw new Error("macro-direction coverage registration boundary has already passed");
}

const existing = await caller.kb.get({ slug });
if (!existing?.body.includes(requiredMarker)) {
  throw new Error(`missing macro-direction control preregistration ${slug}`);
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
      `Registered ${new Date().toISOString()} before ${boundary.toISOString()}.`,
      "",
      `- Version: \`${MACRO_DIRECTION_COVERAGE.version}\`.`,
      `- Boundary: ${boundary.toISOString()}; every earlier row is excluded.`,
      "- Denominator: one compact metadata object on the existing unconditional DOWN parent row for each newly observed valid-book market. No additional market-data poll or database row is created.",
      "- Frozen fields: evaluation tick, market window start, macro-input availability, exact completed-bar alignment, macro state, and the expected UP-only or DOWN-only child key. RANGE, NEUTRAL, unavailable, stale, and desynchronized observations expect no child.",
      "- The later operational report may expose only counts by horizon/state plus expected, placed, missing, and unexpected child counts. It may not read outcomes, grades, returns, residuals, or P&L.",
      "- This is instrumentation only. It changes no side, fill, threshold, existing verdict floor, paper-only constraint, or execution prohibition.",
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
}, null, 2));
process.exit(0);
