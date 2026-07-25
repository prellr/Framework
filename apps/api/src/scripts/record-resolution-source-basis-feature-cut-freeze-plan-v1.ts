/**
 * Preregister the deterministic post-readiness basis-reference freeze.
 *
 * This script reads/writes KB and audit metadata only. It does not query a basis value, outcome,
 * paper decision, result, account, position, wallet, or order.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import {
  RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE,
} from "../services/resolution-source-basis-feature-cut-freeze.ts";

const contract = RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE;
const slug = contract.planVersion;
const marker = "## Outcome-blind resolution-source basis feature-cut freeze plan v1";
const action = "kb.preregistration.record";
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
  req: new Request("http://localhost/internal/kb-resolution-source-basis-feature-cut-plan"),
};
const caller = appRouter.createCaller(ctx);

if (
  contract.planVersion !== "updown-resolution-source-basis-feature-cut-freeze-plan-v1"
  || contract.artifactVersion !== "updown-resolution-source-basis-feature-cuts-v1"
  || contract.prerequisiteVersion !== "updown-resolution-source-basis-distribution-audit-v1"
  || contract.tapeVersion !== "updown-venue-lead-lag-tape-v1"
  || contract.requiredPairs !== 6
  || contract.minimumBoundaryDelayMs !== 30 * 60_000
  || contract.boundaryGridMs !== 15 * 60_000
) {
  throw new Error("resolution-source basis feature-cut contract does not match preregistration");
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

const body = [
  marker,
  "",
  `Registered ${new Date().toISOString()} while the inherited three-day venue-tape clock was still locked and before any basis distribution was disclosed.`,
  "",
  "### Mechanical freeze contract",
  "",
  `- Prerequisite: \`${contract.prerequisiteVersion}\` must expose all ${contract.requiredPairs} pair buckets from \`${contract.tapeVersion}\`; its loader remains unreachable until every pair passes the original 100,000-row, three-day, 500-block floor.`,
  `- Pair order is fixed: BNB-USD, BTC-USD, DOGE-USD, ETH-USD, SOL-USD, XRP-USD. The pooled distribution is deliberately excluded because a pooled cut is not transferable across assets.`,
  `- Metrics are fixed: ${contract.metrics.join(", ")}.`,
  "- Every metric retains its non-null sample count and p05/p25/p50/p75/p95 references. IQR is derived deterministically as p75 − p25.",
  "- Signed basis and exact-one-second basis change must have positive IQR. Absolute basis and source ages must be non-negative; persistence must stay in [0,1]; source-age references may not exceed the inherited 10-second ceiling.",
  `- ${contract.referencePolicy}`,
  "- The artifact is canonical JSON with a SHA-256 digest. If it already exists, reruns verify and return the original artifact rather than recomputing from a later sample.",
  "",
  "### Contamination and strategy boundary",
  "",
  `- No future experiment or paper identity may begin before the first ${contract.boundaryGridMs / 60_000}-minute grid point at least ${contract.minimumBoundaryDelayMs / 60_000} minutes after the artifact is frozen.`,
  "- These references do not choose continuation or reversal, select UP or DOWN, set a basis magnitude, persistence, entry ask, decision phase, or formula threshold, or combine 5m and 15m evidence.",
  "- Formula Lab may consume the immutable references only from a separately registered live-data experiment. Every formula × threshold × exit remains a declared trial and any exported hypothesis requires a new forward boundary.",
  "- A Polymarket translation still requires independent 5m and 15m identities, fee-adjusted executable paired books, incremental comparison against Chainlink-only pricers, and the unchanged familywise verdict gate.",
  "- This plan creates no collector, subscription, polling loop, table, strategy, paper insertion, Crucible run, account access, signing capability, order route, allocation, or fund-moving path.",
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Outcome-blind resolution-source basis feature-cut freeze plan v1",
  category: "research",
  tags: [
    "alchemy",
    "formula-lab",
    "polymarket",
    "updown",
    "chainlink",
    "hyperliquid",
    "basis",
    "paper-only",
  ],
  body,
  sources: [
    {
      title: "Outcome-free resolution-source basis distribution audit v1",
      url: "https://jester.wisco.wine/knowledge/updown-resolution-source-basis-distribution-audit-v1",
    },
    {
      title: "Polymarket RTDS: real-time Binance and Chainlink data",
      url: "https://docs.polymarket.com/market-data/websocket/rtds",
    },
    {
      title: "Alchemy Formula Lab research framework v2",
      url: "https://jester.wisco.wine/knowledge/alchemy-formula-lab-research-framework-v2",
    },
  ],
  status: "active",
});

console.log(JSON.stringify({
  updated: true,
  auditInserted: await ensureAudit(),
  slug,
  prerequisite: contract.prerequisiteVersion,
  tapeVersion: contract.tapeVersion,
  requiredPairs: contract.requiredPairs,
  metrics: contract.metrics,
}, null, 2));
process.exit(0);
