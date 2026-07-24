/**
 * Record the outcome-blind resolution-source basis research plan.
 *
 * This script reads/writes KB and audit metadata only. It does not query the venue tape, a market
 * outcome, paper decision, result, account, wallet, Crucible service, or order route.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { RESOLUTION_SOURCE_BASIS_RESEARCH } from "../services/resolution-source-basis-research.ts";

const plan = RESOLUTION_SOURCE_BASIS_RESEARCH;
const slug = plan.version;
const marker = "## Outcome-blind resolution-source basis research plan";
const action = "kb.research-plan.record";
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
  req: new Request("http://localhost/internal/kb-resolution-source-basis-research"),
};
const caller = appRouter.createCaller(ctx);

if (
  plan.version !== "updown-resolution-source-basis-research-plan-v1"
  || plan.status !== "queued"
  || plan.invariants.readsTapeValuesNow
  || plan.invariants.readsOutcomes
  || plan.invariants.createsStrategy
  || plan.invariants.createsPaperBot
  || plan.invariants.changesCollector
  || plan.invariants.startsCrucibleRun
  || plan.invariants.enablesExecution
  || !plan.invariants.preservesVerdictGate
) {
  throw new Error("resolution-source basis executable contract does not match disposition");
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
    reason: "already_recorded",
  }, null, 2));
  process.exit(0);
}
if (existing) throw new Error(`refusing to replace existing KB article without marker: ${slug}`);

const sources = [
  {
    title: "Polymarket RTDS: real-time Binance and Chainlink data",
    url: "https://docs.polymarket.com/market-data/websocket/rtds",
  },
  {
    title: "The Anatomy of a Decentralized Prediction Market",
    url: "https://arxiv.org/abs/2604.24366",
  },
  {
    title: "Polymarket Trade Engine: multi-source ticker and divergence mechanics",
    url: "https://github.com/KaustubhPatange/polymarket-trade-engine",
  },
  {
    title: "Do Prediction Markets Match Option Prices?",
    url: "https://arxiv.org/abs/2606.19517",
  },
];

const body = [
  marker,
  "",
  `Recorded ${new Date().toISOString()} before inspecting any locked basis value or outcome.`,
  "",
  "### Disposition",
  "",
  `Retain one queued lane: **${plan.candidate.name}**.`,
  `- Prerequisite: \`${plan.prerequisite.version}\` must pass ${plan.prerequisite.minimumRowsPerPair.toLocaleString()} rows, ${plan.prerequisite.minimumSpanDays} days, and ${plan.prerequisite.minimumFiveMinuteBlocksPerPair} complete five-minute blocks in each of ${plan.prerequisite.pairs.length} pairs.`,
  `- Horizon policy: ${plan.candidate.horizonPolicy}.`,
  ...plan.candidate.structuralPrior.map((item) => `- ${item}`),
  "",
  "### Outcome-free feature plan",
  "",
  `- Existing fields: ${plan.outcomeFreeFeaturePlan.existingFields.join(", ")}.`,
  `- Derived only after readiness: ${plan.outcomeFreeFeaturePlan.derivedOnlyAfterReadiness.join(", ")}.`,
  `- ${plan.outcomeFreeFeaturePlan.cutPolicy}`,
  `- ${plan.outcomeFreeFeaturePlan.sourceFreshnessPolicy}`,
  "",
  "The following choices remain deliberately unresolved until immutable cuts exist:",
  ...plan.candidate.unresolvedUntilFeatureCutsFreeze.map((item) => `- ${item}.`),
  "",
  "### Transfer limits",
  "",
  ...plan.rejectedTransfers.map((item) => `- **${item.key}:** ${item.reason}`),
  "",
  "The Polymarket microstructure paper supports authoritative on-chain trade-direction reconciliation; it does not establish this basis signal. Official RTDS and public engines establish that the two source streams and divergence measurement are feasible; their thresholds and profit claims receive zero gate weight.",
  "",
  "### Future validation",
  "",
  ...plan.validation.map((item) => `- ${item}.`),
  `- Archive condition: ${plan.candidate.archiveIf}`,
  "- This record adds no collector, subscription, polling loop, result query, strategy registration, paper insertion, Crucible run, account access, signing capability, order route, allocation, or fund-moving path.",
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Outcome-blind resolution-source basis research plan",
  category: "research",
  tags: [
    "polymarket",
    "updown",
    "chainlink",
    "hyperliquid",
    "basis",
    "lead-lag",
    "paper-only",
  ],
  body,
  sources,
  status: "active",
});

console.log(JSON.stringify({
  updated: true,
  auditInserted: await ensureAudit(),
  slug,
  candidate: plan.candidate.key,
  prerequisite: plan.prerequisite,
}, null, 2));
process.exit(0);
