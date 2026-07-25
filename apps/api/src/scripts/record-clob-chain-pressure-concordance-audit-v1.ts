/**
 * Preregister the outcome-free CLOB event-OFI versus verified-chain pressure mechanism audit.
 *
 * This script reads/writes KB and audit metadata only. It cannot query either source tape value,
 * any outcome, paper decision, result, account, wallet, position, credential, or order.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import {
  CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT,
} from "../services/clob-chain-pressure-concordance-contract.ts";

const slug = CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.version;
const marker = "## Outcome-free CLOB/chain pressure concordance audit v1";
const action = "kb.preregistration.record";
const categories = [
  "operations",
  "strategy",
  "research",
  "provider",
  "decision",
  "postmortem",
] as const;
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
  req: new Request("http://localhost/internal/kb-clob-chain-pressure-concordance-v1"),
};
const caller = appRouter.createCaller(ctx);

if (
  CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.version !==
    "updown-clob-chain-pressure-concordance-audit-v1"
  || CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.anchorSampleMinute !== 0
  || CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.anchorOffsetMinSec !== 55
  || CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.anchorOffsetMaxExclusiveSec !== 60
  || CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.expectedBuckets !== 12
  || CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.minMatchedMarketsPerBucket !== 100
) {
  throw new Error("CLOB/chain pressure concordance contract does not match preregistration");
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
  console.log(JSON.stringify({
    updated: false,
    auditInserted: await ensureAudit(),
    slug,
    reason: "already_registered",
  }, null, 2));
  process.exit(0);
}
if (existing) throw new Error(`refusing to replace existing KB article without marker: ${slug}`);

const metricLines = Object.entries(CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.definitions)
  .map(([metric, definition]) => `- \`${metric}\`: ${definition}.`);
const body = [
  marker,
  "",
  `Registered ${new Date().toISOString()} while both inherited value gates were still locked.`,
  "",
  "### Frozen source and clock contract",
  "",
  `- Live proxy source: \`${CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.clobTapeVersion}\`; canonical 60-second public CLOB queue-event OFI only.`,
  `- Delayed reference source: \`${CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.referenceTapeVersion}\`; independently receipt-verified events with at least 20 confirmations.`,
  `- Reference clock: exact \`[window_start, window_start + ${CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.referenceWindowSec}s)\`.`,
  `- Proxy clock: immutable state-tape sample minute ${CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.anchorSampleMinute}, admitted only when captured in \`[+${CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.anchorOffsetMinSec}s, +${CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.anchorOffsetMaxExclusiveSec}s)\`. Its trailing minute overlaps at least ${CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.minimumClockOverlapSec}s but can include and omit up to ${CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.maximumClockMismatchSec}s at the boundaries. It is near-synchronous, not exact.`,
  "- The proxy is already canonicalized as `(UP queue-event OFI - DOWN queue-event OFI) / 2`. The reference is canonical net verified shares divided by gross verified shares: buy UP and sell DOWN are positive; sell UP and buy DOWN are negative.",
  "- Each source is aggregated to one row per condition before matching. Only the same condition, asset, and horizon may match.",
  "",
  "### Frozen readiness and disclosure",
  "",
  "- No matched-panel query runs until both inherited tape gates pass in full.",
  `- The matched-panel query is count/nullability/time metadata only. It must cover at least ${CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.minMatchedSpanDays} days, retain ${(100 * CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.minAnchorCoverage).toFixed(0)}% anchor coverage, contain all ${CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.expectedBuckets} asset × horizon buckets, and reach ${CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.minMatchedMarketsPerBucket} matched markets in every bucket.`,
  "- 5m and 15m remain separate panels. The pooled row is descriptive and cannot admit either horizon.",
  "- Aggregate values remain unreachable until the matched-panel gate also passes.",
  ...metricLines,
  "",
  "### Interpretation and constraints",
  "",
  `- Intended use: ${CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.intendedUse}.`,
  `- Prohibited use: ${CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.prohibitedUse}.`,
  "- Correlation and sign agreement compare two mechanism measurements, not either measurement with a market outcome. No market-level proxy or reference value is disclosed.",
  "- Polygon finality makes the reference unavailable at the decision clock. It may validate the live proxy after the fact but can never be read by the live paper path.",
  "- This registration creates no feature cut, threshold, strategy, roster entry, paper identity, verdict, order route, signer, allocation, or fund-moving capability.",
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Outcome-free CLOB/chain pressure concordance audit v1",
  category: "research" as (typeof categories)[number],
  tags: [
    "polymarket",
    "updown",
    "clob-ofi",
    "taker-pressure",
    "proxy-validation",
    "paper-only",
  ],
  body,
  sources: [
    {
      title: "Polymarket CLOB WebSocket market channel",
      url: "https://docs.polymarket.com/developers/CLOB/websocket/market-channel",
    },
    {
      title: "Polymarket CTF Exchange contracts",
      url: "https://docs.polymarket.com/developers/CTF/deployment-resources",
    },
  ],
  status: "active" as (typeof statuses)[number],
});

console.log(JSON.stringify({
  updated: true,
  auditInserted: await ensureAudit(),
  slug,
  clock: {
    anchorSampleMinute: CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.anchorSampleMinute,
    anchorOffsetMinSec: CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.anchorOffsetMinSec,
    anchorOffsetMaxExclusiveSec:
      CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.anchorOffsetMaxExclusiveSec,
    maximumClockMismatchSec:
      CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.maximumClockMismatchSec,
  },
  expectedBuckets: CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.expectedBuckets,
  metrics: CLOB_CHAIN_PRESSURE_CONCORDANCE_AUDIT.metrics,
}, null, 2));
process.exit(0);
