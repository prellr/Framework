/**
 * Record the outcome-blind catch-up rule before basis distributions can be disclosed.
 *
 * This script reads/writes KB and audit metadata only. It does not query a venue tape, feature
 * artifact, market outcome, paper decision, result, account, wallet, Crucible service, or order
 * route, and it does not register the rule with the paper engine.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { RESOLUTION_SOURCE_BASIS_CATCHUP_PLAN } from "../services/resolution-source-basis-catchup-plan.ts";

const plan = RESOLUTION_SOURCE_BASIS_CATCHUP_PLAN;
const slug = plan.version;
const marker = "## Outcome-blind resolution-source basis catch-up preregistration v1";
const action = "kb.preregistration.record";
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
  req: new Request("http://localhost/internal/kb-resolution-basis-catchup-plan-v1"),
};
const caller = appRouter.createCaller(ctx);

if (
  plan.version !== "updown-resolution-source-basis-catchup-preregistration-v1" ||
  plan.status !== "preregistered" ||
  plan.hypotheses.length !== 2 ||
  plan.validation.hypotheses.length !== 2 ||
  plan.fixedRule.leadLagSec !== 5 ||
  plan.fixedRule.decisionElapsedSec.minInclusive !== 60 ||
  plan.fixedRule.decisionElapsedSec.maxExclusive !== 120 ||
  plan.fixedRule.maxSourceAgeMs !== 2_000 ||
  plan.fixedRule.minSelectedAsk !== 0.1 ||
  plan.fixedRule.maxSelectedAsk !== 0.55 ||
  plan.validation.familywiseCorrection !== "Holm" ||
  plan.invariants.readsFeatureValuesNow ||
  plan.invariants.readsLeadLagValuesNow ||
  plan.invariants.readsOutcomes ||
  plan.invariants.readsPaperResults ||
  plan.invariants.createsPaperBot ||
  plan.invariants.changesCollector ||
  plan.invariants.startsCrucibleRun ||
  plan.invariants.enablesExecution ||
  !plan.invariants.preservesExistingFamilywiseGate
) {
  throw new Error("resolution-source basis catch-up preregistration contract mismatch");
}

const ensureAudit = async () => {
  const [existing] = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, action),
        eq(auditLogs.resourceType, "kbArticle"),
        eq(auditLogs.resourceId, slug),
      ),
    )
    .limit(1);
  if (existing) return false;
  await audit(ctx, action, {
    resourceType: "kbArticle",
    resourceId: slug,
    newValue: {
      featureValuesRead: false,
      leadLagValuesRead: false,
      outcomesRead: false,
      paperBotCreated: false,
      executionEnabled: false,
    },
  });
  return true;
};

const existing = await caller.kb.get({ slug });
if (existing?.body.includes(marker)) {
  console.log(
    JSON.stringify(
      {
        updated: false,
        auditInserted: await ensureAudit(),
        slug,
        reason: "already_recorded",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
if (existing) throw new Error(`refusing to replace existing KB article without marker: ${slug}`);

const rule = plan.fixedRule;
const body = [
  marker,
  "",
  `Recorded ${new Date().toISOString()} while all resolution-source feature distributions remained disclosure-locked.`,
  "",
  "### Frozen family",
  "",
  ...plan.hypotheses.map(
    (hypothesis) =>
      `- \`${hypothesis.key}\`: **${hypothesis.name}**, ${hypothesis.horizonMin}m only.`,
  ),
  "- The two timeframes are independent verdict units; evidence cannot pool across them.",
  "",
  "### Fixed causal rule",
  "",
  `- Evaluate only ${rule.decisionElapsedSec.minInclusive}–${rule.decisionElapsedSec.maxExclusive - 1} seconds after the market window starts.`,
  `- Pair eligibility requires the fixed ${rule.leadLagSec}-second Hyperliquid→Chainlink lead row to be ready with both the forward-correlation and forward-minus-reverse 95% confidence lower bounds above zero. No lag search is allowed.`,
  `- Require absolute basis at or above the pair's frozen ${rule.absoluteBasisReference}, same-sign five-second persistence at or above its frozen ${rule.persistenceReference}, and a still-widening one-second basis change at the signed ${rule.negativeWideningReference}/${rule.positiveWideningReference} tail.`,
  `- Require both source ages ≤${rule.maxSourceAgeMs}ms.`,
  `- Positive Hyperliquid-minus-Chainlink basis chooses UP; negative basis chooses DOWN.`,
  `- Require a fee-adjusted real $${rule.stakeUsd} paired book and selected ask from $${rule.minSelectedAsk.toFixed(2)} through $${rule.maxSelectedAsk.toFixed(2)}; otherwise abstain.`,
  "",
  "### Activation boundary",
  "",
  `- Required feature artifact: \`${plan.prerequisiteVersions.featureCuts}\`.`,
  `- Required pair manifest: \`${plan.prerequisiteVersions.pairManifest}\`, hashed and bound to the exact feature-cut artifact SHA-256.`,
  `- The runtime boundary must equal or follow the artifact's \`${plan.activation.featureCutBoundaryField}\`.`,
  `- The runtime boundary must also equal or follow the pair manifest's \`${plan.activation.pairManifestBoundaryField}\`.`,
  `- ${plan.activation.pairManifestPolicy}`,
  "- This preregistration does not activate automatically. Runtime implementation and launch require a later reviewed deployment.",
  "",
  "### Forward verdict",
  "",
  `- Gate: \`${plan.validation.version}\`; ${plan.validation.familywiseCorrection} correction across exactly ${plan.validation.hypotheses.length} hypotheses.`,
  `- Primary comparator: ${plan.validation.primaryComparator}.`,
  `- Floors per timeframe: ${plan.validation.minimumEligibleMarkets.toLocaleString()} eligible markets, ${plan.validation.minimumSpanDays} days, ${plan.validation.minimumBets} paired bets, ${plan.validation.minimumClusters} clusters, residual ≥${(plan.validation.minimumResidual * 100).toFixed(1)}¢, and ${plan.validation.positiveSessionsNeeded} qualifying sessions with at least ${plan.validation.sessionMinimumBets} bets each.`,
  `- Secondary comparators: ${plan.validation.secondaryComparators.join("; ")}.`,
  "",
  "### Safety boundary",
  "",
  "- This record reads no locked feature value, lead/lag result, outcome, grade, return, or paper P&L.",
  "- It adds no collector, subscription, polling loop, database migration, paper bot, paper decision, Crucible run, credential, signing capability, order route, allocation, wallet, or fund-moving path.",
  "- The existing 57-hypothesis familywise gate remains immutable and unchanged.",
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Resolution-source basis catch-up preregistration v1",
  category: "research",
  tags: [
    "polymarket",
    "updown",
    "chainlink",
    "hyperliquid",
    "basis",
    "lead-lag",
    "preregistration",
    "paper-only",
  ],
  body,
  sources: [
    {
      title: "Outcome-blind resolution-source basis research plan",
      url: "https://jester.wisco.wine/knowledge/updown-resolution-source-basis-research-plan-v1",
    },
    {
      title: "Resolution-source basis feature-cut freeze plan",
      url: "https://jester.wisco.wine/knowledge/updown-resolution-source-basis-feature-cut-freeze-plan-v1",
    },
  ],
  status: "active",
});

console.log(
  JSON.stringify(
    {
      updated: true,
      auditInserted: await ensureAudit(),
      slug,
      hypotheses: plan.hypotheses.map(({ key, horizonMin }) => ({ key, horizonMin })),
      readsFeatureValues: false,
      createsPaperBot: false,
    },
    null,
    2,
  ),
);
process.exit(0);
