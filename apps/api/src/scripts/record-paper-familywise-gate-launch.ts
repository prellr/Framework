/**
 * Persist the post-grace launch audit for the frozen 57-unit familywise verdict gate.
 *
 * This script is intentionally outcome-blind. It reads only registry keys, market identities,
 * assets, horizons, window times, decision times, and row counts. It never reads a chosen side,
 * book fill, resolution, grade, return, residual, rank, or P&L.
 */
import { and, count, eq, gte, lt, ne } from "drizzle-orm";
import { auditLogs, db, paperTrades } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { PAPER_BOTS, paperBotBucketUniverse } from "../services/paper-floor.ts";
import {
  PAPER_FAMILYWISE_GATE,
  PAPER_FAMILYWISE_HYPOTHESES,
  PAPER_FAMILYWISE_OPPOSITE_KEYS,
} from "../services/paper-familywise-gate.ts";

const slug = PAPER_FAMILYWISE_GATE.version;
const marker = "## Outcome-blind familywise launch success — 2026-07-25";
const requiredPreregistrationText = "## Frozen family and statistical contract";
const action = "kb.launch-audit.record";
const resourceId = `${slug}:launch-success`;
const categories = ["operations", "strategy", "research", "provider", "decision", "postmortem"] as const;
const statuses = ["active", "superseded", "archived"] as const;
const boundary = new Date(PAPER_FAMILYWISE_GATE.evalStartMs);
// One complete 15m window plus a small collector allowance.
const graceMs = 16 * 60_000;
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
  req: new Request("http://localhost/internal/kb-paper-familywise-gate-launch"),
};
const caller = appRouter.createCaller(ctx);

const registeredBots = PAPER_BOTS.filter((bot) => bot.key !== "drift");
const controlBot = PAPER_BOTS.find((bot) => bot.key === "drift");
if (!controlBot) {
  throw new Error("familywise launch cannot resolve the frozen Always Down control");
}
const controlBucketSet = new Set(
  paperBotBucketUniverse(controlBot).map(
    (bucket) => `${bucket.pair}:${bucket.horizonMin}`,
  ),
);
const frozenRosterFromRegistry = registeredBots.flatMap((bot) =>
  [...new Set(
    paperBotBucketUniverse(bot)
      .map((bucket) => bucket.horizonMin)
      .filter((horizonMin): horizonMin is 5 | 15 =>
        horizonMin === 5 || horizonMin === 15
      ),
  )].map((horizonMin) => `${bot.key}:${horizonMin}`)
);
const exactFrozenRoster =
  frozenRosterFromRegistry.length === PAPER_FAMILYWISE_HYPOTHESES.length
  && frozenRosterFromRegistry.every(
    (key, index) => key === PAPER_FAMILYWISE_HYPOTHESES[index],
  );
const exactComparatorRoster =
  PAPER_FAMILYWISE_OPPOSITE_KEYS.length === 4
  && new Set(PAPER_FAMILYWISE_OPPOSITE_KEYS).size === 4
  && PAPER_FAMILYWISE_OPPOSITE_KEYS.every((key) =>
    PAPER_FAMILYWISE_HYPOTHESES.includes(key)
  );
if (
  PAPER_FAMILYWISE_GATE.version !== "updown-familywise-verdict-gate-v1"
  || boundary.toISOString() !== "2026-07-25T00:00:00.000Z"
  || PAPER_FAMILYWISE_GATE.correction !== "Holm"
  || PAPER_FAMILYWISE_GATE.alpha !== 0.05
  || PAPER_FAMILYWISE_GATE.minClusters !== 100
  || PAPER_FAMILYWISE_HYPOTHESES.length !== 57
  || !exactFrozenRoster
  || !exactComparatorRoster
) {
  throw new Error("familywise launch contract does not match the frozen preregistration");
}
if (Date.now() < PAPER_FAMILYWISE_GATE.evalStartMs + graceMs) {
  throw new Error("refusing familywise launch success before the post-boundary grace window");
}

