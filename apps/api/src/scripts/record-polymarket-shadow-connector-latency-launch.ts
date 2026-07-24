/**
 * Persist the post-grace launch receipt for the prospective shadow-connector latency audit.
 *
 * This script reads only market identities, registered bucket keys, decision clocks, and a
 * telemetry-only JSON projection. It never loads connector quotes, book prices, chosen strategy
 * direction, fills, outcomes, grades, returns, residuals, ranks, or P&L.
 */
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, db, paperTrades } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import {
  POLYMARKET_SHADOW_CONNECTOR_AUDIT,
} from "../services/polymarket-shadow-connector-audit-model.ts";
import { POLYMARKET_SHADOW_CONNECTOR } from "../services/polymarket-shadow-connector.ts";

const slug = POLYMARKET_SHADOW_CONNECTOR_AUDIT.version;
const marker = "## Outcome-blind shadow connector launch success — 2026-07-25";
const requiredPreregistrationText = "# Polymarket shadow connector latency audit v1";
const action = "kb.launch-audit.record";
const resourceId = `${slug}:launch-success`;
const categories = ["operations", "strategy", "research", "provider", "decision", "postmortem"] as const;
const statuses = ["active", "superseded", "archived"] as const;
const boundary = new Date(POLYMARKET_SHADOW_CONNECTOR_AUDIT.evalStartMs);
// One complete 15m market plus a small collector allowance.
const graceMs = 16 * 60_000;
const registeredPairs = [
  "BTC-USD",
  "ETH-USD",
  "SOL-USD",
  "XRP-USD",
  "DOGE-USD",
  "BNB-USD",
] as const;
const registeredPairSet = new Set<string>(registeredPairs);
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
  req: new Request("http://localhost/internal/kb-shadow-connector-latency-launch"),
};
const caller = appRouter.createCaller(ctx);

if (
  POLYMARKET_SHADOW_CONNECTOR_AUDIT.version
    !== "polymarket-shadow-connector-latency-audit-v1"
  || boundary.toISOString() !== "2026-07-25T00:00:00.000Z"
  || POLYMARKET_SHADOW_CONNECTOR.version !== "polymarket-shadow-connector-v1"
  || POLYMARKET_SHADOW_CONNECTOR.mode !== "shadow"
  || POLYMARKET_SHADOW_CONNECTOR.authenticationEnabled
  || POLYMARKET_SHADOW_CONNECTOR.signingEnabled
  || POLYMARKET_SHADOW_CONNECTOR.submissionEnabled
) {
  throw new Error("shadow connector launch contract does not match the preregistration");
}
if (Date.now() < POLYMARKET_SHADOW_CONNECTOR_AUDIT.evalStartMs + graceMs) {
  throw new Error("refusing shadow connector launch success before the post-boundary grace window");
}

const rows = await db
  .select({
    conditionId: paperTrades.conditionId,
    pair: paperTrades.pair,
    horizonMin: paperTrades.horizonMin,
    windowStart: paperTrades.windowStart,
    decidedAt: paperTrades.decidedAt,
    // This projection deliberately excludes quote, price, depth, and order-intent fields.
    telemetry: sql<unknown>`jsonb_build_object(
      'up', jsonb_build_object(
        'version', ${paperTrades.modelMeta}#>'{shadowConnector,up,version}',
        'mode', ${paperTrades.modelMeta}#>'{shadowConnector,up,mode}',
        'accepted', ${paperTrades.modelMeta}#>'{shadowConnector,up,accepted}',
        'preparationMicros', ${paperTrades.modelMeta}#>'{shadowConnector,up,preparationMicros}',
        'marketDataAgeMs', ${paperTrades.modelMeta}#>'{shadowConnector,up,marketDataAgeMs}',
        'reason', ${paperTrades.modelMeta}#>'{shadowConnector,up,reason}'
      ),
      'down', jsonb_build_object(
        'version', ${paperTrades.modelMeta}#>'{shadowConnector,down,version}',
        'mode', ${paperTrades.modelMeta}#>'{shadowConnector,down,mode}',
        'accepted', ${paperTrades.modelMeta}#>'{shadowConnector,down,accepted}',
        'preparationMicros', ${paperTrades.modelMeta}#>'{shadowConnector,down,preparationMicros}',
        'marketDataAgeMs', ${paperTrades.modelMeta}#>'{shadowConnector,down,marketDataAgeMs}',
        'reason', ${paperTrades.modelMeta}#>'{shadowConnector,down,reason}'
      )
    )`,
  })
  .from(paperTrades)
  .where(and(
    eq(paperTrades.botKey, "drift"),
    sql`${paperTrades.windowStart} >= ${boundary}`,
  ));

const finiteNonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const validTelemetry = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return row.version === POLYMARKET_SHADOW_CONNECTOR.version
    && row.mode === POLYMARKET_SHADOW_CONNECTOR.mode
    && typeof row.accepted === "boolean"
    && finiteNonNegative(row.preparationMicros)
    && (row.marketDataAgeMs == null || finiteNonNegative(row.marketDataAgeMs))
    && (row.accepted || (typeof row.reason === "string" && row.reason.length > 0));
};

const mappingViolations: string[] = [];
let validTelemetryPlans = 0;
const pairsByHorizon = new Map<number, Set<string>>([
  [5, new Set()],
  [15, new Set()],
]);
for (const row of rows) {
  const identity = `${row.conditionId}:${row.pair}:${row.horizonMin}`;
  if (
    !row.conditionId.trim()
    || !registeredPairSet.has(row.pair)
    || (row.horizonMin !== 5 && row.horizonMin !== 15)
    || row.windowStart.getTime() < POLYMARKET_SHADOW_CONNECTOR_AUDIT.evalStartMs
    || row.decidedAt.getTime() < POLYMARKET_SHADOW_CONNECTOR_AUDIT.evalStartMs
  ) {
    mappingViolations.push(identity);
    continue;
  }
  pairsByHorizon.get(row.horizonMin)!.add(row.pair);
  const root =
    row.telemetry
    && typeof row.telemetry === "object"
    && !Array.isArray(row.telemetry)
      ? row.telemetry as Record<string, unknown>
      : null;
  for (const tokenDirection of ["up", "down"] as const) {
    if (validTelemetry(root?.[tokenDirection])) validTelemetryPlans++;
  }
}

const identityCount = new Set(rows.map((row) => row.conditionId)).size;
const exactPairsAt = (horizonMin: 5 | 15) => {
  const observed = pairsByHorizon.get(horizonMin) ?? new Set<string>();
  return observed.size === registeredPairs.length
    && registeredPairs.every((pair) => observed.has(pair));
};
const expectedTelemetryPlans =
  rows.length * POLYMARKET_SHADOW_CONNECTOR_AUDIT.plansPerMarket;
const checks = {
  exactAuditVersion:
    POLYMARKET_SHADOW_CONNECTOR_AUDIT.version
      === "polymarket-shadow-connector-latency-audit-v1",
  exactBoundary: boundary.toISOString() === "2026-07-25T00:00:00.000Z",
  exactConnectorVersion:
    POLYMARKET_SHADOW_CONNECTOR.version === "polymarket-shadow-connector-v1",
  exactShadowMode: POLYMARKET_SHADOW_CONNECTOR.mode === "shadow",
  authenticationDisabled: !POLYMARKET_SHADOW_CONNECTOR.authenticationEnabled,
  signingDisabled: !POLYMARKET_SHADOW_CONNECTOR.signingEnabled,
  submissionDisabled: !POLYMARKET_SHADOW_CONNECTOR.submissionEnabled,
  postBoundaryCollectionStarted: rows.length > 0,
  uniqueMarketRows: identityCount === rows.length,
  registeredBucketsOnly: mappingViolations.length === 0,
  allFiveMinutePairsPresent: exactPairsAt(5),
  allFifteenMinutePairsPresent: exactPairsAt(15),
  twoValidTelemetryRecordsPerMarket:
    expectedTelemetryPlans > 0 && validTelemetryPlans === expectedTelemetryPlans,
};
if (!Object.values(checks).every(Boolean)) {
  throw new Error(`shadow connector launch audit failed: ${JSON.stringify({
    checks,
    mappingViolations,
    observedFiveMinutePairs: [...(pairsByHorizon.get(5) ?? [])].sort(),
    observedFifteenMinutePairs: [...(pairsByHorizon.get(15) ?? [])].sort(),
    expectedTelemetryPlans,
    validTelemetryPlans,
  })}`);
}

