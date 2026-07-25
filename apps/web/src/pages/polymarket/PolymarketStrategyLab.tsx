import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Beaker,
  Database,
  GitCompareArrows,
  Lock,
  Radar,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { PolymarketAssetLink } from "./PolymarketAssetLink";
import {
  nextSortState,
  PolymarketSortableHeader,
  stableSortRows,
  type SortState,
  type SortValue,
} from "./PolymarketSortableHeader";
import { FAMILY_META, strategyMeta, type StrategyFamily } from "./polymarket-strategy-meta";

type AuditState = "scheduled" | "collecting" | "ready" | "degraded" | "unavailable";
type AuditView = {
  key: string;
  name: string;
  family: string;
  version: string;
  source: string;
  state: AuditState;
  progress: number;
  primary: string;
  secondary: string;
  evalStartMs: number;
  note: string;
};

type ResearchLane = {
  key: string;
  name: string;
  href?: "/formula-lab";
  stage: "registered" | "capture next" | "hypothesis" | "blocked";
  evidence: string;
  requiredData: string;
  disposition: string;
};
type RegistrySortKey =
  | "strategy"
  | "family"
  | "timeframe"
  | "state"
  | "markets"
  | "decisions"
  | "clusters"
  | "residual"
  | "registered";
type FunnelSortKey = "asset" | "eligible" | "observed" | "path" | "book" | "paper";
type ShadowBucketSortKey =
  | "bucket"
  | "markets"
  | "coverage"
  | "p95Preparation"
  | "p99Preparation"
  | "p95BookAge"
  | "unavailable"
  | "rejections";
type IndependenceSortKey =
  | "pair"
  | "relation"
  | "shared"
  | "agreement"
  | "leftCoverage"
  | "rightCoverage"
  | "dependence";

const RESEARCH_LANES: ResearchLane[] = [
  {
    key: "cobra-bull-factor-session-router",
    name: "Cobra bull-factor × session router",
    stage: "hypothesis",
    evidence:
      "External Cobra v1.9.2 screenshot: per-bot bull factor, UK session × 5m/15m/60m buckets, and explicit no-tick/no-ask skip counters",
    requiredData:
      "Causal factor definition, source-timestamped Chainlink ticks, complete session attribution, and an independent forward boundary per timeframe",
    disposition:
      "Do not copy the displayed P&L or tune to the reported winning buckets. Jester already isolates the Cobra-night 5m pricer prior; next value is outcome-blind instrumentation of factor distribution and skip taxonomy before any broader session router is frozen.",
  },
  {
    key: "macro-breadth-router",
    name: "Macro leader: UP / DOWN / RANGE",
    stage: "registered",
    evidence: "Synchronized completed BTC, ETH, and SOL 5m CMO breadth",
    requiredData: "Fresh aligned anchor bars, local target CMO, fee-adjusted paired book",
    disposition:
      "Frozen as v1 at the Jul 23, 1:00 PM boundary. Trend, range-fade, and combined router remain separately scored beside always-UP and always-DOWN baselines.",
  },
  {
    key: "authoritative-taker-flow",
    name: "Authoritative taker-flow impulse",
    stage: "registered",
    evidence: "Public market trades reconciled to official V2 OrdersMatched receipts",
    requiredData:
      "10k raw events, 5k verified, 500 markets, 7d, 99% hash coverage, 99.5% terminal verification",
    disposition:
      "Collector frozen at the Jul 23, 3:00 PM boundary. No directional threshold exists; after readiness, inspect outcome-free distributions and preregister any rule at a new future boundary.",
  },
  {
    key: "clob-event-ofi",
    name: "CLOB event-level OFI",
    stage: "registered",
    evidence:
      "Public book and price-change frames folded into causal paired UP/DOWN queue pressure",
    requiredData:
      "20k compact rows, 1,500 resolved markets, 5d, 100 markets per asset/timeframe, 95% coverage",
    disposition:
      "Registered for Jul 24 at 2:00 AM CT. An outcome-blind launch audit found a stale tick-start read clock while tagged rows were still zero; the documented repair produced the first usable row at 2:25:56 AM CT. The tape reuses the authoritative-flow socket, reconstructs best queues in memory, and writes only 5s/30s/60s aggregates on existing state rows. No sign, threshold, or paper strategy exists before the outcome-free distribution audit.",
  },
  {
    key: "hyperliquid-aggressor-flow",
    name: "Hyperliquid aggressor-flow pulse",
    stage: "registered",
    evidence: "Public aggressor-side perp trades folded into causal 5s / 30s / 60s windows",
    requiredData:
      "20k usable rows, 1,500 resolved markets, 5d, 100 markets per asset/horizon, 95% coverage",
    disposition:
      "Outcome-blind v1 failed closed because quiet 5s/30s windows were treated as missing transport. Sparse-flow-safe v2 begins Jul 23 at 9:00 PM CT on the same six public subscriptions and stores only aggregates on existing state rows. No side threshold or paper rule exists.",
  },
  {
    key: "state-conditioned-dual-flow-agreement",
    name: "State-conditioned dual-flow agreement",
    stage: "blocked",
    evidence:
      "Rolling OOS state-first L2 results, repeated-flow theory, Hyperliquid impact evidence, and public replay/footprint implementations",
    requiredData:
      "Immutable 12-bucket dual-flow cuts + ready causal Polymarket microstructure tape; independent 5m/15m identities",
    disposition:
      "Retained as the only new flow candidate from the Jul 24 external-prior screen. Polymarket liquidity state must lead; same-sign Hyperliquid aggressor flow and paired-book event-OFI may add continuation evidence, while disagreement and single-print dominance abstain. Exact states, cuts, timing, and ask cap remain unfrozen until every outcome-free prerequisite passes.",
  },
  {
    key: "resolution-source-basis-convergence",
    name: "Resolution-source basis convergence",
    stage: "capture next",
    evidence:
      "Official Chainlink RTDS + existing exact 1s Chainlink × Hyperliquid tape; public engines establish divergence mechanics, not alpha",
    requiredData:
      "All 6 pairs at 100k rows, 3d, and 500 five-minute blocks; outcome-free per-pair basis cuts, freshness coverage, and independent 5m/15m boundaries",
    disposition:
      "Retain as a distinct future mechanism. After venue-tape readiness, freeze basis, change, and persistence cuts without outcomes; proceed only if the diagnostic supports stable Hyperliquid-to-Chainlink precedence. Any later child must beat Chainlink-only pricers incrementally, abstain on stale/conflicting evidence, and enter at a new boundary.",
  },
  {
    key: "formulaic-fixed-horizon-lab",
    name: "Formula Lab: fixed-horizon short",
    href: "/formula-lab",
    stage: "capture next",
    evidence:
      "Synthetic POC with bounded algebraic expression trees, training-only normalization, purged chronological folds, complexity penalties, and fixed 10-minute labels",
    requiredData:
      "Ready venue tape and immutable basis cuts; explicit trial ledger; source clocks; then a separate 15m paired-book tape with executable entry asks and exact 10-minute exit bids",
    disposition:
      "The first live experiment remains blocked. Short means a negative 10-minute underlying-return hypothesis; a later Polymarket translation may buy DOWN on 15m only and sell at the bid after exactly 10 minutes. Every formula × threshold × exit horizon counts as a trial, and any selected expression starts over at a new forward boundary. No 5m transfer is possible for this hold.",
  },
  {
    key: "smooth-path-displacement",
    name: "Smooth path / strike displacement",
    stage: "registered",
    evidence: "Chainlink resolution-source price ticks (~1 Hz) + prior-art 5m path logic",
    requiredData:
      "Opening Chainlink anchor, complete intrawindow tick path, minute-1 fill, current fee-adjusted paired book",
    disposition:
      "Jester's Morpheus-like lane: frozen as v1 for 5m minute-two decisions. These ticks are underlying Chainlink prices, not Polymarket trades; its independent score begins at the Jul 23, 11:45 AM boundary.",
  },
  {
    key: "smooth-path-causal-displacement",
    name: "Smooth path — causal ticks",
    stage: "registered",
    evidence:
      "Outcome-blind v1 funnel isolated RTDS deliveries arriving after the paired-book timestamp",
    requiredData:
      "Same v1 Chainlink path and executable books, filtered by both source time and local receipt time",
    disposition:
      "Prospective v2 begins Jul 23 at 5:00 PM CT. Every numerical path, edge, and chase gate is unchanged; only ticks already available at the book timestamp are eligible.",
  },
  {
    key: "maker-complete-set",
    name: "Maker complete-set feasibility",
    stage: "blocked",
    evidence: "Official maker mechanics + adverse-selection and ghost-fill research",
    requiredData: "Chain-settled fills, queue position, partial inventory, markouts, merge gas",
    disposition:
      "Keep as execution research. Off-chain matches can revert, and a two-leg spread is not realizable P&L unless both settled fills and inventory risk are modeled.",
  },
  {
    key: "options-implied-benchmark",
    name: "Options-implied fair-value benchmark",
    stage: "blocked",
    evidence: "Matched Deribit / Polymarket pricing research",
    requiredData: "Ready Deribit skew tape with matched horizon and strike",
    disposition:
      "Retain as a calibration diagnostic; do not extrapolate long-dated pricing gaps into 5-minute direction.",
  },
];

