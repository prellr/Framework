/**
 * Record the Albert BTC 1h-chart sensitivity receipt in Alchemy's knowledge base.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import {
  HISTORICAL_ALBERT_ONE_HOUR_CHART_SENSITIVITY_KNOWLEDGE,
  renderHistoricalAlbertOneHourChartSensitivityKnowledge,
} from "../services/historical-albert-one-hour-chart-sensitivity-knowledge.ts";

const record = HISTORICAL_ALBERT_ONE_HOUR_CHART_SENSITIVITY_KNOWLEDGE;
const slug = record.version;
const marker = "## Historical Albert formula × BTC 1h-chart sensitivity v1";
const action = "kb.historical-albert-one-hour-chart-sensitivity.record";
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
  req: new Request("http://localhost/internal/kb-historical-albert-one-hour-chart-sensitivity"),
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
  throw new Error("Albert 1h-chart knowledge contract does not match disposition");
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
  title: "Historical Albert formula × BTC 1h-chart sensitivity v1",
  category: "research",
  tags: [
    "alchemy",
    "formula-lab",
    "qlib",
    "hyperliquid",
    "btc",
    "1h-chart",
    "walk-forward",
    "paper-only",
  ],
  body: renderHistoricalAlbertOneHourChartSensitivityKnowledge(new Date().toISOString()),
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
  horizons: record.receipt.target.requestedHoldMinutes,
  strategyRegistered: false,
  executionAllowed: false,
}, null, 2));
process.exit(0);
