/**
 * Preregister the exact post-readiness analysis for the existing venue basis tape.
 *
 * This script reads/writes KB and audit metadata only. It does not query a feature value, market
 * outcome, paper decision, strategy result, account, wallet, Crucible service, or order route.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import {
  RESOLUTION_SOURCE_BASIS_DISTRIBUTION_AUDIT,
} from "../services/resolution-source-basis-distribution-contract.ts";

const contract = RESOLUTION_SOURCE_BASIS_DISTRIBUTION_AUDIT;
const slug = contract.version;
const marker = "## Outcome-free resolution-source basis distribution audit v1";
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
  req: new Request("http://localhost/internal/kb-resolution-source-basis-distribution"),
};
const caller = appRouter.createCaller(ctx);

if (
  contract.version !== "updown-resolution-source-basis-distribution-audit-v1"
  || contract.tapeVersion !== "updown-venue-lead-lag-tape-v1"
  || contract.pairs.length !== 6
  || contract.quantileProbabilities.join(",") !== "0.05,0.25,0.5,0.75,0.95"
  || contract.metrics.join(",")
    !== "basisBps,absoluteBasisBps,basisChange1sBps,sameSignPersistence5s,chainlinkAgeMs,hlAgeMs"
) {
  throw new Error("resolution-source basis executable contract does not match preregistration");
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
    title: "Polymarket RTDS: real-time Binance and Chainlink data",
    url: "https://docs.polymarket.com/market-data/websocket/rtds",
  },
  {
    title: "The Anatomy of a Decentralized Prediction Market",
    url: "https://arxiv.org/abs/2604.24366",
  },
  {
    title: "Polymarket Trade Engine: multi-source ticker and divergence mechanics",
    url: "https://github.com/KaustubhPatange/polymarket-trade-engine",
  },
];

const body = [
  marker,
  "",
  `Registered ${new Date().toISOString()} before the inherited venue tape passed readiness and before any basis value was queried.`,
  "",
  "### Exact disclosure plan",
  "",
  `- Source: \`${contract.tapeVersion}\`, beginning at its original prospective boundary.`,
  `- Required universe: ${contract.pairs.join(", ")}. Every pair must pass the inherited 100,000-row, three-day, 500-block floor before one feature query can run.`,
  "- The venue tape is horizon-neutral, so the audit has one pooled row and six pair rows. It does not manufacture duplicate 5m and 15m feature buckets.",
  `- Quantiles are fixed at ${contract.quantileProbabilities.join(", ")}.`,
  `- Metrics are fixed at ${contract.metrics.join(", ")}.`,
  `- Basis definition: ${contract.definitions.basisBps}.`,
  `- One-second change: ${contract.definitions.basisChange1sBps}.`,
  `- Persistence: ${contract.definitions.sameSignPersistence5s}.`,
  "- Changes require an exact prior second; persistence requires four exact prior seconds. Gaps remain null and are never interpolated.",
  `- Source ages retain the collector's existing ${contract.maximumSourceAgeMs}ms ceiling.`,
  `- A successful report is cached for ${contract.cacheMs / 60_000} minutes to bound Server2 database load.`,
  "",
  "### Research and execution constraints",
  "",
  "- The report contains feature distributions only. It may not select or join a market, horizon, side, resolution, label, paper decision, fill, grade, return, P&L, account, position, wallet, or order.",
  "- A ready distribution does not authorize a threshold or direction. Immutable cuts must be captured separately; any later rule must be registered at a new future boundary with independent 5m and 15m paper identities.",
  "- Any later candidate must compare incrementally against Chainlink-only pricers and always-UP/always-DOWN controls and pass the unchanged verdict gate.",
  "- This artifact adds no collector, subscription, table, polling loop, strategy, paper decision, Crucible run, signing capability, order route, allocation, or fund-moving path.",
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Outcome-free resolution-source basis distribution audit v1",
  category: "research",
  tags: [
    "polymarket",
    "updown",
    "chainlink",
    "hyperliquid",
    "basis",
    "distribution",
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
  pairs: contract.pairs,
  metrics: contract.metrics,
  quantiles: contract.quantileProbabilities,
}, null, 2));
process.exit(0);
