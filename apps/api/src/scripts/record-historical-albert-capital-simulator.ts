/**
 * Record the historical Albert capital-simulator contract in Alchemy's knowledge base.
 *
 * This writes KB and audit metadata only. It cannot reach an account, modify a frozen receipt,
 * register a strategy, create a paper bot, or enable execution.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import {
  HISTORICAL_ALBERT_CAPITAL_SIMULATOR_KNOWLEDGE,
  renderHistoricalAlbertCapitalSimulatorKnowledge,
} from "../services/historical-albert-capital-simulator-knowledge.ts";
import {
  HISTORICAL_ALBERT_TRADE_LEDGER_IDENTITY,
} from "../services/historical-albert-capital-simulator.ts";

const record = HISTORICAL_ALBERT_CAPITAL_SIMULATOR_KNOWLEDGE;
const slug = record.version;
const marker = "## Historical Albert trade ledger and capital simulator v1";
const action = "kb.historical-albert-capital-simulator.record";
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
  req: new Request("http://localhost/internal/kb-historical-albert-capital-simulator"),
};
const caller = appRouter.createCaller(ctx);

if (
  record.status !== "active"
  || record.invariants.changesFrozenReceipt
  || record.invariants.readsLiveAccount
  || record.invariants.selectsWinner
  || record.invariants.registersStrategy
  || record.invariants.createsPaperBot
  || record.invariants.enablesExecution
) {
  throw new Error("historical Albert capital-simulator knowledge contract is unsafe");
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
if (
  existing?.body.includes(marker)
  && existing.body.includes(HISTORICAL_ALBERT_TRADE_LEDGER_IDENTITY.contentHash)
) {
  console.log(JSON.stringify({
    updated: false,
    auditInserted: await ensureAudit(),
    slug,
    reason: "already_recorded",
  }, null, 2));
  process.exit(0);
}
if (existing && !existing.body.includes(marker)) {
  throw new Error(`refusing to replace existing KB article without marker: ${slug}`);
}

await caller.kb.upsert({
  slug,
  title: "Historical Albert trade ledger and capital simulator v1",
  category: "research",
  tags: [
    "alchemy",
    "formula-lab",
    "albert",
    "hyperliquid",
    "fees",
    "funding",
    "capital-simulation",
    "trade-ledger",
    "walk-forward",
    "paper-only",
  ],
  body: renderHistoricalAlbertCapitalSimulatorKnowledge(new Date().toISOString()),
  sources: record.sources.map(({ title, url }) => ({ title, url })),
  status: "active",
});
await audit(ctx, action, {
  resourceType: "kbArticle",
  resourceId: slug,
  newValue: {
    contentHash: HISTORICAL_ALBERT_TRADE_LEDGER_IDENTITY.contentHash,
  },
});

console.log(JSON.stringify({
  updated: true,
  auditInserted: true,
  slug,
  contentHash: HISTORICAL_ALBERT_TRADE_LEDGER_IDENTITY.contentHash,
  tradeObservations: HISTORICAL_ALBERT_TRADE_LEDGER_IDENTITY.trades,
  strategyRegistered: false,
  executionAllowed: false,
}, null, 2));
process.exit(0);
