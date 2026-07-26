import { t } from "../trpc/context.ts";
import { protectedProcedure } from "../trpc/middleware.ts";
import { scoreboard, scoreSeries } from "../services/polymarket-updown.ts";
import { floorState, paperAssetFeed, paperStrategyFeed } from "../services/paper-floor.ts";
import { paperFloorView } from "../services/paper-floor-view.ts";
import { fetchLiveCryptoUpDown, updownHorizonMinutes } from "../services/polymarket.ts";
import {
  polymarketMicrostructureTapeStatus,
  polymarketMultiStakeCapacityStatus,
} from "../services/polymarket-state-tape.ts";
import { venueLeadLagTapeStatus } from "../services/venue-lead-lag-report.ts";
import { deribitSkewTapeStatus } from "../services/deribit-skew.ts";
import { pricerCalibrationAudit } from "../services/pricer-calibration.ts";
import { crossHorizonBundleAudit } from "../services/cross-horizon-bundle.ts";
import { crossAssetLeadLagStatus } from "../services/cross-asset-lead-lag-report.ts";
import { paperMarkoutAudit } from "../services/paper-markout-report.ts";
import { bsmWindowProfileCalibrationAudit } from "../services/bsm-window-profile-calibration.ts";
import { microstructureAbsorptionAudit } from "../services/microstructure-absorption-audit.ts";
import { fourStreakReversalAudit } from "../services/four-streak-reversal-audit.ts";
import { strategyIndependenceStatus } from "../services/strategy-independence.ts";
import { completeSetTakerAudit } from "../services/complete-set-taker-audit.ts";
import { authoritativeTradeFlowTapeStatus } from "../services/polymarket-trade-flow-report.ts";
import { authoritativeTakerFlowDistributionAudit } from "../services/authoritative-taker-flow-distribution-audit.ts";
import { authoritativeTakerPressureDistributionAudit } from "../services/authoritative-taker-pressure-distribution-audit.ts";
import { clobChainPressureConcordanceAudit } from "../services/clob-chain-pressure-concordance-audit.ts";
import { smoothPathFunnelStatus } from "../services/smooth-path-funnel-report.ts";
import { hyperliquidFlowTapeStatus } from "../services/hyperliquid-flow-report.ts";
import { clobEventOfiTapeStatus } from "../services/clob-event-ofi-report.ts";
import { flowDistributionAudit } from "../services/flow-distribution-audit.ts";
import { microstructureStateDistributionAudit } from "../services/microstructure-state-distribution-audit.ts";
import { polymarketShadowConnectorAudit } from "../services/polymarket-shadow-connector-audit.ts";
import { resolutionSourceBasisDistributionAudit } from "../services/resolution-source-basis-distribution.ts";
import { idNr4QualityDistributionAudit } from "../services/id-nr4-quality-distribution.ts";
import { z } from "zod";
import { paperPerformance } from "../services/paper-performance.ts";
import { paperExecutionCapital } from "../services/paper-execution-capital.ts";
import {
  paperUnder35Portfolio,
  paperUnder35TradeHistory,
} from "../services/paper-under-35-portfolio.ts";
import { polymarketConnectorReadiness } from "../services/polymarket-connector-readiness.ts";

/**
 * Polymarket Up/Down (Phase 1, read-only research). The scoreboard aggregates our forward-collected
 * scores of resolved BTC/ETH markets vs the Tesseract signal (follow vs fade vs drift). No trading.
 */
