/**
 * Preregister the symmetric macro-direction verdict before its future boundary.
 *
 * This records executable constants and evaluation semantics only. It reads no paper rows,
 * resolutions, returns, feature values, or performance.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { MACRO_DIRECTION_CONTROLS } from "../services/macro-direction-controls.ts";
import { MACRO_DIRECTION_VERDICT_GATE } from "../services/macro-direction-verdict-gate.ts";
import { PAPER_GATE } from "../services/paper-floor-gate.ts";

const slug = MACRO_DIRECTION_VERDICT_GATE.version;
const marker = "## Prospective registration — symmetric macro-direction verdict v1";
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
  req: new Request("http://localhost/internal/kb-macro-direction-verdict-v1"),
};
const caller = appRouter.createCaller(ctx);
const boundary = new Date(MACRO_DIRECTION_VERDICT_GATE.evalStartMs);

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

const sameFloors =
  MACRO_DIRECTION_VERDICT_GATE.minMarkets === PAPER_GATE.minMarkets
  && MACRO_DIRECTION_VERDICT_GATE.minSpanDays === PAPER_GATE.minSpanDays
  && MACRO_DIRECTION_VERDICT_GATE.minBets === PAPER_GATE.minBets
  && MACRO_DIRECTION_VERDICT_GATE.minResidual === PAPER_GATE.minResidual
  && MACRO_DIRECTION_VERDICT_GATE.clusterMs === PAPER_GATE.clusterMs
  && MACRO_DIRECTION_VERDICT_GATE.bootIters === PAPER_GATE.bootIters
  && MACRO_DIRECTION_VERDICT_GATE.sessionMinBets === PAPER_GATE.sessionMinBets
  && MACRO_DIRECTION_VERDICT_GATE.sessionsNeeded === PAPER_GATE.sessionsNeeded;
if (
  MACRO_DIRECTION_VERDICT_GATE.version
    !== "updown-macro-direction-opposite-side-gate-v1"
  || boundary.toISOString() !== "2026-07-24T09:30:00.000Z"
  || MACRO_DIRECTION_CONTROLS.version !== "updown-macro-direction-controls-v1"
  || !sameFloors
) {
  throw new Error("macro-direction verdict executable contract does not match registration");
}
if (Date.now() >= MACRO_DIRECTION_VERDICT_GATE.evalStartMs) {
  throw new Error("macro-direction verdict registration boundary has already passed");
}

const existing = await caller.kb.get({ slug });
if (existing?.body.includes(marker)) {
  console.log(JSON.stringify({
    updated: false,
    auditInserted: await ensureAudit(),
    slug,
    reason: "already_registered",
  }));
  process.exit(0);
}
if (existing) throw new Error(`refusing to replace pre-existing KB article without marker: ${slug}`);

const body = [
  marker,
  "",
  `Registered ${new Date().toISOString()} for the frozen boundary ${boundary.toISOString()}.`,
  "",
  "### Structural rationale",
  "",
  "- The immutable verdict gate uses Always Down as its same-tick control. That comparison is valid for an UP candidate, but a DOWN candidate buying the same contract at the same ask has an identically zero residual by construction.",
  "- This is an outcome-independent evaluation defect, not evidence about strategy performance. The pooled and general split gates remain immutable.",
  "- For only the two already registered macro-direction children, compare each selected side with the opposite side from the exact same fee-adjusted paired-book walk and decision tick.",
  "",
  "### Frozen evaluation contract",
  "",
  `- Version \`${MACRO_DIRECTION_VERDICT_GATE.version}\`; boundary ${boundary.toISOString()}.`,
  `- Candidate keys \`${MACRO_DIRECTION_CONTROLS.upBotKey}\` and \`${MACRO_DIRECTION_CONTROLS.downBotKey}\` only.`,
  "- Evaluate 5m and 15m as four independent cohorts; evidence can never pool across timeframes or sides.",
  "- Macro UP compares its UP contract net with same-tick DOWN contract net. Macro DOWN compares its DOWN contract net with same-tick UP contract net.",
  "- Both asks must be the fee-adjusted effective VWAPs for the same $5 total-outlay paired-book capture already frozen on the candidate row. Missing or malformed opposite asks fail closed.",
  "- RANGE, NEUTRAL, unavailable, stale, desynchronized, and nonmatching macro states continue to abstain under the unchanged decision rule.",
  `- Each cohort requires at least ${MACRO_DIRECTION_VERDICT_GATE.minMarkets.toLocaleString()} observed markets over ${MACRO_DIRECTION_VERDICT_GATE.minSpanDays} days, ${MACRO_DIRECTION_VERDICT_GATE.minBets} paired bets, and ${MACRO_DIRECTION_VERDICT_GATE.sessionsNeeded} UK sessions with at least ${MACRO_DIRECTION_VERDICT_GATE.sessionMinBets} bets each.`,
  `- PASS additionally requires mean opposite-side residual at least ${(MACRO_DIRECTION_VERDICT_GATE.minResidual * 100).toFixed(1)} cents/contract, a whole-five-minute-cluster bootstrap 95% lower bound above zero, and positive mean residual in at least ${MACRO_DIRECTION_VERDICT_GATE.sessionsNeeded} qualifying UK sessions.`,
  "- Rows before the boundary are descriptive only and cannot enter this verdict.",
  "",
  "### Safety",
  "",
  "- This changes evaluation only. It does not alter a strategy decision, macro classification, paper fill, original verdict gate, or timeframe gate.",
  "- It remains paper-only and adds no order, wallet, account, signing, cancellation, position, fund, or execution capability.",
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Symmetric macro-direction verdict v1",
  category: "research" as (typeof categories)[number],
  tags: ["polymarket", "updown", "macro", "verdict-gate", "paper-only", "preregistered"],
  body,
  sources: [],
  status: "active" as (typeof statuses)[number],
});

console.log(JSON.stringify({
  updated: true,
  auditInserted: await ensureAudit(),
  slug,
  version: MACRO_DIRECTION_VERDICT_GATE.version,
  boundary: boundary.toISOString(),
  sameFloors,
}, null, 2));
process.exit(0);
