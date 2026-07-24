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
import { FAMILY_META, strategyMeta } from "./polymarket-strategy-meta";

type ScopeKey = "paper" | "forward" | "history";
type PeriodKey = "24h" | "3d" | "7d" | "30d" | "all";
type HorizonKey = 5 | 15;
type BucketSortKey = "asset" | "n" | "winRate" | "pnl" | "open";
type FeedSortKey = "time" | "market" | "side" | "ask" | "edge" | "pnl" | "status";

const usd = (value: number | null | undefined) =>
  value == null ? "—" : `${value < 0 ? "-" : "+"}$${Math.abs(value).toFixed(2)}`;
const pct = (value: number | null | undefined) =>
  value == null ? "—" : `${Math.round(value * 100)}%`;
const DOW = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function PolymarketStrategyDetailPage() {
  const { botKey } = useParams({ strict: false }) as { botKey: string };
  const search = useSearch({ strict: false }) as {
    scope?: ScopeKey;
    period?: PeriodKey;
    horizon?: HorizonKey;
  };
  const navigate = useNavigate();
  const scope = search.scope ?? "forward";
  const period = search.period ?? "all";
  const horizon = search.horizon ?? 5;
  const horizonMin = horizon;
  const timezone = "America/Chicago";
  const [bucketSort, setBucketSort] = useState<SortState<BucketSortKey>>({
    key: "pnl",
    direction: "desc",
  });
  const [feedSort, setFeedSort] = useState<SortState<FeedSortKey>>({
    key: "time",
    direction: "desc",
  });

  const setSearch = (next: Partial<{ scope: ScopeKey; period: PeriodKey; horizon: HorizonKey }>) =>
    navigate({
      to: "/polymarket/strategy/$botKey",
      params: { botKey },
      search: { scope, period, horizon, ...next },
    });

  const floor = trpc.polymarket.floorView.useQuery({ scope, view: "strategy" }, {
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const performance = trpc.polymarket.performance.useQuery({
    scope,
    period,
    timezone,
    segmentBotKey: botKey,
    segmentHorizonMin: horizonMin,
  }, {
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const strategyFeed = trpc.polymarket.strategyFeed.useQuery({
    botKey,
    horizonMin,
    scope,
    limit: 100,
  }, {
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  if (floor.isLoading) return <p className="text-sm text-muted-foreground">Loading strategy evidence…</p>;
  if (!floor.data) return <p className="text-sm text-destructive">Paper evidence is unavailable.</p>;

  const scoped = floor.data.scope;
  const bot = scoped.bots.find((candidate) => candidate.key === botKey);
  if (!bot) {
    return (
      <div className="space-y-4">
        <Link to="/polymarket" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Polymarket
        </Link>
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Unknown paper strategy: {botKey}</CardContent></Card>
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
  const ordered = (dimension: PolymarketPerformanceSegment["dimension"], keys: readonly string[]) => {
    const order = new Map(keys.map((key, index) => [key, index]));
    return byDimension(dimension).sort(
      (a, b) => (order.get(a.key) ?? keys.length) - (order.get(b.key) ?? keys.length)
        || a.key.localeCompare(b.key),
    );
  };
  const selectedBuckets = bot.buckets.filter((bucket) => bucket.horizonMin === horizonMin);
  const selectedGate = floor.data.familywiseGate.hypotheses.find(
    (row) => row.key === `${botKey}:${horizonMin}`,
  );
  const recent = strategyFeed.data ?? [];
  const sortedBuckets = stableSortRows(
    selectedBuckets,
    (bucket) => ({
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
    (trade) => ({
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

  return (
    <div className="space-y-5">
      <Link to="/polymarket" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Polymarket overview
      </Link>
      <PageHeader
        title={bot.name}
        subtitle={`${meta.thesis} ${meta.scope}. This page is evidence-only: no Polymarket order, wallet, allocation, or execution control exists.`}
        actions={(
          <div className="inline-flex items-center gap-1.5 rounded-md border bg-muted/20 px-2.5 py-1.5 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" /> paper only · live locked
          </div>
        )}
      />

      <div className="flex flex-wrap items-end gap-4 rounded-lg border bg-muted/10 p-3 text-xs">
        <ControlGroup label="Stats scope">
          {([["paper", "Current paper"], ["forward", "Gate cohort"], ["history", "All history"]] as const).map(([key, label]) => (
            <ControlButton key={key} active={scope === key} onClick={() => setSearch({ scope: key })}>{label}</ControlButton>
          ))}
        </ControlGroup>
        <ControlGroup label="Timeframe">
          {([[5, "5m"], [15, "15m"]] as const).map(([key, label]) => (
            <ControlButton key={key} active={horizon === key} onClick={() => setSearch({ horizon: key })}>{label}</ControlButton>
          ))}
        </ControlGroup>
        <ControlGroup label="Diagnostic period">
          {(["24h", "3d", "7d", "30d", "all"] as const).map((key) => (
            <ControlButton key={key} active={period === key} onClick={() => setSearch({ period: key })}>
              {key === "all" ? "All" : key}
            </ControlButton>
          ))}
        </ControlGroup>
        <div className="ml-auto text-right text-[11px] text-muted-foreground">
          <div>{scoped.label}</div>
          <div>{scoped.fromMs == null ? "all captured rows" : `from ${new Date(scoped.fromMs).toLocaleString()}`}</div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <Metric label="RAW net" value={usd(cohort?.pnl)} tone={Number(cohort?.pnl) > 0 ? "good" : Number(cohort?.pnl) < 0 ? "bad" : "neutral"} />
        <Metric label="Profit stress −36%" value={usd(cohort?.profitStress)} sub="legacy sensitivity; not a verdict input" tone={Number(cohort?.profitStress) > 0 ? "good" : Number(cohort?.profitStress) < 0 ? "bad" : "neutral"} />
        <Metric label="Graded" value={`${wins}W / ${losses}L`} sub={pct(cohort?.winRate)} />
        <Metric label="Net / bet" value={usd(cohort?.netPerBet)} tone={Number(cohort?.netPerBet) > 0 ? "good" : Number(cohort?.netPerBet) < 0 ? "bad" : "neutral"} />
        <Metric label="Vs control" value={cohort?.residualPerBet == null ? "—" : `${cohort.residualPerBet >= 0 ? "+" : ""}${(cohort.residualPerBet * 100).toFixed(1)}¢`} tone={Number(cohort?.residualPerBet) > 0 ? "good" : Number(cohort?.residualPerBet) < 0 ? "bad" : "neutral"} />
        <Metric label="Active days" value={String(cohort?.activeDays ?? 0)} sub={selectedGate ? `familywise gate: ${selectedGate.state}` : `${family.short} · ${meta.origin}`} />
      </div>

      <PolymarketDailyRawLedger
        ledger={scoped.dailyLedger}
        bots={[bot]}
        horizonMin={horizonMin}
        subtitle={`${horizonMin}m realized P&L by Chicago calendar day`}
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader className="border-b p-4">
          <CardTitle className="text-base">Scope-to-date asset buckets · {horizonMin}m</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm tabular-nums">
              <thead><tr className="border-b text-[10px] uppercase text-muted-foreground">
                <PolymarketSortableHeader column="asset" active={bucketSort.key} direction={bucketSort.direction} onSort={sortBuckets} initialDirection="asc" className="px-4 py-2 font-medium">Asset</PolymarketSortableHeader>
                <PolymarketSortableHeader column="n" active={bucketSort.key} direction={bucketSort.direction} onSort={sortBuckets} align="right" className="px-3 py-2 font-medium">N</PolymarketSortableHeader>
                <PolymarketSortableHeader column="winRate" active={bucketSort.key} direction={bucketSort.direction} onSort={sortBuckets} align="right" className="px-3 py-2 font-medium">WR</PolymarketSortableHeader>
                <PolymarketSortableHeader column="pnl" active={bucketSort.key} direction={bucketSort.direction} onSort={sortBuckets} align="right" className="px-3 py-2 font-medium">RAW</PolymarketSortableHeader>
                <PolymarketSortableHeader column="open" active={bucketSort.key} direction={bucketSort.direction} onSort={sortBuckets} align="right" className="px-4 py-2 font-medium">Open</PolymarketSortableHeader>
              </tr></thead>
              <tbody>
                {sortedBuckets.map((bucket) => (
                  <tr key={bucket.pair} className={"border-b last:border-0 " + (bucket.n < 5 ? "opacity-45" : "")}>
                    <td className="px-4 py-2.5 font-medium">
                      <PolymarketAssetLink asset={bucket.pair} scope={scope} period={period} horizonMin={horizonMin} />
                    </td>
                    <td className="px-3 py-2.5 text-right">{bucket.n}</td>
                    <td className="px-3 py-2.5 text-right">{bucket.n ? `${Math.round(bucket.wins / bucket.n * 100)}%` : "—"}</td>
                    <td className={"px-3 py-2.5 text-right " + (bucket.pnl > 0 ? "text-success" : bucket.pnl < 0 ? "text-destructive" : "")}>{usd(bucket.pnl)}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">{bucket.openNow || "—"}</td>
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
            <Definition label="Selected population" value={`${scope} · ${period} · ${horizonMin}m`} />
            <Definition label="Verdict state" value={selectedGate?.state ?? (meta.family === "control" ? "control" : "waiting")} />
            <Definition label="Execution" value="Locked; no route exists" />
            <p className="sm:col-span-2 text-xs leading-relaxed text-muted-foreground">
              Time, asset, regime, side, ask, and freshness slices are diagnostic. They cannot
              overwrite the frozen pooled or split verdict gate, and they are never used to enable
              live execution.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b p-4">
          <CardTitle className="text-base">Segmentation · {horizonMin}m <span className="ml-1 text-xs font-normal text-muted-foreground">{period} · {timezone}</span></CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          {performance.isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading segmentation…</p>
          ) : performance.error ? (
            <p className="py-8 text-center text-sm text-destructive">Segmentation unavailable; no zero-filled substitute is shown.</p>
          ) : (
            <div className="grid gap-3 xl:grid-cols-3">
              <PolymarketSegmentTable title="Calendar day" icon={<CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />} rows={byDimension("day").sort((a, b) => b.key.localeCompare(a.key))} label={(row) => new Date(`${row.key}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} />
              <PolymarketSegmentTable title="Time of day" icon={<Clock3 className="h-3.5 w-3.5 text-muted-foreground" />} rows={ordered("session", ["00–06", "06–12", "12–18", "18–24"])} label={(row) => row.key} />
              <PolymarketSegmentTable title="Day of week" icon={<CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />} rows={byDimension("weekday")} label={(row) => DOW[Number(row.key)] ?? row.key} />
              <PolymarketSegmentTable title="Macro direction" icon={<Compass className="h-3.5 w-3.5 text-muted-foreground" />} rows={ordered("macro", ["UP", "DOWN", "RANGE", "NEUTRAL", "UNAVAILABLE"])} label={(row) => row.key} />
              <PolymarketSegmentTable title="Technical regime" icon={<Activity className="h-3.5 w-3.5 text-muted-foreground" />} rows={ordered("technical", ["Trend", "Chop", "Compression", "Neutral", "Unavailable"])} label={(row) => row.key} />
              <PolymarketSegmentTable
                title="Asset"
                icon={<Layers3 className="h-3.5 w-3.5 text-muted-foreground" />}
                rows={byDimension("asset")}
                label={(row) => <PolymarketAssetLink asset={row.key} scope={scope} period={period} horizonMin={horizonMin} />}
              />
              <PolymarketSegmentTable title="Chosen side" icon={<Layers3 className="h-3.5 w-3.5 text-muted-foreground" />} rows={byDimension("side")} label={(row) => row.key} />
              <PolymarketSegmentTable title="Entry ask" icon={<Layers3 className="h-3.5 w-3.5 text-muted-foreground" />} rows={ordered("ask", ["<35¢", "35–49¢", "50–64¢", "65¢+"])} label={(row) => row.key} />
              <PolymarketSegmentTable title="Signal freshness" icon={<Clock3 className="h-3.5 w-3.5 text-muted-foreground" />} rows={ordered("freshness", ["<2s", "2–5s", "5–15s", "15s+", "Unavailable"])} label={(row) => row.key} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b p-4">
          <CardTitle className="text-base">Recent {horizonMin}m decisions <span className="ml-1 text-xs font-normal text-muted-foreground">latest 100 rows in the selected scope</span></CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm tabular-nums">
              <thead><tr className="border-b text-[10px] uppercase text-muted-foreground">
                <PolymarketSortableHeader column="time" active={feedSort.key} direction={feedSort.direction} onSort={sortFeed} className="px-4 py-2 font-medium">Time</PolymarketSortableHeader>
                <PolymarketSortableHeader column="market" active={feedSort.key} direction={feedSort.direction} onSort={sortFeed} initialDirection="asc" className="px-3 py-2 font-medium">Market</PolymarketSortableHeader>
                <PolymarketSortableHeader column="side" active={feedSort.key} direction={feedSort.direction} onSort={sortFeed} initialDirection="asc" className="px-3 py-2 font-medium">Side</PolymarketSortableHeader>
                <PolymarketSortableHeader column="ask" active={feedSort.key} direction={feedSort.direction} onSort={sortFeed} align="right" className="px-3 py-2 font-medium">Ask</PolymarketSortableHeader>
                <PolymarketSortableHeader column="edge" active={feedSort.key} direction={feedSort.direction} onSort={sortFeed} align="right" className="px-3 py-2 font-medium">Edge</PolymarketSortableHeader>
                <PolymarketSortableHeader column="pnl" active={feedSort.key} direction={feedSort.direction} onSort={sortFeed} align="right" className="px-3 py-2 font-medium">P&amp;L</PolymarketSortableHeader>
                <PolymarketSortableHeader column="status" active={feedSort.key} direction={feedSort.direction} onSort={sortFeed} align="right" initialDirection="asc" className="px-4 py-2 font-medium">Result</PolymarketSortableHeader>
              </tr></thead>
              <tbody>
                {sortedRecent.map((trade) => (
                  <tr key={trade.id} className="border-b last:border-0">
                    <td className="px-4 py-2.5 text-muted-foreground">{new Date(trade.at).toLocaleString()}</td>
                    <td className="px-3 py-2.5">
                      <PolymarketAssetLink asset={trade.pair} scope={scope} period={period} horizonMin={trade.horizonMin}>
                        {trade.pair.replace("-USD", "")} {trade.horizonMin}m
                      </PolymarketAssetLink>
                    </td>
                    <td className="px-3 py-2.5 uppercase">{trade.side}</td>
                    <td className="px-3 py-2.5 text-right">{trade.ask == null ? "—" : `${Math.round(trade.ask * 100)}¢`}</td>
                    <td className="px-3 py-2.5 text-right">{trade.edge == null ? "—" : `${trade.edge >= 0 ? "+" : ""}${(trade.edge * 100).toFixed(1)}¢`}</td>
                    <td className={"px-3 py-2.5 text-right " + (Number(trade.pnl) > 0 ? "text-success" : Number(trade.pnl) < 0 ? "text-destructive" : "")}>{usd(trade.pnl)}</td>
                    <td className="px-4 py-2.5 text-right">{trade.status}</td>
                  </tr>
                ))}
                {strategyFeed.isLoading && <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">Loading recent decisions…</td></tr>}
                {strategyFeed.error && <tr><td colSpan={7} className="p-8 text-center text-destructive">Recent decisions are unavailable; no empty substitute is shown.</td></tr>}
                {!strategyFeed.isLoading && !strategyFeed.error && !recent.length && <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No {horizonMin}m decisions in this scope.</td></tr>}
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
      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="flex rounded-md border bg-background p-0.5">{children}</div>
    </div>
  );
}

function ControlButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={"rounded px-2 py-1 " + (active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
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
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={"mt-1 text-xl font-semibold tabular-nums " + (tone === "good" ? "text-success" : tone === "bad" ? "text-destructive" : "")}>{value}</div>
        {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function Definition({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}