const existing = await caller.kb.get({ slug });
if (!existing || !existing.body.includes(requiredPreregistrationText)) {
  throw new Error(`missing exact preregistered KB article ${slug}`);
}
if (!existing.body.includes(marker)) {
  const sources = Array.isArray(existing.sources)
    ? existing.sources.filter((source): source is { title: string; url: string } =>
      !!source
      && typeof source === "object"
      && typeof (source as { title?: unknown }).title === "string"
      && typeof (source as { url?: unknown }).url === "string"
    )
    : undefined;
  await caller.kb.upsert({
    slug: existing.slug,
    title: existing.title,
    category: existing.category as (typeof categories)[number],
    tags: existing.tags ?? [],
    body: [
      existing.body,
      "",
      marker,
      "",
      `Recorded ${new Date().toISOString()} after one complete 15m market plus collector allowance.`,
      "",
      `- ${rows.length.toLocaleString()} distinct control markets began collecting across the exact six registered pairs at both 5m and 15m.`,
      `- All ${validTelemetryPlans.toLocaleString()} expected connector telemetry records had the exact frozen version and shadow mode, a valid acceptance flag, nonnegative preparation duration, valid receive age, and a rejection reason when applicable.`,
      "- Authentication, signing, and submission remained disabled.",
      "- This receipt inspected no connector quote, book price, chosen strategy direction, fill, outcome, grade, return, residual, rank, or performance field.",
      "- Launch success authorizes continued paper-only telemetry collection. It does not satisfy the 500-market, 24-hour coverage or latency floors and does not authorize execution.",
    ].join("\n"),
    sources,
    status: existing.status as (typeof statuses)[number],
    supersededBySlug: existing.supersededBySlug ?? undefined,
  });
}

const [existingAudit] = await db
  .select({ id: auditLogs.id })
  .from(auditLogs)
  .where(and(
    eq(auditLogs.action, action),
    eq(auditLogs.resourceType, "kbArticle"),
    eq(auditLogs.resourceId, resourceId),
  ))
  .limit(1);
if (!existingAudit) {
  await audit(ctx, action, { resourceType: "kbArticle", resourceId });
}

console.log(JSON.stringify({
  updated: !existing.body.includes(marker),
  auditInserted: !existingAudit,
  slug,
  connectorVersion: POLYMARKET_SHADOW_CONNECTOR.version,
  boundary: boundary.toISOString(),
  graceMinutes: graceMs / 60_000,
  checks,
  evidence: {
    controlMarkets: rows.length,
    distinctMarkets: identityCount,
    fiveMinutePairs: pairsByHorizon.get(5)?.size ?? 0,
    fifteenMinutePairs: pairsByHorizon.get(15)?.size ?? 0,
    expectedTelemetryPlans,
    validTelemetryPlans,
  },
  safety: {
    authentication: POLYMARKET_SHADOW_CONNECTOR.authenticationEnabled,
    signing: POLYMARKET_SHADOW_CONNECTOR.signingEnabled,
    submission: POLYMARKET_SHADOW_CONNECTOR.submissionEnabled,
  },
}, null, 2));
process.exit(0);
