/**
 * Preregister the complete-set segmentation and persistence report before cost/edge disclosure.
 *
 * This script reads count/time readiness only. It never selects a book cost, edge, outcome, paper
 * decision, fill, grade, return, account, position, wallet, order, or merge instruction.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import {
  COMPLETE_SET_SEGMENTATION,
  COMPLETE_SET_TAKER_AUDIT,
  completeSetTakerReadiness,
} from "../services/complete-set-taker-audit.ts";

const slug = COMPLETE_SET_SEGMENTATION.version;
const marker = "## Complete-set segmentation and persistence plan v1";
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
  req: new Request("http://localhost/internal/kb-complete-set-segmentation-plan-v1"),
};
const caller = appRouter.createCaller(ctx);

if (
  COMPLETE_SET_SEGMENTATION.requiredBuckets !== 120
  || COMPLETE_SET_SEGMENTATION.thresholds.belowOne !== 0
  || COMPLETE_SET_SEGMENTATION.thresholds.conservativePreGas
    !== COMPLETE_SET_TAKER_AUDIT.conservativePreGasEdge
  || COMPLETE_SET_SEGMENTATION.persistenceRuns[0] !== 2
  || COMPLETE_SET_SEGMENTATION.persistenceRuns[1] !== 3
) {
  throw new Error("complete-set segmentation executable contract does not match plan");
}

// This helper is intentionally count/time only. Refuse to register after disclosure unlock without
// ever requesting the cost/edge report that would make this a retrospective slice selection.
const readiness = await completeSetTakerReadiness();
if (readiness.ready || !readiness.resultsLocked) {
  throw new Error("refusing complete-set segmentation preregistration after result disclosure");
}

const ensureAudit = async () => {
  const [existing] = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(and(
      eq(auditLogs.action, action),
      eq(auditLogs.resourceType, "kbArticle"),
      eq(auditLogs.resourceId, slug),
    ))
    .limit(1);
  if (existing) return false;
  await audit(ctx, action, { resourceType: "kbArticle", resourceId: slug });
  return true;
};

const existing = await caller.kb.get({ slug });
if (existing?.body.includes(marker)) {
  console.log(JSON.stringify({
    updated: false,
    auditInserted: await ensureAudit(),
    slug,
    reason: "already_registered",
  }, null, 2));
  process.exit(0);
}
if (existing) throw new Error(`refusing to replace existing KB article without marker: ${slug}`);

const body = [
  marker,
  "",
  `Registered ${new Date().toISOString()} while \`${COMPLETE_SET_TAKER_AUDIT.version}\` remained disclosure-locked at ${readiness.spanDays.toFixed(3)} of ${readiness.minimums.spanDays} required days.`,
  "",
  "### Frozen descriptive report",
  "",
  `- Preserve exactly ${COMPLETE_SET_SEGMENTATION.requiredBuckets} ordered asset × horizon × causal sample-minute buckets: all six assets, every minute 0–4 for 5m, and every minute 0–14 for 15m. Empty buckets remain explicit.`,
  "- For every bucket report rows, distinct markets, fee-adjusted effective-cost quantiles, cost-below-$1 rows/rate/markets, and pre-gas edge-at-least-2¢ rows/rate/markets.",
  "- For each market, compute the longest run of qualifying consecutive sample minutes. Report markets with any, at least two, and at least three consecutive observations plus the maximum run, separately for cost below $1 and pre-gas edge at least 2¢.",
  "- A minute is consecutive only when its causal sample-minute index is exactly the prior index plus one. Missing minutes break a run; rows are never imputed or backfilled.",
  "",
  "### Interpretation constraints",
  "",
  "- These fields describe synchronized public-book feasibility only. They do not establish that two independent taker orders fill atomically, that a merge succeeds, or that pre-gas edge survives gas, settlement, latency, adverse selection, inventory, partial fills, or capital lock-up.",
  "- No asset, timeframe, minute, persistence run, or edge threshold may be promoted from this report alone. Any paper candidate needs a separate exact prospective registration after disclosure, a later boundary, capacity and sequential-leg assumptions, independent 5m/15m identities, and the unchanged verdict gate.",
  "- The audit remains paper-only and public-data-only. This plan adds no key, wallet, order, approval, signature, cancellation, merge, withdrawal, funding, position, or execution path.",
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Complete-set segmentation and persistence plan v1",
  category: "research" as (typeof categories)[number],
  tags: [
    "polymarket",
    "updown",
    "complete-set",
    "execution-research",
    "segmentation",
    "paper-only",
  ],
  body,
  sources: [{
    title: "Complete-set taker parity audit",
    url: "https://jester.wisco.wine/polymarket",
  }],
  status: "active" as (typeof statuses)[number],
});

console.log(JSON.stringify({
  updated: true,
  auditInserted: await ensureAudit(),
  slug,
  prerequisiteVersion: COMPLETE_SET_TAKER_AUDIT.version,
  requiredBuckets: COMPLETE_SET_SEGMENTATION.requiredBuckets,
  readiness: {
    rows: readiness.rows,
    markets: readiness.markets,
    spanDays: readiness.spanDays,
  },
}, null, 2));
process.exit(0);
