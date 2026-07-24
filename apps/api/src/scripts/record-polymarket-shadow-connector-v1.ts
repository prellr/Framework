/**
 * Record the public-source architecture review and paper-safe connector boundary.
 *
 * Metadata only: this script reads/writes KB and audit rows. It does not inspect strategy outcomes,
 * create credentials, read account state, sign an order, or call a CLOB trading endpoint.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { POLYMARKET_SHADOW_CONNECTOR } from "../services/polymarket-shadow-connector.ts";

const slug = POLYMARKET_SHADOW_CONNECTOR.version;
const marker = "# Polymarket paper-safe shadow connector v1";
const action = "kb.connector.record";
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
  req: new Request("http://localhost/internal/kb-polymarket-shadow-connector-v1"),
};
const caller = appRouter.createCaller(ctx);

if (
  POLYMARKET_SHADOW_CONNECTOR.mode !== "shadow"
  || POLYMARKET_SHADOW_CONNECTOR.authenticationEnabled
  || POLYMARKET_SHADOW_CONNECTOR.signingEnabled
  || POLYMARKET_SHADOW_CONNECTOR.submissionEnabled
) throw new Error("connector safety contract changed");

const existing = await caller.kb.get({ slug });
if (existing && !existing.body.includes(marker)) {
  throw new Error(`refusing to replace existing KB article without marker: ${slug}`);
}

const body = [
  marker,
  "",
  `Recorded ${new Date().toISOString()}.`,
  "",
  "## Outcome",
  "",
  "- Jester now has a reusable execution hot path without an execution capability: public in-memory order book → fee-aware $5 book walk → minimum-size/tick/slippage checks → deterministic shadow FOK BUY plan.",
  "- The connector reuses the worker's existing official public market WebSocket. It opens no duplicate socket and performs no REST, database, or JSON work between an already-decided signal and plan preparation.",
  "- The live probe fetches public market metadata and books only. No private/user channel is used.",
  "",
  "## Frozen safety boundary",
  "",
  `- Version: \`${POLYMARKET_SHADOW_CONNECTOR.version}\`; mode: \`${POLYMARKET_SHADOW_CONNECTOR.mode}\`.`,
  `- Authentication enabled: \`${POLYMARKET_SHADOW_CONNECTOR.authenticationEnabled}\`.`,
  `- Signing enabled: \`${POLYMARKET_SHADOW_CONNECTOR.signingEnabled}\`.`,
  `- Submission enabled: \`${POLYMARKET_SHADOW_CONNECTOR.submissionEnabled}\`.`,
  `- Only a simulated \`${POLYMARKET_SHADOW_CONNECTOR.orderType}\` \`${POLYMARKET_SHADOW_CONNECTOR.orderSide}\` is constructed; maximum shadow budget is $${POLYMARKET_SHADOW_CONNECTOR.maxBudgetUsd}.`,
  `- A public book older than ${POLYMARKET_SHADOW_CONNECTOR.maxBookAgeMs / 1_000}s, a token/condition mismatch, malformed fee curve, thin depth, sub-minimum size, invalid tick, or breached slippage ceiling fails closed.`,
  "- The module contains no wallet, private key, API key, HMAC, EIP-712 signer, maker address, nonce, authenticated header, order POST, cancel call, balance call, allowance call, or fund path.",
  "",
  "## Official-source decisions",
  "",
  "- Use the market WebSocket instead of REST polling for the hot path. Maintain full snapshots plus price-level changes in memory and send PING every 10 seconds.",
  "- Treat Polymarket market orders as marketable limit orders. Use FOK for all-or-nothing immediate execution and make the price field a worst-price ceiling, not a target fill.",
  "- Cache condition metadata (tick size, minimum order size, negative-risk status, fee curve) outside the decision path. Quantize a BUY ceiling upward to the market tick.",
  "- Keep order preparation distinct from authentication/signing/submission. The official TypeScript v2 client now points new work to the unified `Polymarket/ts-sdk`; selection and pinning belong to a later separately authorized live phase.",
  "- If multiple simultaneous orders are ever authorized, the official batch endpoint accepts up to 15 and processes them in parallel. The current shadow connector does not implement that endpoint.",
  "",
  "## Latency budget and server load",
  "",
  "- Signal decision → shadow plan is synchronous CPU work over resident memory.",
  "- Market discovery stays on the existing bounded 30-second refresh and the existing shared socket; no new persistent service is added.",
  "- Public REST is allowed only in the manual probe/control path, never as the low-latency decision path.",
  "- Preparation time is measured with a monotonic high-resolution clock. Network transit, signing, CLOB acknowledgement, matching, and confirmation remain unmeasured until a later paper-safe emulator or explicitly authorized live phase exists.",
  "",
  "## Deferred live-only controls",
  "",
  "- Explicit human authorization and a new safety review.",
  "- Region/geoblock and terms eligibility, isolated wallet custody, API credential lifecycle, balance/allowance checks, maximum exposure, idempotency, rate limiting, circuit breaker, kill switch, user-channel lifecycle reconciliation, partial-fill handling, cancellation, and reconciliation against onchain confirmation.",
  "- None of those controls or capabilities is implied by this shadow module.",
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Polymarket paper-safe shadow connector v1",
  category: "operations",
  tags: ["polymarket", "connector", "paper-only", "latency", "clob", "safety"],
  status: "active",
  body,
  sources: [
    {
      title: "Polymarket WebSocket overview",
      url: "https://docs.polymarket.com/market-data/websocket/overview",
    },
    {
      title: "Polymarket order overview",
      url: "https://docs.polymarket.com/trading/orders/overview",
    },
    {
      title: "Polymarket create order",
      url: "https://docs.polymarket.com/trading/orders/create",
    },
    {
      title: "Polymarket API rate limits",
      url: "https://docs.polymarket.com/api-reference/rate-limits",
    },
    {
      title: "Official Polymarket CLOB client v2",
      url: "https://github.com/Polymarket/clob-client-v2",
    },
  ],
});

const [existingAudit] = await db
  .select({ id: auditLogs.id })
  .from(auditLogs)
  .where(and(
    eq(auditLogs.action, action),
    eq(auditLogs.resourceType, "kbArticle"),
    eq(auditLogs.resourceId, slug),
  ))
  .limit(1);
if (!existingAudit) {
  await audit(ctx, action, { resourceType: "kbArticle", resourceId: slug });
}

console.log(JSON.stringify({
  slug,
  updated: true,
  auditInserted: !existingAudit,
  safety: {
    authentication: POLYMARKET_SHADOW_CONNECTOR.authenticationEnabled,
    signing: POLYMARKET_SHADOW_CONNECTOR.signingEnabled,
    submission: POLYMARKET_SHADOW_CONNECTOR.submissionEnabled,
  },
}, null, 2));
process.exit(0);