const [controlRows, candidateRows, [cobraPreBoundary]] = await Promise.all([
  db
    .select({
      conditionId: paperTrades.conditionId,
      pair: paperTrades.pair,
      horizonMin: paperTrades.horizonMin,
      windowStart: paperTrades.windowStart,
      decidedAt: paperTrades.decidedAt,
    })
    .from(paperTrades)
    .where(and(
      eq(paperTrades.botKey, "drift"),
      gte(paperTrades.windowStart, boundary),
    )),
  db
    .select({
      botKey: paperTrades.botKey,
      conditionId: paperTrades.conditionId,
      pair: paperTrades.pair,
      horizonMin: paperTrades.horizonMin,
      windowStart: paperTrades.windowStart,
      decidedAt: paperTrades.decidedAt,
    })
    .from(paperTrades)
    .where(and(
      ne(paperTrades.botKey, "drift"),
      gte(paperTrades.windowStart, boundary),
    )),
  db
    .select({ rows: count() })
    .from(paperTrades)
    .where(and(
      eq(paperTrades.botKey, "pricerMC5mCobraNight"),
      lt(paperTrades.windowStart, boundary),
    )),
]);

const botByKey = new Map(registeredBots.map((bot) => [bot.key, bot]));
const frozenSet = new Set<string>(PAPER_FAMILYWISE_HYPOTHESES);
const controlMappingViolations = controlRows.filter((row) =>
  !row.conditionId.trim()
  || !row.pair.trim()
  || !controlBucketSet.has(`${row.pair}:${row.horizonMin}`)
  || row.windowStart.getTime() < PAPER_FAMILYWISE_GATE.evalStartMs
  || row.decidedAt.getTime() < PAPER_FAMILYWISE_GATE.evalStartMs
);
const candidateMappingViolations = candidateRows.filter((row) => {
  const bot = botByKey.get(row.botKey);
  const key = `${row.botKey}:${row.horizonMin}`;
  return !row.conditionId.trim()
    || !row.pair.trim()
    || !bot
    || !frozenSet.has(key)
    || (row.horizonMin !== 5 && row.horizonMin !== 15)
    || row.windowStart.getTime() < PAPER_FAMILYWISE_GATE.evalStartMs
    || row.decidedAt.getTime() < PAPER_FAMILYWISE_GATE.evalStartMs
    || !(bot.eligible?.({
      pair: row.pair,
      horizonMin: row.horizonMin,
      decidedAtMs: row.decidedAt.getTime(),
    }) ?? true);
});
const candidateIdentityCount = new Set(
  candidateRows.map((row) => `${row.botKey}:${row.conditionId}`),
).size;
const opportunities = PAPER_FAMILYWISE_HYPOTHESES.map((key) => {
  const splitAt = key.lastIndexOf(":");
  const sourceKey = key.slice(0, splitAt);
  const horizonMin = Number(key.slice(splitAt + 1));
  const bot = botByKey.get(sourceKey);
  if (!bot || (horizonMin !== 5 && horizonMin !== 15)) {
    throw new Error(`familywise launch cannot resolve frozen key ${key}`);
  }
  const eligibleRows = controlRows.filter((row) =>
    row.horizonMin === horizonMin
    && (bot.eligible?.({
      pair: row.pair,
      horizonMin: row.horizonMin,
      decidedAtMs: row.decidedAt.getTime(),
    }) ?? true)
  );
  const uniqueMarkets = new Set(eligibleRows.map((row) => row.conditionId)).size;
  return {
    key,
    markets: uniqueMarkets,
    firstWindowMs: eligibleRows.length
      ? Math.min(...eligibleRows.map((row) => row.windowStart.getTime()))
      : null,
    firstDecidedMs: eligibleRows.length
      ? Math.min(...eligibleRows.map((row) => row.decidedAt.getTime()))
      : null,
  };
});
const missingOpportunityKeys = opportunities
  .filter((row) => row.markets === 0)
  .map((row) => row.key);
