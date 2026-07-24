/**
 * Record the outcome-blind structural refinement of the queued dual-flow research lane.
 *
 * This script reads/writes KB and audit metadata only. It does not query a feature value, market
 * outcome, paper decision, result, account, position, wallet, or order.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { FLOW_MECHANISM_REFINEMENT } from "../services/flow-mechanism-refinement.ts";

const slug = FLOW_MECHANISM_REFINEMENT.version;
const marker = "## Outcome-blind dual-flow mechanism refinement — 2026-07-24";
const action = "kb.research-refinement.record";
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
  req: new Request("http://localhost/internal/kb-flow-mechanism-refinement-2026-07-24"),
};
const caller = appRouter.createCaller(ctx);

if (
  FLOW_MECHANISM_REFINEMENT.version !== "updown-flow-mechanism-refinement-2026-07-24"
  || FLOW_MECHANISM_REFINEMENT.status !== "queued"
  || FLOW_MECHANISM_REFINEMENT.invariants.readLockedFeatureValues
  || FLOW_MECHANISM_REFINEMENT.invariants.readOutcomes
  || FLOW_MECHANISM_REFINEMENT.invariants.createsPaperBot
  || FLOW_MECHANISM_REFINEMENT.invariants.changesCollector
  || FLOW_MECHANISM_REFINEMENT.invariants.enablesExecution
  || !FLOW_MECHANISM_REFINEMENT.invariants.preservesVerdictGate
) {
  throw new Error("flow mechanism refinement executable contract does not match disposition");
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
    title: "The Price Impact of Order Book Events",
    url: "https://arxiv.org/abs/1011.6402",
  },
  {
    title: "Queue Imbalance as a One-Tick-Ahead Price Predictor in a Limit Order Book",
    url: "https://arxiv.org/abs/1512.03492",
  },
  {
    title: "The Micro-Price: A High Frequency Estimator of Future Prices",
    url: "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2970694",
  },
  {
    title: "Microprice — author code and sample data",
    url: "https://github.com/sstoikov/microprice",
  },
  {
    title: "Multi-Level Order-Flow Imbalance in a Limit Order Book",
    url: "https://arxiv.org/abs/1907.06230",
  },
  {
    title: "When Does Order Flow Matter? State-Dependent L2 Liquidity-State Transitions in Crypto Futures",
    url: "https://arxiv.org/abs/2607.09230",
  },
];

const frozen = FLOW_MECHANISM_REFINEMENT.frozenBeforeFeatureValues;
const body = [
  marker,
  "",
  `Recorded ${new Date().toISOString()} without reading a flow feature value or market outcome.`,
  "",
  "### Decision",
  "",
  `Keep exactly one queued lane: \`${FLOW_MECHANISM_REFINEMENT.candidateKey}\`.`,
  `It inherits \`${FLOW_MECHANISM_REFINEMENT.inheritedPriorVersion}\`, remains behind immutable \`${FLOW_MECHANISM_REFINEMENT.prerequisiteVersions.flowFeatureCuts}\` and \`${FLOW_MECHANISM_REFINEMENT.prerequisiteVersions.microstructureTape}\`, and keeps ${FLOW_MECHANISM_REFINEMENT.horizonPolicy}.`,
  "",
  "### Frozen direction and persistence",
  "",
  ...frozen.direction.map((item) => `- ${item}`),
  "",
  "### Frozen asset × horizon quality guards",
  "",
  ...frozen.immutableBucketQuality.map((item) => `- ${item}`),
  "",
  "### State-first comparison",
  "",
  ...frozen.stateLayer.map((item) => `- ${item}`),
  "",
  "The future comparison ladder is fixed before outcomes:",
  ...frozen.comparisonLadder.map((item, index) => `${index + 1}. ${item}.`),
  "",
  "This separates a state effect from the incremental contribution of each flow source. A full dual-flow result receives no credit if the identical Polymarket state-only layer explains it.",
  "",
  "### Deliberately unresolved",
  "",
  ...FLOW_MECHANISM_REFINEMENT.unresolvedUntilPrerequisitesPass.map((item) => `- ${item}.`),
  "",
  "No depth/spread threshold, ask cap, or decision minute is inferred from the incomplete tape. Each must be fixed at a later future boundary after its prerequisites exist.",
  "",
  "### Rejected as current additions",
  "",
  ...FLOW_MECHANISM_REFINEMENT.rejectedAsCurrentAdditions.map(
    (item) => `- **${item.key}:** ${item.reason}`,
  ),
  "",
  "The micro-price and queue-imbalance literature supports an inexpensive state comparator, while Cont-style evidence supports depth-normalized event flow. It does not justify copying an equity transition model, a deep-book model, or a fitted Hawkes layer into a six-asset binary market before the compact deterministic ladder is evaluated.",
  "",
  "### Future validation contract",
  "",
  ...FLOW_MECHANISM_REFINEMENT.validationContract.map((item) => `- ${item}`),
  "- This receipt adds no collector, subscription, polling loop, strategy registration, paper insertion, account access, signing capability, order route, allocation, or fund-moving path.",
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Outcome-blind dual-flow mechanism refinement — 2026-07-24",
  category: "research" as (typeof categories)[number],
  tags: [
    "polymarket",
    "updown",
    "hyperliquid",
    "order-flow",
    "microprice",
    "microstructure",
    "paper-only",
  ],
  body,
  sources,
  status: "active" as (typeof statuses)[number],
});

console.log(JSON.stringify({
  updated: true,
  auditInserted: await ensureAudit(),
  slug,
  candidate: FLOW_MECHANISM_REFINEMENT.candidateKey,
  unresolved: FLOW_MECHANISM_REFINEMENT.unresolvedUntilPrerequisitesPass,
}, null, 2));
process.exit(0);
