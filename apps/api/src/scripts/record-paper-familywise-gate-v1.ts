/**
 * Preregister the frozen Holm family for the expanded Up/Down strategy tournament.
 *
 * Metadata only: this script reads no paper row, feature, side, outcome, grade, fill, price, return,
 * ranking, P&L, account, wallet, position, or order.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import {
  PAPER_FAMILYWISE_GATE,
  PAPER_FAMILYWISE_HYPOTHESES,
} from "../services/paper-familywise-gate.ts";
import { PAPER_GATE } from "../services/paper-floor-gate.ts";

const slug = PAPER_FAMILYWISE_GATE.version;
const action = "kb.preregistration.record";
const boundary = new Date(PAPER_FAMILYWISE_GATE.evalStartMs);
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
  req: new Request("http://localhost/internal/kb-paper-familywise-gate-v1"),
};
const caller = appRouter.createCaller(ctx);

const sameFloors =
  PAPER_FAMILYWISE_GATE.minMarkets === PAPER_GATE.minMarkets
  && PAPER_FAMILYWISE_GATE.minSpanDays === PAPER_GATE.minSpanDays
  && PAPER_FAMILYWISE_GATE.minBets === PAPER_GATE.minBets
  && PAPER_FAMILYWISE_GATE.minResidual === PAPER_GATE.minResidual
  && PAPER_FAMILYWISE_GATE.clusterMs === PAPER_GATE.clusterMs
  && PAPER_FAMILYWISE_GATE.bootIters === PAPER_GATE.bootIters
  && PAPER_FAMILYWISE_GATE.sessionMinBets === PAPER_GATE.sessionMinBets
  && PAPER_FAMILYWISE_GATE.sessionsNeeded === PAPER_GATE.sessionsNeeded;
if (
  PAPER_FAMILYWISE_GATE.version !== "updown-familywise-verdict-gate-v1"
  || boundary.toISOString() !== "2026-07-25T00:00:00.000Z"
  || PAPER_FAMILYWISE_GATE.correction !== "Holm"
  || PAPER_FAMILYWISE_GATE.alpha !== 0.05
  || PAPER_FAMILYWISE_GATE.minClusters !== 100
  || PAPER_FAMILYWISE_HYPOTHESES.length !== 57
  || new Set(PAPER_FAMILYWISE_HYPOTHESES).size !== 57
  || !PAPER_FAMILYWISE_HYPOTHESES.includes("pricerMC5mCobraNight:5")
  || !sameFloors
) {
  throw new Error("familywise gate executable contract does not match preregistration");
}
if (Date.now() >= PAPER_FAMILYWISE_GATE.evalStartMs) {
  throw new Error("familywise gate preregistration boundary has already passed");
}

const existing = await caller.kb.get({ slug });
if (!existing) {
  await caller.kb.upsert({
    slug,
    title: "Polymarket Up/Down familywise verdict gate v1",
    category: "decision",
    tags: [
      "polymarket",
      "updown",
      "paper-only",
      "verdict-gate",
      "multiple-testing",
      "holm",
      "prospective",
    ],
    status: "active",
    sources: [
      {
        title: "Holm (1979), A Simple Sequentially Rejective Multiple Test Procedure",
        url: "https://doi.org/10.2307/4615733",
      },
      {
        title: "R stats p.adjust — Holm strong family-wise error control",
        url: "https://stat.ethz.ch/R-manual/R-devel/library/stats/html/p.adjust.html",
      },
    ],
    body: [
      "# Polymarket Up/Down familywise verdict gate v1",
      "",
      `Preregistered ${new Date().toISOString()} for ${boundary.toISOString()}.`,
      "",
      "## Why a new gate is necessary",
      "",
      `- Jester now evaluates ${PAPER_FAMILYWISE_HYPOTHESES.length} strategy × timeframe hypotheses. Treating every nominal 95% interval as an independent promotion gate would make false discovery increasingly likely as the roster grows.`,
      "- The immutable pooled, timeframe, and macro opposite-side gates remain historical contracts. This new cohort does not rewrite their earlier results.",
      "- Holm's sequential procedure controls the family-wise error rate under arbitrary dependence, which is appropriate because many children share markets, parent signals, prices, and fills.",
      "",
      "## Frozen family and statistical contract",
      "",
      `- Version: \`${PAPER_FAMILYWISE_GATE.version}\`; exact family size: ${PAPER_FAMILYWISE_HYPOTHESES.length}; alpha: ${PAPER_FAMILYWISE_GATE.alpha}.`,
      `- Frozen keys, in roster order: ${PAPER_FAMILYWISE_HYPOTHESES.map((key) => `\`${key}\``).join(", ")}.`,
      "- Four macro-UP/DOWN units use their registered same-tick opposite-side comparator. Every other unit uses its registered same-tick Always Down comparator.",
      `- Each unit retains the unchanged floors: ${PAPER_FAMILYWISE_GATE.minMarkets.toLocaleString()} markets, ${PAPER_FAMILYWISE_GATE.minSpanDays} days, ${PAPER_FAMILYWISE_GATE.minBets} paired bets, ${PAPER_FAMILYWISE_GATE.sessionsNeeded} qualifying UK sessions, and mean residual at least ${(PAPER_FAMILYWISE_GATE.minResidual * 100).toFixed(1)}¢.`,
      `- Each unit additionally needs at least ${PAPER_FAMILYWISE_GATE.minClusters} independent five-minute clusters. Its one-sided cluster-robust t p-value for H0: residual ≤ 0 enters one Holm adjustment across the full frozen family.`,
      "- An unready or missing unit enters the adjustment as p=1; it cannot disappear and make the family easier. An unexpected key fails closed.",
      "- PASS requires all original coverage, span, bet, session, effect-size, nominal cluster-bootstrap lower-bound, and positive-session rules plus Holm-adjusted p ≤ 0.05.",
      "- Filtered periods and diagnostic segments cannot change this verdict. A later strategy must enter a later frozen family/version.",
      "",
      "## Safety",
      "",
      "- This gate changes evaluation only. It changes no strategy feature, side, price, timing, fill, stake, or paper decision.",
      "- Paper only. No Polymarket account, wallet, signing, allowance, order, cancellation, position, allocation, or fund-moving path is added or authorized.",
    ].join("\n"),
  });
}

const [existingAudit] = await db
  .select({ id: auditLogs.id })
  .from(auditLogs)
  .where(and(
    eq(auditLogs.action, action),
    eq(auditLogs.resourceType, "kbArticle"),
    eq(auditLogs.resourceId, slug),
  ))
  .limit(1);
if (!existingAudit) {
  await audit(ctx, action, { resourceType: "kbArticle", resourceId: slug });
}

console.log(JSON.stringify({
  updated: !existing,
  auditInserted: !existingAudit,
  slug,
  boundary: boundary.toISOString(),
  familySize: PAPER_FAMILYWISE_HYPOTHESES.length,
  sameFloors,
}, null, 2));
process.exit(0);