const cents = (value: number | null | undefined) =>
  value == null ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}¢`;
const gib = (value: number | null | undefined) =>
  value == null ? "—" : `${(value / 1_073_741_824).toFixed(2)} GiB`;
const ratio = (value: number, minimum: number) => (minimum > 0 ? Math.min(1, value / minimum) : 1);
const ceilingRatio = (value: number | null, maximum: number) =>
  value == null ? 0 : Math.min(1, maximum / Math.max(value, Number.EPSILON));
const readiness = (ready: boolean, evalStartMs: number): AuditState =>
  Date.now() < evalStartMs ? "scheduled" : ready ? "ready" : "collecting";
const progress = (...ratios: number[]) => Math.max(0, Math.min(1, ...ratios));
const strategyHorizon = (key: string): 5 | 15 | null => {
  const match = key.match(/:(5|15)$/);
  return match ? (Number(match[1]) as 5 | 15) : null;
};
const stateClass = (state: AuditState | string) =>
  ({
    ready: "border-success/30 bg-success/10 text-success",
    passing: "border-success/30 bg-success/10 text-success",
    failing: "border-destructive/30 bg-destructive/10 text-destructive",
    collecting: "border-warning/30 bg-warning/10 text-warning",
    degraded: "border-destructive/30 bg-destructive/5 text-destructive",
    scheduled: "border-border bg-muted/40 text-muted-foreground",
    waiting: "border-border bg-muted/40 text-muted-foreground",
    unavailable: "border-destructive/30 bg-destructive/5 text-destructive",
    control: "border-border bg-muted/40 text-muted-foreground",
  })[state] ?? "border-border bg-muted/40 text-muted-foreground";

export function PolymarketStrategyLab() {
  const floor = trpc.polymarket.floorView.useQuery({ scope: "forward", view: "registry" }, {
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const micro = trpc.polymarket.microstructureTape.useQuery(undefined, { staleTime: 60_000 });
  const venue = trpc.polymarket.venueLeadLagTape.useQuery(undefined, {
    staleTime: 15 * 60_000,
    refetchInterval: 15 * 60_000,
  });
  const basisDistribution = trpc.polymarket.resolutionSourceBasisDistributionAudit.useQuery(
    undefined,
    {
      staleTime: 15 * 60_000,
      refetchInterval: 15 * 60_000,
    },
  );
  const tradeFlow = trpc.polymarket.authoritativeTradeFlowTape.useQuery(undefined, {
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
  const hyperliquidFlow = trpc.polymarket.hyperliquidFlowTape.useQuery(undefined, {
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const clobEventOfi = trpc.polymarket.clobEventOfiTape.useQuery(undefined, {
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const flowDistribution = trpc.polymarket.flowDistributionAudit.useQuery(undefined, {
    staleTime: 15 * 60_000,
    refetchInterval: 15 * 60_000,
  });
  const smoothFunnel = trpc.polymarket.smoothPathFunnel.useQuery(undefined, {
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const deribit = trpc.polymarket.deribitSkewTape.useQuery(undefined, { staleTime: 60_000 });
  const calibration = trpc.polymarket.pricerCalibration.useQuery(undefined, { staleTime: 60_000 });
  const bundles = trpc.polymarket.crossHorizonBundle.useQuery(undefined, { staleTime: 60_000 });
  const crossAsset = trpc.polymarket.crossAssetLeadLagTape.useQuery(undefined, {
    staleTime: 15 * 60_000,
    refetchInterval: 15 * 60_000,
  });
  const markout = trpc.polymarket.paperMarkoutTape.useQuery(undefined, { staleTime: 60_000 });
  const profile = trpc.polymarket.bsmWindowProfileCalibration.useQuery(undefined, {
    staleTime: 60_000,
  });
  const absorption = trpc.polymarket.microstructureAbsorption.useQuery(undefined, {
    staleTime: 60_000,
  });
  const streak = trpc.polymarket.fourStreakReversal.useQuery(undefined, { staleTime: 60_000 });
  const independence = trpc.polymarket.strategyIndependence.useQuery(undefined, {
    staleTime: 60_000,
  });
  const completeSet = trpc.polymarket.completeSetTaker.useQuery(undefined, { staleTime: 60_000 });
  const shadowConnector = trpc.polymarket.shadowConnectorAudit.useQuery(undefined, {
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const auditRegistrySettled = ![
    micro.isLoading,
    venue.isLoading,
    basisDistribution.isLoading,
    tradeFlow.isLoading,
    hyperliquidFlow.isLoading,
    clobEventOfi.isLoading,
    flowDistribution.isLoading,
    deribit.isLoading,
    calibration.isLoading,
    bundles.isLoading,
    crossAsset.isLoading,
    markout.isLoading,
    profile.isLoading,
    absorption.isLoading,
    streak.isLoading,
    completeSet.isLoading,
    shadowConnector.isLoading,
  ].some(Boolean);
  const [family, setFamily] = useState<"all" | StrategyFamily>("all");
  const [registryView, setRegistryView] = useState<"split" | "pooled">(() =>
    localStorage.getItem("strategyLab.registryView") === "pooled" ? "pooled" : "split"
  );
  const [independenceHorizon, setIndependenceHorizon] = useState<"both" | "5" | "15">(
    () => {
      const saved = localStorage.getItem("strategyLab.independenceHorizon");
      return saved === "5" || saved === "15" ? saved : "both";
    },
  );
  const [registrySort, setRegistrySort] = useState<SortState<RegistrySortKey>>({
    key: "registered",
    direction: "desc",
  });
  const [funnelSort, setFunnelSort] = useState<SortState<FunnelSortKey>>({
    key: "asset",
    direction: "asc",
  });
  const [shadowBucketSort, setShadowBucketSort] = useState<
    SortState<ShadowBucketSortKey>
  >({
    key: "bucket",
    direction: "asc",
  });
  const [independenceSort, setIndependenceSort] = useState<SortState<IndependenceSortKey>>({
    key: "dependence",
    direction: "desc",
  });

  const audits = useMemo<AuditView[]>(() => {
    const rows: AuditView[] = [];
    const failed = [
      { key: "microstructure", error: micro.isError },
      { key: "venue", error: venue.isError },
      { key: "basisDistribution", error: basisDistribution.isError },
      { key: "tradeFlow", error: tradeFlow.isError },
      { key: "hyperliquidFlow", error: hyperliquidFlow.isError },
      { key: "clobEventOfi", error: clobEventOfi.isError },
      { key: "flowDistribution", error: flowDistribution.isError },
      { key: "deribit", error: deribit.isError },
      { key: "calibration", error: calibration.isError },
      { key: "bundles", error: bundles.isError },
      { key: "crossAsset", error: crossAsset.isError },
      { key: "markout", error: markout.isError },
      { key: "profile", error: profile.isError },
      { key: "absorption", error: absorption.isError },
      { key: "streak", error: streak.isError },
      { key: "completeSet", error: completeSet.isError },
      { key: "shadowConnector", error: shadowConnector.isError },
    ]
      .filter((query) => query.error)
      .map((query) => query.key);

    if (micro.data) {
      const d = micro.data;
      rows.push({
        key: "microstructure",
        name: "CLOB microstructure tape",
        family: "Data plane",
        version: d.version,
        source: "Polymarket books + Chainlink",
        state: readiness(d.readyForFrozenDiagnostic, d.evalStartMs),
        progress: progress(
          ratio(d.resolvedMarkets, d.minResolvedMarkets),
          ratio(d.spanDays, d.minSpanDays),
        ),
        primary: `${d.resolvedMarkets.toLocaleString()} / ${d.minResolvedMarkets.toLocaleString()} resolved markets`,
        secondary: `${d.usableRows.toLocaleString()} usable rows · ${d.spanDays.toFixed(2)} / ${d.minSpanDays}d`,
        evalStartMs: d.evalStartMs,
        note: "Captures touch size, depth, microprice, imbalance, spread, and Chainlink state without exposing outcome-conditioned diagnostics early.",
      });
    }
    if (venue.data) {
      const d = venue.data;
      const weakestRows = Math.min(...d.pairs.map((pair) => pair.rows));
      const weakestBlocks = Math.min(...d.pairs.map((pair) => pair.blocks));
      const weakestSpan = Math.min(...d.pairs.map((pair) => pair.spanDays));
      rows.push({
        key: "venue",
        name: "Venue lead / lag",
        family: "Market structure",
        version: d.version,
        source: "Chainlink × Hyperliquid",
        state: readiness(d.allPairsReadyForFrozenDiagnostic, d.evalStartMs),
        progress: progress(
          ratio(weakestRows, d.minRows),
          ratio(weakestBlocks, d.minBlocks),
          ratio(weakestSpan, d.minSpanDays),
        ),
        primary: `${d.pairs.length} pairs · weakest ${weakestRows.toLocaleString()} / ${d.minRows.toLocaleString()} rows`,
        secondary: `${weakestBlocks.toLocaleString()} / ${d.minBlocks.toLocaleString()} blocks · ${weakestSpan.toFixed(2)} / ${d.minSpanDays}d`,
        evalStartMs: d.evalStartMs,
        note: "Frozen diagnostic asks which venue moves first; correlations, signs, and winning lags stay hidden until every pair is ready.",
      });
    }
    if (basisDistribution.data) {
      const d = basisDistribution.data;
      const weakestRows = Math.min(...d.tape.pairs.map((pair) => pair.rows));
      const weakestBlocks = Math.min(...d.tape.pairs.map((pair) => pair.blocks));
      const weakestSpan = Math.min(...d.tape.pairs.map((pair) => pair.spanDays));
      rows.push({
        key: "resolution-source-basis-distribution",
        name: "Resolution-source basis distributions",
        family: "Model audit",
        version: d.version,
        source: "Chainlink × Hyperliquid exact-second tape",
        state: d.report ? "ready" : "collecting",
        progress: progress(
          ratio(weakestRows, d.tape.minimumRows),
          ratio(weakestBlocks, d.tape.minimumBlocks),
          ratio(weakestSpan, d.tape.minimumSpanDays),
        ),
        primary: d.report
          ? `${d.report.buckets.length} pair distributions unlocked`
          : `weakest ${weakestRows.toLocaleString()} / ${d.tape.minimumRows.toLocaleString()} rows`,
        secondary: d.report
          ? `${d.metrics.length} metrics · p05 / p25 / p50 / p75 / p95`
          : `${weakestBlocks.toLocaleString()} / ${d.tape.minimumBlocks.toLocaleString()} blocks · ${weakestSpan.toFixed(2)} / ${d.tape.minimumSpanDays}d`,
        evalStartMs: d.evalStartMs,
        note: d.report
          ? "The six pair-level reports are outcome-free. No threshold, direction, or strategy follows automatically; the hashed updown-resolution-source-basis-feature-cuts-v1 artifact and separate future 5m/15m registrations are still required."
          : "The exact basis, one-second change, five-second sign-persistence, and source-age quantiles are preregistered. Their query cannot run until all six pairs pass the original tape floor; a separate guarded freeze will then create updown-resolution-source-basis-feature-cuts-v1, while gaps remain null and Server2 caches the report for 15 minutes.",
      });
    }
    if (tradeFlow.data) {
      const d = tradeFlow.data;
      const weakestPairMarkets = Math.min(...d.pairs.map((pair) => pair.distinctMarkets));
      const capacityProjection = d.capacity.availableBytes == null
        ? "filesystem headroom unavailable"
        : `${gib(d.capacity.availableBytes)} filesystem free · ${gib(d.capacity.projectedAdditionalBytesToFloor)} projected additional to the ${d.floors.spanDays}d floor · ${gib(d.capacity.projectedAvailableBytesAtFloor)} projected free at unlock`;
      rows.push({
        key: "authoritative-trade-flow",
        name: "Authoritative taker-flow tape",
        family: "Market structure",
        version: d.version,
        source: "Polymarket stream × Polygon V2 receipts",
        state:
          d.mappingViolations > 0 || !d.operationalHealth.healthy
            ? "unavailable"
            : readiness(d.readyForOutcomeFreeDistributionAudit, d.evalStartMs),
        progress: progress(
          ratio(d.rawEvents, d.floors.rawEvents),
          ratio(d.verifiedEvents, d.floors.verifiedEvents),
          ratio(d.distinctMarkets, d.floors.distinctMarkets),
          ratio(d.spanDays, d.floors.spanDays),
          ratio(weakestPairMarkets, d.floors.marketsPerPair),
          ratio(d.hashCoverage, d.floors.hashCoverage),
          ratio(d.chainVerificationRate, d.floors.chainVerificationRate),
        ),
        primary: `${d.rawEvents.toLocaleString()} / ${d.floors.rawEvents.toLocaleString()} events · ${d.verifiedEvents.toLocaleString()} chain-verified · ${d.replacementVerifiedEvents.toLocaleString()} retry replacements · ${d.ambiguousHashEvents.toLocaleString()} ambiguous quarantined`,
        secondary: `${d.distinctMarkets.toLocaleString()} / ${d.floors.distinctMarkets.toLocaleString()} markets · ${d.spanDays.toFixed(2)} / ${d.floors.spanDays}d · weakest pair ${weakestPairMarkets} / ${d.floors.marketsPerPair}`,
        evalStartMs: d.evalStartMs,
        note:
          d.mappingViolations > 0
            ? `${d.mappingViolations} universe mapping violation(s); readiness is fail-closed.`
            : !d.operationalHealth.healthy
              ? `Collection health degraded: last event ${d.operationalHealth.lastEventAgeSec == null ? "—" : `${d.operationalHealth.lastEventAgeSec.toFixed(1)}s`} ago · p99 ingestion ${d.operationalHealth.p99IngestionLatencyMs == null ? "—" : `${Math.round(d.operationalHealth.p99IngestionLatencyMs)}ms`} · ${d.operationalHealth.oldPendingEvents.toLocaleString()} source hashes pending >${d.operationalHealth.pendingAgeWarningSec}s (${d.operationalHealth.overduePendingEvents.toLocaleString()} verifier-overdue · ${d.operationalHealth.retryDeferredPendingEvents.toLocaleString()} retry-deferred; ${d.operationalHealth.verificationInitialDelaySec}s initial / ${Math.round(d.operationalHealth.verificationRetryBaseSec / 60)}m–${Math.round(d.operationalHealth.verificationRetryMaxSec / 3600)}h retry). Readiness is fail-closed.`
              : `${d.pendingEvents.toLocaleString()} pending · ${d.missingHashEvents.toLocaleString()} missing hash · ${d.ambiguousHashEvents.toLocaleString()} ambiguous hash · ${(d.mismatchEvents + d.revertedEvents).toLocaleString()} receipt failures · hash coverage ${(d.hashCoverage * 100).toFixed(2)}% · terminal verification ${(d.chainVerificationRate * 100).toFixed(2)}% · last event ${d.operationalHealth.lastEventAgeSec == null ? "—" : `${d.operationalHealth.lastEventAgeSec.toFixed(1)}s`} ago · p95/p99 ingestion ${d.operationalHealth.p95IngestionLatencyMs == null ? "—" : Math.round(d.operationalHealth.p95IngestionLatencyMs)}/${d.operationalHealth.p99IngestionLatencyMs == null ? "—" : Math.round(d.operationalHealth.p99IngestionLatencyMs)}ms · ${d.operationalHealth.oldPendingEvents.toLocaleString()} source hashes pending >${d.operationalHealth.pendingAgeWarningSec}s (${d.operationalHealth.overduePendingEvents.toLocaleString()} verifier-overdue · ${d.operationalHealth.retryDeferredPendingEvents.toLocaleString()} retry-deferred) · ${gib(d.storage.relationBytes)} stored at ${gib(d.storage.bytesPerDay)}/day · ${capacityProjection}. Ambiguous replacements are terminal provenance failures and remain in the frozen verification-rate denominator. Projection is operational only; no retention, readiness, or strategy rule changes. Directional aggregates and outcomes remain locked.`,
      });
    }
    if (hyperliquidFlow.data) {
      const d = hyperliquidFlow.data;
      rows.push({
        key: "hyperliquid-flow",
        name: "Hyperliquid aggressor-flow tape",
        family: "Market structure",
        version: d.version,
        source: "Hyperliquid public trades × existing state tape",
        state:
          Date.now() >= d.evalStartMs && !d.operationalHealth.healthy
            ? "unavailable"
            : readiness(d.readyForOutcomeFreeDistributionAudit, d.evalStartMs),
        progress: progress(
          ratio(d.usableRows, d.floors.usableRows),
          ratio(d.resolvedMarkets, d.floors.resolvedMarkets),
          ratio(d.spanDays, d.floors.spanDays),
          ratio(d.weakestBucketMarkets, d.floors.marketsPerBucket),
          ratio(d.coverage, d.floors.coverage),
        ),
        primary: `${d.usableRows.toLocaleString()} / ${d.floors.usableRows.toLocaleString()} usable rows · ${d.resolvedMarkets.toLocaleString()} / ${d.floors.resolvedMarkets.toLocaleString()} resolved markets`,
        secondary: `${d.spanDays.toFixed(2)} / ${d.floors.spanDays}d · weakest bucket ${d.weakestBucketMarkets} / ${d.floors.marketsPerBucket} · ${(d.coverage * 100).toFixed(1)}% coverage · ${d.coverageBreakdown.missingSnapshotRows.toLocaleString()} no complete 60s snapshot · ${d.coverageBreakdown.delayedTransportRows.toLocaleString()} transport-delayed`,
        evalStartMs: d.evalStartMs,
        note: Date.now() < d.evalStartMs
          ? `Prospective collection begins ${new Date(d.evalStartMs).toLocaleString()}; pre-boundary blanks are expected.`
          : d.operationalHealth.healthy
            ? `The denominator is unchanged and exactly reconciled: ${d.coverageBreakdown.taggedRows.toLocaleString()} tagged rows; ${
              d.coverageBreakdown.completeTaggedUsableCoverage == null
                ? "—"
                : `${(d.coverageBreakdown.completeTaggedUsableCoverage * 100).toFixed(1)}%`
            } usable among complete tagged snapshots. Missing and delayed rows remain null and are never imputed or backfilled. Stores only aggregates; flow signs, outcomes, and thresholds remain locked.`
            : `Collection health is fail-closed: latest state row ${d.operationalHealth.lastCaptureAgeSec == null ? "—" : `${d.operationalHealth.lastCaptureAgeSec.toFixed(1)}s`} old; latest included trade ${d.operationalHealth.latestLastTradeAgeSec == null ? "—" : `${d.operationalHealth.latestLastTradeAgeSec.toFixed(1)}s`} old; recent max transport lag ${d.operationalHealth.latestMaxTransportLagMs == null ? "—" : `${Math.round(d.operationalHealth.latestMaxTransportLagMs)}ms`}.`,
      });
    }
    if (clobEventOfi.data) {
      const d = clobEventOfi.data;
      const operationalTransportDegraded =
        d.operationalCoverage.pairedBookEligibleRows >= 12
        && d.operationalCoverage.pairedBookCoverage != null
        && d.operationalCoverage.pairedBookCoverage < d.floors.coverage;
      rows.push({
        key: "clob-event-ofi",
        name: "CLOB event-OFI tape",
        family: "Market structure",
        version: d.version,
        source: "Existing Polymarket public socket × state tape",
        state:
          Date.now() >= d.evalStartMs && !d.operationalHealth.healthy
            ? "unavailable"
            : Date.now() >= d.evalStartMs && operationalTransportDegraded
              ? "degraded"
              : readiness(d.readyForOutcomeFreeDistributionAudit, d.evalStartMs),
        progress: progress(
          ratio(d.usableRows, d.floors.usableRows),
          ratio(d.resolvedMarkets, d.floors.resolvedMarkets),
          ratio(d.spanDays, d.floors.spanDays),
          ratio(d.weakestBucketMarkets, d.floors.marketsPerBucket),
          ratio(d.coverage, d.floors.coverage),
        ),
        primary: `${d.usableRows.toLocaleString()} / ${d.floors.usableRows.toLocaleString()} usable rows · ${d.resolvedMarkets.toLocaleString()} / ${d.floors.resolvedMarkets.toLocaleString()} resolved markets`,
        secondary: `${d.spanDays.toFixed(2)} / ${d.floors.spanDays}d · weakest bucket ${d.weakestBucketMarkets} / ${d.floors.marketsPerBucket} · ${(d.coverage * 100).toFixed(1)}% cumulative coverage · ${
          d.operationalCoverage.coverage == null
            ? `last ${d.operationalCoverage.windowMin}m —`
            : `last ${d.operationalCoverage.windowMin}m ${(d.operationalCoverage.coverage * 100).toFixed(1)}% all rows (${d.operationalCoverage.usableRows}/${d.operationalCoverage.eligibleRows}) · ${
              d.operationalCoverage.pairedBookCoverage == null
                ? "complete-book transport —"
                : `${(d.operationalCoverage.pairedBookCoverage * 100).toFixed(1)}% complete-book transport (${d.operationalCoverage.pairedBookUsableRows}/${d.operationalCoverage.pairedBookEligibleRows})`
            } · ${d.operationalCoverage.pairedBookUnavailableRows} paired-book unavailable · ${d.operationalCoverage.transportMissingRows} transport missing`
        }`,
        evalStartMs: d.evalStartMs,
        note: Date.now() < d.evalStartMs
          ? `Prospective collection begins ${new Date(d.evalStartMs).toLocaleString()}; pre-boundary blanks are expected.`
          : !d.operationalHealth.healthy
            ? `Collection health is fail-closed: latest state row ${d.operationalHealth.lastCaptureAgeSec == null ? "—" : `${d.operationalHealth.lastCaptureAgeSec.toFixed(1)}s`} old; parsed market-data age ${d.operationalHealth.latestMarketDataAgeSec == null ? "—" : `${d.operationalHealth.latestMarketDataAgeSec.toFixed(1)}s`}; recent max transport lag ${d.operationalHealth.latestMaxTransportLagMs == null ? "—" : `${Math.round(d.operationalHealth.latestMaxTransportLagMs)}ms`}.`
            : operationalTransportDegraded
              ? `Complete paired-book transport coverage is below the frozen ${(d.floors.coverage * 100).toFixed(0)}% floor despite a currently fresh stream: ${d.operationalCoverage.transportMissingRows} otherwise eligible rows are missing. Gaps remain null and cannot be backfilled.`
              : d.operationalCoverage.pairedBookUnavailableRows > 0
                ? `The stream is healthy for complete paired books. ${d.operationalCoverage.pairedBookUnavailableRows} recent rows had an independently fetched incomplete/one-sided paired book and correctly remain null; they still count against the unchanged cumulative ${(d.floors.coverage * 100).toFixed(0)}% readiness floor.`
              : `${d.firstCapturedAtMs == null ? "First usable row pending." : `First usable row ${new Date(d.firstCapturedAtMs).toLocaleString()}.`} The recent coverage window is operational only and does not alter the frozen cumulative 95% readiness floor. Reuses the existing public socket and stores only paired 5s/30s/60s quote-event aggregates on existing state rows. Signs, outcome relationships, and thresholds remain locked.`,
      });
    }
    if (flowDistribution.data) {
      const d = flowDistribution.data;
      rows.push({
        key: "flow-distribution",
        name: "Outcome-free flow distributions",
        family: "Model audit",
        version: d.version,
        source: "Hyperliquid flow × CLOB event-OFI",
        state: d.readySources === d.totalSources ? "ready" : "collecting",
        progress: ratio(d.readySources, d.totalSources),
        primary: `${d.readySources} / ${d.totalSources} source distributions ready`,
        secondary: `Hyperliquid ${d.sources.hyperliquid.ready ? "unlocked" : "locked"} · CLOB event-OFI ${d.sources.clobEventOfi.ready ? "unlocked" : "locked"} · p05 / p25 / p50 / p75 / p95`,
        evalStartMs: Math.max(
          d.sources.hyperliquid.evalStartMs,
          d.sources.clobEventOfi.evalStartMs,
        ),
        note: d.readySources === 0
          ? "The exact quantiles and metrics are preregistered. No feature-value query runs until a source independently passes every original readiness floor; no outcome or paper-performance field is available here."
          : "Unlocked reports remain outcome-free. Any directional transform or threshold still requires a later boundary, an independent paper bot, and the unchanged verdict gate.",
      });
      const freeze = d.featureCutFreeze;
      rows.push({
        key: "flow-feature-cut-freeze",
        name: "Flow feature-cut freeze",
        family: "Model audit",
        version: freeze.artifactVersion,
        source: "Ready distributions → immutable preprocessing artifact",
        state: freeze.frozen ? "ready" : "collecting",
        progress: freeze.frozen ? 1 : ratio(d.readySources, d.totalSources) * 0.9,
        primary: freeze.frozen && freeze.artifact
          ? `${freeze.artifact.buckets} / ${freeze.requiredBuckets} bucket references frozen`
          : `${d.readySources} / ${d.totalSources} prerequisite distributions ready`,
        secondary: freeze.frozen && freeze.artifact
          ? `SHA ${freeze.artifact.sha256.slice(0, 12)}… · strategy not before ${new Date(freeze.artifact.strategyNotBeforeMs).toLocaleString()}`
          : `No artifact · ${freeze.requiredBuckets} buckets required · minimum ${freeze.minimumBoundaryDelayMs / 60_000}m later boundary`,
        evalStartMs: Math.max(
          d.sources.hyperliquid.evalStartMs,
          d.sources.clobEventOfi.evalStartMs,
        ),
        note: freeze.frozen
          ? "The hash-verified artifact contains only outcome-blind robust references. It still authorizes no side rule or bot; any candidate needs a separate future registration and the unchanged paper verdict gate."
          : freeze.eligibleToFreeze
            ? "Both source reports are ready. The one-shot freeze may now capture the preregistered robust references; it still cannot create a strategy or inspect outcomes."
            : "The one-shot freeze is fail-closed. It cannot read or write feature cuts until both original source floors pass, and it cannot create a paper bot or execution path.",
      });
    }
    if (crossAsset.data) {
      const d = crossAsset.data;
      const weakestRows = Math.min(...d.pairs.map((pair) => pair.matchedRows));
      const weakestBlocks = Math.min(...d.pairs.map((pair) => pair.blocks));
      const weakestSpan = Math.min(...d.pairs.map((pair) => pair.spanDays));
      rows.push({
        key: "cross-asset",
        name: "BTC → alt lead / lag",
        family: "Market structure",
        version: d.version,
        source: "Exact-match venue tape",
        state: readiness(d.allPairsReadyForFrozenDiagnostic, d.evalStartMs),
        progress: progress(
          ratio(weakestRows, d.minRows),
          ratio(weakestBlocks, d.minBlocks),
          ratio(weakestSpan, d.minSpanDays),
        ),
        primary: `${d.pairs.length} alts · weakest ${weakestRows.toLocaleString()} / ${d.minRows.toLocaleString()} matches`,
        secondary: `${weakestBlocks.toLocaleString()} / ${d.minBlocks.toLocaleString()} blocks · ${weakestSpan.toFixed(2)} / ${d.minSpanDays}d`,
        evalStartMs: d.evalStartMs,
        note: "Tests whether BTC contains short-horizon information for alts using only exact timestamp matches.",
      });
    }
    if (deribit.data) {
      const d = deribit.data;
      const weakestRows = Math.min(...d.currencies.map((item) => item.rows));
      const weakestSpan = Math.min(...d.currencies.map((item) => item.spanDays));
      rows.push({
        key: "deribit",
        name: "Deribit skew context",
        family: "Derivatives",
        version: d.version,
        source: "Deribit BTC / ETH options",
        state: readiness(d.allCurrenciesReadyForFrozenDiagnostic, d.evalStartMs),
        progress: progress(
          ratio(weakestRows, d.diagnosticMinRows),
          ratio(weakestSpan, d.diagnosticMinSpanDays),
        ),
        primary: `${d.currencies.length} currencies · weakest ${weakestRows.toLocaleString()} / ${d.diagnosticMinRows.toLocaleString()} rows`,
        secondary: `${weakestSpan.toFixed(2)} / ${d.diagnosticMinSpanDays}d · ${Math.round(d.sampleMs / 60_000)}m cadence`,
        evalStartMs: d.evalStartMs,
        note: "Collects delta-matched put/call skew and open-interest context; directional signs remain disclosure-locked.",
      });
    }
    if (calibration.data) {
      const d = calibration.data;
      rows.push({
        key: "calibration",
        name: "Digital pricer calibration",
        family: "Model audit",
        version: d.version,
        source: "BSM N(d2) × book × resolution",
        state: readiness(d.ready, d.evalStartMs),
        progress: progress(
          ratio(d.observations, d.minObservations),
          ratio(d.clusters, d.minClusters),
          ratio(d.spanDays, d.minSpanDays),
        ),
        primary: `${d.observations.toLocaleString()} / ${d.minObservations.toLocaleString()} observations`,
        secondary: `${d.clusters.toLocaleString()} / ${d.minClusters.toLocaleString()} clusters · ${d.spanDays.toFixed(2)} / ${d.minSpanDays}d`,
        evalStartMs: d.evalStartMs,
        note: "Compares BSM and the market with paired Brier and log loss only after the frozen observation floor.",
      });
    }
    if (profile.data) {
      const d = profile.data;
      rows.push({
        key: "profile",
        name: "BSM window-profile calibration",
        family: "Model audit",
        version: d.version,
        source: "BTC 5m state tape",
        state: readiness(d.ready, d.evalStartMs),
        progress: progress(
          ratio(d.observations, d.minObservations),
          ratio(d.clusters, d.minClusters),
          ratio(d.spanDays, d.minSpanDays),
        ),
        primary: `${d.observations.toLocaleString()} / ${d.minObservations.toLocaleString()} paired observations`,
        secondary: `${d.clusters.toLocaleString()} / ${d.minClusters.toLocaleString()} clusters · ${d.spanDays.toFixed(2)} / ${d.minSpanDays}d`,
        evalStartMs: d.evalStartMs,
        note: "Paired proper-score audit of the frozen intrawindow variance clock against its unchanged BSM parent.",
      });
    }
    if (bundles.data) {
      const d = bundles.data;
      rows.push({
        key: "bundles",
        name: "Cross-horizon nested strikes",
        family: "Execution research",
        version: d.version,
        source: "Synchronized 5m / 15m books",
        state: readiness(d.ready, d.evalStartMs),
        progress: progress(
          ratio(d.rows, d.minRows),
          ratio(d.commonCloses, d.minCommonCloses),
          ratio(d.spanDays, d.minSpanDays),
        ),
        primary: `${d.rows.toLocaleString()} / ${d.minRows.toLocaleString()} bundle rows`,
        secondary: `${d.commonCloses.toLocaleString()} / ${d.minCommonCloses.toLocaleString()} common closes · ${d.spanDays.toFixed(2)} / ${d.minSpanDays}d`,
        evalStartMs: d.evalStartMs,
        note: "Measures fee-aware executable cost for synchronized nested contracts; it is an audit, not an order path.",
      });
    }
    if (completeSet.data) {
      const d = completeSet.data;
      rows.push({
        key: "complete-set",
        name: "Complete-set taker parity",
        family: "Execution research",
        version: d.version,
        source: "Batched UP + DOWN books",
        state: readiness(d.ready, d.evalStartMs),
        progress: progress(
          ratio(d.rows, d.minimums.rows),
          ratio(d.markets, d.minimums.markets),
          ratio(d.spanDays, d.minimums.spanDays),
        ),
        primary: `${d.rows.toLocaleString()} / ${d.minimums.rows.toLocaleString()} synchronized rows`,
        secondary: `${d.markets.toLocaleString()} / ${d.minimums.markets.toLocaleString()} markets · ${d.spanDays.toFixed(2)} / ${d.minimums.spanDays}d · ${d.sharesPerLeg} shares/leg`,
        evalStartMs: d.evalStartMs,
        note: `Measures fee-adjusted complete-set cost from one batch request. The sealed report preserves all ${d.reportContract.requiredBuckets} asset × timeframe × minute buckets plus 2/3-minute persistence; it remains pre-gas and does not assume that two independent orders fill atomically.`,
      });
    }
    if (shadowConnector.data) {
      const d = shadowConnector.data;
      const rejectSummary = Object.entries(d.rejectReasons)
        .filter(([, count]) => count > 0)
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 4)
        .map(([reason, count]) => `${reason} ${count.toLocaleString()}`)
        .join(" · ");
      rows.push({
        key: "shadow-connector-latency",
        name: "Shadow connector preparation",
        family: "Execution research",
        version: d.version,
        source: "Resident public CLOB book",
        state: readiness(d.readyForOperationalReview, d.evalStartMs),
        progress: progress(
          ratio(d.markets, d.floors.minMarkets),
          ratio(d.spanHours, d.floors.minSpanHours),
          ratio(d.preparedCoverage, d.floors.minPreparedCoverage),
          ceilingRatio(d.preparationMicros.p95, d.floors.maxP95PreparationMicros),
          ceilingRatio(d.preparationMicros.p99, d.floors.maxP99PreparationMicros),
          ceilingRatio(d.marketDataAgeMs.p95, d.floors.maxP95MarketDataAgeMs),
        ),
        primary: `${d.markets.toLocaleString()} / ${d.floors.minMarkets.toLocaleString()} markets · ${(d.preparedCoverage * 100).toFixed(1)} / ${(d.floors.minPreparedCoverage * 100).toFixed(0)}% prepared`,
        secondary: `${d.spanHours.toFixed(2)} / ${d.floors.minSpanHours}h · p95/p99 preparation ${
          d.preparationMicros.p95 == null ? "—" : Math.round(d.preparationMicros.p95).toLocaleString()
        }/${
          d.preparationMicros.p99 == null ? "—" : Math.round(d.preparationMicros.p99).toLocaleString()
        } µs · p95 book age ${
          d.marketDataAgeMs.p95 == null ? "—" : Math.round(d.marketDataAgeMs.p95).toLocaleString()
        } ms`,
        evalStartMs: d.evalStartMs,
        note: Date.now() < d.evalStartMs
          ? `Prospective timing begins ${new Date(d.evalStartMs).toLocaleString()}. Historical telemetry is excluded. The adapter performs no REST call, database read, socket creation, or JSON parsing in its timed hot path.`
          : `${rejectSummary || "No preparation rejections recorded."} Missing telemetry and unavailable public books count against coverage. Passing is an operational review only and cannot authorize credentials, signing, submission, cancellation, balances, live trading, or a strategy promotion.`,
      });
    }
    if (markout.data) {
      const d = markout.data;
      rows.push({
        key: "markout",
        name: "30-second paper markouts",
        family: "Execution research",
        version: d.version,
        source: "Paper decisions × future book",
        state: readiness(d.readyForDescriptiveAudit, d.evalStartMs),
        progress: progress(
          ratio(d.terminalRows, d.minimums.terminalRows),
          ratio(d.markets, d.minimums.markets),
          ratio(d.spanDays, d.minimums.spanDays),
        ),
        primary: `${d.terminalRows.toLocaleString()} / ${d.minimums.terminalRows.toLocaleString()} terminal markouts`,
        secondary: `${d.markets.toLocaleString()} / ${d.minimums.markets.toLocaleString()} markets · ${d.spanDays.toFixed(2)} / ${d.minimums.spanDays}d`,
        evalStartMs: d.evalStartMs,
        note: "Separates decision quality from final outcome by measuring the book after entry; signs and rankings stay locked.",
      });
    }
    if (absorption.data) {
      const d = absorption.data;
      rows.push({
        key: "absorption",
        name: "Microstructure absorption",
        family: "Candidate audit",
        version: d.version,
        source: "Minute 0 → minute 1 CLOB response",
        state: readiness(d.ready, d.evalStartMs),
        progress: progress(
          ratio(d.markets, d.minimums.markets),
          ratio(d.bets, d.minimums.bets),
          ratio(d.clusters, d.minimums.clusters),
          ratio(d.qualifyingSessions, d.minimums.sessions),
          ratio(d.spanDays, d.minimums.spanDays),
        ),
        primary: `${d.markets.toLocaleString()} / ${d.minimums.markets.toLocaleString()} markets · ${d.bets.toLocaleString()} / ${d.minimums.bets.toLocaleString()} candidates`,
        secondary: `${d.clusters.toLocaleString()} / ${d.minimums.clusters.toLocaleString()} clusters · ${d.qualifyingSessions} / ${d.minimums.sessions} sessions · ${d.spanDays.toFixed(2)} / ${d.minimums.spanDays}d`,
        evalStartMs: d.evalStartMs,
        note: "Frozen effort-versus-response rule. Outcomes and residual alpha are not selected until every count, span, cluster, and session floor passes.",
      });
    }
    if (streak.data) {
      const d = streak.data;
      rows.push({
        key: "four-streak",
        name: "Four-result reversal",
        family: "Candidate audit",
        version: d.version,
        source: "Prior four resolved 5m markets",
        state: readiness(d.ready, d.evalStartMs),
        progress: progress(
          ratio(d.markets, d.minimums.markets),
          ratio(d.bets, d.minimums.bets),
          ratio(d.clusters, d.minimums.clusters),
          ratio(d.qualifyingSessions, d.minimums.sessions),
          ratio(d.spanDays, d.minimums.spanDays),
        ),
        primary: `${d.markets.toLocaleString()} / ${d.minimums.markets.toLocaleString()} markets · ${d.bets.toLocaleString()} / ${d.minimums.bets.toLocaleString()} candidates`,
        secondary: `${d.clusters.toLocaleString()} / ${d.minimums.clusters.toLocaleString()} clusters · ${d.qualifyingSessions} / ${d.minimums.sessions} sessions · ${d.spanDays.toFixed(2)} / ${d.minimums.spanDays}d`,
        evalStartMs: d.evalStartMs,
        note: "Contrarian candidate after four same-direction venue resolutions. Target outcomes stay unread until readiness.",
      });
    }
    for (const key of failed) {
      rows.push({
        key: String(key),
        name: `${key} audit`,
        family: "Unavailable",
        version: "—",
        source: "Status endpoint",
        state: "unavailable",
        progress: 0,
        primary: "Status unavailable",
        secondary: "No zero-filled substitute is shown.",
        evalStartMs: Date.now(),
        note: "The status query failed. Reload or inspect the API before interpreting readiness.",
      });
    }
    return rows;
  }, [
    absorption,
    basisDistribution,
    bundles,
    calibration,
    completeSet,
    shadowConnector,
    clobEventOfi,
    flowDistribution,
    crossAsset,
    deribit,
    markout,
    micro,
    profile,
    streak,
    tradeFlow,
    hyperliquidFlow,
    venue,
  ]);

  if (floor.isLoading) {
    return (
      <div className="text-muted-foreground rounded-xl border p-8 text-sm">
        Loading strategy registry…
      </div>
    );
  }
  if (!floor.data) {
    return (
      <div className="border-destructive/30 bg-destructive/5 rounded-xl border p-6 text-sm">
        The registered paper roster is unavailable. The Lab will not infer strategies from stale
        client constants.
      </div>
    );
  }

  const response = floor.data;
  const bots = response.scope.bots;
  const botByKey = new Map(bots.map((bot) => [bot.key, bot]));
  const pooledGateByKey = new Map(response.gate.bots.map((bot) => [bot.key, bot]));
  const pooledRows = bots.map((bot) => ({
    rowKey: bot.key,
    bot,
    gate: pooledGateByKey.get(bot.key),
    horizonMin: null as 5 | 15 | null,
    state: bot.key === "drift"
      ? "control"
      : (pooledGateByKey.get(bot.key)?.state ?? "waiting"),
  }));
  const splitRows = [
    ...response.familywiseGate.hypotheses.flatMap((gate) => {
      const match = gate.key.match(/^(.*):(5|15)$/);
      if (!match) return [];
      const bot = botByKey.get(match[1]);
      if (!bot) return [];
      return [{
        rowKey: gate.key,
        bot,
        gate,
        horizonMin: Number(match[2]) as 5 | 15,
        state: gate.state,
      }];
    }),
    ...bots
      .filter((bot) => bot.key === "drift")
      .map((bot) => ({
        rowKey: "drift:control",
        bot,
        gate: undefined,
        horizonMin: null as 5 | 15 | null,
        state: "control",
      })),
  ];
  const splitPopulated = response.familywiseGate.hypotheses.filter(
    (gate) => gate.markets > 0 || gate.decisions > 0 || gate.bets > 0,
  ).length;
  const splitCollectionStarted = Date.now() >= response.familywiseGate.constants.evalStartMs;
  const registryRows = (registryView === "split" ? splitRows : pooledRows).filter(
    ({ bot }) => family === "all" || strategyMeta(bot.key).family === family,
  );
  const registryValue = (
    row: (typeof registryRows)[number],
    key: RegistrySortKey,
  ): SortValue => {
    const meta = strategyMeta(row.bot.key);
    return {
      strategy: row.bot.name,
      family: FAMILY_META[meta.family].label,
      timeframe: row.horizonMin,
      state: row.state,
      markets: row.gate?.markets,
      decisions: row.gate?.decisions,
      clusters: row.gate?.residual?.clusters,
      residual: row.gate?.residual?.mean,
      registered: row.gate?.evalStartMs,
    }[key];
  };
  const sortedRegistryRows = stableSortRows(
    registryRows,
    (row) => registryValue(row, registrySort.key),
    registrySort.direction,
  );
  const independenceBotByKey = new Map(
    independence.data?.bots.map((bot) => [bot.key, bot]) ?? [],
  );
  const independenceEligible =
    independence.data?.pairs.filter((pair) => pair.sharedMarkets >= 3) ?? [];
  const prioritizeUnexpectedCollisions = (pairs: typeof independenceEligible) =>
    [...pairs].sort(
      (left, right) =>
        Number(right.unexpectedExactCollision) - Number(left.unexpectedExactCollision),
    );
  const fiveMinutePairs = prioritizeUnexpectedCollisions(
    independenceEligible.filter(
      (pair) => strategyHorizon(pair.leftKey) === 5 && strategyHorizon(pair.rightKey) === 5,
    ),
  );
  const fifteenMinutePairs = prioritizeUnexpectedCollisions(
    independenceEligible.filter(
      (pair) => strategyHorizon(pair.leftKey) === 15 && strategyHorizon(pair.rightKey) === 15,
    ),
  );
  const independencePairs = (() => {
    if (independenceHorizon === "5") return fiveMinutePairs.slice(0, 12);
    if (independenceHorizon === "15") return fifteenMinutePairs.slice(0, 12);
    const balanced: typeof independenceEligible = [];
    for (let index = 0; balanced.length < 12; index++) {
      const five = fiveMinutePairs[index];
      const fifteen = fifteenMinutePairs[index];
      if (!five && !fifteen) break;
      if (five) balanced.push(five);
      if (fifteen && balanced.length < 12) balanced.push(fifteen);
    }
    return balanced;
  })();
  const independenceValue = (
    pair: (typeof independencePairs)[number],
    key: IndependenceSortKey,
  ): SortValue => ({
    pair: `${pair.leftKey}:${pair.rightKey}`,
    relation: pair.unexpectedExactCollision
      ? "0-unexpected-exact"
      : pair.structuralRelation
        ? `1-${pair.structuralRelation}`
        : `2-${pair.relation}`,
    shared: pair.sharedMarkets,
    agreement: pair.agreement,
    leftCoverage: pair.leftCoverage,
    rightCoverage: pair.rightCoverage,
    dependence: pair.dependencyStrength,
  })[key];
  const sortedIndependencePairs = stableSortRows(
    independencePairs,
    (pair) => independenceValue(pair, independenceSort.key),
    independenceSort.direction,
  );
  const sortRegistry = (key: RegistrySortKey, initialDirection: "asc" | "desc" = "desc") =>
    setRegistrySort((current) => nextSortState(current, key, initialDirection));
  const sortFunnel = (key: FunnelSortKey, initialDirection: "asc" | "desc" = "desc") =>
    setFunnelSort((current) => nextSortState(current, key, initialDirection));
  const sortShadowBucket = (
    key: ShadowBucketSortKey,
    initialDirection: "asc" | "desc" = "desc",
  ) => setShadowBucketSort((current) => nextSortState(current, key, initialDirection));
  const sortIndependence = (
    key: IndependenceSortKey,
    initialDirection: "asc" | "desc" = "desc",
  ) => setIndependenceSort((current) => nextSortState(current, key, initialDirection));
  const shadowBuckets = shadowConnector.data?.buckets ?? [];
  const shadowRejectionSummary = (bucket: (typeof shadowBuckets)[number]) =>
    Object.entries(bucket.rejectReasons)
      .filter(([, count]) => count > 0)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([reason, count]) => `${reason} ${count.toLocaleString()}`)
      .join(" · ");
  const sortedShadowBuckets = stableSortRows(
    shadowBuckets,
    (bucket) => ({
      bucket: `${bucket.pair}:${String(bucket.horizonMin).padStart(2, "0")}`,
      markets: bucket.markets,
      coverage: bucket.preparedCoverage,
      p95Preparation: bucket.preparationMicros.p95,
      p99Preparation: bucket.preparationMicros.p99,
      p95BookAge: bucket.marketDataAgeMs.p95,
      unavailable: bucket.unavailablePlans,
      rejections: shadowRejectionSummary(bucket),
    })[shadowBucketSort.key],
    shadowBucketSort.direction,
  );
  const readyAudits = audits.filter((audit) => audit.state === "ready").length;
  const registeredPaperStrategies = bots.filter((bot) => bot.key !== "drift").length;
  const strategyCounts = bots.reduce<Record<StrategyFamily, number>>(
    (counts, bot) => {
      counts[strategyMeta(bot.key).family]++;
      return counts;
    },
    { signal: 0, regime: 0, pattern: 0, pricer: 0, control: 0 },
  );

  return (
    <div className="space-y-5">
      <section className="bg-card rounded-xl border">
        <div className="grid lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
          <div className="p-5 lg:border-r">
            <div className="text-muted-foreground mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em]">
              <Beaker className="h-3.5 w-3.5" />
              Research operating system
            </div>
            <h2 className="text-xl font-semibold tracking-tight">
              Registered rules, forward evidence, and locked audits
            </h2>
            <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">
              The Lab now mirrors the live roster instead of replaying six legacy hypotheses.
              Its primary evidence view treats every strategy × timeframe as an independent
              prospective cohort; the immutable pooled gate remains available only for continuity.
              Audit rows expose collection progress while withholding results until their
              preregistered floors are met.
            </p>
          </div>
          <div className="grid grid-cols-2 border-t lg:border-t-0">
            <div className="border-b border-r p-4">
              <div className="text-muted-foreground text-[10px] uppercase tracking-[0.15em]">
                Registered
              </div>
              <div className="mt-1 font-mono text-2xl font-semibold">
                {registeredPaperStrategies}
              </div>
              <div className="text-muted-foreground text-[11px]">paper strategies</div>
            </div>
            <div className="border-b p-4">
              <div className="text-muted-foreground text-[10px] uppercase tracking-[0.15em]">
                Audits ready
              </div>
              <div className="mt-1 font-mono text-2xl font-semibold">
                {auditRegistrySettled ? `${readyAudits}/${audits.length}` : "—"}
              </div>
              <div className="text-muted-foreground text-[11px]">
                {auditRegistrySettled ? "results disclosure" : "loading audit registry"}
              </div>
            </div>
            <div className="border-r p-4">
              <div className="text-muted-foreground text-[10px] uppercase tracking-[0.15em]">
                Evaluation gates
              </div>
              <div className="mt-1 font-mono text-xs font-semibold">{response.gate.version}</div>
              <div className="text-muted-foreground mt-0.5 font-mono text-[10px]">
                {response.timeframeGate.version}
              </div>
              <div className="text-muted-foreground font-mono text-[10px]">
                {response.macroDirectionGate.version}
              </div>
              <div className="text-muted-foreground font-mono text-[10px]">
                {response.familywiseGate.version}
              </div>
              <div className="text-muted-foreground text-[11px]">
                familywise starts {new Date(response.familywiseGate.constants.evalStartMs).toLocaleString()}
              </div>
            </div>
            <div className="p-4">
              <div className="text-muted-foreground text-[10px] uppercase tracking-[0.15em]">
                Execution
              </div>
              <div className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold">
                <Lock className="h-3.5 w-3.5" /> Locked
              </div>
              <div className="text-muted-foreground text-[11px]">no order endpoint</div>
            </div>
          </div>
        </div>
      </section>

      <Card className="overflow-hidden shadow-none">
        <CardHeader className="border-b p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Radar className="text-muted-foreground h-4 w-4" />
                Strategy registry
              </CardTitle>
              <p className="text-muted-foreground mt-1 text-xs">
                Every rule currently registered on the paper engine, grouped by what actually
                generates its decision.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1 text-xs">
              <button
                type="button"
                onClick={() => {
                  setRegistryView("split");
                  localStorage.setItem("strategyLab.registryView", "split");
                }}
                className={`rounded-md border px-2 py-1 ${registryView === "split" ? "border-foreground/30 bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`}
              >
                Split cohorts
              </button>
              <button
                type="button"
                onClick={() => {
                  setRegistryView("pooled");
                  localStorage.setItem("strategyLab.registryView", "pooled");
                }}
                className={`rounded-md border px-2 py-1 ${registryView === "pooled" ? "border-foreground/30 bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`}
              >
                Pooled registry
              </button>
              <span className="mx-1 h-5 w-px bg-border" />
              <button
                type="button"
                onClick={() => setFamily("all")}
                className={`rounded-md border px-2 py-1 ${family === "all" ? "border-foreground/30 bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`}
              >
                All {bots.length}
              </button>
              {(Object.keys(FAMILY_META) as StrategyFamily[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFamily(key)}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 ${family === key ? "border-foreground/30 bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: FAMILY_META[key].color }}
                  />
                  {FAMILY_META[key].short} {strategyCounts[key]}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {registryView === "split" && (
            <div
              data-testid="split-registry-collection-state"
              className={`border-b px-4 py-2.5 text-xs ${
                !splitCollectionStarted
                  ? "border-warning/30 bg-warning/5 text-warning"
                  : splitPopulated === 0
                    ? "border-destructive/30 bg-destructive/5 text-destructive"
                    : "bg-success/5 text-muted-foreground"
              }`}
            >
              {!splitCollectionStarted
                ? `Prospective split collection has not started. The frozen boundary opens ${new Date(response.familywiseGate.constants.evalStartMs).toLocaleString()}; zeros before that time are expected and are not missing history.`
                : splitPopulated === 0
                  ? `No post-boundary split evidence has been recorded since ${new Date(response.familywiseGate.constants.evalStartMs).toLocaleString()}. Treat this as an operational collection warning, not a zero-performance result.`
                  : `Post-boundary split collection is active. ${splitPopulated}/${response.familywiseGate.familySize} frozen strategy × timeframe cohorts currently contain market, capture, or grade observations.`}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1320px] text-sm tabular-nums">
              <thead>
                <tr className="bg-muted/20 text-muted-foreground border-b text-left text-[10px] uppercase tracking-[0.12em]">
                  <PolymarketSortableHeader column="strategy" active={registrySort.key} direction={registrySort.direction} onSort={sortRegistry} initialDirection="asc" className="px-4 py-2.5 font-medium" title="The paper strategy and its exact preregistered decision rule.">Strategy and preregistered rule</PolymarketSortableHeader>
                  <PolymarketSortableHeader column="family" active={registrySort.key} direction={registrySort.direction} onSort={sortRegistry} initialDirection="asc" className="px-3 py-2.5 font-medium" title="The research mechanism family and source or origin of the rule.">Research family</PolymarketSortableHeader>
                  <PolymarketSortableHeader column="timeframe" active={registrySort.key} direction={registrySort.direction} onSort={sortRegistry} initialDirection="asc" className="px-3 py-2.5 font-medium" title="The independently evaluated 5-minute or 15-minute cohort and its eligible market scope.">Timeframe and eligible scope</PolymarketSortableHeader>
                  <PolymarketSortableHeader column="state" active={registrySort.key} direction={registrySort.direction} onSort={sortRegistry} initialDirection="asc" className="px-3 py-2.5 font-medium" title="Current state under the frozen forward-validation requirements.">Forward-gate status</PolymarketSortableHeader>
                  <PolymarketSortableHeader column="markets" active={registrySort.key} direction={registrySort.direction} onSort={sortRegistry} align="right" className="px-3 py-2.5 font-medium" title="Unique control markets observed after this cohort's boundary within the strategy's eligible universe.">Eligible control markets</PolymarketSortableHeader>
                  <PolymarketSortableHeader column="decisions" active={registrySort.key} direction={registrySort.direction} onSort={sortRegistry} align="right" className="px-3 py-2.5 font-medium" title="Candidate paper decisions captured after the boundary, followed by resolved bets with a valid same-tick comparator.">Candidate decisions / paired graded bets</PolymarketSortableHeader>
                  <PolymarketSortableHeader column="clusters" active={registrySort.key} direction={registrySort.direction} onSort={sortRegistry} align="right" className="px-3 py-2.5 font-medium" title="Independent five-minute decision windows represented in the paired residual sample.">Independent 5m clusters</PolymarketSortableHeader>
                  <PolymarketSortableHeader column="residual" active={registrySort.key} direction={registrySort.direction} onSort={sortRegistry} align="right" className="px-3 py-2.5 font-medium" title="Mean per-contract net edge versus the same-tick control, with the cluster-bootstrap 95% confidence interval below it.">Mean edge vs control (95% CI)</PolymarketSortableHeader>
                  <PolymarketSortableHeader column="registered" active={registrySort.key} direction={registrySort.direction} onSort={sortRegistry} align="right" className="px-4 py-2.5 font-medium" title="The immutable start of this strategy and timeframe's prospective evidence cohort.">Forward cohort starts</PolymarketSortableHeader>
                </tr>
              </thead>
              <tbody>
                {sortedRegistryRows.map(({ rowKey, bot, gate, horizonMin, state }) => {
                  const meta = strategyMeta(bot.key);
                  const familyMeta = FAMILY_META[meta.family];
                  return (
                    <tr
                      key={rowKey}
                      className={`border-b last:border-0 ${bot.key === "drift" ? "bg-muted/20" : ""}`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-2.5">
                          <span
                            className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                            style={{ background: bot.color }}
                          />
                          <div>
                            <Link
                              to="/polymarket/strategy/$botKey"
                              params={{ botKey: bot.key }}
                              search={{
                                scope: "forward",
                                horizon: horizonMin === 15 ? 15 : 5,
                              }}
                              className="font-medium transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {bot.name}
                            </Link>
                            <div className="text-muted-foreground mt-0.5 max-w-xl text-[11px] leading-snug">
                              {meta.thesis}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs">
                        <div>{familyMeta.short}</div>
                        <div className="text-muted-foreground text-[10px]">{meta.origin}</div>
                      </td>
                      <td className="px-3 py-3 text-xs">
                        <div className="font-mono font-medium text-foreground">
                          {horizonMin == null ? (bot.key === "drift" ? "CONTROL" : "POOLED") : `${horizonMin}m`}
                        </div>
                        <div className="text-muted-foreground mt-0.5 text-[10px]">{meta.scope}</div>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${stateClass(state)}`}
                        >
                          {state}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        {gate?.markets.toLocaleString() ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {gate
                          ? (
                            <>
                              <div>
                                {gate.decisions.toLocaleString()} / {gate.bets.toLocaleString()}
                              </div>
                              {gate.pairedBookDecisions !== gate.decisions && (
                                <div className="text-muted-foreground text-[10px]">
                                  {gate.pairedBookDecisions.toLocaleString()} comparator-ready
                                </div>
                              )}
                            </>
                          )
                          : "—"}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {gate?.residual?.clusters.toLocaleString() ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div
                          className={
                            gate?.residual?.mean != null && gate.residual.mean > 0
                              ? "text-success"
                              : gate?.residual?.mean != null && gate.residual.mean < 0
                                ? "text-destructive"
                                : "text-muted-foreground"
                          }
                        >
                          {cents(gate?.residual?.mean)}
                        </div>
                        {gate?.residual && (
                          <div className="text-muted-foreground text-[10px]">
                            [{cents(gate.residual.lo)}, {cents(gate.residual.hi)}]
                          </div>
                        )}
                      </td>
                      <td className="text-muted-foreground px-4 py-3 text-right text-[11px]">
                        {gate
                          ? new Date(gate.evalStartMs).toLocaleString(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "control"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="bg-muted/10 text-muted-foreground border-t px-4 py-2.5 text-[11px]">
            {registryView === "split"
              ? `5m and 15m are independent verdict units inside one frozen ${response.familywiseGate.familySize}-hypothesis Holm family. Macro UP/DOWN use their same-tick opposite side; all other rows use same-tick Always Down. New strategies never inherit old evidence.`
              : "Pooled rows preserve the immutable legacy gate for continuity. They never replace or combine the independent strategy × timeframe verdicts."}
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden shadow-none">
        <CardHeader className="border-b p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Radar className="text-muted-foreground h-4 w-4" />
                Shadow connector · asset × timeframe
              </CardTitle>
              <p className="text-muted-foreground mt-1 max-w-3xl text-xs leading-relaxed">
                All twelve registered buckets remain visible, including zero-activity cells.
                Coverage means the public-book cache produced a valid preparation result; this
                table reads no quote, price, strategy direction, fill, outcome, or P&amp;L.
              </p>
            </div>
            {shadowConnector.data && (
              <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-[11px]">
                <span
                  className={`rounded-md border px-1.5 py-0.5 font-semibold uppercase ${stateClass(
                    readiness(
                      shadowConnector.data.readyForOperationalReview,
                      shadowConnector.data.evalStartMs,
                    ),
                  )}`}
                >
                  {readiness(
                    shadowConnector.data.readyForOperationalReview,
                    shadowConnector.data.evalStartMs,
                  )}
                </span>
                <span>
                  {shadowConnector.data.markets.toLocaleString()} markets ·{" "}
                  {(shadowConnector.data.preparedCoverage * 100).toFixed(1)}% pooled prepared
                </span>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {shadowConnector.isLoading ? (
            <div className="text-muted-foreground p-8 text-center text-sm">
              Loading connector bucket telemetry…
            </div>
          ) : shadowConnector.isError || !shadowConnector.data ? (
            <div className="border-destructive/20 bg-destructive/5 text-destructive p-6 text-sm">
              Connector bucket telemetry is unavailable. No zero-filled substitute is shown.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-xs tabular-nums">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-[9px] uppercase tracking-[0.12em]">
                    <PolymarketSortableHeader
                      column="bucket"
                      active={shadowBucketSort.key}
                      direction={shadowBucketSort.direction}
                      onSort={sortShadowBucket}
                      initialDirection="asc"
                      className="px-4 py-2 font-medium"
                    >
                      Asset bucket
                    </PolymarketSortableHeader>
                    <PolymarketSortableHeader
                      column="markets"
                      active={shadowBucketSort.key}
                      direction={shadowBucketSort.direction}
                      onSort={sortShadowBucket}
                      align="right"
                      className="px-3 py-2 font-medium"
                    >
                      Markets
                    </PolymarketSortableHeader>
                    <PolymarketSortableHeader
                      column="coverage"
                      active={shadowBucketSort.key}
                      direction={shadowBucketSort.direction}
                      onSort={sortShadowBucket}
                      align="right"
                      className="px-3 py-2 font-medium"
                    >
                      Prepared
                    </PolymarketSortableHeader>
                    <PolymarketSortableHeader
                      column="p95Preparation"
                      active={shadowBucketSort.key}
                      direction={shadowBucketSort.direction}
                      onSort={sortShadowBucket}
                      align="right"
                      className="px-3 py-2 font-medium"
                    >
                      Prep p95
                    </PolymarketSortableHeader>
                    <PolymarketSortableHeader
                      column="p99Preparation"
                      active={shadowBucketSort.key}
                      direction={shadowBucketSort.direction}
                      onSort={sortShadowBucket}
                      align="right"
                      className="px-3 py-2 font-medium"
                    >
                      Prep p99
                    </PolymarketSortableHeader>
                    <PolymarketSortableHeader
                      column="p95BookAge"
                      active={shadowBucketSort.key}
                      direction={shadowBucketSort.direction}
                      onSort={sortShadowBucket}
                      align="right"
                      className="px-3 py-2 font-medium"
                    >
                      Book age p95
                    </PolymarketSortableHeader>
                    <PolymarketSortableHeader
                      column="unavailable"
                      active={shadowBucketSort.key}
                      direction={shadowBucketSort.direction}
                      onSort={sortShadowBucket}
                      align="right"
                      className="px-3 py-2 font-medium"
                    >
                      Unavailable
                    </PolymarketSortableHeader>
                    <PolymarketSortableHeader
                      column="rejections"
                      active={shadowBucketSort.key}
                      direction={shadowBucketSort.direction}
                      onSort={sortShadowBucket}
                      initialDirection="asc"
                      className="px-4 py-2 font-medium"
                    >
                      Rejection mix
                    </PolymarketSortableHeader>
                  </tr>
                </thead>
                <tbody>
                  {sortedShadowBuckets.map((bucket) => {
                    const rejectionSummary = shadowRejectionSummary(bucket);
                    return (
                      <tr
                        key={`${bucket.pair}:${bucket.horizonMin}`}
                        className="border-b last:border-0"
                      >
                        <td className="px-4 py-2.5 font-medium">
                          <PolymarketAssetLink
                            asset={bucket.pair}
                            horizonMin={bucket.horizonMin}
                          >
                            {bucket.pair.replace("-USD", ` ${bucket.horizonMin}m`)}
                          </PolymarketAssetLink>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {bucket.markets.toLocaleString()}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {(bucket.preparedCoverage * 100).toFixed(1)}%
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono">
                          {bucket.preparationMicros.p95 == null
                            ? "—"
                            : `${Math.round(bucket.preparationMicros.p95).toLocaleString()}µs`}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono">
                          {bucket.preparationMicros.p99 == null
                            ? "—"
                            : `${Math.round(bucket.preparationMicros.p99).toLocaleString()}µs`}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono">
                          {bucket.marketDataAgeMs.p95 == null
                            ? "—"
                            : `${Math.round(bucket.marketDataAgeMs.p95).toLocaleString()}ms`}
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right ${
                            bucket.unavailablePlans > 0 ? "text-warning" : ""
                          }`}
                        >
                          {bucket.unavailablePlans.toLocaleString()}
                        </td>
                        <td className="text-muted-foreground max-w-[360px] px-4 py-2.5 text-[10px]">
                          {rejectionSummary || (bucket.markets ? "none" : "no telemetry yet")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="bg-muted/10 text-muted-foreground border-t px-4 py-2.5 text-[11px]">
            A valid depth, minimum-size, or slippage rejection is still a prepared result. Missing
            telemetry, stale public books, invalid intent, and market/token mismatch count as
            unavailable. Bucket rows are diagnostic; the frozen pooled operational floors remain
            unchanged.
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden shadow-none">
        <CardHeader className="border-b p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <GitCompareArrows className="text-muted-foreground h-4 w-4" />
                Smooth Path decision funnel
              </CardTitle>
              <p className="text-muted-foreground mt-1 max-w-3xl text-xs leading-relaxed">
                Prospective v1 versus causal-delivery v2. Counts stop at decision stages; no
                selected direction, outcome, grade, or P&amp;L is queried.
              </p>
            </div>
            {smoothFunnel.data && (
              <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-[11px]">
                <span
                  className={`rounded-md border px-1.5 py-0.5 font-semibold uppercase ${stateClass(
                    smoothFunnel.data.scheduled
                      ? "scheduled"
                      : smoothFunnel.data.collectionFresh
                        ? "collecting"
                        : "unavailable",
                  )}`}
                >
                  {smoothFunnel.data.scheduled
                    ? "scheduled"
                    : smoothFunnel.data.collectionFresh
                      ? "collecting"
                      : "stale"}
                </span>
                <span>
                  {smoothFunnel.data.totalRows.toLocaleString()} rows · cap{" "}
                  {smoothFunnel.data.rowCapPerFiveMinutes}/5m
                </span>
                <span className="text-border">/</span>
                <span>
                  last capture{" "}
                  {smoothFunnel.data.lastCapturedAtMs == null
                    ? "—"
                    : new Date(smoothFunnel.data.lastCapturedAtMs).toLocaleTimeString()}
                </span>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {smoothFunnel.isLoading ? (
            <div className="text-muted-foreground p-8 text-center text-sm">
              Loading outcome-blind funnel evidence…
            </div>
          ) : smoothFunnel.isError || !smoothFunnel.data ? (
            <div className="border-destructive/20 bg-destructive/5 text-destructive p-6 text-sm">
              Funnel evidence is unavailable. No zero-filled substitute is shown.
            </div>
          ) : (
            <div className="grid xl:grid-cols-2">
              {smoothFunnel.data.versions.map((version, versionIndex) => (
                <section
                  key={version.version}
                  className={versionIndex === 0 ? "border-b xl:border-b-0 xl:border-r" : ""}
                >
                  <div className="bg-muted/10 border-b px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium">{version.label}</div>
                        <div className="text-muted-foreground mt-0.5 font-mono text-[10px]">
                          {version.version}
                        </div>
                      </div>
                      <div className="text-muted-foreground text-right text-[10px]">
                        <div>{version.botKey}</div>
                        <div>
                          window{" "}
                          {version.lastWindowMs == null
                            ? "—"
                            : new Date(version.lastWindowMs).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                    <div className="bg-border mt-3 grid grid-cols-5 gap-px overflow-hidden rounded-md border text-center tabular-nums">
                      {[
                        ["Eligible", version.eligibleRows],
                        ["Observed", version.observedRows],
                        ["Path", version.pathQualifiedRows],
                        ["Book", version.bookQualifiedRows],
                        ["Paper", version.placedRows],
                      ].map(([label, value]) => (
                        <div key={String(label)} className="bg-card px-1 py-2">
                          <div className="font-mono text-sm font-semibold">
                            {Number(value).toLocaleString()}
                          </div>
                          <div className="text-muted-foreground text-[9px] uppercase tracking-wider">
                            {label}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="text-muted-foreground mt-2 min-h-4 text-[10px] leading-relaxed">
                      {version.rejections.length === 0
                        ? "No rejection evidence yet."
                        : version.rejections
                            .map((rejection) => `${rejection.reason} ${rejection.count}`)
                            .join(" · ")}
                    </div>
                    <div className="text-muted-foreground mt-1 min-h-4 text-[10px] leading-relaxed">
                      {smoothFunnel.data.qualityTape.scheduled
                        ? `Unsigned quality audit scheduled for ${new Date(
                            smoothFunnel.data.qualityTape.evalStartMs,
                          ).toLocaleString()}; pre-boundary smoke rows are excluded.`
                        : !version.quality.readyForThresholdDesign
                          ? `Unsigned quality ${version.quality.metricRows.toLocaleString()} / ${smoothFunnel.data.qualityTape.floors.metricRowsPerVersion.toLocaleString()} rows · weakest asset ${version.quality.weakestPairMetricRows.toLocaleString()} / ${smoothFunnel.data.qualityTape.floors.metricRowsPerPair.toLocaleString()} · ${version.quality.spanDays.toFixed(2)} / ${smoothFunnel.data.qualityTape.floors.spanDays}d · ${(version.quality.coverage * 100).toFixed(1)} / ${(smoothFunnel.data.qualityTape.floors.coverage * 100).toFixed(0)}% coverage. Quantiles locked.`
                          : `Unsigned quality n ${version.quality.metricRows.toLocaleString()} · median |displacement| ${
                            version.quality.absDisplacementLog.p50 == null
                              ? "—"
                              : `${(version.quality.absDisplacementLog.p50 * 10_000).toFixed(1)}bp`
                          } · R² ${
                            version.quality.pathR2.p50 == null
                              ? "—"
                              : version.quality.pathR2.p50.toFixed(2)
                          } · efficiency ${
                            version.quality.pathEfficiency.p50 == null
                              ? "—"
                              : version.quality.pathEfficiency.p50.toFixed(2)
                          } · 10s continuation ${
                            version.quality.continuationFreshLog.p50 == null
                              ? "—"
                              : `${(version.quality.continuationFreshLog.p50 * 10_000).toFixed(1)}bp`
                          } · weakest asset ${version.quality.weakestPairMetricRows.toLocaleString()} · ${version.quality.spanDays.toFixed(2)}d · ${(version.quality.coverage * 100).toFixed(1)}% coverage`}
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-xs tabular-nums">
                      <thead>
                        <tr className="text-muted-foreground border-b text-left text-[9px] uppercase tracking-[0.12em]">
                          <PolymarketSortableHeader column="asset" active={funnelSort.key} direction={funnelSort.direction} onSort={sortFunnel} initialDirection="asc" className="px-4 py-2 font-medium">Asset bucket</PolymarketSortableHeader>
                          <PolymarketSortableHeader column="eligible" active={funnelSort.key} direction={funnelSort.direction} onSort={sortFunnel} align="right" className="px-2 py-2 font-medium">Eligible</PolymarketSortableHeader>
                          <PolymarketSortableHeader column="observed" active={funnelSort.key} direction={funnelSort.direction} onSort={sortFunnel} align="right" className="px-2 py-2 font-medium">Observed</PolymarketSortableHeader>
                          <PolymarketSortableHeader column="path" active={funnelSort.key} direction={funnelSort.direction} onSort={sortFunnel} align="right" className="px-2 py-2 font-medium">Path</PolymarketSortableHeader>
                          <PolymarketSortableHeader column="book" active={funnelSort.key} direction={funnelSort.direction} onSort={sortFunnel} align="right" className="px-2 py-2 font-medium">Book</PolymarketSortableHeader>
                          <PolymarketSortableHeader column="paper" active={funnelSort.key} direction={funnelSort.direction} onSort={sortFunnel} align="right" className="px-4 py-2 font-medium">Paper</PolymarketSortableHeader>
                        </tr>
                      </thead>
                      <tbody>
                        {stableSortRows(
                          version.pairs,
                          (pair) => ({
                            asset: pair.pair,
                            eligible: pair.eligibleRows,
                            observed: pair.observedRows,
                            path: pair.pathQualifiedRows,
                            book: pair.bookQualifiedRows,
                            paper: pair.placedRows,
                          })[funnelSort.key],
                          funnelSort.direction,
                        ).map((pair) => (
                          <tr key={pair.pair} className="border-b last:border-0">
                            <td className="px-4 py-2 font-medium">
                              <PolymarketAssetLink asset={pair.pair} horizonMin={5}>
                                {pair.pair.replace("-USD", " 5m")}
                              </PolymarketAssetLink>
                            </td>
                            <td className="px-2 py-2 text-right">{pair.eligibleRows}</td>
                            <td className="px-2 py-2 text-right">{pair.observedRows}</td>
                            <td className="px-2 py-2 text-right">{pair.pathQualifiedRows}</td>
                            <td className="px-2 py-2 text-right">{pair.bookQualifiedRows}</td>
                            <td className="px-4 py-2 text-right">{pair.placedRows}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </div>
          )}
          <div className="bg-muted/10 text-muted-foreground border-t px-4 py-2.5 text-[11px]">
            Every asset bucket is shown, including zero activity. A qualified paper row and its
            funnel evidence commit in one transaction after the Jul 23, 5:00 PM CT boundary.
          </div>
        </CardContent>
      </Card>

      <section className="bg-card overflow-hidden rounded-xl border">
        <header className="grid gap-3 border-b px-4 pb-4 pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.45fr)] lg:items-end">
          <div>
            <div className="text-muted-foreground text-[10px] font-semibold uppercase tracking-[0.16em]">
              External research queue
            </div>
            <h3 className="mt-1 text-base font-semibold tracking-tight">
              Ideas worth instrumenting, not claims worth copying
            </h3>
            <p className="text-muted-foreground mt-1 max-w-3xl text-xs leading-relaxed">
              Literature, public datasets, and open-source systems supply hypotheses. Jester admits
              them only after the required data exists and a future rule is frozen.
            </p>
          </div>
          <div className="text-muted-foreground text-xs leading-relaxed lg:text-right">
            <span className="text-foreground font-mono">{RESEARCH_LANES.length}</span> retained
            lanes
            <span className="text-border mx-2">/</span>
            copied backtests carry{" "}
            <span className="text-foreground font-medium">zero gate weight</span>
          </div>
        </header>
        <div className="divide-y">
          {RESEARCH_LANES.map((lane, index) => {
            const stageClass =
              lane.stage === "registered" || lane.stage === "capture next"
                ? "border-success/30 bg-success/10 text-success"
                : lane.stage === "hypothesis"
                  ? "border-warning/30 bg-warning/10 text-warning"
                  : "border-border bg-muted/30 text-muted-foreground";
            return (
              <article
                key={lane.key}
                className="grid gap-3 px-4 py-4 lg:grid-cols-[52px_minmax(220px,0.75fr)_minmax(300px,1fr)_minmax(320px,1.15fr)] lg:items-start"
              >
                <div className="text-muted-foreground font-mono text-xs">
                  {String(index + 1).padStart(2, "0")}
                </div>
                <div>
                  <span
                    className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${stageClass}`}
                  >
                    {lane.stage}
                  </span>
                  <div className="mt-2 text-sm font-medium">
                    {lane.href ? (
                      <Link to={lane.href} className="hover:text-primary hover:underline">
                        {lane.name}
                      </Link>
                    ) : lane.name}
                  </div>
                  <div className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
                    {lane.evidence}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[10px] uppercase tracking-[0.12em]">
                    Required data
                  </div>
                  <div className="mt-1.5 text-xs leading-relaxed">{lane.requiredData}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[10px] uppercase tracking-[0.12em]">
                    Research disposition
                  </div>
                  <div className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
                    {lane.disposition}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        <div className="bg-muted/10 text-muted-foreground border-t px-4 py-2.5 text-[11px]">
          Rejected outright: guessed feed-side flow, naive maker fills, copied ensemble scores,
          martingale sizing, and repositories that solicit wallet secrets.
        </div>
      </section>

      <Card className="overflow-hidden shadow-none">
        <CardHeader className="border-b p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Workflow className="text-muted-foreground h-4 w-4" />
                Strategy independence map
              </CardTitle>
              <p className="text-muted-foreground mt-1.5 max-w-4xl text-xs">
                Structural overlap in the prospectively split strategy × timeframe cohort using
                only cohort key, market ID, and chosen side. No resolution, price, fill, or
                P&amp;L field is read. Registered lineage labels come from the implementation graph,
                not observed returns.
              </p>
            </div>
            {independence.data ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <div
                  className="flex items-center gap-1 text-[10px]"
                  aria-label="Independence-map timeframe"
                >
                  {(["both", "5", "15"] as const).map((horizon) => (
                    <button
                      key={horizon}
                      type="button"
                      onClick={() => {
                        setIndependenceHorizon(horizon);
                        localStorage.setItem("strategyLab.independenceHorizon", horizon);
                      }}
                      className={`rounded-md border px-2 py-1 ${
                        independenceHorizon === horizon
                          ? "border-foreground/30 bg-muted font-medium"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {horizon === "both" ? "Both" : `${horizon}m`}
                    </button>
                  ))}
                </div>
                <div
                  className={`shrink-0 rounded-md border px-2.5 py-1.5 text-right ${
                    independence.data.unexpectedExactCollisions > 0
                      ? "border-destructive/30 bg-destructive/10 text-destructive"
                      : "border-success/30 bg-success/10 text-success"
                  }`}
                >
                  <div className="text-[10px] font-semibold">
                    {independence.data.unexpectedExactCollisions.toLocaleString()} unexpected exact{" "}
                    {independence.data.unexpectedExactCollisions === 1 ? "collision" : "collisions"}
                  </div>
                  <div className="mt-0.5 text-[10px] opacity-80">
                    {independence.data.expectedStructuralPairs.toLocaleString()} registered lineage pairs
                  </div>
                </div>
                <div className="border-border bg-muted/20 shrink-0 rounded-md border px-2.5 py-1.5 text-right">
                  <div className="text-[10px] font-semibold">
                    {independence.data.version}
                  </div>
                  <div className="text-muted-foreground mt-0.5 text-[10px]">
                    forward from {new Date(independence.data.evalStartMs).toLocaleString()}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {independence.isLoading ? (
            <div className="text-muted-foreground p-8 text-center text-sm">
              Mapping forward decision overlap…
            </div>
          ) : independence.isError || !independence.data ? (
            <div className="border-destructive/20 bg-destructive/5 text-destructive p-6 text-sm">
              Independence data is unavailable. No zero-filled substitute is shown.
            </div>
          ) : independencePairs.length === 0 ? (
            <div className="text-muted-foreground p-8 text-center text-sm">
              No pair has at least three shared forward decisions yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm tabular-nums">
                <thead>
                  <tr className="bg-muted/20 text-muted-foreground border-b text-left text-[10px] uppercase tracking-[0.12em]">
                    <PolymarketSortableHeader column="pair" active={independenceSort.key} direction={independenceSort.direction} onSort={sortIndependence} initialDirection="asc" className="px-4 py-2.5 font-medium">Strategy pair</PolymarketSortableHeader>
                    <PolymarketSortableHeader column="relation" active={independenceSort.key} direction={independenceSort.direction} onSort={sortIndependence} initialDirection="asc" className="px-3 py-2.5 font-medium">Relationship</PolymarketSortableHeader>
                    <PolymarketSortableHeader column="shared" active={independenceSort.key} direction={independenceSort.direction} onSort={sortIndependence} align="right" className="px-3 py-2.5 font-medium">Shared</PolymarketSortableHeader>
                    <PolymarketSortableHeader column="agreement" active={independenceSort.key} direction={independenceSort.direction} onSort={sortIndependence} align="right" className="px-3 py-2.5 font-medium">Side agreement</PolymarketSortableHeader>
                    <PolymarketSortableHeader column="leftCoverage" active={independenceSort.key} direction={independenceSort.direction} onSort={sortIndependence} align="right" className="px-3 py-2.5 font-medium">Left coverage</PolymarketSortableHeader>
                    <PolymarketSortableHeader column="rightCoverage" active={independenceSort.key} direction={independenceSort.direction} onSort={sortIndependence} align="right" className="px-3 py-2.5 font-medium">Right coverage</PolymarketSortableHeader>
                    <PolymarketSortableHeader column="dependence" active={independenceSort.key} direction={independenceSort.direction} onSort={sortIndependence} align="right" className="px-4 py-2.5 font-medium">Dependence</PolymarketSortableHeader>
                  </tr>
                </thead>
                <tbody>
                  {sortedIndependencePairs.map((pair) => {
                    const left = independenceBotByKey.get(pair.leftKey);
                    const right = independenceBotByKey.get(pair.rightKey);
                    const horizon = strategyHorizon(pair.leftKey);
                    const relationLabel =
                      pair.relation === "same"
                        ? "Same-side"
                        : pair.relation === "inverse"
                          ? "Mirrored"
                          : "Mixed";
                    const relationClass =
                      pair.relation === "same"
                        ? "border-success/30 bg-success/10 text-success"
                        : pair.relation === "inverse"
                          ? "border-warning/30 bg-warning/10 text-warning"
                          : "border-border bg-muted/30 text-muted-foreground";
                    const structuralLabel =
                      pair.structuralRelation === "expected-filter"
                        ? "Expected filter"
                        : pair.structuralRelation === "expected-mirror"
                          ? "Expected mirror"
                          : pair.structuralRelation === "expected-router"
                            ? "Expected router"
                            : null;
                    return (
                      <tr
                        key={`${pair.leftKey}:${pair.rightKey}`}
                        className={`border-b last:border-0 ${
                          pair.unexpectedExactCollision ? "bg-destructive/5" : ""
                        }`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            {horizon ? (
                              <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono text-[10px]">
                                {horizon}m
                              </span>
                            ) : null}
                            <span className="inline-flex items-center gap-1.5 font-medium">
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ background: left?.color ?? "#6b7280" }}
                              />
                              {left?.name ?? pair.leftKey}
                            </span>
                            <span className="text-muted-foreground">×</span>
                            <span className="inline-flex items-center gap-1.5 font-medium">
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ background: right?.color ?? "#6b7280" }}
                              />
                              {right?.name ?? pair.rightKey}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                                pair.unexpectedExactCollision
                                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                                  : relationClass
                              }`}
                            >
                              {pair.unexpectedExactCollision ? "Unexpected exact" : relationLabel}
                            </span>
                            {structuralLabel ? (
                              <span className="border-border bg-muted/20 text-muted-foreground rounded-md border px-1.5 py-0.5 text-[10px] font-medium">
                                {structuralLabel}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <div>{pair.sharedMarkets.toLocaleString()}</div>
                          <div className="text-muted-foreground text-[10px]">
                            {pair.leftDecisions.toLocaleString()} /{" "}
                            {pair.rightDecisions.toLocaleString()}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right">
                          {pair.agreement == null ? "—" : `${Math.round(pair.agreement * 100)}%`}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {Math.round(pair.leftCoverage * 100)}%
                        </td>
                        <td className="px-3 py-3 text-right">
                          {Math.round(pair.rightCoverage * 100)}%
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {pair.dependencyStrength == null
                            ? "—"
                            : pair.dependencyStrength.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="bg-muted/10 text-muted-foreground border-t px-4 py-2.5 text-[11px]">
            Dependence = overlap of the smaller decision set × directional consistency. A perfect
            inverse mirror is highly dependent, not an independent confirmation. Expected filters,
            mirrors, and routers are registered implementation lineage; exact full-population
            identity or inversion outside that map is flagged as an operational collision. Minimum
            three shared markets shown. “Both” balances the strongest eligible 5m and 15m
            relationships so one timeframe cannot crowd out the other. These labels are
            descriptive only; the frozen Holm family remains authoritative.
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden shadow-none">
        <CardHeader className="border-b p-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="text-muted-foreground h-4 w-4" />
            Data and audit pipeline
          </CardTitle>
          <p className="text-muted-foreground text-xs">
            Progress is the least-complete preregistered requirement, not an average. A full bar
            means the report may be disclosed; it does not imply positive alpha.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {audits.length === 0 ? (
            <div className="text-muted-foreground p-8 text-center text-sm">
              Loading readiness-locked research tapes…
            </div>
          ) : (
            <div className="divide-y">
              {audits.map((audit) => (
                <div
                  key={audit.key}
                  className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(230px,0.8fr)_minmax(300px,1.2fr)_minmax(240px,1fr)] lg:items-center"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${stateClass(audit.state)}`}
                      >
                        {audit.state}
                      </span>
                      <span className="text-muted-foreground text-[10px] uppercase tracking-wider">
                        {audit.family}
                      </span>
                    </div>
                    <div className="mt-1.5 text-sm font-medium">{audit.name}</div>
                    <div className="text-muted-foreground mt-0.5 text-[10px]">{audit.version}</div>
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-3 text-[11px]">
                      <span className="text-muted-foreground">{audit.primary}</span>
                      <span className="font-mono font-medium">
                        {Math.round(audit.progress * 100)}%
                      </span>
                    </div>
                    <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                      <div
                        className={`h-full rounded-full ${audit.state === "ready" ? "bg-success" : audit.state === "unavailable" ? "bg-destructive" : "bg-warning"}`}
                        style={{
                          width: `${Math.max(audit.progress > 0 ? 2 : 0, audit.progress * 100)}%`,
                        }}
                      />
                    </div>
                    <div className="text-muted-foreground mt-1.5 text-[10px]">
                      {audit.secondary}
                    </div>
                  </div>
                  <div className="text-muted-foreground text-[11px] leading-relaxed">
                    <div className="text-foreground mb-1 flex items-center gap-1.5 font-medium">
                      {audit.state === "ready" ? (
                        <ShieldCheck className="text-success h-3.5 w-3.5" />
                      ) : (
                        <Lock className="h-3.5 w-3.5" />
                      )}
                      {audit.source}
                    </div>
                    {audit.note}
                    <div className="mt-1 text-[10px]">
                      Boundary {new Date(audit.evalStartMs).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="bg-muted/10 text-muted-foreground border-t px-4 py-2.5 text-[11px]">
            Locked audits return counts, spans, and data quality only. They do not query or expose
            target outcomes, signs, correlations, or rankings before readiness.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
