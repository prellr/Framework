/**
 * Record the outcome-blind external research disposition for the compact flow tapes.
 *
 * This script reads/writes KB and audit metadata only. It does not query a feature value, market
 * outcome, paper decision, result, account, position, wallet, or order.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { FLOW_EXTERNAL_PRIOR_SCREEN } from "../services/flow-external-prior-screen.ts";

const slug = FLOW_EXTERNAL_PRIOR_SCREEN.version;
const marker = "## Outcome-blind external flow prior screen — 2026-07-24";
const action = "kb.research-screen.record";
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
  req: new Request("http://localhost/internal/kb-flow-external-prior-screen-2026-07-24"),
};
const caller = appRouter.createCaller(ctx);

if (
  FLOW_EXTERNAL_PRIOR_SCREEN.version !== "updown-flow-external-prior-screen-2026-07-24"
  || FLOW_EXTERNAL_PRIOR_SCREEN.status !== "queued"
  || FLOW_EXTERNAL_PRIOR_SCREEN.invariants.readLockedFeatureValues
  || FLOW_EXTERNAL_PRIOR_SCREEN.invariants.readOutcomes
  || FLOW_EXTERNAL_PRIOR_SCREEN.invariants.createsPaperBot
  || FLOW_EXTERNAL_PRIOR_SCREEN.invariants.changesCollector
  || FLOW_EXTERNAL_PRIOR_SCREEN.invariants.enablesExecution
  || !FLOW_EXTERNAL_PRIOR_SCREEN.invariants.preservesVerdictGate
) {
  throw new Error("external flow prior screen executable contract does not match disposition");
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
    title: "When Does Order Flow Matter? State-Dependent L2 Liquidity-State Transitions in Crypto Futures",
    url: "https://arxiv.org/abs/2607.09230",
  },
  {
    title: "When large trades are not (automatically) news: Liquidity tail risk and price discovery",
    url: "https://arxiv.org/abs/2607.01198v2",
  },
  {
    title: "The Quarter-Hour Effect: Periodic Algorithmic Trading and Return Predictability in Cryptocurrency Futures",
    url: "https://arxiv.org/abs/2607.09426v2",
  },
  {
    title: "Forecasting high frequency order flow imbalance using Hawkes processes",
    url: "https://arxiv.org/abs/2408.03594",
  },
  {
    title: "Multi-Level Order-Flow Imbalance in a Limit Order Book",
    url: "https://arxiv.org/abs/1907.06230",
  },
  {
    title: "Orderflow — public footprint-candle service",
    url: "https://github.com/tiagosiebler/orderflow",
  },
  {
    title: "Limit Order Book — public replay and microstructure analytics",
    url: "https://github.com/mansoor-mamnoon/limit-order-book",
  },
  {
    title: "Polymarket Terminal — public execution mechanics and ghost-fill handling",
    url: "https://github.com/direkturcrypto/polymarket-terminal",
  },
];

const candidate = FLOW_EXTERNAL_PRIOR_SCREEN.candidate;
const body = [
  marker,
  "",
  `Recorded ${new Date().toISOString()} while Jester's inherited flow feature reports remained locked.`,
  "",
  "### Disposition",
  "",
  `Retain one queued lane: **${candidate.name}**.`,
  `- Prerequisites: \`${candidate.prerequisiteVersions.flowDistribution}\`, immutable \`${candidate.prerequisiteVersions.flowFeatureCuts}\`, and ready \`${candidate.prerequisiteVersions.microstructureTape}\`.`,
  `- Horizon policy: ${candidate.horizonPolicy}. No pooled identity may stand in for either horizon.`,
  ...candidate.structuralPrior.map((item) => `- ${item}`),
  "",
  "These are structural priors, not an executable rule. The following choices remain deliberately unresolved until every prerequisite passes:",
  ...candidate.unresolvedUntilPrerequisitesPass.map((item) => `- ${item}.`),
  "",
  "### Why this survived",
  "",
  "- A rolling out-of-sample crypto study finds pre-event L2 liquidity state is the first-order layer and that order flow adds value only on top of it; transfer differs materially by symbol and horizon.",
  "- Heavy-tail liquidity theory says one large imbalance can be a liquidity shock rather than information, while repeated flow is more informative under stable conditions.",
  "- Hyperliquid evidence shows visible same-side programs attract an absorbing liquidity response and may be less informational than latent flow, so aggressor volume cannot be read without state and concentration context.",
  "- Quarter-hour effects are real and out of sample, but their strongest order-imbalance result is a four-to-twelve-hour association. For Jester this supports clock-phase segmentation and strict 5m/15m separation, not direct threshold transfer.",
  "",
  "### Rejected or deferred",
  "",
  ...FLOW_EXTERNAL_PRIOR_SCREEN.rejectedAsCurrentStrategyInputs.map(
    (item) => `- **${item.key}:** ${item.reason}`,
  ),
  "",
  "Public Polymarket repositories were treated as operational evidence only. They reveal one-sided-fill, ghost-fill, fee, spread, wallet, and execution risks; README profitability claims and hard-coded thresholds receive zero gate weight.",
  "",
  "### Future evaluation contract",
  "",
  ...FLOW_EXTERNAL_PRIOR_SCREEN.retainedValidationPatterns.map((item) => `- ${item}.`),
  "- Any later rule must be separately preregistered at a future boundary after the immutable cuts exist, use independent 5m and 15m paper identities, price decisions from fee-adjusted executable paired books, and remain behind the unchanged verdict gate.",
  "- Always-UP, always-DOWN, macro-UP-only, and macro-DOWN-only stay as distinct controls; no candidate may overwrite them.",
  "- This screen adds no collector, subscription, polling loop, raw-data retention, strategy registration, paper insertion, account access, signing capability, order route, allocation, or fund-moving path.",
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Outcome-blind external flow prior screen — 2026-07-24",
  category: "research" as (typeof categories)[number],
  tags: [
    "polymarket",
    "updown",
    "hyperliquid",
    "order-flow",
    "microstructure",
    "github",
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
  candidate: candidate.key,
  prerequisiteVersions: candidate.prerequisiteVersions,
}, null, 2));
process.exit(0);
