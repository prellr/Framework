import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Activity, ArrowLeft, CalendarDays, Clock3, Compass, Layers3, Lock } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { PolymarketDailyRawLedger } from "./PolymarketDailyRawLedger";
import { PolymarketAssetLink } from "./PolymarketAssetLink";
import {
  PolymarketSegmentTable,
  type PolymarketPerformanceSegment,
} from "./PolymarketPerformanceLens";
import {
  nextSortState,
  PolymarketSortableHeader,
  stableSortRows,
  type SortState,
} from "./PolymarketSortableHeader";
import { formatElapsedDays } from "./polymarket-age";
import { FAMILY_META, strategyMeta } from "./polymarket-strategy-meta";

type ScopeKey = "paper" | "forward" | "history";
type PeriodKey = "24h" | "3d" | "7d" | "30d" | "all";
type HorizonKey = 5 | 15;
type StakeUsd = 5 | 10 | 20;
type AssetKey = "BTC" | "ETH" | "SOL" | "XRP" | "DOGE" | "BNB";
type BucketSortKey = "asset" | "n" | "winRate" | "pnl" | "open";
type FeedSortKey = "time" | "market" | "side" | "ask" | "edge" | "pnl" | "status";

const usd = (value: number | null | undefined) =>
  value == null ? "—" : `${value < 0 ? "-" : "+"}$${Math.abs(value).toFixed(2)}`;
const pct = (value: number | null | undefined) =>
  value == null ? "—" : `${Math.round(value * 100)}%`;
const DOW = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ASSETS: readonly AssetKey[] = ["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB"];
const CAPTURED_STAKE_USD = 5;
const STAKE_OPTIONS: readonly StakeUsd[] = [5, 10, 20];

export function parseStrategyAssets(value: string | null | undefined): AssetKey[] {
  if (!value || value === "all") return [...ASSETS];
  const requested = new Set(value.split(",").map((asset) => asset.trim().toUpperCase()));
  const selected = ASSETS.filter((asset) => requested.has(asset));
  return selected.length ? selected : [...ASSETS];
}

