/**
 * Record the synthetic-only algebraic formula laboratory design.
 *
 * This script reads/writes KB and audit metadata only. It does not query market data, feature
 * values, labels, outcomes, paper results, accounts, Crucible, or an order route.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { FORMULAIC_FIXED_HORIZON_POC } from "../services/formulaic-fixed-horizon-contract.ts";
import { fixedFormulaCandidates } from "../services/formulaic-fixed-horizon-poc.ts";

const contract = FORMULAIC_FIXED_HORIZON_POC;
const candidates = fixedFormulaCandidates();
const slug = contract.version;
const marker = "## Synthetic-only formulaic fixed-horizon lab POC v1";
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
  req: new Request("http://localhost/internal/kb-formulaic-fixed-horizon-lab-poc"),
};
const caller = appRouter.createCaller(ctx);

if (
  contract.version !== "updown-formulaic-fixed-horizon-lab-poc-v1"
  || contract.status !== "synthetic-only"
  || contract.target.holdSeconds !== 600
  || contract.target.fiveMinuteEligible
  || contract.invariants.readsLockedLiveValues
  || contract.invariants.readsPaperOutcomes
  || contract.invariants.createsStrategy
  || contract.invariants.createsPaperBot
  || contract.invariants.startsCrucibleRun
  || contract.invariants.enablesExecution
  || !contract.invariants.preservesVerdictGate
) {
  throw new Error("formulaic fixed-horizon executable contract does not match disposition");
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
    title: "PySR: bounded symbolic regression and complexity controls",
    url: "https://ai.damtp.cam.ac.uk/pysr/v2.0.0a2/api",
  },
  {
    title: "The Probability of Backtest Overfitting",
    url: "https://escholarship.org/uc/item/4w1110bb",
  },
  {
    title: "The Deflated Sharpe Ratio",
    url: "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551",
  },
  {
    title: "Double out-of-sample walk-forward optimization on intraday crypto",
    url: "https://arxiv.org/abs/2602.10785",
  },
  {
    title: "Hyperliquid public WebSocket subscriptions",
    url: "https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions",
  },
  {
    title: "Polymarket RTDS: real-time Binance and Chainlink data",
    url: "https://docs.polymarket.com/market-data/websocket/rtds",
  },
];

const body = [
  marker,
  "",
  `Recorded ${new Date().toISOString()} without reading a locked live feature or result.`,
  "",
  "### What the POC proves",
  "",
  "- A formula is a bounded typed expression tree, not arbitrary code or JavaScript eval.",
  `- Allowed features: ${contract.features.join(", ")}.`,
  `- Operators: ${[...contract.grammar.binaryOperators, ...contract.grammar.unaryOperators].join(", ")}; maximum ${contract.grammar.maximumNodes} nodes and depth ${contract.grammar.maximumDepth}.`,
  `- The deterministic seed library currently contains ${candidates.length} formula × threshold trials. Every one counts in the trial ledger; no hidden mutation is free.`,
  "- Every fold estimates feature and formula-output normalization from prior training data only, chooses one formula on that data, purges labels through the test boundary, then scores the next chronological block.",
  `- The label is fixed before search: ${contract.target.label}. Entries cannot overlap because the cooldown equals the ${contract.target.holdSeconds / 60}-minute hold.`,
  "- The POC runs only on caller-supplied in-memory points and is tested with synthetic data. It has no live-data adapter or API endpoint.",
  "",
  "### Why not trust the best formula",
  "",
  "- Symbolic regression and genetic/program search can produce readable equations, but the search itself creates selection bias. PySR therefore exposes explicit complexity, nesting, and evaluation-budget controls.",
  "- Financial backtests require chronological splits. Overlapping 10-minute labels are purged; shuffled cross-validation is forbidden.",
  "- Probability of Backtest Overfitting and Deflated Sharpe work show why the number of attempted formulas must be retained. A descriptive leaderboard is not a verdict.",
  "- Any formula selected from historical or walk-forward data becomes a registered hypothesis at a later boundary. It does not inherit the discovery score.",
  "",
  "### Jester translation",
  "",
  "- Stage A predicts the exact 10-minute underlying short return using source-timestamped Chainlink/Hyperliquid inputs. This is a label study, not executable P&L.",
  "- Stage B, if Stage A survives, is a separate 15m Polymarket paper child: buy DOWN from the fee-adjusted executable ask, then sell at the executable DOWN bid exactly 10 minutes later. Spread, fees, thin depth, partial fills, and unavailable exits remain losses or explicit failures under a future frozen contract.",
  "- A 5m market cannot host a 10-minute timed exit and is ineligible for this first translation.",
  "- Optimizing exit time later is allowed only as an explicitly bounded second dimension; every formula × threshold × exit time is another trial and any winner needs its own untouched forward test.",
  "",
  "### Locked prerequisites",
  "",
  ...contract.prerequisitesForLiveData.map((item) => `- ${item}.`),
  ...contract.prerequisitesForPolymarketTranslation.map((item) => `- ${item}.`),
  "",
  "- This record adds no collector, subscription, database query, live search, strategy, paper decision, Crucible run, signing capability, order route, allocation, or fund-moving path.",
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Formulaic fixed-horizon strategy lab — synthetic POC v1",
  category: "research",
  tags: [
    "polymarket",
    "updown",
    "symbolic-regression",
    "formula",
    "walk-forward",
    "fixed-horizon",
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
  status: contract.status,
  formulaThresholdTrials: candidates.length,
  holdSeconds: contract.target.holdSeconds,
}, null, 2));
process.exit(0);
