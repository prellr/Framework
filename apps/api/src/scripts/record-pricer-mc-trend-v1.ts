/**
 * Idempotently preregister the outcome-inspired bootstrap-MC 5m trend child.
 *
 * This script deliberately reads no trade side, outcome, grade, price, return, or P&L. The design
 * provenance acknowledges that earlier diagnostics were visible; all pre-boundary rows are excluded.
 */
import { and, count, eq, gte } from "drizzle-orm";
import { auditLogs, db, paperTrades } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { MARKET_REGIME_V1 } from "../services/market-regime.ts";
import { PRICER_MC_5M_TREND } from "../services/pricer-mc-trend.ts";
import { PRICER } from "../services/pricer.ts";

const slug = PRICER_MC_5M_TREND.version;
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
  req: new Request("http://localhost/internal/kb-pricer-mc-5m-trend-v1"),
};
const caller = appRouter.createCaller(ctx);
const boundary = new Date(PRICER_MC_5M_TREND.evalStartMs);

if (
  PRICER_MC_5M_TREND.version !== "updown-pricer-mc-5m-trend-v1"
  || boundary.toISOString() !== "2026-07-24T05:00:00.000Z"
  || PRICER_MC_5M_TREND.askEdge !== PRICER.askEdge
  || PRICER_MC_5M_TREND.regimeVersion !== MARKET_REGIME_V1.version
) {
  throw new Error("bootstrap-MC trend executable contract does not match its preregistration");
}
if (Date.now() >= PRICER_MC_5M_TREND.evalStartMs) {
  throw new Error("bootstrap-MC trend boundary has already passed");
}

const [[allChildRows], [postBoundary]] = await Promise.all([
  db
    .select({ rows: count() })
    .from(paperTrades)
    .where(eq(paperTrades.botKey, "pricerMC5mTrend")),
  db
    .select({ rows: count() })
    .from(paperTrades)
    .where(and(
      eq(paperTrades.botKey, "pricerMC5mTrend"),
      gte(paperTrades.windowStart, boundary),
    )),
]);
if (Number(allChildRows?.rows ?? 0) !== 0) {
  throw new Error("refusing preregistration: child ledger is not empty");
}
if (Number(postBoundary?.rows ?? 0) !== 0) {
  throw new Error("refusing preregistration: post-boundary child rows already exist");
}

const existing = await caller.kb.get({ slug });
if (!existing) {
  await caller.kb.upsert({
    slug,
    title: "Bootstrap-MC 5m completed-trend child v1",
    category: "strategy",
    tags: [
      "polymarket",
      "paper-only",
      "pricer",
      "bootstrap",
      "5m",
      "trend",
      "prospective",
    ],
    status: "active",
    body: [
      "# Bootstrap-MC 5m completed-trend child v1",
      "",
      `Preregistered ${new Date().toISOString()} for ${boundary.toISOString()}.`,
      "",
      "## Design provenance and contamination boundary",
      "",
      "- The child was proposed only after the Scoreboard exposed one-day bootstrap-MC 5m results by technical regime. That entire visible sample is hypothesis-generation data, not evidence.",
      "- Every parent or diagnostic row before the frozen boundary is permanently excluded. No historical child rows are generated or copied.",
      "- The child is intentionally a strict subset of its parent, not independent alpha. Overlap must remain visible.",
      "",
      "## Frozen executable paper rule",
      "",
      `- Version: \`${PRICER_MC_5M_TREND.version}\`; bot key: \`pricerMC5mTrend\`; parent: \`${PRICER_MC_5M_TREND.parentKey}\` / \`${PRICER_MC_5M_TREND.parentVersion}\`.`,
      `- Universe: the parent's six crypto assets, 5m only. The latest completed 5m-bar classifier must be \`${MARKET_REGIME_V1.version}\` with label exactly \`trend\` (|CMO14| ≥ ${(MARKET_REGIME_V1.trendAbsCmo * 100).toFixed(0)}%, unless the frozen compression rule takes precedence).`,
      `- Fair value: the exact parent de-meaned ${PRICER.mcPaths.toLocaleString()}-path bootstrap over at most ${PRICER.volMaxBars} recent one-minute returns.`,
      `- Entry: unchanged parent side selection and strict ${(PRICER.askEdge * 100).toFixed(0)}¢ edge over the fee-adjusted real $5 book-walk ask, with at least ${PRICER.minRemainingSec}s remaining.`,
      "- Size, one-bet-per-market uniqueness, Chainlink-preferred coherent S/K reference, model metadata, same-tick DOWN control, grading, winner haircut, and all verdict-gate floors remain unchanged.",
      "- Evaluation unit: `pricerMC5mTrend:5` under `updown-timeframe-verdict-gate-v1`. No 15m row exists.",
      "- Paper only. Registration creates no Polymarket execution route and does not authorize live trading.",
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
  boundary: boundary.toISOString(),
  allChildRows: Number(allChildRows?.rows ?? 0),
  postBoundaryRows: Number(postBoundary?.rows ?? 0),
}, null, 2));
process.exit(0);