export function PolymarketStrategyDetailPage() {
  const { botKey } = useParams({ strict: false }) as { botKey: string };
  const search = useSearch({ strict: false }) as {
    scope?: ScopeKey;
    period?: PeriodKey;
    horizon?: HorizonKey;
    assets?: string;
    stake?: StakeUsd;
  };
  const navigate = useNavigate();
  const scope = search.scope ?? "forward";
  const period = search.period ?? "all";
  const horizon = search.horizon ?? 5;
  const horizonMin = horizon;
  const stakeUsd = search.stake ?? CAPTURED_STAKE_USD;
  const stakeScale = stakeUsd / CAPTURED_STAKE_USD;
  const timezone = "America/Chicago";
  const assetStorageKey = `strategy.assets.${botKey}`;
  const selectedAssets = parseStrategyAssets(
    search.assets ?? localStorage.getItem(assetStorageKey),
  );
  const selectedAssetQuery = selectedAssets.length === ASSETS.length ? undefined : selectedAssets;
  const [bucketSort, setBucketSort] = useState<SortState<BucketSortKey>>({
    key: "pnl",
    direction: "desc",
  });
  const [feedSort, setFeedSort] = useState<SortState<FeedSortKey>>({
    key: "time",
    direction: "desc",
  });

  const setSearch = (
    next: Partial<{
      scope: ScopeKey;
      period: PeriodKey;
      horizon: HorizonKey;
      assets: string;
      stake: StakeUsd;
    }>,
  ) =>
    navigate({
      to: "/polymarket/strategy/$botKey",
      params: { botKey },
      search: {
        scope,
        period,
        horizon,
        assets: selectedAssets.length === ASSETS.length ? "all" : selectedAssets.join(","),
        stake: stakeUsd,
        ...next,
      },
    });
  const chooseAssets = (next: AssetKey[]) => {
    const normalized = ASSETS.filter((asset) => next.includes(asset));
    if (!normalized.length) return;
    const encoded = normalized.length === ASSETS.length ? "all" : normalized.join(",");
    localStorage.setItem(assetStorageKey, encoded);
    void setSearch({ assets: encoded });
  };
  const toggleAsset = (asset: AssetKey) => {
    chooseAssets(
      selectedAssets.includes(asset)
        ? selectedAssets.filter((item) => item !== asset)
        : [...selectedAssets, asset],
    );
  };

  const floor = trpc.polymarket.floorView.useQuery(
    { scope, view: "strategy" },
    {
      staleTime: 15_000,
      refetchInterval: 30_000,
    },
  );
  const performance = trpc.polymarket.performance.useQuery(
    {
      scope,
      period,
      timezone,
      assets: selectedAssetQuery,
      segmentBotKey: botKey,
      segmentHorizonMin: horizonMin,
    },
    {
      staleTime: 30_000,
      refetchInterval: 60_000,
    },
  );
  const multiStakeCapacity = trpc.polymarket.multiStakeCapacityTape.useQuery(undefined, {
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
  const strategyFeed = trpc.polymarket.strategyFeed.useQuery(
    {
      botKey,
      horizonMin,
      scope,
      assets: selectedAssetQuery,
      limit: 100,
    },
    {
      staleTime: 15_000,
      refetchInterval: 30_000,
    },
  );

  if (floor.isLoading)
    return <p className="text-muted-foreground text-sm">Loading strategy evidence…</p>;
  if (!floor.data)
    return <p className="text-destructive text-sm">Paper evidence is unavailable.</p>;

  const scoped = floor.data.scope;
  const bot = scoped.bots.find((candidate) => candidate.key === botKey);
  if (!bot) {
    return (
      <div className="space-y-4">
        <Link
          to="/polymarket"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="h-4 w-4" /> Polymarket
        </Link>
        <Card>
          <CardContent className="text-muted-foreground p-8 text-center text-sm">
            Unknown paper strategy: {botKey}
          </CardContent>
        </Card>
      </div>
    );
  }

  const meta = strategyMeta(botKey);
  const family = FAMILY_META[meta.family];
  const cohorts = (performance.data?.cohorts ?? []) as Array<{
    key: string;
    botKey: string;
    horizonMin: number;
    n: number;
    wins: number;
    losses: number;
    winRate: number | null;
    pnl: number;
    profitStress: number;
    netPerBet: number | null;
    pairedN: number;
    residualPerBet: number | null;
    activeDays: number;
  }>;
  const cohort = cohorts.find((row) => row.botKey === botKey && row.horizonMin === horizonMin);
  const segments = (performance.data?.segments ?? []) as PolymarketPerformanceSegment[];
  const byDimension = (dimension: PolymarketPerformanceSegment["dimension"]) =>
    segments.filter((row) => row.dimension === dimension);
  const ordered = (
    dimension: PolymarketPerformanceSegment["dimension"],
    keys: readonly string[],
  ) => {
    const order = new Map(keys.map((key, index) => [key, index]));
    return byDimension(dimension).sort(
      (a, b) =>
        (order.get(a.key) ?? keys.length) - (order.get(b.key) ?? keys.length) ||
        a.key.localeCompare(b.key),
    );
  };
  const selectedBuckets = bot.buckets.filter(
    (bucket) =>
      bucket.horizonMin === horizonMin &&
      selectedAssets.includes(bucket.pair.replace("-USD", "") as AssetKey),
  );
  const selectedGate = floor.data.familywiseGate.hypotheses.find(
    (row) => row.key === `${botKey}:${horizonMin}`,
  );
  const recent = strategyFeed.data ?? [];
  const sortedBuckets = stableSortRows(
    selectedBuckets,
    (bucket) =>
      ({
        asset: bucket.pair,
        n: bucket.n,
        winRate: bucket.n ? bucket.wins / bucket.n : null,
        pnl: bucket.pnl,
        open: bucket.openNow,
      })[bucketSort.key],
    bucketSort.direction,
  );
  const sortedRecent = stableSortRows(
    recent,
    (trade) =>
      ({
        time: new Date(trade.at).getTime(),
        market: `${trade.pair}:${trade.horizonMin}`,
        side: trade.side,
        ask: trade.ask,
        edge: trade.edge,
        pnl: trade.pnl,
        status: trade.status,
      })[feedSort.key],
    feedSort.direction,
  );
  const sortBuckets = (key: BucketSortKey, initialDirection: "asc" | "desc" = "desc") =>
    setBucketSort((current) => nextSortState(current, key, initialDirection));
  const sortFeed = (key: FeedSortKey, initialDirection: "asc" | "desc" = "desc") =>
    setFeedSort((current) => nextSortState(current, key, initialDirection));
  const wins = cohort?.wins ?? 0;
  const losses = cohort?.losses ?? 0;
  const observedLedgerDates = new Set(
    scoped.dailyLedger.rows
      .filter(
        (row) =>
          row.botKey === botKey &&
          row.horizonMin === horizonMin &&
          selectedAssets.includes(row.pair.replace("-USD", "") as AssetKey),
      )
      .map((row) => row.day),
  ).size;
  const gateSpanDays = selectedGate?.spanDays ?? 0;
  const sliceLabel = period === "all" ? "selected scope" : `${period} slice`;
  const capacity = multiStakeCapacity.data;
  const capacityWaiting = capacity != null && Date.now() < capacity.evalStartMs;
  const capacityProgress =
    capacity == null
      ? "Depth calibration status unavailable."
      : capacityWaiting
        ? `Same-book $10/$20 depth calibration begins ${new Date(capacity.evalStartMs).toLocaleString()}.`
        : capacity.readyForCapacityDistribution
          ? `Same-book depth tape is ready for a separate frozen capacity-distribution review (${capacity.markets.toLocaleString()} markets · ${(capacity.coverage * 100).toFixed(1)}% paired $10/$20 coverage).`
          : `Same-book $10/$20 depth calibration is collecting: ${capacity.markets.toLocaleString()} / ${capacity.minMarkets.toLocaleString()} markets · ${capacity.spanDays.toFixed(2)} / ${capacity.minSpanDays}d · ${(capacity.coverage * 100).toFixed(1)}% / ${(capacity.minCoverage * 100).toFixed(0)}% paired coverage.`;

  return (
    <div className="space-y-5">
      <Link
        to="/polymarket"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="h-4 w-4" /> Polymarket overview
      </Link>
      <PageHeader
        title={bot.name}
        subtitle={`${meta.thesis} ${meta.scope}. This page is evidence-only: no Polymarket order, wallet, allocation, or execution control exists.`}
        actions={
          <div className="bg-muted/20 text-muted-foreground inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs">
            <Lock className="h-3.5 w-3.5" /> paper only · live locked
          </div>
        }
      />

      <div className="bg-muted/10 flex flex-wrap items-end gap-4 rounded-lg border p-3 text-xs">
        <ControlGroup label="Stats scope">
          {(
            [
              ["paper", "Current paper"],
              ["forward", "Gate cohort"],
              ["history", "All history"],
            ] as const
          ).map(([key, label]) => (
            <ControlButton
              key={key}
              active={scope === key}
              onClick={() => setSearch({ scope: key })}
            >
              {label}
            </ControlButton>
          ))}
        </ControlGroup>
        <ControlGroup label="Timeframe">
          {(
            [
              [5, "5m"],
              [15, "15m"],
            ] as const
          ).map(([key, label]) => (
            <ControlButton
              key={key}
              active={horizon === key}
              onClick={() => setSearch({ horizon: key })}
            >
              {label}
            </ControlButton>
          ))}
        </ControlGroup>
        <ControlGroup label="Diagnostic period">
          {(["24h", "3d", "7d", "30d", "all"] as const).map((key) => (
            <ControlButton
              key={key}
              active={period === key}
              onClick={() => setSearch({ period: key })}
            >
              {key === "all" ? "All" : key}
            </ControlButton>
          ))}
        </ControlGroup>
        <ControlGroup label="Assets">
          <ControlButton
            active={selectedAssets.length === ASSETS.length}
            onClick={() => chooseAssets([...ASSETS])}
          >
            All
          </ControlButton>
          {ASSETS.map((asset) => (
            <ControlButton
              key={asset}
              active={selectedAssets.includes(asset)}
              onClick={() => toggleAsset(asset)}
            >
              {asset}
            </ControlButton>
          ))}
        </ControlGroup>
        <ControlGroup label="Stake model">
          {STAKE_OPTIONS.map((value) => (
            <ControlButton
              key={value}
              active={stakeUsd === value}
              onClick={() => setSearch({ stake: value })}
            >
              ${value}
              {value === CAPTURED_STAKE_USD ? " captured" : " linear"}
            </ControlButton>
          ))}
        </ControlGroup>
        <div className="text-muted-foreground ml-auto text-right text-[11px]">
          <div>{scoped.label}</div>
          <div>
            {scoped.fromMs == null
              ? "all captured rows"
              : `${formatElapsedDays(scoped.fromMs)} selected history · from ${new Date(scoped.fromMs).toLocaleString()}`}
          </div>
          <div>
            {selectedAssets.length === ASSETS.length ? "all 6 assets" : selectedAssets.join(", ")} ·
            diagnostic slice
          </div>
        </div>
        <div className="text-muted-foreground w-full border-t pt-2 text-[11px] leading-relaxed">
          {stakeUsd === CAPTURED_STAKE_USD
            ? "Captured model: every decision uses its recorded fee-adjusted $5 book-walk VWAP and binary payout."
            : `$${stakeUsd} linear exposure model: dollar P&L is scaled ${stakeScale.toFixed(0)}× from the recorded $5 fill. It does not replay deeper book liquidity, slippage, or capacity and cannot affect the frozen $5 verdict gate.`}
          <span className="mt-1 block">
            {capacityProgress} Until that review is complete, the $10/$20 controls remain explicitly
            linear and descriptive.
          </span>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Metric
          label={`RAW net · $${stakeUsd}`}
          value={usd(cohort == null ? null : cohort.pnl * stakeScale)}
          tone={Number(cohort?.pnl) > 0 ? "good" : Number(cohort?.pnl) < 0 ? "bad" : "neutral"}
        />
        <Metric label="Graded" value={`${wins}W / ${losses}L`} sub={pct(cohort?.winRate)} />
        <Metric
          label={`Net / bet · $${stakeUsd}`}
          value={usd(cohort?.netPerBet == null ? null : cohort.netPerBet * stakeScale)}
          tone={
            Number(cohort?.netPerBet) > 0
              ? "good"
              : Number(cohort?.netPerBet) < 0
                ? "bad"
                : "neutral"
          }
        />
        <Metric
          label={`Vs control · $${stakeUsd}`}
          value={
            cohort?.residualPerBet == null
              ? "—"
              : `${cohort.residualPerBet >= 0 ? "+" : ""}${(cohort.residualPerBet * stakeScale * 100).toFixed(1)}¢`
          }
          tone={
            Number(cohort?.residualPerBet) > 0
              ? "good"
              : Number(cohort?.residualPerBet) < 0
                ? "bad"
                : "neutral"
          }
        />
        <Metric
          label="Observed ledger dates"
          value={String(observedLedgerDates)}
          sub={
            selectedGate
              ? `${cohort?.activeDays ?? 0} in ${sliceLabel} · observed gate span ${gateSpanDays.toFixed(2)}d / ${selectedGate.state}`
              : `${cohort?.activeDays ?? 0} in ${sliceLabel} · ${family.short} · ${meta.origin}`
          }
        />
      </div>

      <PolymarketDailyRawLedger
        ledger={scoped.dailyLedger}
        bots={[bot]}
        horizonMin={horizonMin}
        assets={selectedAssets}
        stakeScale={stakeScale}
        stakeUsd={stakeUsd}
        subtitle={`${horizonMin}m realized P&L by Chicago calendar day`}
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader className="border-b p-4">
            <CardTitle className="text-base">Scope-to-date asset buckets · {horizonMin}m</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-muted-foreground border-b text-[10px] uppercase">
                  <PolymarketSortableHeader
                    column="asset"
                    active={bucketSort.key}
                    direction={bucketSort.direction}
                    onSort={sortBuckets}
                    initialDirection="asc"
                    className="px-4 py-2 font-medium"
                  >
                    Asset
                  </PolymarketSortableHeader>
                  <PolymarketSortableHeader
                    column="n"
                    active={bucketSort.key}
                    direction={bucketSort.direction}
                    onSort={sortBuckets}
                    align="right"
                    className="px-3 py-2 font-medium"
                  >
                    N
                  </PolymarketSortableHeader>
                  <PolymarketSortableHeader
                    column="winRate"
                    active={bucketSort.key}
                    direction={bucketSort.direction}
                    onSort={sortBuckets}
                    align="right"
                    className="px-3 py-2 font-medium"
                  >
                    WR
                  </PolymarketSortableHeader>
                  <PolymarketSortableHeader
                    column="pnl"
                    active={bucketSort.key}
                    direction={bucketSort.direction}
                    onSort={sortBuckets}
                    align="right"
                    className="px-3 py-2 font-medium"
                  >
                    RAW
                  </PolymarketSortableHeader>
                  <PolymarketSortableHeader
                    column="open"
                    active={bucketSort.key}
                    direction={bucketSort.direction}
                    onSort={sortBuckets}
                    align="right"
                    className="px-4 py-2 font-medium"
                  >
                    Open
                  </PolymarketSortableHeader>
                </tr>
              </thead>
              <tbody>
                {sortedBuckets.map((bucket) => (
                  <tr
                    key={bucket.pair}
                    className={"border-b last:border-0 " + (bucket.n < 5 ? "opacity-45" : "")}
                  >
                    <td className="px-4 py-2.5 font-medium">
                      <PolymarketAssetLink
                        asset={bucket.pair}
                        scope={scope}
                        period={period}
                        horizonMin={horizonMin}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-right">{bucket.n}</td>
                    <td className="px-3 py-2.5 text-right">
                      {bucket.n ? `${Math.round((bucket.wins / bucket.n) * 100)}%` : "—"}
                    </td>
                    <td
                      className={
                        "px-3 py-2.5 text-right " +
                        (bucket.pnl > 0 ? "text-success" : bucket.pnl < 0 ? "text-destructive" : "")
                      }
                    >
                      {usd(bucket.pnl * stakeScale)}
                    </td>
                    <td className="text-muted-foreground px-4 py-2.5 text-right">
                      {bucket.openNow || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b p-4">
            <CardTitle className="text-base">Rule and evidence contract</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 p-4 text-sm sm:grid-cols-2">
            <Definition label="Family" value={family.label} />
            <Definition label="Origin" value={meta.origin} />
            <Definition label="Registered scope" value={meta.scope} />
            <Definition
              label="Selected population"
              value={`${scope} · ${period} · ${horizonMin}m · ${selectedAssets.join(", ")}`}
            />
            <Definition
              label="Verdict state"
              value={selectedGate?.state ?? (meta.family === "control" ? "control" : "waiting")}
            />
            <Definition label="Execution" value="Locked; no route exists" />
            <p className="text-muted-foreground text-xs leading-relaxed sm:col-span-2">
              Time, asset, regime, side, ask, and freshness slices are diagnostic. They cannot
              overwrite the frozen pooled or split verdict gate, and they are never used to enable
              live execution.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b p-4">
          <CardTitle className="text-base">
            Segmentation · {horizonMin}m{" "}
            <span className="text-muted-foreground ml-1 text-xs font-normal">
              {period} ·{" "}
              {selectedAssets.length === ASSETS.length ? "all assets" : selectedAssets.join(", ")} ·{" "}
              {timezone}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          {performance.isLoading ? (
            <p className="text-muted-foreground py-8 text-center text-sm">Loading segmentation…</p>
          ) : performance.error ? (
            <p className="text-destructive py-8 text-center text-sm">
              Segmentation unavailable; no zero-filled substitute is shown.
            </p>
          ) : (
            <div className="grid gap-3 xl:grid-cols-3">
              <PolymarketSegmentTable
                stakeScale={stakeScale}
                title="Calendar day"
                icon={<CalendarDays className="text-muted-foreground h-3.5 w-3.5" />}
                rows={byDimension("day").sort((a, b) => b.key.localeCompare(a.key))}
                label={(row) =>
                  new Date(`${row.key}T12:00:00`).toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })
                }
              />
              <PolymarketSegmentTable
                stakeScale={stakeScale}
                title="Time of day"
                icon={<Clock3 className="text-muted-foreground h-3.5 w-3.5" />}
                rows={ordered("session", ["00–06", "06–12", "12–18", "18–24"])}
                label={(row) => row.key}
              />
              <PolymarketSegmentTable
                stakeScale={stakeScale}
                title="Day of week"
                icon={<CalendarDays className="text-muted-foreground h-3.5 w-3.5" />}
                rows={byDimension("weekday")}
                label={(row) => DOW[Number(row.key)] ?? row.key}
              />
              <PolymarketSegmentTable
                stakeScale={stakeScale}
                title="Macro direction"
                icon={<Compass className="text-muted-foreground h-3.5 w-3.5" />}
                rows={ordered("macro", ["UP", "DOWN", "RANGE", "NEUTRAL", "UNAVAILABLE"])}
                label={(row) => row.key}
              />
              <PolymarketSegmentTable
                stakeScale={stakeScale}
                title="Technical regime"
                icon={<Activity className="text-muted-foreground h-3.5 w-3.5" />}
                rows={ordered("technical", [
                  "Trend",
                  "Chop",
                  "Compression",
                  "Neutral",
                  "Unavailable",
                ])}
                label={(row) => row.key}
              />
              <PolymarketSegmentTable
                stakeScale={stakeScale}
                title="Asset"
                icon={<Layers3 className="text-muted-foreground h-3.5 w-3.5" />}
                rows={byDimension("asset")}
                label={(row) => (
                  <PolymarketAssetLink
                    asset={row.key}
                    scope={scope}
                    period={period}
                    horizonMin={horizonMin}
                  />
                )}
              />
              <PolymarketSegmentTable
                stakeScale={stakeScale}
                title="Chosen side"
                icon={<Layers3 className="text-muted-foreground h-3.5 w-3.5" />}
                rows={byDimension("side")}
                label={(row) => row.key}
              />
              <PolymarketSegmentTable
                stakeScale={stakeScale}
                title="Entry ask"
                icon={<Layers3 className="text-muted-foreground h-3.5 w-3.5" />}
                rows={ordered("ask", ["<35¢", "35–49¢", "50–64¢", "65¢+"])}
                label={(row) => row.key}
              />
              <PolymarketSegmentTable
                stakeScale={stakeScale}
                title="Signal freshness"
                icon={<Clock3 className="text-muted-foreground h-3.5 w-3.5" />}
                rows={ordered("freshness", ["<2s", "2–5s", "5–15s", "15s+", "Unavailable"])}
                label={(row) => row.key}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b p-4">
          <CardTitle className="text-base">
            Recent {horizonMin}m decisions{" "}
            <span className="text-muted-foreground ml-1 text-xs font-normal">
              latest 100 rows ·{" "}
              {selectedAssets.length === ASSETS.length ? "all assets" : selectedAssets.join(", ")} ·
              ${stakeUsd} P&amp;L model
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm tabular-nums">
              <thead>
                <tr className="text-muted-foreground border-b text-[10px] uppercase">
                  <PolymarketSortableHeader
                    column="time"
                    active={feedSort.key}
                    direction={feedSort.direction}
                    onSort={sortFeed}
                    className="px-4 py-2 font-medium"
                  >
                    Time
                  </PolymarketSortableHeader>
                  <PolymarketSortableHeader
                    column="market"
                    active={feedSort.key}
                    direction={feedSort.direction}
                    onSort={sortFeed}
                    initialDirection="asc"
                    className="px-3 py-2 font-medium"
                  >
                    Market
                  </PolymarketSortableHeader>
                  <PolymarketSortableHeader
                    column="side"
                    active={feedSort.key}
                    direction={feedSort.direction}
                    onSort={sortFeed}
                    initialDirection="asc"
                    className="px-3 py-2 font-medium"
                  >
                    Side
                  </PolymarketSortableHeader>
                  <PolymarketSortableHeader
                    column="ask"
                    active={feedSort.key}
                    direction={feedSort.direction}
                    onSort={sortFeed}
                    align="right"
                    className="px-3 py-2 font-medium"
                    title="Captured fee-adjusted $5 book-walk VWAP"
                  >
                    Ask · $5 VWAP
                  </PolymarketSortableHeader>
                  <PolymarketSortableHeader
                    column="edge"
                    active={feedSort.key}
                    direction={feedSort.direction}
                    onSort={sortFeed}
                    align="right"
                    className="px-3 py-2 font-medium"
                  >
                    Edge
                  </PolymarketSortableHeader>
                  <PolymarketSortableHeader
                    column="pnl"
                    active={feedSort.key}
                    direction={feedSort.direction}
                    onSort={sortFeed}
                    align="right"
                    className="px-3 py-2 font-medium"
                  >
                    P&amp;L
                  </PolymarketSortableHeader>
                  <PolymarketSortableHeader
                    column="status"
                    active={feedSort.key}
                    direction={feedSort.direction}
                    onSort={sortFeed}
                    align="right"
                    initialDirection="asc"
                    className="px-4 py-2 font-medium"
                  >
                    Result
                  </PolymarketSortableHeader>
                </tr>
              </thead>
              <tbody>
                {sortedRecent.map((trade) => (
                  <tr key={trade.id} className="border-b last:border-0">
                    <td className="text-muted-foreground px-4 py-2.5">
                      {new Date(trade.at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5">
                      <PolymarketAssetLink
                        asset={trade.pair}
                        scope={scope}
                        period={period}
                        horizonMin={trade.horizonMin}
                      >
                        {trade.pair.replace("-USD", "")} {trade.horizonMin}m
                      </PolymarketAssetLink>
                    </td>
                    <td className="px-3 py-2.5 uppercase">{trade.side}</td>
                    <td className="px-3 py-2.5 text-right">
                      {trade.ask == null ? "—" : `${Math.round(trade.ask * 100)}¢`}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {trade.edge == null
                        ? "—"
                        : `${trade.edge >= 0 ? "+" : ""}${(trade.edge * 100).toFixed(1)}¢`}
                    </td>
                    <td
                      className={
                        "px-3 py-2.5 text-right " +
                        (Number(trade.pnl) > 0
                          ? "text-success"
                          : Number(trade.pnl) < 0
                            ? "text-destructive"
                            : "")
                      }
                    >
                      {usd(trade.pnl == null ? null : trade.pnl * stakeScale)}
                    </td>
                    <td className="px-4 py-2.5 text-right">{trade.status}</td>
                  </tr>
                ))}
                {strategyFeed.isLoading && (
                  <tr>
                    <td colSpan={7} className="text-muted-foreground p-8 text-center">
                      Loading recent decisions…
                    </td>
                  </tr>
                )}
                {strategyFeed.error && (
                  <tr>
                    <td colSpan={7} className="text-destructive p-8 text-center">
                      Recent decisions are unavailable; no empty substitute is shown.
                    </td>
                  </tr>
                )}
                {!strategyFeed.isLoading && !strategyFeed.error && !recent.length && (
                  <tr>
                    <td colSpan={7} className="text-muted-foreground p-8 text-center">
                      No {horizonMin}m decisions in this scope.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ControlGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-muted-foreground mb-1 text-[10px] uppercase tracking-wider">{label}</div>
      <div className="bg-background flex flex-wrap rounded-md border p-0.5">{children}</div>
    </div>
  );
}

function ControlButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded px-2 py-1 " +
        (active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")
      }
    >
      {children}
    </button>
  );
}

function Metric({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad" | "neutral";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-muted-foreground text-[10px] uppercase tracking-wider">{label}</div>
        <div
          className={
            "mt-1 text-xl font-semibold tabular-nums " +
            (tone === "good" ? "text-success" : tone === "bad" ? "text-destructive" : "")
          }
        >
          {value}
        </div>
        {sub && <div className="text-muted-foreground mt-1 text-[11px]">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function Definition({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground text-[10px] uppercase tracking-wider">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}