export const polymarketRouter = t.router({
  scoreboard: protectedProcedure.query(() => scoreboard()),
  series: protectedProcedure.query(() => scoreSeries()),
  // Paper Floor state (bots, equity, feed). Paper only — this Polymarket router exposes no execution endpoint.
  floor: protectedProcedure.query(() => floorState()),
  // Scope-specific read projection. It carries the same authoritative gates but sends large equity,
  // feed, and diagnostic collections only to the view that renders them.
  floorView: protectedProcedure
    .input(
      z.object({
        scope: z.enum(["paper", "forward", "history"]),
        view: z.enum(["scoreboard", "floor", "strategy", "registry"]),
      }),
    )
    .query(({ input }) => paperFloorView(input)),
  // A bounded strategy-specific evidence feed for the detail page. Read-only and paper-only.
  strategyFeed: protectedProcedure
    .input(
      z.object({
        botKey: z.string().min(1).max(80),
        horizonMin: z.union([z.literal(5), z.literal(15)]),
        scope: z.enum(["paper", "forward", "history"]).default("forward"),
        assets: z
          .array(z.enum(["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB"]))
          .min(1)
          .max(6)
          .optional(),
        limit: z.number().int().min(1).max(200).default(100),
      }),
    )
    .query(({ input }) => paperStrategyFeed(input)),
  // Bounded all-strategy feed for one asset research page. Read-only; no execution capability.
  assetFeed: protectedProcedure
    .input(
      z.object({
        asset: z.enum(["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB"]),
        horizonMin: z.union([z.literal(5), z.literal(15)]),
        scope: z.enum(["paper", "forward", "history"]).default("forward"),
        limit: z.number().int().min(1).max(200).default(100),
      }),
    )
    .query(({ input }) => paperAssetFeed(input)),
  // Read-optimized diagnostic lens: strategy × timeframe rankings plus one selected cohort's
  // calendar/session/asset/side/ask segmentation. It cannot place orders or alter the verdict gate.
  performance: protectedProcedure
    .input(
      z.object({
        scope: z.enum(["paper", "forward", "history"]).default("forward"),
        period: z.enum(["24h", "3d", "7d", "30d", "all"]).default("all"),
        timezone: z.string().min(1).max(64).default("America/Chicago"),
        asset: z.enum(["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB"]).optional(),
        assets: z
          .array(z.enum(["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB"]))
          .min(1)
          .max(6)
          .optional(),
        segmentBotKey: z.string().min(1).max(80).optional(),
        segmentHorizonMin: z.union([z.literal(5), z.literal(15)]).optional(),
      }),
    )
    .query(({ input }) => paperPerformance(input)),
  // Dedicated paper-only execution-cost and capital-efficiency projection. It reads captured book
  // walks, fees, depth, and strategy overlap; no credential, balance, signing, or order path exists.
  executionCapital: protectedProcedure
    .input(
      z.object({
        scope: z.enum(["paper", "forward", "history"]).default("paper"),
        period: z.enum(["24h", "3d", "7d", "30d", "all"]).default("all"),
        horizon: z.union([z.literal("all"), z.literal(5), z.literal(15)]).default("all"),
        timezone: z.string().min(1).max(64).default("America/Chicago"),
      }),
    )
    .query(({ input }) => paperExecutionCapital(input)),
  // Exact registered strategy × timeframe roster with seven local-calendar-day `<35¢` RAW cells.
  // Selection happens only in the browser research workspace; no paper or execution mutation exists.
  under35Portfolio: protectedProcedure
    .input(
      z.object({
        scope: z.enum(["paper", "forward", "history"]).default("paper"),
        horizon: z.union([z.literal("all"), z.literal(5), z.literal(15)]).default("all"),
        timezone: z.string().min(1).max(64).default("America/Chicago"),
      }),
    )
    .query(({ input }) => paperUnder35Portfolio(input)),
  // Bounded read-only ledger for the same seven-day `<35¢` population. The browser filters the
  // exact registered cohort selection and groups rows by market window, hour, or calendar day.
  under35TradeHistory: protectedProcedure
    .input(
      z.object({
        scope: z.enum(["paper", "forward", "history"]).default("paper"),
        timezone: z.string().min(1).max(64).default("America/Chicago"),
        cohortKeys: z.array(z.string().min(3).max(160)).max(60).optional(),
      }),
    )
    .query(({ input }) => paperUnder35TradeHistory(input)),
  // Raw prospective research-tape readiness only; no outcome-conditioned diagnostics before its floor.
  microstructureTape: protectedProcedure.query(() => polymarketMicrostructureTapeStatus()),
  // Same-book $5/$10/$20 depth coverage only; no outcomes, strategy evidence, or execution path.
  multiStakeCapacityTape: protectedProcedure.query(() => polymarketMultiStakeCapacityStatus()),
  // Collection progress only: no cross-correlations or signs before LEAD-LAG-REPORT-V1 is ready.
  venueLeadLagTape: protectedProcedure.query(() => venueLeadLagTapeStatus()),
  // Chain-verified, unsigned liquidity/timing quantiles only. The value query remains unreachable
  // until the inherited seven-day taker-flow gate passes and cannot expose token or trade direction.
  authoritativeTakerFlowDistributionAudit: protectedProcedure.query(() =>
    authoritativeTakerFlowDistributionAudit(),
  ),
  // One verified first-minute row per market; only unsigned activity/pressure magnitude is exposed.
  // Chain-confirmed pressure is a proxy-validation reference, not an assumed live decision input.
  authoritativeTakerPressureDistributionAudit: protectedProcedure.query(() =>
    authoritativeTakerPressureDistributionAudit(),
  ),
  // Aggregate mechanism concordance only. Both inherited source gates and a separate matched-panel
  // count/span/coverage gate must pass before any proxy/reference correlation can be queried.
  clobChainPressureConcordanceAudit: protectedProcedure.query(() =>
    clobChainPressureConcordanceAudit(),
  ),
  // Outcome-free basis/change/persistence quantiles. The feature query stays unreachable until all
  // six pairs pass the inherited venue-tape row/span/block floor.
  resolutionSourceBasisDistributionAudit: protectedProcedure.query(() =>
    resolutionSourceBasisDistributionAudit(),
  ),
  // Prospective, direction-invariant ID/NR4 feature distributions. Counts are shown first; the
  // value query remains unreachable until every frozen row/pair/span floor passes.
  idNr4QualityDistributionAudit: protectedProcedure.query(() => idNr4QualityDistributionAudit()),
  // Collection progress only: no IV skew/OI sign or directional diagnostic before its frozen floor.
  deribitSkewTape: protectedProcedure.query(() => deribitSkewTapeStatus()),
  // Counts only until all frozen floors pass; then the preregistered pooled proper-score audit.
  pricerCalibration: protectedProcedure.query(() => pricerCalibrationAudit()),
  // Counts only until the synchronized nested-strike tape passes every frozen readiness floor.
  crossHorizonBundle: protectedProcedure.query(() => crossHorizonBundleAudit()),
  // Exact-match count/span/block readiness only; BTC→alt correlations stay locked until the floor.
  crossAssetLeadLagTape: protectedProcedure.query(() => crossAssetLeadLagStatus()),
  // Count/data-quality readiness first. Once every frozen floor passes, expose only the fixed,
  // outcome-blind 30-second liquidation audit—never strategy ranks, grades, P&L, or orders.
  paperMarkoutTape: protectedProcedure.query(() => paperMarkoutAudit()),
  // Paired BTC5m profile-vs-parent proper scores; counts only until every frozen floor passes.
  bsmWindowProfileCalibration: protectedProcedure.query(() => bsmWindowProfileCalibrationAudit()),
  // Frozen effort-vs-response audit; cannot select outcomes until all count/span/session floors pass.
  microstructureAbsorption: protectedProcedure.query(() => microstructureAbsorptionAudit()),
  // Frozen four-result reversal audit; prior outcomes are inputs, while target outcomes stay locked.
  fourStreakReversal: protectedProcedure.query(() => fourStreakReversalAudit()),
  // Outcome-free overlap/agreement map; selects no resolution, price, fill, or P&L fields.
  strategyIndependence: protectedProcedure.query(() => strategyIndependenceStatus()),
  // Same-condition UP+DOWN matched-share cost audit; batched books, fee-aware, no outcomes/orders.
  completeSetTaker: protectedProcedure.query(() => completeSetTakerAudit()),
  // Prospective public-book preparation health only. The connector remains paper-only and has no
  // authentication, signing, submission, cancellation, credential, or balance capability.
  shadowConnectorAudit: protectedProcedure.query(() => polymarketShadowConnectorAudit()),
  // Secret-free control-plane status. It probes the official public SDK and reports only whether
  // account/risk prerequisites are present; it never authenticates, signs, submits, or cancels.
  connectorReadiness: protectedProcedure.query(() => polymarketConnectorReadiness()),
  // Authoritative executed-flow coverage and Polygon reconciliation only; no direction or outcomes.
  authoritativeTradeFlowTape: protectedProcedure.query(() => authoritativeTradeFlowTapeStatus()),
  // Outcome-blind v1/v2 decision stages and all six asset buckets; no result or P&L joins.
  smoothPathFunnel: protectedProcedure.query(() => smoothPathFunnelStatus()),
  // Compact public Hyperliquid aggressor-flow coverage only; no sign, outcome, or rule disclosure.
  hyperliquidFlowTape: protectedProcedure.query(() => hyperliquidFlowTapeStatus()),
  // Compact public CLOB book-event coverage only; rolling OFI signs and outcomes stay locked.
  clobEventOfiTape: protectedProcedure.query(() => clobEventOfiTapeStatus()),
  // Preregistered feature quantiles plus immutable-cut status; each source report stays null until
  // its full readiness gate passes, and the cut artifact cannot create a rule or paper decision.
  flowDistributionAudit: protectedProcedure.query(() => flowDistributionAudit()),
  // Outcome-free paired-book state quantiles by asset × horizon × sample minute. The grouped
  // feature query remains unreachable until the inherited raw microstructure tape gate passes.
  microstructureStateDistributionAudit: protectedProcedure.query(() =>
    microstructureStateDistributionAudit(),
  ),

  liveMarkets: protectedProcedure.query(async () => {
    const now = Date.now();
    const m = await fetchLiveCryptoUpDown(3).catch(() => []);
    return m
      .map((x) => ({
        question: x.question,
        slug: x.slug,
        horizonMin: updownHorizonMinutes(x.question),
        minutesLeft: x.endDate ? Math.round((new Date(x.endDate).getTime() - now) / 60000) : null,
        volumeNum: x.volumeNum ?? 0,
      }))
      .filter((x) => x.minutesLeft != null && x.minutesLeft >= 0)
      .sort((a, b) => (a.minutesLeft ?? 0) - (b.minutesLeft ?? 0))
      .slice(0, 40);
  }),
});
