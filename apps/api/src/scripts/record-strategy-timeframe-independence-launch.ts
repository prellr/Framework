/**
 * Persist the post-grace launch audit for the strategy × timeframe independence map.
 *
 * The audited service reads only strategy/horizon identity, market identity, and chosen paper side.
 * This script reads the service report plus KB/audit metadata; it never reads an outcome ledger.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { PAPER_TIMEFRAME_GATE } from "../services/paper-timeframe-gate.ts";
import { strategyIndependenceStatus } from "../services/strategy-independence.ts";

const slug = "updown-strategy-timeframe-independence-v1";
const marker = "## Outcome-blind independence-map launch success — 2026-07-24";
const action = "kb.launch-audit.record";
const resourceId = `${slug}:launch-success`;
const expectedBoundary = "2026-07-24T04:00:00.000Z";
const graceMs = 5 * 60_000;
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
  req: new Request("http://localhost/internal/kb-strategy-timeframe-independence-launch"),
};
const caller = appRouter.createCaller(ctx);

if (
  PAPER_TIMEFRAME_GATE.evalStartMs !== Date.parse(expectedBoundary)
  || Date.now() < PAPER_TIMEFRAME_GATE.evalStartMs + graceMs
) {
  throw new Error("refusing independence-map launch success before the frozen post-boundary grace window");
}

const report = await strategyIndependenceStatus();
const activeFiveMinute = report.bots.filter((bot) => bot.key.endsWith(":5") && bot.decisions > 0);
const activeFifteenMinute = report.bots.filter((bot) => bot.key.endsWith(":15") && bot.decisions > 0);
const invalidBotKeys = report.bots.filter((bot) => !/^[^:]+:(5|15)$/.test(bot.key));
const invalidPairs = report.pairs.filter((pair) =>
  !Number.isInteger(pair.sharedMarkets)
  || pair.sharedMarkets < 0
  || pair.leftCoverage < 0
  || pair.leftCoverage > 1
  || pair.rightCoverage < 0
  || pair.rightCoverage > 1
  || pair.subsetOverlap < 0
  || pair.subsetOverlap > 1
  || (pair.agreement != null && (pair.agreement < 0 || pair.agreement > 1))
  || (pair.dependencyStrength != null
    && (pair.dependencyStrength < 0 || pair.dependencyStrength > 1))
);
const checks = {
  exactVersion: report.version === slug,
  outcomeFree: report.outcomeFree === true,
  exactBoundary: new Date(report.evalStartMs).toISOString() === expectedBoundary,
  forwardDecisions: report.decisions > 0,
  fiveMinuteCollection: activeFiveMinute.length > 0,
  fifteenMinuteCollection: activeFifteenMinute.length > 0,
  strategyTimeframeKeysOnly: invalidBotKeys.length === 0,
  validPairMetrics: invalidPairs.length === 0,
};
if (!Object.values(checks).every(Boolean)) {
  throw new Error(`independence-map launch audit failed: ${JSON.stringify({
    checks,
    invalidBotKeys: invalidBotKeys.map((bot) => bot.key),
    invalidPairs: invalidPairs.map((pair) => `${pair.leftKey}:${pair.rightKey}`),
  })}`);
}

const existing = await caller.kb.get({ slug });
if (!existing) throw new Error(`missing preregistered KB article ${slug}`);
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
      `Recorded ${new Date().toISOString()} after the five-minute grace window.`,
      "",
      `- ${report.decisions.toLocaleString()} deduplicated forward decisions across ${activeFiveMinute.length.toLocaleString()} active 5m identities and ${activeFifteenMinute.length.toLocaleString()} active 15m identities.`,
      `- All ${report.bots.length.toLocaleString()} registered identities use an explicit strategy × horizon key; all ${report.pairs.length.toLocaleString()} pair metrics are finite and bounded.`,
      "- The audited endpoint uses only strategy/horizon identity, condition ID, and chosen paper side. It reads no resolution, grade, price, fill, control fill, return, residual, or P&L field.",
      "- Launch success authorizes descriptive overlap collection only. It cannot alter a strategy, gate verdict, position size, or execution lock.",
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
  boundary: expectedBoundary,
  checks,
  evidence: {
    decisions: report.decisions,
    registeredIdentities: report.bots.length,
    activeFiveMinuteIdentities: activeFiveMinute.length,
    activeFifteenMinuteIdentities: activeFifteenMinute.length,
    pairMetrics: report.pairs.length,
  },
}, null, 2));
process.exit(0);
