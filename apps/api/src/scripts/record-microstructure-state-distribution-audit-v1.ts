/**
 * Preregister the exact outcome-free liquidity-state distribution audit.
 *
 * This script reads/writes KB and audit metadata only. It does not query a state feature value,
 * market outcome, paper decision, strategy result, account, position, wallet, or order.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT } from "../services/microstructure-state-distribution-contract.ts";

const slug = MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.version;
const marker = "## Outcome-free microstructure state distribution audit v1";
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
  req: new Request("http://localhost/internal/kb-microstructure-state-distribution-audit-v1"),
};
const caller = appRouter.createCaller(ctx);

if (
  MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.version
    !== "updown-microstructure-state-distribution-audit-v1"
  || MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.quantileProbabilities.join(",")
    !== "0.05,0.25,0.5,0.75,0.95"
  || MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.expectedBuckets !== 120
  || MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.minMarketsPerBucket !== 50
) {
  throw new Error("microstructure-state distribution contract does not match preregistration");
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
    reason: "already_registered",
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
];
const body = [
  marker,
  "",
  `Registered ${new Date().toISOString()} before the inherited state-tape readiness gate passed.`,
  "",
  "### Exact disclosure plan",
  "",
  `- Source: \`${MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.tapeVersion}\`; no new collector or historical backfill.`,
  `- Quantiles: ${MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.quantileProbabilities.join(", ")}.`,
  `- Dimensions: ${MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.dimensions.join(" × ")}.`,
  `- Required universe: all ${MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.expectedBuckets} six-asset × 5m/15m × causal-sample-minute buckets.`,
  `- Minimum support: ${MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.minMarketsPerBucket} distinct markets in every bucket before a later immutable cut artifact may be frozen.`,
  `- Metrics: ${MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.metrics.join(", ")}.`,
  "- Paired spread is the mean UP/DOWN touch spread. Minimum paired depth is log(1 + min(UP depth USD, DOWN depth USD)). Complement error is the absolute UP-mid + DOWN-mid parity deviation.",
  "- Signed microprice skew and touch pressure remain directional coordinates only; this audit does not choose a side or a threshold.",
  `- The grouped feature query is unreachable until the inherited ${MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.tapeVersion} readiness predicate passes, and successful results are cached for ${MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.cacheMs / 60_000} minutes.`,
  "",
  "### Research and execution constraints",
  "",
  "- The report may not select or join market outcomes, resolution values, labels, paper decisions, fills, grades, returns, P&L, accounts, positions, wallets, or orders.",
  "- A complete distribution report still authorizes no state, direction, ask cap, decision minute, paper identity, or verdict. A later immutable cut artifact and future-boundary rule registration are required.",
  "- Any later candidate must retain independent 5m/15m identities, a state-only comparator, fee-adjusted paired-book asks, chronological clustered validation, and the unchanged forward verdict gate.",
  "- This artifact adds no collector, subscription, table, polling loop, strategy, paper insertion, order route, signing capability, allocation, or fund-moving path.",
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Outcome-free microstructure state distribution audit v1",
  category: "research" as (typeof categories)[number],
  tags: [
    "polymarket",
    "updown",
    "microstructure",
    "microprice",
    "liquidity",
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
  expectedBuckets: MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.expectedBuckets,
  minMarketsPerBucket: MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.minMarketsPerBucket,
  metrics: MICROSTRUCTURE_STATE_DISTRIBUTION_AUDIT.metrics,
}, null, 2));
process.exit(0);
