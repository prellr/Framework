/**
 * Persist the first outcome-visible checkpoint for the 57-member familywise paper gate.
 *
 * This is a retrospective description of an immature cohort. It may reject a new research branch,
 * but it cannot admit one: every observed outcome is contaminated for hypothesis construction and
 * any later child needs a new preregistration plus a future boundary.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import {
  PAPER_FAMILYWISE_GATE,
  PAPER_FAMILYWISE_HYPOTHESES,
} from "../services/paper-familywise-gate.ts";
import { floorState } from "../services/paper-floor.ts";
import { strategyIndependenceStatus } from "../services/strategy-independence.ts";

const slug = "updown-familywise-day-one-checkpoint-2026-07-25";
const marker = "## Familywise day-one collection checkpoint — 2026-07-25";
const action = "kb.paper-evidence-checkpoint.record";
const resourceId = `${slug}:v1`;
const evidenceHardStopMs = Date.parse("2026-07-26T00:00:00.000Z");
const categories = [
  "operations",
  "strategy",
  "research",
  "provider",
  "decision",
  "postmortem",
] as const;
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
  req: new Request("http://localhost/internal/kb-familywise-day-one-checkpoint"),
};
const caller = appRouter.createCaller(ctx);

const ensureAudit = async () => {
  const [existingAudit] = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, action),
        eq(auditLogs.resourceType, "kbArticle"),
        eq(auditLogs.resourceId, resourceId),
      ),
    )
    .limit(1);
  if (!existingAudit) {
    await audit(ctx, action, { resourceType: "kbArticle", resourceId });
  }
  return !existingAudit;
};

const existing = await caller.kb.get({ slug });
if (existing?.body.includes(marker)) {
  console.log(
    JSON.stringify(
      {
        updated: false,
        auditInserted: await ensureAudit(),
        slug,
        marker,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
if (existing) throw new Error(`refusing to replace existing checkpoint without marker: ${slug}`);
if (Date.now() >= evidenceHardStopMs) {
  throw new Error("refusing a day-one checkpoint after the first familywise day has closed");
}

const [state, independence] = await Promise.all([floorState(), strategyIndependenceStatus()]);
if (
  state.familywiseGate.version !== PAPER_FAMILYWISE_GATE.version ||
  state.familywiseGate.familySize !== PAPER_FAMILYWISE_HYPOTHESES.length ||
  state.familywiseGate.familySize !== 57
) {
  throw new Error("live familywise contract does not match the frozen 57-member gate");
}

const byKey = new Map(state.familywiseGate.hypotheses.map((row) => [row.key, row] as const));
const idNr4 = byKey.get("idNr4Breakout:5");
const pricerMc5 = byKey.get("pricerMC:5");
const sweep15 = byKey.get("sweepReclaim:15");
const alwaysUp5 = byKey.get("alwaysUp:5");
if (!idNr4?.residual || !pricerMc5?.residual || !sweep15?.residual || !alwaysUp5?.residual) {
  throw new Error("day-one checkpoint cannot resolve its four frozen evidence rows");
}

const topDependency = (key: string) =>
  independence.pairs
    .filter((pair) => pair.leftKey === key || pair.rightKey === key)
    .filter((pair) => pair.structuralRelation == null)
    .sort(
      (left, right) =>
        (right.dependencyStrength ?? -1) - (left.dependencyStrength ?? -1) ||
        right.sharedMarkets - left.sharedMarkets,
    )[0] ?? null;
const idDependency = topDependency(idNr4.key);
const sweepDependency = topDependency(sweep15.key);
if (
  !idDependency ||
  idDependency.dependencyStrength == null ||
  !sweepDependency ||
  sweepDependency.dependencyStrength == null
) {
  throw new Error("day-one checkpoint cannot resolve outcome-free dependence evidence");
}

const rows = state.familywiseGate.hypotheses;
const checks = {
  allCollecting: rows.every((row) => row.state === "collecting"),
  noPass: rows.every((row) => row.state !== "passing"),
  underOneDay: rows.every((row) => row.spanDays < 1),
  idNr4BelowEveryVerdictFloor:
    idNr4.markets < PAPER_FAMILYWISE_GATE.minMarkets &&
    idNr4.spanDays < PAPER_FAMILYWISE_GATE.minSpanDays &&
    idNr4.bets < PAPER_FAMILYWISE_GATE.minBets &&
    (idNr4.residual.clusters ?? 0) < PAPER_FAMILYWISE_GATE.minClusters &&
    idNr4.qualifyingSessions < PAPER_FAMILYWISE_GATE.sessionsNeeded,
  sweepBelowEveryVerdictFloor:
    sweep15.markets < PAPER_FAMILYWISE_GATE.minMarkets &&
    sweep15.spanDays < PAPER_FAMILYWISE_GATE.minSpanDays &&
    sweep15.bets < PAPER_FAMILYWISE_GATE.minBets &&
    (sweep15.residual.clusters ?? 0) < PAPER_FAMILYWISE_GATE.minClusters &&
    sweep15.qualifyingSessions < PAPER_FAMILYWISE_GATE.sessionsNeeded,
  pricerMcStillImmature:
    pricerMc5.markets < PAPER_FAMILYWISE_GATE.minMarkets &&
    pricerMc5.spanDays < PAPER_FAMILYWISE_GATE.minSpanDays &&
    pricerMc5.bets >= PAPER_FAMILYWISE_GATE.minBets &&
    (pricerMc5.residual.clusters ?? 0) >= PAPER_FAMILYWISE_GATE.minClusters &&
    pricerMc5.positiveQualifyingSessions < PAPER_FAMILYWISE_GATE.sessionsNeeded &&
    (pricerMc5.residual.lo == null || pricerMc5.residual.lo <= 0),
  idNr4NoStrongObservedDependence: idDependency.dependencyStrength < 0.5,
  sweepHasStrongObservedDependence: sweepDependency.dependencyStrength >= 0.5,
  noUnexpectedExactCollision: independence.unexpectedExactCollisions === 0,
};
if (!Object.values(checks).every(Boolean)) {
  throw new Error(`familywise day-one checkpoint invariant changed: ${JSON.stringify(checks)}`);
}

const cents = (value: number | null | undefined) =>
  value == null ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}¢`;
const percent = (value: number | null | undefined) =>
  value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const otherKey = (pair: { leftKey: string; rightKey: string }, focusKey: string) =>
  pair.leftKey === focusKey ? pair.rightKey : pair.leftKey;
const generatedAt = new Date().toISOString();

const body = [
  marker,
  "",
  `Recorded ${generatedAt}. Outcomes were visible before this checkpoint, so every observed lead is contaminated discovery evidence and cannot define a new strategy in this cohort.`,
  "",
  "### Frozen gate",
  "",
  `- Version: \`${PAPER_FAMILYWISE_GATE.version}\`; boundary: ${new Date(PAPER_FAMILYWISE_GATE.evalStartMs).toISOString()}; ${state.familywiseGate.familySize} frozen strategy × timeframe hypotheses.`,
  `- A verdict requires ${PAPER_FAMILYWISE_GATE.minMarkets.toLocaleString()} markets, ${PAPER_FAMILYWISE_GATE.minSpanDays} days, ${PAPER_FAMILYWISE_GATE.minBets} paired bets, ${PAPER_FAMILYWISE_GATE.minClusters} clusters, ${PAPER_FAMILYWISE_GATE.sessionsNeeded} positive qualifying sessions, an effect of at least ${cents(PAPER_FAMILYWISE_GATE.minResidual)}, a positive confidence bound, and familywise Holm significance.`,
  `- The longest gate span is ${Math.max(...rows.map((row) => row.spanDays)).toFixed(3)} days. All ${rows.length} rows remain collecting; none is mature enough for a verdict.`,
  "",
  "### Independent early lead: ID/NR4 5m",
  "",
  `- ${idNr4.decisions.toLocaleString()} captured decisions, ${idNr4.bets.toLocaleString()} paired resolved bets, ${(idNr4.residual.clusters ?? 0).toLocaleString()} clusters, and ${idNr4.qualifyingSessions}/${PAPER_FAMILYWISE_GATE.sessionsNeeded} qualifying sessions.`,
  `- Same-tick-control residual mean ${cents(idNr4.residual.mean)} with nominal 95% interval [${cents(idNr4.residual.lo)}, ${cents(idNr4.residual.hi)}]. This is an early lead, not a gate result.`,
  `- Its strongest non-lineage dependence is only ${percent(idDependency.dependencyStrength)} against \`${otherKey(idDependency, idNr4.key)}\` across ${idDependency.sharedMarkets.toLocaleString()} shared markets; the observed relation is ${idDependency.relation}.`,
  "- The already-preregistered future-only ID/NR4 quality tape is the next admissible research substrate. Its values remain locked until the separate outcome-blind support floors pass.",
  "",
  "### Existing watchlist cohort: Bootstrap MC 5m",
  "",
  `- ${pricerMc5.decisions.toLocaleString()} captured decisions, ${pricerMc5.bets.toLocaleString()} paired resolved bets, ${(pricerMc5.residual.clusters ?? 0).toLocaleString()} clusters, and ${pricerMc5.positiveQualifyingSessions}/${pricerMc5.qualifyingSessions} positive qualifying sessions.`,
  `- Same-tick-control residual mean ${cents(pricerMc5.residual.mean)} with nominal 95% interval [${cents(pricerMc5.residual.lo)}, ${cents(pricerMc5.residual.hi)}].`,
  `- The cohort has cleared the paired-bet and cluster counts, but it has only ${pricerMc5.markets.toLocaleString()}/${PAPER_FAMILYWISE_GATE.minMarkets.toLocaleString()} markets over ${pricerMc5.spanDays.toFixed(3)}/${PAPER_FAMILYWISE_GATE.minSpanDays} days, lacks two positive qualifying sessions, and retains a non-positive confidence bound.`,
  "- Bootstrap MC 5m remains the existing frozen hypothesis. No asset, side, time, price, regime, or freshness child is admitted from the visible diagnostics.",
  "",
  "### Rejected branch: Sweep Reclaim 15m",
  "",
  `- ${sweep15.decisions.toLocaleString()} captured decisions, ${sweep15.bets.toLocaleString()} paired resolved bets, ${(sweep15.residual.clusters ?? 0).toLocaleString()} clusters, and ${sweep15.qualifyingSessions}/${PAPER_FAMILYWISE_GATE.sessionsNeeded} qualifying sessions.`,
  `- Residual mean ${cents(sweep15.residual.mean)} with nominal 95% interval [${cents(sweep15.residual.lo)}, ${cents(sweep15.residual.hi)}].`,
  `- Its strongest non-lineage dependence is ${percent(sweepDependency.dependencyStrength)} against \`${otherKey(sweepDependency, sweep15.key)}\` across ${sweepDependency.sharedMarkets.toLocaleString()} shared markets; the observed relation is ${sweepDependency.relation}.`,
  "- That dependence is too strong to treat the present nominal lead as a new independent mechanism. No Sweep child, filter, ensemble, or duplicate is admitted.",
  "",
  "### Direction benchmark",
  "",
  `- Always Up 5m has ${alwaysUp5.bets.toLocaleString()} paired bets and ${(alwaysUp5.residual.clusters ?? 0).toLocaleString()} clusters, but only ${alwaysUp5.positiveQualifyingSessions}/${alwaysUp5.qualifyingSessions} qualifying sessions are positive and the gate still spans less than one day.`,
  `- Its residual mean is ${cents(alwaysUp5.residual.mean)} with nominal 95% interval [${cents(alwaysUp5.residual.lo)}, ${cents(alwaysUp5.residual.hi)}]. It remains a direction benchmark, not evidence for an execution rule.`,
  "",
  "### Decision",
  "",
  "- Admit no new strategy from this outcome-visible checkpoint.",
  "- Continue the immutable 57-member paper gate and the separately preregistered outcome-blind ID/NR4 quality tape.",
  "- Do not use the displayed means, intervals, assets, sessions, or dependence values to tune the current family. Any later rule requires a hashed contract and a fresh prospective boundary.",
  "- Paper only. This checkpoint adds no bot, collector, socket, timer, database table, order route, signing capability, credential, wallet, allocation, cancellation, position, or fund-moving path.",
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Familywise day-one checkpoint — continue collection",
  category: "decision",
  tags: [
    "polymarket",
    "updown",
    "paper-only",
    "familywise",
    "id-nr4",
    "independence",
    "falsification",
  ],
  body,
  sources: [],
  status: "active",
});
const auditInserted = await ensureAudit();

console.log(
  JSON.stringify(
    {
      updated: true,
      auditInserted,
      slug,
      generatedAt,
      checks,
      idNr4: {
        decisions: idNr4.decisions,
        bets: idNr4.bets,
        clusters: idNr4.residual.clusters,
        mean: idNr4.residual.mean,
        lo: idNr4.residual.lo,
        hi: idNr4.residual.hi,
        qualifyingSessions: idNr4.qualifyingSessions,
        topDependency: idDependency,
      },
      pricerMc5: {
        decisions: pricerMc5.decisions,
        bets: pricerMc5.bets,
        clusters: pricerMc5.residual.clusters,
        mean: pricerMc5.residual.mean,
        lo: pricerMc5.residual.lo,
        hi: pricerMc5.residual.hi,
        markets: pricerMc5.markets,
        spanDays: pricerMc5.spanDays,
        qualifyingSessions: pricerMc5.qualifyingSessions,
        positiveQualifyingSessions: pricerMc5.positiveQualifyingSessions,
      },
      sweep15: {
        decisions: sweep15.decisions,
        bets: sweep15.bets,
        clusters: sweep15.residual.clusters,
        mean: sweep15.residual.mean,
        lo: sweep15.residual.lo,
        hi: sweep15.residual.hi,
        qualifyingSessions: sweep15.qualifyingSessions,
        topDependency: sweepDependency,
      },
    },
    null,
    2,
  ),
);
process.exit(0);
