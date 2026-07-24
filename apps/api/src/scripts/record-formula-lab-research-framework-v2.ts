/**
 * Record the versioned Alchemy Formula Lab research framework in the in-app knowledge base.
 *
 * This script reads/writes KB and audit metadata only. It does not query feature values, market
 * outcomes, paper results, accounts, Crucible, strategies, positions, wallets, or an order route.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import {
  FORMULA_LAB_RESEARCH_FRAMEWORK,
  renderFormulaLabResearchFramework,
} from "../services/formula-lab-research-framework.ts";

const framework = FORMULA_LAB_RESEARCH_FRAMEWORK;
const slug = framework.version;
const marker = "## Alchemy Formula Lab research framework v2";
const action = "kb.research-framework.record";
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
  req: new Request("http://localhost/internal/kb-formula-lab-research-framework-v2"),
};
const caller = appRouter.createCaller(ctx);

if (
  framework.version !== "alchemy-formula-lab-research-framework-v2"
  || framework.status !== "active"
  || framework.invariants.readsLockedLiveValues
  || framework.invariants.readsMarketOutcomes
  || framework.invariants.readsPaperOutcomes
  || framework.invariants.createsStrategy
  || framework.invariants.createsPaperBot
  || framework.invariants.startsCrucibleRun
  || framework.invariants.enablesExecution
  || !framework.invariants.preservesVerdictGate
) {
  throw new Error("Formula Lab research framework contract does not match disposition");
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

const recordedAt = new Date().toISOString();
await caller.kb.upsert({
  slug,
  title: "Alchemy Formula Lab — research and validation framework v2",
  category: "research",
  tags: [
    "alchemy",
    "formula-lab",
    "symbolic-regression",
    "multiple-testing",
    "walk-forward",
    "capital-backtest",
    "paper-only",
  ],
  body: renderFormulaLabResearchFramework(recordedAt),
  sources: framework.sources.map(({ title, url }) => ({ title, url })),
  status: "active",
});

console.log(JSON.stringify({
  updated: true,
  auditInserted: await ensureAudit(),
  slug,
  sourceCount: framework.sources.length,
  mechanicsVersions: framework.mechanicsVersions,
}, null, 2));
process.exit(0);
