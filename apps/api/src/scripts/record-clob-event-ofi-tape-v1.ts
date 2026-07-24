/**
 * Idempotently preregister the compact public CLOB event-OFI tape before its future boundary.
 *
 * KB/audit metadata only: no state rows, feature values, outcomes, decisions, or P&L are queried.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { CLOB_EVENT_OFI_TAPE } from "../services/clob-event-ofi.ts";

const slug = CLOB_EVENT_OFI_TAPE.version;
const marker = "## Prospective registration — public CLOB event-OFI tape v1";
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
  req: new Request("http://localhost/internal/kb-clob-event-ofi-v1"),
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
  CLOB_EVENT_OFI_TAPE.version !== "updown-clob-event-ofi-tape-v1"
  || new Date(CLOB_EVENT_OFI_TAPE.evalStartMs).toISOString() !== "2026-07-24T07:00:00.000Z"
) {
  throw new Error("CLOB event-OFI executable contract does not match its preregistration");
}
if (Date.now() >= CLOB_EVENT_OFI_TAPE.evalStartMs) {
  throw new Error("CLOB event-OFI registration boundary has already passed");
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
    title: "Polymarket public market WebSocket event contract",
    url: "https://github.com/Polymarket/agent-skills/blob/main/websocket.md",
  },
  {
    title: "The Price Impact of Order Book Events",
    url: "https://arxiv.org/abs/1011.6402",
  },
  {
    title: "Cross-Impact of Order Flow Imbalance in Equity Markets",
    url: "https://arxiv.org/abs/2112.13213",
  },
];
const body = [
  marker,
  "",
  `Registered ${new Date().toISOString()} for the frozen boundary ${new Date(CLOB_EVENT_OFI_TAPE.evalStartMs).toISOString()}.`,
  "",
  "### Research rationale",
  "",
  "- Polymarket's public market stream emits full `book` snapshots and `price_change` frames for order placement/cancellation, including asset, level, size, and current best prices.",
  "- Limit-order-book research finds that queue-event OFI explains short-horizon contemporaneous price impact more robustly than trade volume and that lagged integrated OFI can contain short-lived predictive information. Those equity findings are prior art only; they are not assumed to transfer to binary crypto markets.",
  "- Jester's existing minute-snapshot OFI can miss transient queue build-up and depletion. This tape asks only whether a compact event-level representation can be collected causally and reliably enough for a later outcome-free distribution audit.",
  "",
  "### Frozen collection contract",
  "",
  `- Version \`${CLOB_EVENT_OFI_TAPE.version}\`; boundary ${new Date(CLOB_EVENT_OFI_TAPE.evalStartMs).toISOString()}; public six-asset 5m/15m Up/Down universe.`,
  "- Reuse the already-running authoritative trade-flow market socket. Do not create another connection, subscription universe, poller, or raw-event table.",
  "- Reconstruct per-token bid/ask levels in memory from full books and standard price changes. Fold successive best-queue states with the registered normalized OFI transform; convert DOWN pressure into canonical UP space only by subtracting the paired DOWN aggregate.",
  "- At the existing state-tape cadence, write only paired 5s, 30s, and 60s sums; per-outcome event counts; source/socket ages; and maximum 60s transport lag. Zero is a valid quiet window after both books initialize. Null means disconnected, incomplete, stale, or late.",
  `- Causal health requires a live socket frame within ${CLOB_EVENT_OFI_TAPE.maxSocketAgeSec}s and no included event with transport lag above ${CLOB_EVENT_OFI_TAPE.maxTransportLagMs.toLocaleString()}ms.`,
  `- Readiness floors are ${CLOB_EVENT_OFI_TAPE.minRows.toLocaleString()} usable rows, ${CLOB_EVENT_OFI_TAPE.minMarkets.toLocaleString()} resolved markets, ${CLOB_EVENT_OFI_TAPE.minSpanDays} days, ${CLOB_EVENT_OFI_TAPE.minRowsPerBucket} distinct markets in every asset × timeframe bucket, and ${(CLOB_EVENT_OFI_TAPE.minCoverage * 100).toFixed(0)}% coverage.`,
  "- Before all floors pass, surfaces may disclose only version, counts, span, bucket coverage, and transport health. Rolling signs/magnitudes, outcome relationships, grades, strategy comparisons, and P&L remain prohibited.",
  "- After readiness, inspect only outcome-free feature/missingness distributions. Any directional use requires a separate exact rule, a later future boundary, an independent paper bot, fee-adjusted real-book fills, and the unchanged verdict gate.",
  "",
  "### Safety and load",
  "",
  "- This is a data tape, not a strategy. It has no side threshold, probability, trade size, order, wallet, account, signing, cancellation, position, or fund-moving capability.",
  "- It adds only bounded in-memory maps and nine nullable columns on state rows that Jester already writes. Raw frames are never persisted.",
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Public CLOB event-OFI tape v1",
  category: "research" as (typeof categories)[number],
  tags: ["polymarket", "updown", "clob", "order-flow", "microstructure", "paper-only"],
  body,
  sources,
  status: "active" as (typeof statuses)[number],
});

console.log(JSON.stringify({
  updated: true,
  auditInserted: await ensureAudit(),
  slug,
  version: CLOB_EVENT_OFI_TAPE.version,
  boundary: new Date(CLOB_EVENT_OFI_TAPE.evalStartMs).toISOString(),
}, null, 2));
process.exit(0);
