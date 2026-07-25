/**
 * Record external Up/Down system and historical Formula Lab intelligence in the in-app KB.
 *
 * This script reads/writes KB and audit metadata only. It does not query feature values, market
 * outcomes, paper results, accounts, Crucible, strategies, positions, wallets, or an order route.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import {
  EXTERNAL_UPDOWN_SYSTEM_INTELLIGENCE,
  renderExternalUpdownSystemIntelligence,
} from "../services/external-updown-system-intelligence.ts";

const record = EXTERNAL_UPDOWN_SYSTEM_INTELLIGENCE;
const slug = record.version;
const marker = "## External crypto Up/Down systems and Formula Lab priors — 2026-07-24";
const action = "kb.external-system-intelligence.record";
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
  req: new Request("http://localhost/internal/kb-external-updown-system-intelligence"),
};
const caller = appRouter.createCaller(ctx);

if (
  record.version !== "alchemy-external-updown-system-intelligence-2026-07-24" ||
  record.status !== "active" ||
  record.invariants.readsLockedFeatureValues ||
  record.invariants.readsMarketOutcomes ||
  record.invariants.readsPaperOutcomes ||
  record.invariants.changesFeatureCuts ||
  record.invariants.createsStrategy ||
  record.invariants.createsPaperBot ||
  record.invariants.startsSearch ||
  record.invariants.startsCrucibleRun ||
  record.invariants.enablesExecution ||
  !record.invariants.preservesVerdictGate
) {
  throw new Error("external system intelligence contract does not match disposition");
}

const ensureAudit = async () => {
  const [existing] = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, action),
        eq(auditLogs.resourceType, "kbArticle"),
        eq(auditLogs.resourceId, slug),
      ),
    )
    .limit(1);
  if (existing) return false;
  await audit(ctx, action, { resourceType: "kbArticle", resourceId: slug });
  return true;
};

const existing = await caller.kb.get({ slug });
if (existing?.body.includes(marker)) {
  console.log(
    JSON.stringify(
      {
        updated: false,
        auditInserted: await ensureAudit(),
        slug,
        reason: "already_recorded",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
if (existing) throw new Error(`refusing to replace existing KB article without marker: ${slug}`);

await caller.kb.upsert({
  slug,
  title: "External crypto Up/Down systems and Formula Lab priors — 2026-07-24",
  category: "research",
  tags: [
    "alchemy",
    "formula-lab",
    "polymarket",
    "updown",
    "screenshots",
    "external-prior",
    "execution-realism",
    "paper-only",
  ],
  body: renderExternalUpdownSystemIntelligence(new Date().toISOString()),
  sources: record.sources.map(({ title, url }) => ({ title, url })),
  status: "active",
});

console.log(
  JSON.stringify(
    {
      updated: true,
      auditInserted: await ensureAudit(),
      slug,
      sourceCount: record.sources.length,
      legacyFormula: record.historicalFormula.id,
      formulaNodes: record.historicalFormula.complexity,
    },
    null,
    2,
  ),
);
process.exit(0);
