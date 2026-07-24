/**
 * Idempotently preregister the compact Hyperliquid aggressor-flow tape before its frozen boundary.
 *
 * Registration is outcome-blind: this script reads/writes KB and audit metadata only. It never
 * queries state-tape labels, paper decisions, strategy results, accounts, positions, or orders.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";

const slug = "updown-hyperliquid-taker-flow-tape-v1";
// Historical scripts must not import the current executable contract. These are the exact v1
// values that were preregistered before its 2026-07-24T01:00:00Z launch.
const contract = {
  version: "updown-hyperliquid-taker-flow-tape-v1",
  evalStartMs: Date.UTC(2026, 6, 24, 1, 0, 0),
  minUsableRows: 20_000,
  minResolvedMarkets: 1_500,
  minSpanDays: 5,
  minMarketsPerBucket: 100,
  minCoverage: 0.95,
  maxReceiveAgeSec: 10,
  maxTransportLagMs: 5_000,
} as const;
const marker = "## Prospective registration — Hyperliquid aggressor flow v1";
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
  req: new Request("http://localhost/internal/kb-hyperliquid-flow-v1"),
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

const existing = await caller.kb.get({ slug });
if (existing?.body.includes(marker)) {
  console.log(JSON.stringify({ updated: false, auditInserted: await ensureAudit(), slug, reason: "already_registered" }));
  process.exit(0);
}
if (existing) throw new Error(`refusing to replace pre-existing KB article without marker: ${slug}`);
if (Date.now() >= contract.evalStartMs) {
  throw new Error("Hyperliquid flow v1 registration boundary has already passed");
}

const body = [
  marker,
  "",
  `Registered ${new Date().toISOString()} for the frozen boundary ${new Date(contract.evalStartMs).toISOString()}.`,
  "",
  "### Research disposition",
  "",
  "- Public repositories using RSI/VWAP/MACD/Heikin-Ashi composites were rejected: their inputs are highly correlated, their hand scores are not calibrated probabilities, and at least one implementation normalized away the executable spread before claiming edge.",
  "- The retained ingredient is underlying-venue aggressor flow. Limit-order-book research supports signed order flow as a short-horizon price-pressure variable, while the inspected public implementation is treated as feature prior art only because its reported P&L enters and exits at midpoint.",
  "- No directional sign, magnitude threshold, session, asset preference, probability bridge, or paper-trading rule is registered here.",
  "",
  "### Frozen collection contract",
  "",
  "- Source: Hyperliquid's public `trades` WebSocket subscription for BTC, ETH, SOL, XRP, DOGE, and BNB on the same read-only socket already used for public BBO observations.",
  "- Hyperliquid's documented aggressor side is retained (`B` buy, `A` sell). Each event keeps exchange time and local receipt time in memory; reconnect duplicates are removed by pair + exchange time + trade id.",
  "- Raw events remain memory-bounded and are never written. At each existing Polymarket state-tape capture, Jester stores only notional-weighted imbalance over 5s/30s/60s, total 60s notional, 60s trade count, largest-trade share, source/receipt age, and maximum transport lag.",
  "- Both source time and local receipt time must lie in the aggregate window, so reconnect backfills cannot masquerade as a fresh impulse.",
  `- Readiness floors: ${contract.minUsableRows.toLocaleString()} usable rows, ${contract.minResolvedMarkets.toLocaleString()} resolved markets, ${contract.minSpanDays} days, ${contract.minMarketsPerBucket} distinct markets in every asset × 5m/15m bucket, ${(contract.minCoverage * 100).toFixed(0)}% usable coverage, no row with more than ${contract.maxTransportLagMs.toLocaleString()} ms maximum transport lag, no included trade older than ${contract.maxReceiveAgeSec} seconds at receipt, and fresh operational health.`,
  "- Before every floor passes, status surfaces may disclose only counts, spans, bucket coverage, nullability, and freshness. They may not select or expose flow signs, outcomes, grades, strategy comparisons, or P&L.",
  "- After readiness, only outcome-free feature distributions may be inspected. Any directional hypothesis requires a separate exact rule, future boundary, independent bot key, real fee-adjusted paired-book fill, and the existing verdict gate.",
  "",
  "### Load and safety budget",
  "",
  "- A 20-second Server2 probe across all six symbols observed 204 trades in 35 frames and 57,146 bytes (about 10.2 trades/sec and 2.9 kB/sec).",
  "- The implementation adds six subscriptions to the existing Hyperliquid connection, performs bounded in-memory arithmetic, and adds columns to state rows already being inserted. It creates no raw-event relation and no new polling loop.",
  "- This path is public-data and paper-research only. No account address, credential, wallet, signature, `/exchange` request, order, cancellation, position, allocation, or fund-moving capability is permitted.",
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Hyperliquid aggressor-flow tape v1",
  category: "research" as (typeof categories)[number],
  tags: ["polymarket", "updown", "hyperliquid", "order-flow", "microstructure", "paper-only"],
  body,
  sources: [
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
    {
      title: "Cross-market state fusion prior art",
      url: "https://github.com/humanplane/cross-market-state-fusion",
    },
  ],
  status: "active" as (typeof statuses)[number],
});
console.log(JSON.stringify({
  updated: true,
  auditInserted: await ensureAudit(),
  slug,
  version: contract.version,
  boundary: new Date(contract.evalStartMs).toISOString(),
}, null, 2));
process.exit(0);
