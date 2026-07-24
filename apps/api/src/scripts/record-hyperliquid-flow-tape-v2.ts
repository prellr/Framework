/**
 * Idempotently preregister sparse-flow-safe Hyperliquid tape v2 before its future boundary.
 *
 * This script reads and writes KB/audit metadata only. It never queries flow values, state labels,
 * market outcomes, paper decisions, strategy results, accounts, positions, or orders.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { HYPERLIQUID_FLOW_TAPE } from "../services/hl-rtds.ts";

const slug = "updown-hyperliquid-taker-flow-tape-v2";
const priorSlug = "updown-hyperliquid-taker-flow-tape-v1";
const marker = "## Prospective registration — Hyperliquid sparse aggressor flow v2";
const failureMarker = "## Outcome-blind launch failure — 2026-07-24T01:05:09Z";
const action = "kb.preregistration.record";
const categories = ["operations", "strategy", "research", "provider", "decision", "postmortem"] as const;
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
  req: new Request("http://localhost/internal/kb-hyperliquid-flow-v2"),
};
const caller = appRouter.createCaller(ctx);

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

if (
  HYPERLIQUID_FLOW_TAPE.version !== "updown-hyperliquid-taker-flow-tape-v2"
  || new Date(HYPERLIQUID_FLOW_TAPE.evalStartMs).toISOString() !== "2026-07-24T02:00:00.000Z"
) {
  throw new Error("Hyperliquid flow v2 executable contract does not match its preregistration");
}
if (Date.now() >= HYPERLIQUID_FLOW_TAPE.evalStartMs) {
  throw new Error("Hyperliquid flow v2 registration boundary has already passed");
}

const existing = await caller.kb.get({ slug });
if (existing?.body.includes(marker)) {
  console.log(JSON.stringify({
    updated: false,
    auditInserted: await ensureAudit(),
    slug,
    reason: "already_registered",
  }));
  process.exit(0);
}
if (existing) throw new Error(`refusing to replace pre-existing KB article without marker: ${slug}`);

const sources = [
  {
    title: "Hyperliquid WebSocket subscriptions",
    url: "https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions",
  },
  {
    title: "Hyperliquid API notation",
    url: "https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/notation",
  },
  {
    title: "Price Impact of Order Book Events",
    url: "https://arxiv.org/abs/1011.6402",
  },
  {
    title: "Multi-Level Order-Flow Imbalance in a Limit Order Book",
    url: "https://arxiv.org/abs/1907.06230",
  },
];
const body = [
  marker,
  "",
  `Registered ${new Date().toISOString()} for the frozen boundary ${new Date(HYPERLIQUID_FLOW_TAPE.evalStartMs).toISOString()}.`,
  "",
  "### Why v2 exists",
  "",
  "- The v1 launch audit failed closed at 2026-07-24T01:05:09.484Z after 54 tagged rows: 29 were usable under v1 and operational health failed because the latest included BNB trade was 38.965 seconds old.",
  "- The outcome-blind bucket audit showed that every 60-second aggregate was present and maximum transport lag stayed below one second. Quiet BNB, DOGE, and SOL 5s/30s subwindows—not a stalled socket—caused the missing short-window ratios and old-last-trade flag.",
  "- No flow sign, magnitude, outcome, grade, paper decision, P&L, or strategy comparison was selected while diagnosing v1.",
  "",
  "### Frozen v2 collection and readiness contract",
  "",
  "- Source, six-asset universe, 5s/30s/60s windows, deduplication, causal dual-clock filtering, in-memory retention, stored columns, and read-only public WebSocket remain unchanged from v1.",
  "- A null 5s or 30s imbalance explicitly means no trade occurred in that subwindow. It is valid sparse-flow data and does not make the enclosing state row unusable.",
  "- A usable row requires the complete 60-second aggregate, source/receipt timing, largest-trade share, and maximum transport lag. Its most recent included trade must be no more than 60 seconds old and maximum transport lag must be no more than 5,000 ms.",
  "- Operational health requires a tagged state capture within 180 seconds and the most recent 12 tagged rows to satisfy both the 60-second last-trade bound and 5,000 ms transport-lag ceiling. A stalled socket naturally stops producing tagged rows after the rolling 60-second buffer expires.",
  `- Readiness floors remain ${HYPERLIQUID_FLOW_TAPE.minUsableRows.toLocaleString()} usable rows, ${HYPERLIQUID_FLOW_TAPE.minResolvedMarkets.toLocaleString()} resolved markets, ${HYPERLIQUID_FLOW_TAPE.minSpanDays} days, ${HYPERLIQUID_FLOW_TAPE.minMarketsPerBucket} distinct markets in every asset × 5m/15m bucket, and ${(HYPERLIQUID_FLOW_TAPE.minCoverage * 100).toFixed(0)}% usable coverage.`,
  "- Before every floor passes, status surfaces may disclose only version, counts, spans, bucket coverage, short-window nullability, and timing/transport health. Flow signs, outcomes, grades, strategy comparisons, and P&L remain prohibited.",
  "- After readiness, only outcome-free feature and missingness distributions may be inspected. Any directional hypothesis requires a separate exact rule, a later future boundary, an independent paper bot, executable fee-adjusted paired-book fills, and the existing verdict gate.",
  "",
  "### Safety and load",
  "",
  "- V2 changes only the interpretation of explicit quiet subwindows and the readiness health predicate. It adds no subscription, raw-event table, polling loop, feature, account data, wallet, signature, order, cancellation, position, allocation, or fund-moving capability.",
  "- V1 rows remain immutable under their original version and boundary for auditability; they carry no gate weight and are superseded by this contract.",
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Hyperliquid sparse aggressor-flow tape v2",
  category: "research" as (typeof categories)[number],
  tags: ["polymarket", "updown", "hyperliquid", "order-flow", "microstructure", "paper-only"],
  body,
  sources,
  status: "active" as (typeof statuses)[number],
});

const prior = await caller.kb.get({ slug: priorSlug });
if (prior && !prior.body.includes(failureMarker)) {
  await caller.kb.upsert({
    slug: prior.slug,
    title: prior.title,
    category: prior.category as (typeof categories)[number],
    tags: prior.tags ?? [],
    body: [
      prior.body,
      "",
      failureMarker,
      "",
      "- V1 launched at its exact boundary and preserved 54 tagged rows with zero pre-boundary, version, universe, schema, or prohibited-source violations.",
      "- Its 01:05:09Z audit failed operational readiness: only 29/54 rows met the v1 predicate, 25 contained legitimate quiet 5s/30s subwindows, and the latest included BNB trade was 38.965 seconds old despite sub-second transport lag.",
      "- This was diagnosed using only version, bucket, nullability, capture time, last-trade age, and transport-lag metadata. No flow signs or outcomes were read.",
      `- V1 is superseded by \`${slug}\`, which begins at the independent future boundary ${new Date(HYPERLIQUID_FLOW_TAPE.evalStartMs).toISOString()}.`,
    ].join("\n"),
    sources: (prior.sources ?? []) as { title: string; url: string }[],
    status: "superseded" as (typeof statuses)[number],
    supersededBySlug: slug,
  });
}

console.log(JSON.stringify({
  updated: true,
  auditInserted: await ensureAudit(),
  slug,
  version: HYPERLIQUID_FLOW_TAPE.version,
  boundary: new Date(HYPERLIQUID_FLOW_TAPE.evalStartMs).toISOString(),
  priorSuperseded: Boolean(prior),
}, null, 2));
process.exit(0);
