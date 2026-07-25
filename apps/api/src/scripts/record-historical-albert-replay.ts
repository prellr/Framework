/**
 * Record the historical Albert/BTC replay research receipt in Alchemy's in-app knowledge base.
 *
 * This writes KB and audit metadata only. It does not read market outcomes, register a strategy,
 * create a paper bot, start a search, or reach an execution path.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import {
  HISTORICAL_ALBERT_REPLAY_KNOWLEDGE,
  renderHistoricalAlbertReplayKnowledge,
} from "../services/historical-albert-replay-knowledge.ts";

const record = HISTORICAL_ALBERT_REPLAY_KNOWLEDGE;
const slug = record.version;
const marker = "## Historical Albert formula × BTC 5m fixed-horizon replay v1";
const action = "kb.historical-albert-replay.record";
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
  req: new Request("http://localhost/internal/kb-historical-albert-replay"),
};
const caller = appRouter.createCaller(ctx);

if (
  record.status !== "active"
  || record.invariants.readsLockedLiveValues
  || record.invariants.readsPaperOutcomes
  || record.invariants.changesVerdictGate
  || record.invariants.createsStrategy
  || record.invariants.createsPaperBot
  || record.invariants.startsSearch
  || record.invariants.enablesExecution
  || !record.invariants.preservesVerdictGate
) {
  throw new Error("historical Albert replay knowledge contract does not match disposition");
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
  && existing.body.includes(record.receipt.receiptHash)
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
  title: "Historical Albert formula × BTC 5m fixed-horizon replay v1",
  category: "research",
  tags: [
    "alchemy",
    "formula-lab",
    "qlib",
    "symbolic-regression",
    "hyperliquid",
    "btc",
    "walk-forward",
    "paper-only",
  ],
  body: renderHistoricalAlbertReplayKnowledge(new Date().toISOString()),
  sources: record.sources.map(({ title, url }) => ({ title, url })),
  status: "active",
});
await audit(ctx, action, {
  resourceType: "kbArticle",
  resourceId: slug,
  newValue: { receiptHash: record.receipt.receiptHash },
});

console.log(JSON.stringify({
  updated: true,
  auditInserted: true,
  slug,
  receiptHash: record.receipt.receiptHash,
  sourceCount: record.sources.length,
  strategyRegistered: false,
  executionAllowed: false,
}, null, 2));
process.exit(0);