const earlyOpportunityKeys = opportunities
  .filter((row) =>
    row.firstWindowMs == null
    || row.firstWindowMs < PAPER_FAMILYWISE_GATE.evalStartMs
    || row.firstDecidedMs == null
    || row.firstDecidedMs < PAPER_FAMILYWISE_GATE.evalStartMs
  )
  .map((row) => row.key);
const controlHorizonCounts = {
  five: new Set(
    controlRows
      .filter((row) => row.horizonMin === 5)
      .map((row) => row.conditionId),
  ).size,
  fifteen: new Set(
    controlRows
      .filter((row) => row.horizonMin === 15)
      .map((row) => row.conditionId),
  ).size,
};
const checks = {
  exactVersion: PAPER_FAMILYWISE_GATE.version === "updown-familywise-verdict-gate-v1",
  exactBoundary: boundary.toISOString() === "2026-07-25T00:00:00.000Z",
  exactFrozenRoster,
  exactComparatorRoster,
  controlFiveMinuteCollection: controlHorizonCounts.five > 0,
  controlFifteenMinuteCollection: controlHorizonCounts.fifteen > 0,
  everyFrozenHypothesisHasOpportunity: missingOpportunityKeys.length === 0,
  noEarlyOpportunity: earlyOpportunityKeys.length === 0,
  registeredControlBucketsOnly: controlMappingViolations.length === 0,
  candidateCollectionStarted: candidateRows.length > 0,
  registeredFrozenBucketsOnly: candidateMappingViolations.length === 0,
  uniqueCandidateRows:
    candidateIdentityCount === candidateRows.length,
  cobraChildHadNoPreBoundaryRows: Number(cobraPreBoundary?.rows ?? 0) === 0,
};
if (!Object.values(checks).every(Boolean)) {
  throw new Error(`familywise launch audit failed: ${JSON.stringify({
    checks,
    missingOpportunityKeys,
    earlyOpportunityKeys,
    controlMappingViolations,
    candidateMappingViolations,
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
      `Recorded ${new Date().toISOString()} after one complete 15m window plus collector allowance.`,
      "",
      `- The executable registry exactly reproduced all ${PAPER_FAMILYWISE_HYPOTHESES.length} frozen strategy × timeframe keys and all four opposite-side macro comparator exceptions.`,
      `- ${controlRows.length.toLocaleString()} control rows supplied ${controlHorizonCounts.five.toLocaleString()} distinct 5m and ${controlHorizonCounts.fifteen.toLocaleString()} distinct 15m opportunities; every frozen hypothesis had at least one eligible market.`,
      `- ${candidateRows.length.toLocaleString()} candidate rows began collecting across registered frozen buckets, with no malformed or pre-boundary decision metadata and no duplicate bot × market identities.`,
      "- The Cobra-night child had zero pre-boundary rows. No candidate was required to trade merely to pass this launch audit; a valid abstention remains an abstention.",
      "- This receipt inspected no chosen side, book fill, outcome, grade, return, residual, rank, or performance field.",
      "- Launch success authorizes continued paper collection only. Holm correction and every preregistered market, span, paired-bet, cluster, effect, bootstrap, and session floor remain mandatory; execution remains unavailable.",
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
  boundary: boundary.toISOString(),
  graceMinutes: graceMs / 60_000,
  checks,
  evidence: {
    familySize: PAPER_FAMILYWISE_HYPOTHESES.length,
    oppositeSideComparators: PAPER_FAMILYWISE_OPPOSITE_KEYS.length,
    controlRows: controlRows.length,
    controlFiveMinuteMarkets: controlHorizonCounts.five,
    controlFifteenMinuteMarkets: controlHorizonCounts.fifteen,
    candidateRows: candidateRows.length,
    candidateBotMarkets: candidateIdentityCount,
    cobraPreBoundaryRows: Number(cobraPreBoundary?.rows ?? 0),
  },
}, null, 2));
process.exit(0);
