/**
 * Record the display-only multi-day RAW evidence contract before its review floor is reachable.
 *
 * This script reads no paper outcomes and changes no collector, strategy, verdict, or execution
 * setting. It only makes the interpretation boundary durable in the research knowledge base.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { PAPER_DAILY_LEDGER } from "../services/paper-daily-ledger.ts";

const slug = "updown-paper-daily-raw-evidence-v2";
const action = "kb.daily-raw-evidence-contract.record";
const resourceId = slug;
// The first eligible forward calendar day was 2026-07-23. Fourteen such completed Chicago days
// could first exist at local midnight opening 2026-08-06 (05:00 UTC under CDT).
const evidenceHardStopMs = Date.parse("2026-08-06T05:00:00.000Z");
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
  req: new Request("http://localhost/internal/kb-paper-daily-raw-evidence-v2"),
};
const caller = appRouter.createCaller(ctx);

if (
  PAPER_DAILY_LEDGER.version !== "updown-paper-daily-raw-ledger-v2"
  || PAPER_DAILY_LEDGER.timeZone !== "America/Chicago"
  || PAPER_DAILY_LEDGER.attributionClock !== "graded_at"
  || PAPER_DAILY_LEDGER.completedDayReviewFloor !== 14
  || PAPER_DAILY_LEDGER.reviewPolicy !== "descriptive_only_no_gate_effect"
) {
  throw new Error("daily RAW executable contract does not match the research record");
}

const existing = await caller.kb.get({ slug });
if (!existing && Date.now() >= evidenceHardStopMs) {
  throw new Error("refusing to create the daily RAW review contract after its evidence floor");
}
if (!existing) {
  await caller.kb.upsert({
    slug,
    title: "Polymarket daily RAW evidence contract v2",
    category: "decision",
    tags: [
      "polymarket",
      "paper-only",
      "daily-ledger",
      "multi-day",
      "forward-validation",
    ],
    status: "active",
    body: [
      "# Polymarket daily RAW evidence contract v2",
      "",
      `Recorded ${new Date().toISOString()} before the ${PAPER_DAILY_LEDGER.completedDayReviewFloor}-completed-day review floor was reachable.`,
      "",
      "## Frozen attribution",
      "",
      `- Version: \`${PAPER_DAILY_LEDGER.version}\`.`,
      `- Calendar: ${PAPER_DAILY_LEDGER.timeZone}.`,
      "- A realized result belongs to the local calendar day on which the market is graded.",
      "- PostgreSQL UTC wall-clock timestamps must be attached to UTC before conversion into the Chicago calendar.",
      "- The currently accumulating Chicago day is labeled live and excluded from completed-day sign, median, best, and worst summaries.",
      "- 5m and 15m remain separate evaluation units.",
      "",
      "## Interpretation boundary",
      "",
      `- A strategy/timeframe requires ${PAPER_DAILY_LEDGER.completedDayReviewFloor} completed Chicago days before a manual multi-day review is eligible. This covers two full weekly cycles and was not selected from a return result.`,
      "- Eligibility is not a PASS. It does not rank, promote, retune, filter, or change a strategy.",
      "- Daily positive counts, median RAW, best day, and worst day are descriptive diagnostics only.",
      "- Any hypothesis suggested by a daily pattern must be preregistered as a new child with a later forward boundary before it can collect evaluable evidence.",
      "- The existing strategy × timeframe verdict gate remains authoritative and unchanged.",
      "",
      "## Current disposition",
      "",
      "- Continue collection. Do not admit a new bot from the initial partial-day results.",
      "- Do not pool overlapping strategy rows into portfolio P&L.",
      "- Paper only. No Polymarket order, wallet, allocation, signing, or execution path is added.",
    ].join("\n"),
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
  updated: !existing,
  auditInserted: !existingAudit,
  slug,
  version: PAPER_DAILY_LEDGER.version,
  completedDayReviewFloor: PAPER_DAILY_LEDGER.completedDayReviewFloor,
  reviewPolicy: PAPER_DAILY_LEDGER.reviewPolicy,
}, null, 2));
process.exit(0);
