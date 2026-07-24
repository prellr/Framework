/**
 * Idempotently preregister the outcome-free strategy × timeframe independence map.
 *
 * The script reads only a post-boundary row count. It does not inspect strategy side, outcome,
 * grade, price, fill, P&L, or any derived performance field.
 */
import { and, count, eq, gte } from "drizzle-orm";
import { auditLogs, db, paperTrades } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { PAPER_TIMEFRAME_GATE } from "../services/paper-timeframe-gate.ts";

const version = "updown-strategy-timeframe-independence-v1";
const slug = version;
const action = "kb.preregistration.record";
const resourceId = slug;
const expectedBoundary = "2026-07-24T04:00:00.000Z";
const boundary = new Date(PAPER_TIMEFRAME_GATE.evalStartMs);
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
  req: new Request("http://localhost/internal/kb-strategy-timeframe-independence"),
};
const caller = appRouter.createCaller(ctx);

if (
  PAPER_TIMEFRAME_GATE.version !== "updown-timeframe-verdict-gate-v1"
  || boundary.toISOString() !== expectedBoundary
) {
  throw new Error("strategy independence boundary does not match the timeframe gate");
}
if (Date.now() >= PAPER_TIMEFRAME_GATE.evalStartMs) {
  throw new Error("strategy independence boundary has already passed");
}

const [postBoundary] = await db
  .select({ rows: count() })
  .from(paperTrades)
  .where(gte(paperTrades.windowStart, boundary));
if (Number(postBoundary?.rows ?? 0) !== 0) {
  throw new Error("refusing preregistration: post-boundary ledger rows already exist");
}

const existing = await caller.kb.get({ slug });
if (!existing) {
  await caller.kb.upsert({
    slug,
    title: "Strategy × timeframe independence map v1",
    category: "decision",
    tags: [
      "polymarket",
      "paper-only",
      "strategy-independence",
      "timeframe",
      "outcome-free",
      "prospective",
    ],
    status: "active",
    body: [
      "# Strategy × timeframe independence map v1",
      "",
      `Preregistered ${new Date().toISOString()} for ${boundary.toISOString()}.`,
      "",
      "## Motivation and contamination boundary",
      "",
      "- Pooled 5m and 15m identities can manufacture apparent overlap between rules that do not actually share the same evaluation horizon.",
      "- Earlier overlap displays and all pre-boundary decisions are diagnostic only. The prospective map starts with the strategy × timeframe verdict-gate cohort.",
      "- This map is structural, not a performance test. It cannot promote, demote, retune, size, or route a strategy.",
      "",
      "## Frozen outcome-free contract",
      "",
      `- Version: \`${version}\`; boundary: \`${expectedBoundary}\`.`,
      "- Identity: registered paper strategy key plus frozen horizon (`5` or `15`). Assets stay pooled within that identity.",
      "- Inputs: identity key, Polymarket condition ID, and the paper side chosen. Resolution, grade, price, fill, ask, return, P&L, and control outcome are never read.",
      "- Decisions are deduplicated by identity and condition ID before comparison.",
      "- A pair is displayed after at least three shared forward markets.",
      "- Same-side means agreement at least 80%; mirrored means agreement at most 20%; otherwise the relation is mixed.",
      "- Subset overlap is shared markets divided by the smaller decision set. Dependence is subset overlap × |2 × side agreement − 1|.",
      "- Results remain descriptive. The verdict gate stays authoritative and Polymarket execution remains unavailable.",
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
  version,
  boundary: boundary.toISOString(),
  postBoundaryRows: Number(postBoundary?.rows ?? 0),
}, null, 2));
process.exit(0);
