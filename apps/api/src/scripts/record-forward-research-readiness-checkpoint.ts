/**
 * Record the 2026-07-24 count-only reconciliation of the forward research queue.
 *
 * The script is deliberately time-bounded to a period in which none of the registered three-day
 * tapes can possibly satisfy its elapsed-time floor. It calls only readiness-locked services,
 * requires every outcome-bearing report to remain null, and refuses to add the checkpoint after
 * the earliest possible unlock. It changes no collector, strategy, gate, or execution setting.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { bsmWindowProfileCalibrationAudit } from "../services/bsm-window-profile-calibration.ts";
import { clobEventOfiTapeStatus } from "../services/clob-event-ofi-report.ts";
import { completeSetTakerAudit } from "../services/complete-set-taker-audit.ts";
import { crossAssetLeadLagStatus } from "../services/cross-asset-lead-lag-report.ts";
import { crossHorizonBundleAudit } from "../services/cross-horizon-bundle.ts";
import { deribitSkewTapeStatus } from "../services/deribit-skew.ts";
import { fourStreakReversalAudit } from "../services/four-streak-reversal-audit.ts";
import { hyperliquidFlowTapeStatus } from "../services/hyperliquid-flow-report.ts";
import { microstructureAbsorptionAudit } from "../services/microstructure-absorption-audit.ts";
import { paperMarkoutStatus } from "../services/paper-markout-report.ts";
import { pricerCalibrationAudit } from "../services/pricer-calibration.ts";
import { authoritativeTradeFlowTapeStatus } from "../services/polymarket-trade-flow-report.ts";
import { polymarketMicrostructureTapeStatus } from "../services/polymarket-state-tape.ts";
import { venueLeadLagTapeStatus } from "../services/venue-lead-lag-report.ts";

const slug = "updown-forward-research-queue-2026-07-23";
const marker = "## Count-only readiness checkpoint — 2026-07-24 11:03 UTC";
const action = "kb.readiness-checkpoint.record";
const resourceId = `${slug}:2026-07-24T11:03:00Z`;
// Venue lead/lag has the earliest three-day boundary among the services below. Refuse to run the
// evidence calls once that elapsed-time floor could possibly be met.
const evidenceHardStopMs = Date.parse("2026-07-26T02:21:29.910Z");
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
  req: new Request("http://localhost/internal/kb-forward-readiness-checkpoint"),
};
const caller = appRouter.createCaller(ctx);

const article = await caller.kb.get({ slug });
if (!article) throw new Error(`KB article not found: ${slug}`);
if (!categories.includes(article.category as (typeof categories)[number])) {
  throw new Error(`invalid KB category: ${article.category}`);
}
if (!statuses.includes(article.status as (typeof statuses)[number])) {
  throw new Error(`invalid KB status: ${article.status}`);
}

const ensureAudit = async () => {
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
  return !existingAudit;
};

if (article.body.includes(marker)) {
  const auditInserted = await ensureAudit();
  console.log(JSON.stringify({
    updated: false,
    auditInserted,
    slug,
    marker,
  }, null, 2));
  process.exit(0);
}
if (Date.now() >= evidenceHardStopMs) {
  throw new Error("refusing count-only checkpoint after the earliest possible readiness unlock");
}

const [
  microstructure,
  venue,
  deribit,
  pricer,
  crossHorizon,
  crossAsset,
  markout,
  profile,
  absorption,
  streak,
  completeSet,
  authoritativeFlow,
  hyperliquidFlow,
  clobEventOfi,
] = await Promise.all([
  polymarketMicrostructureTapeStatus(),
  venueLeadLagTapeStatus(),
  deribitSkewTapeStatus(),
  pricerCalibrationAudit(),
  crossHorizonBundleAudit(),
  crossAssetLeadLagStatus(),
  paperMarkoutStatus(),
  bsmWindowProfileCalibrationAudit(),
  microstructureAbsorptionAudit(),
  fourStreakReversalAudit(),
  completeSetTakerAudit(),
  authoritativeTradeFlowTapeStatus(),
  hyperliquidFlowTapeStatus(),
  clobEventOfiTapeStatus(),
]);

const lockedChecks = {
  microstructure: !microstructure.readyForFrozenDiagnostic,
  venue: !venue.allPairsReadyForFrozenDiagnostic,
  deribit: !deribit.allCurrenciesReadyForFrozenDiagnostic,
  pricer: !pricer.ready && pricer.report == null,
  crossHorizon: !crossHorizon.ready && crossHorizon.report == null,
  crossAsset: !crossAsset.allPairsReadyForFrozenDiagnostic,
  markout: !markout.readyForDescriptiveAudit && markout.resultsLocked,
  profile: !profile.ready && profile.resultsLocked && profile.report == null,
  absorption: !absorption.ready && absorption.resultsLocked && absorption.report == null,
  streak: !streak.ready && streak.resultsLocked && streak.report == null,
  completeSet: !completeSet.ready && completeSet.resultsLocked && completeSet.report == null,
  authoritativeFlow: !authoritativeFlow.readyForOutcomeFreeDistributionAudit,
  hyperliquidFlow: !hyperliquidFlow.readyForOutcomeFreeDistributionAudit,
  clobEventOfi: !clobEventOfi.readyForOutcomeFreeDistributionAudit,
};
if (!Object.values(lockedChecks).every(Boolean)) {
  throw new Error(`refusing checkpoint because a readiness surface unlocked: ${
    JSON.stringify(lockedChecks)
  }`);
}

const weakestVenue = venue.pairs.reduce((weakest, item) =>
  item.rows < weakest.rows ? item : weakest);
const weakestCrossAsset = crossAsset.pairs.reduce((weakest, item) =>
  item.matchedRows < weakest.matchedRows ? item : weakest);
const weakestDeribit = deribit.currencies.reduce((weakest, item) =>
  item.rows < weakest.rows ? item : weakest);
const gbPerDay = authoritativeFlow.storage.bytesPerDay / 1_000_000_000;

const addition = [
  marker,
  "",
  "All values below came from readiness-locked count/timing/health surfaces. Every outcome-bearing report remained null. No sign, outcome, score, direction, P&L, win rate, ranking, or strategy parameter was requested.",
  "",
  "### Queue reconciliation",
  "",
  "- The BTC 5m BSM child, its paired proper-score audit, and state-tape fee-semantics v2 all already have durable boundary-verification records. They are removed from the immediate-action queue.",
  "- No additional bot is admitted. The current roster and every frozen boundary remain unchanged; the next legitimate work is continued collection until a complete registered floor passes.",
  "",
  "### Three-day floors",
  "",
  `- Paper markouts: ${markout.terminalRows.toLocaleString()} terminal rows / ${markout.minimums.terminalRows.toLocaleString()}, ${markout.markets.toLocaleString()} markets / ${markout.minimums.markets.toLocaleString()}, ${markout.spanDays.toFixed(3)}d / ${markout.minimums.spanDays}d; locked.`,
  `- Cross-horizon bundle: ${crossHorizon.rows.toLocaleString()} rows / ${crossHorizon.minRows.toLocaleString()}, ${crossHorizon.commonCloses.toLocaleString()} common closes / ${crossHorizon.minCommonCloses.toLocaleString()}, ${crossHorizon.spanDays.toFixed(3)}d / ${crossHorizon.minSpanDays}d; locked.`,
  `- Venue lead/lag weakest pair (${weakestVenue.pair}): ${weakestVenue.rows.toLocaleString()} rows / ${venue.minRows.toLocaleString()}, ${weakestVenue.blocks.toLocaleString()} blocks / ${venue.minBlocks.toLocaleString()}, ${weakestVenue.spanDays.toFixed(3)}d / ${venue.minSpanDays}d; locked.`,
  `- BTC-to-alt lead/lag weakest pair (${weakestCrossAsset.altPair}): ${weakestCrossAsset.matchedRows.toLocaleString()} rows / ${crossAsset.minRows.toLocaleString()}, ${weakestCrossAsset.blocks.toLocaleString()} blocks / ${crossAsset.minBlocks.toLocaleString()}, ${weakestCrossAsset.spanDays.toFixed(3)}d / ${crossAsset.minSpanDays}d; locked.`,
  `- Deribit skew weakest currency (${weakestDeribit.currency}): ${weakestDeribit.rows.toLocaleString()} rows / ${deribit.diagnosticMinRows.toLocaleString()}, ${weakestDeribit.spanDays.toFixed(3)}d / ${deribit.diagnosticMinSpanDays}d; locked.`,
  `- Complete-set taker audit: ${completeSet.rows.toLocaleString()} rows / ${completeSet.minimums.rows.toLocaleString()}, ${completeSet.markets.toLocaleString()} markets / ${completeSet.minimums.markets.toLocaleString()}, ${completeSet.spanDays.toFixed(3)}d / ${completeSet.minimums.spanDays}d; locked.`,
  "",
  "### Five-day floors",
  "",
  `- Canonical state microstructure: ${microstructure.usableRows.toLocaleString()} usable rows, ${microstructure.resolvedMarkets.toLocaleString()} resolved markets / ${microstructure.minResolvedMarkets.toLocaleString()}, ${microstructure.spanDays.toFixed(3)}d / ${microstructure.minSpanDays}d; locked.`,
  `- Parent BSM calibration: ${pricer.observations.toLocaleString()} observations / ${pricer.minObservations.toLocaleString()}, ${pricer.clusters.toLocaleString()} clusters / ${pricer.minClusters.toLocaleString()}, ${pricer.spanDays.toFixed(3)}d / ${pricer.minSpanDays}d; locked.`,
  `- BTC 5m window-profile calibration: ${profile.observations.toLocaleString()} observations / ${profile.minObservations.toLocaleString()}, ${profile.clusters.toLocaleString()} clusters / ${profile.minClusters.toLocaleString()}, ${profile.spanDays.toFixed(3)}d / ${profile.minSpanDays}d; locked.`,
  `- Microstructure absorption: ${absorption.markets.toLocaleString()} markets / ${absorption.minimums.markets.toLocaleString()}, ${absorption.bets.toLocaleString()} bets / ${absorption.minimums.bets.toLocaleString()}, ${absorption.clusters.toLocaleString()} clusters / ${absorption.minimums.clusters.toLocaleString()}, ${absorption.spanDays.toFixed(3)}d / ${absorption.minimums.spanDays}d; locked.`,
  `- Four-streak reversal: ${streak.markets.toLocaleString()} markets / ${streak.minimums.markets.toLocaleString()}, ${streak.bets.toLocaleString()} bets / ${streak.minimums.bets.toLocaleString()}, ${streak.clusters.toLocaleString()} clusters / ${streak.minimums.clusters.toLocaleString()}, ${streak.spanDays.toFixed(3)}d / ${streak.minimums.spanDays}d; locked.`,
  `- Hyperliquid flow v2: ${hyperliquidFlow.usableRows.toLocaleString()} usable rows / ${hyperliquidFlow.floors.usableRows.toLocaleString()}, ${hyperliquidFlow.resolvedMarkets.toLocaleString()} resolved markets / ${hyperliquidFlow.floors.resolvedMarkets.toLocaleString()}, ${(hyperliquidFlow.coverage * 100).toFixed(2)}% coverage / ${(hyperliquidFlow.floors.coverage * 100).toFixed(0)}%, weakest bucket ${hyperliquidFlow.weakestBucketMarkets.toLocaleString()} / ${hyperliquidFlow.floors.marketsPerBucket.toLocaleString()}, ${hyperliquidFlow.spanDays.toFixed(3)}d / ${hyperliquidFlow.floors.spanDays}d; transport healthy, locked.`,
  `- Public CLOB event-OFI v1: ${clobEventOfi.usableRows.toLocaleString()} usable rows / ${clobEventOfi.floors.usableRows.toLocaleString()}, ${clobEventOfi.resolvedMarkets.toLocaleString()} resolved markets / ${clobEventOfi.floors.resolvedMarkets.toLocaleString()}, ${(clobEventOfi.coverage * 100).toFixed(2)}% cumulative coverage / ${(clobEventOfi.floors.coverage * 100).toFixed(0)}%, weakest bucket ${clobEventOfi.weakestBucketMarkets.toLocaleString()} / ${clobEventOfi.floors.marketsPerBucket.toLocaleString()}, ${clobEventOfi.spanDays.toFixed(3)}d / ${clobEventOfi.floors.spanDays}d; transport healthy, locked.`,
  "",
  "### Seven-day authoritative-flow floor and capacity",
  "",
  `- Chain-verified Polymarket taker flow: ${authoritativeFlow.rawEvents.toLocaleString()} raw events, ${authoritativeFlow.verifiedEvents.toLocaleString()} verified, ${authoritativeFlow.distinctMarkets.toLocaleString()} markets, ${authoritativeFlow.spanDays.toFixed(3)}d / ${authoritativeFlow.floors.spanDays}d; operational health passed and the distribution audit remains locked.`,
  `- Current relation size is ${(authoritativeFlow.storage.relationBytes / 1_000_000).toFixed(1)} MB, growing at approximately ${gbPerDay.toFixed(2)} GB/day. Capacity must be checked again before the seven-day unlock and before retaining an unbounded raw tape.`,
  "",
  "### Decision",
  "",
  "The count evidence supports continued collection, not another strategy. Adding a bot now would multiply overlap and server cost without an unlocked empirical basis. Gate v3, the separate macro-direction gate, and the prohibition on execution remain intact.",
].join("\n");

await caller.kb.upsert({
  slug: article.slug,
  title: article.title,
  category: article.category as (typeof categories)[number],
  tags: article.tags ?? [],
  body: `${article.body.trim()}\n\n${addition}`,
  sources: Array.isArray(article.sources)
    ? article.sources.filter((source): source is { title: string; url: string } =>
      !!source
      && typeof source === "object"
      && typeof (source as { title?: unknown }).title === "string"
      && typeof (source as { url?: unknown }).url === "string"
    )
    : undefined,
  status: article.status as (typeof statuses)[number],
  supersededBySlug: article.supersededBySlug ?? undefined,
});
const auditInserted = await ensureAudit();

console.log(JSON.stringify({
  updated: true,
  auditInserted,
  slug,
  marker,
  lockedChecks,
}, null, 2));
process.exit(0);
