/**
 * Record the accounting correction that retires the misleading "worst-case" label.
 *
 * This is a methodology/UI correction only. It changes no paper decision, outcome, strategy,
 * threshold, gate, or execution constraint.
 */
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, db, paperTrades } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { PAPER_ACCOUNTING } from "../services/paper-accounting.ts";
import { PAPER_GATE } from "../services/paper-floor-gate.ts";

const slug = "updown-paper-accounting-profit-stress-v1";
const marker = "## Paper accounting and legacy profit stress — v1";
const action = "kb.methodology-correction.record";

if (
  PAPER_ACCOUNTING.raw.version !== "fee-adjusted-total-budget-v1"
  || PAPER_ACCOUNTING.raw.totalOutlayUsd !== 5
  || PAPER_ACCOUNTING.raw.authoritative !== true
  || PAPER_ACCOUNTING.profitStress.winnerProfitHaircut !== 0.36
  || PAPER_ACCOUNTING.profitStress.calibrated !== false
  || PAPER_ACCOUNTING.profitStress.executionModel !== false
  || PAPER_ACCOUNTING.profitStress.verdictInput !== false
  || PAPER_ACCOUNTING.conservativeComparison.verdictInput !== true
) {
  throw new Error("paper accounting contract changed");
}

const [reconciliation] = await db
  .select({
    graded: sql<number>`count(*)::int`,
    executionMeta: sql<number>`count(*) filter (
      where ${paperTrades.modelMeta} #>> '{bookExecution,version}' = ${PAPER_ACCOUNTING.raw.version}
    )::int`,
    invalidAsk: sql<number>`count(*) filter (
      where ${paperTrades.askPaid} <= 0 or ${paperTrades.askPaid} >= 1
    )::int`,
    pnlMismatch: sql<number>`count(*) filter (
      where abs(
        ${paperTrades.pnlUsd}
        - case
            when ${paperTrades.status} = 'won'
              then (${paperTrades.sizeUsd} * (1 - ${paperTrades.askPaid})) / ${paperTrades.askPaid}
            else -${paperTrades.sizeUsd}
          end
      ) > 0.00000001
    )::int`,
  })
  .from(paperTrades)
  .where(and(
    sql`${paperTrades.status} in ('won', 'lost')`,
    sql`${paperTrades.windowStart} >= ${new Date(PAPER_GATE.evalStartMs)}`,
  ));

const graded = Number(reconciliation?.graded ?? 0);
const executionMeta = Number(reconciliation?.executionMeta ?? 0);
const invalidAsk = Number(reconciliation?.invalidAsk ?? 0);
const pnlMismatch = Number(reconciliation?.pnlMismatch ?? 0);
if (!graded || executionMeta !== graded || invalidAsk || pnlMismatch) {
  throw new Error(`paper accounting reconciliation failed: ${
    JSON.stringify({ graded, executionMeta, invalidAsk, pnlMismatch })
  }`);
}

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
  req: new Request("http://localhost/internal/kb-paper-profit-stress-semantics"),
};
const caller = appRouter.createCaller(ctx);

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
    reason: "already_recorded",
    reconciliation: { graded, executionMeta, invalidAsk, pnlMismatch },
  }, null, 2));
  process.exit(0);
}
if (existing) throw new Error(`refusing to replace existing KB article without marker: ${slug}`);

const recordedAt = new Date().toISOString();
const body = [
  marker,
  "",
  `Recorded ${recordedAt}.`,
  "",
  "### What RAW measures",
  "",
  "- RAW is the authoritative realized paper ledger. Each decision uses the fee-adjusted depth-walk VWAP for a fixed $5 total outlay captured on that decision tick, then settles the resulting contracts at $1 for a win or $0 for a loss.",
  `- Forward reconciliation found ${graded.toLocaleString()} graded rows, ${executionMeta.toLocaleString()} with the required book-execution metadata, ${invalidAsk} invalid asks, and ${pnlMismatch} P&L formula mismatches.`,
  "",
  "### What the old “worst-case” measured",
  "",
  "- Formula: losses are unchanged; positive profit from every winning trade is multiplied by 0.64.",
  "- Provenance: the 36% haircut was copied from the Cobra reference dashboard as an adverse sensitivity display. Jester has no empirical calibration supporting 36%.",
  "- It does not model latency, delayed depth, failed fills, additional slippage, settlement error, confidence bounds, or an actual extreme outcome. Calling it “worst-case” was inaccurate.",
  "- The retained display is named `Profit stress −36%`. It is legacy continuity only, not an execution model and not a verdict input.",
  "",
  "### Conservative evidence",
  "",
  "- Strategy ranking defaults to the same-tick paired control residual where that comparator exists. The gate continues to use its preregistered control residual and session-bootstrap requirements.",
  "- RAW remains the direct paper-accounting result. Profit stress remains optional context. Neither this correction nor the renamed response fields changes any frozen population or gate.",
  "- Markout evidence remains under its separate forward audit and disclosure lock. No locked markout value was read or used for this correction.",
  "",
  "### Scope",
  "",
  "- Methodology, API naming, and UI ranking-label correction only.",
  "- No signal, state, side, asset, horizon, threshold, ask, fee, size, paper row, outcome, grade, verdict, wallet, order, signature, execution path, or fund-moving state changed.",
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Paper accounting and legacy profit stress — v1",
  category: "decision",
  tags: [
    "polymarket",
    "updown",
    "paper-accounting",
    "methodology-correction",
    "verdict-gate",
    "paper-only",
  ],
  body,
  sources: [],
  status: "active",
});

console.log(JSON.stringify({
  updated: true,
  auditInserted: await ensureAudit(),
  slug,
  reconciliation: { graded, executionMeta, invalidAsk, pnlMismatch },
}, null, 2));
process.exit(0);
