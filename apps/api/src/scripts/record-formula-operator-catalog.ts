/**
 * Record the governed Formula Lab operator catalog in Alchemy's in-app knowledge base.
 *
 * This writes KB and audit metadata only. It does not start a formula search, read market or paper
 * outcomes, register a strategy, create a paper bot, or reach execution.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import {
  FORMULA_OPERATOR_CATALOG_KNOWLEDGE,
  renderFormulaOperatorCatalogKnowledge,
} from "../services/formula-operator-catalog-knowledge.ts";

const record = FORMULA_OPERATOR_CATALOG_KNOWLEDGE;
const slug = record.version;
const marker = "## Alchemy Formula Lab operator catalog v1";
const action = "kb.formula-operator-catalog.record";
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
  req: new Request("http://localhost/internal/kb-formula-operator-catalog-v1"),
};
const caller = appRouter.createCaller(ctx);

if (
  record.status !== "active"
  || record.invariants.candidateChangesGenerator
  || record.invariants.importEvaluatorChangesGenerator
  || record.invariants.arbitraryCodeAllowed
  || record.invariants.futureReferencesAllowed
  || record.invariants.createsStrategy
  || record.invariants.enablesExecution
) {
  throw new Error("Formula operator catalog knowledge contract does not match disposition");
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

await caller.kb.upsert({
  slug,
  title: "Alchemy Formula Lab — governed operator catalog v1",
  category: "research",
  tags: [
    "alchemy",
    "formula-lab",
    "operators",
    "symbolic-regression",
    "qlib",
    "causality",
    "paper-only",
  ],
  body: renderFormulaOperatorCatalogKnowledge(new Date().toISOString()),
  sources: record.sources.map(({ title, url }) => ({ title, url })),
  status: "active",
});

console.log(JSON.stringify({
  updated: true,
  auditInserted: await ensureAudit(),
  slug,
  sourceCount: record.sources.length,
  strategyRegistered: false,
  executionAllowed: false,
}, null, 2));
process.exit(0);
