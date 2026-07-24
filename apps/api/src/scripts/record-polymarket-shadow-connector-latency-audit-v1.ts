/**
 * Preregister the prospective paper-only shadow connector latency audit.
 *
 * This script reads registry constants and a post-boundary row count only. It cannot inspect plan
 * timing values, book values, chosen sides, fills, outcomes, grades, returns, or performance.
 */
import { and, count, eq, gte } from "drizzle-orm";
import { auditLogs, db, paperTrades } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import {
  POLYMARKET_SHADOW_CONNECTOR_AUDIT,
} from "../services/polymarket-shadow-connector-audit-model.ts";
import { POLYMARKET_SHADOW_CONNECTOR } from "../services/polymarket-shadow-connector.ts";

const slug = POLYMARKET_SHADOW_CONNECTOR_AUDIT.version;
const marker = "# Polymarket shadow connector latency audit v1";
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
  req: new Request("http://localhost/internal/kb-shadow-connector-latency-audit-v1"),
};
const caller = appRouter.createCaller(ctx);
const boundary = new Date(POLYMARKET_SHADOW_CONNECTOR_AUDIT.evalStartMs);

if (
  POLYMARKET_SHADOW_CONNECTOR_AUDIT.version
    !== "polymarket-shadow-connector-latency-audit-v1"
  || boundary.toISOString() !== "2026-07-25T00:00:00.000Z"
  || POLYMARKET_SHADOW_CONNECTOR_AUDIT.minMarkets !== 500
  || POLYMARKET_SHADOW_CONNECTOR_AUDIT.minSpanHours !== 24
  || POLYMARKET_SHADOW_CONNECTOR_AUDIT.minPreparedCoverage !== 0.95
  || POLYMARKET_SHADOW_CONNECTOR_AUDIT.maxP95PreparationMicros !== 1_000
  || POLYMARKET_SHADOW_CONNECTOR_AUDIT.maxP99PreparationMicros !== 5_000
  || POLYMARKET_SHADOW_CONNECTOR_AUDIT.maxP95MarketDataAgeMs !== 2_000
  || POLYMARKET_SHADOW_CONNECTOR.mode !== "shadow"
  || POLYMARKET_SHADOW_CONNECTOR.authenticationEnabled
  || POLYMARKET_SHADOW_CONNECTOR.signingEnabled
  || POLYMARKET_SHADOW_CONNECTOR.submissionEnabled
) {
  throw new Error("shadow connector latency audit contract does not match preregistration");
}
if (Date.now() >= POLYMARKET_SHADOW_CONNECTOR_AUDIT.evalStartMs) {
  throw new Error("shadow connector latency audit boundary has already passed");
}

const [postBoundary] = await db
  .select({ rows: count() })
  .from(paperTrades)
  .where(and(
    eq(paperTrades.botKey, "drift"),
    gte(paperTrades.windowStart, boundary),
  ));
if (Number(postBoundary?.rows ?? 0) !== 0) {
  throw new Error("post-boundary shadow connector rows already exist");
}

const existing = await caller.kb.get({ slug });
if (existing && !existing.body.includes(marker)) {
  throw new Error(`refusing to replace existing KB article without marker: ${slug}`);
}
if (!existing) {
  await caller.kb.upsert({
    slug,
    title: "Polymarket shadow connector latency audit v1",
    category: "operations",
    tags: ["polymarket", "connector", "paper-only", "latency", "preregistration"],
    status: "active",
    body: [
      marker,
      "",
      `Registered ${new Date().toISOString()} before ${boundary.toISOString()}.`,
      "",
      "## Fixed population and telemetry",
      "",
      "- Population: one universal Always Down control row per eligible crypto Up/Down market, beginning at the frozen boundary. Each market expects one UP and one DOWN shadow preparation record.",
      "- Input: the already-maintained public WebSocket full-book cache plus cached public tick/minimum-order/fee metadata. The hot path performs no REST call, database read, socket creation, or JSON parsing.",
      "- Timing: one monotonic duration from immediately before the in-memory cache lookup through validation, fee-adjusted book walk, minimum-size/slippage checks, and conservative tick quantization.",
      "- Missing telemetry, stale books, token/condition mismatch, and invalid intent count against prepared coverage. Valid depth, minimum-size, or slippage rejection remains a successfully prepared result rather than an unavailable connector.",
      "",
      "## Frozen operational floors",
      "",
      `- At least ${POLYMARKET_SHADOW_CONNECTOR_AUDIT.minMarkets} markets spanning at least ${POLYMARKET_SHADOW_CONNECTOR_AUDIT.minSpanHours} hours.`,
      `- Prepared coverage at least ${(POLYMARKET_SHADOW_CONNECTOR_AUDIT.minPreparedCoverage * 100).toFixed(0)}%.`,
      `- Preparation latency p95 ≤ ${POLYMARKET_SHADOW_CONNECTOR_AUDIT.maxP95PreparationMicros.toLocaleString()} µs and p99 ≤ ${POLYMARKET_SHADOW_CONNECTOR_AUDIT.maxP99PreparationMicros.toLocaleString()} µs.`,
      `- Public-book receive age p95 ≤ ${POLYMARKET_SHADOW_CONNECTOR_AUDIT.maxP95MarketDataAgeMs.toLocaleString()} ms.`,
      "- Every floor must pass before an operational review. Passing does not authorize trading, a strategy promotion, credential creation, signing, submission, cancellation, balance access, or any live phase.",
      "",
      "## Safety boundary",
      "",
      "- The audit reads only market/decision clocks and the control row's `shadowConnector` subtree. It reads no chosen side, signal, book price, fill, outcome, grade, return, residual, rank, or P&L.",
      "- Historical pre-boundary telemetry is excluded. Missing rows are never backfilled and the audit cannot alter the familywise verdict gate.",
      `- Connector flags remain authentication=${POLYMARKET_SHADOW_CONNECTOR.authenticationEnabled}, signing=${POLYMARKET_SHADOW_CONNECTOR.signingEnabled}, submission=${POLYMARKET_SHADOW_CONNECTOR.submissionEnabled}.`,
    ].join("\n"),
    sources: [
      {
        title: "Polymarket WebSocket overview",
        url: "https://docs.polymarket.com/market-data/websocket/overview",
      },
      {
        title: "Polymarket order overview",
        url: "https://docs.polymarket.com/trading/orders/overview",
      },
    ],
  });
}

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
  updated: !existing,
  auditInserted: !existingAudit,
  slug,
  boundary: boundary.toISOString(),
  postBoundaryRows: Number(postBoundary?.rows ?? 0),
  safety: {
    authentication: POLYMARKET_SHADOW_CONNECTOR.authenticationEnabled,
    signing: POLYMARKET_SHADOW_CONNECTOR.signingEnabled,
    submission: POLYMARKET_SHADOW_CONNECTOR.submissionEnabled,
  },
}, null, 2));
process.exit(0);
