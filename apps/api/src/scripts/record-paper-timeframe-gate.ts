/**
 * Idempotently preregister the strategy × timeframe verdict gate before its future boundary.
 *
 * The script reads only metadata and a post-boundary row count. It does not inspect side, outcome,
 * grade, price, P&L, or any segment value.
 */
import { and, count, eq, gte } from "drizzle-orm";
import { auditLogs, db, paperTrades } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { PAPER_TIMEFRAME_GATE } from "../services/paper-timeframe-gate.ts";

const slug = "updown-timeframe-verdict-gate-v1";
const action = "kb.preregistration.record";
const resourceId = slug;
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
  req: new Request("http://localhost/internal/kb-paper-timeframe-gate"),
};
const caller = appRouter.createCaller(ctx);

if (PAPER_TIMEFRAME_GATE.evalStartMs !== Date.parse("2026-07-24T04:00:00.000Z")) {
  throw new Error("timeframe gate executable boundary does not match the preregistration");
}
if (Date.now() >= PAPER_TIMEFRAME_GATE.evalStartMs) {
  throw new Error("timeframe gate boundary has already passed");
}

const [postBoundary] = await db
  .select({ rows: count() })
  .from(paperTrades)
  .where(gte(paperTrades.windowStart, new Date(PAPER_TIMEFRAME_GATE.evalStartMs)));
if (Number(postBoundary?.rows ?? 0) !== 0) {
  throw new Error("refusing preregistration: post-boundary ledger rows already exist");
}

const existing = await caller.kb.get({ slug });
if (!existing) {
  await caller.kb.upsert({
    slug,
    title: "Polymarket strategy × timeframe verdict gate v1",
    category: "decision",
    tags: ["polymarket", "paper-only", "verdict-gate", "timeframe", "prospective"],
    status: "active",
    body: [
      "# Strategy × timeframe verdict gate v1",
      "",
      `Preregistered ${new Date().toISOString()} for ${new Date(PAPER_TIMEFRAME_GATE.evalStartMs).toISOString()}.`,
      "",
      "## Motivation and contamination boundary",
      "",
      "- 5m and 15m contracts have different quote dynamics, opportunity counts, and resolution horizons. They are separate evaluation units.",
      "- The split was requested after pooled dashboard outcomes were visible. Therefore every earlier row is diagnostic only and permanently excluded from this gate.",
      "- This is an evaluation-only change. No strategy side, feature, threshold, fill rule, or order path changes.",
      "",
      "## Frozen contract",
      "",
      `- Version: \`${PAPER_TIMEFRAME_GATE.version}\`.`,
      "- Unit: one registered strategy × one horizon (5m or 15m). Assets remain pooled inside that fixed horizon and all asset buckets remain visible.",
      `- Floors per unit: ${PAPER_TIMEFRAME_GATE.minMarkets.toLocaleString()} observed markets, ${PAPER_TIMEFRAME_GATE.minSpanDays} days, ${PAPER_TIMEFRAME_GATE.minBets} paired executable paper bets, and ${PAPER_TIMEFRAME_GATE.sessionsNeeded} sessions with at least ${PAPER_TIMEFRAME_GATE.sessionMinBets} bets each.`,
      `- Evidence: same-tick DOWN control, cluster bootstrap over ${PAPER_TIMEFRAME_GATE.clusterMs / 60_000}-minute windows with ${PAPER_TIMEFRAME_GATE.bootIters.toLocaleString()} iterations, residual mean at least ${(PAPER_TIMEFRAME_GATE.minResidual * 100).toFixed(1)}¢, 95% lower bound above zero, and positive residual in at least ${PAPER_TIMEFRAME_GATE.sessionsNeeded} qualifying sessions.`,
      "- Rolling periods, calendar days, hours, weekdays, assets, sides, and ask bands are diagnostic slices only. They cannot promote, retune, or change a gate verdict.",
      "- Paper only. The Polymarket router exposes no execution endpoint; live remains locked behind a later human decision even after a PASS.",
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
  version: PAPER_TIMEFRAME_GATE.version,
  boundary: new Date(PAPER_TIMEFRAME_GATE.evalStartMs).toISOString(),
  postBoundaryRows: Number(postBoundary?.rows ?? 0),
}, null, 2));
process.exit(0);
