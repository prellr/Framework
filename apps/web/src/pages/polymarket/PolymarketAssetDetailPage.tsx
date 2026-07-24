import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronsUpDown,
  Clock3,
  Layers3,
  Lock,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import {
  polymarketAsset,
  type PolymarketAsset,
} from "./PolymarketAssetLink";
import type { PolymarketPerformanceSegment } from "./PolymarketPerformanceLens";

type ScopeKey = "paper" | "forward" | "history";
type PeriodKey = "24h" | "3d" | "7d" | "30d" | "all";
type HorizonKey = 5 | 15;
type SortDirection = "asc" | "desc";
type StrategySortKey =
  | "name"
  | "n"
  | "days"
  | "winRate"
  | "netPerBet"
  | "residualPerBet"
  | "pnl"
  | "profitStress";
type DailySortKey = "day" | "n" | "up" | "down" | "upRate";
type FeedSortKey = "time" | "strategy" | "side" | "ask" | "edge" | "size" | "pnl" | "status";

type Cohort = {
  key: string;
  botKey: string;
  name: string;
  color: string;
  horizonMin: number;
  control: boolean;
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
};

const usd = (value: number | null | undefined) =>
  value == null ? "—" : `${value < 0 ? "-" : "+"}$${Math.abs(value).toFixed(2)}`;
const pct = (value: number | null | undefined) =>
  value == null ? "—" : `${Math.round(value * 100)}%`;

function compareValues(
  a: number | string | null | undefined,
  b: number | string | null | undefined,
  direction: SortDirection,
) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const compared = typeof a === "string" && typeof b === "string"
    ? a.localeCompare(b)
    : Number(a) - Number(b);
  return direction === "asc" ? compared : -compared;
}

export function PolymarketAssetDetailPage() {
  const params = useParams({ strict: false }) as { asset: string };
  const search = useSearch({ strict: false }) as {
    scope?: ScopeKey;
    period?: PeriodKey;
    horizon?: HorizonKey;
  };
  const navigate = useNavigate();
  const asset = polymarketAsset(params.asset);
  const queryAsset: PolymarketAsset = asset ?? "BTC";
  const scope = search.scope ?? "forward";
  const period = search.period ?? "all";
  const horizon = search.horizon ?? 5;
  const horizonMin = horizon;
  const timezone = "America/Chicago";
  const [strategySort, setStrategySort] = useState<{
    key: StrategySortKey;
    direction: SortDirection;
  }>({ key: "residualPerBet", direction: "desc" });
  const [dailySort, setDailySort] = useState<{
    key: DailySortKey;
    direction: SortDirection;
  }>({ key: "day", direction: "desc" });
  const [feedSort, setFeedSort] = useState<{
    key: FeedSortKey;
    direction: SortDirection;
  }>({ key: "time", direction: "desc" });

  const setSearch = (next: Partial<{ scope: ScopeKey; period: PeriodKey; horizon: HorizonKey }>) =>
    navigate({
      to: "/polymarket/asset/$asset",
      params: { asset: queryAsset },
      search: { scope, period, horizon, ...next },
    });

  const performance = trpc.polymarket.performance.useQuery({
    scope,
    period,
    timezone,
    asset: queryAsset,
    segmentBotKey: "drift",
    segmentHorizonMin: horizonMin,
  }, {
    enabled: Boolean(asset),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const feed = trpc.polymarket.assetFeed.useQuery({
    asset: queryAsset,
    horizonMin,
    scope,
    limit: 100,
  }, {
    enabled: Boolean(asset),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  if (!asset) {
    return (
      <div className="space-y-4">
        <Link to="/polymarket" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Polymarket
        </Link>
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Unknown Polymarket asset: {params.asset}
          </CardContent>
        </Card>
      </div>
    );
  }

  const cohorts = (performance.data?.cohorts ?? []) as Cohort[];
  const control = cohorts.find(
    (row) => row.horizonMin === horizonMin && row.control,
  );
  const strategyRows = cohorts.filter(
    (row) => row.horizonMin === horizonMin && !row.control,
  );
  const strategyValue = (row: Cohort, key: StrategySortKey) => ({
    name: row.name,
    n: row.n,
    days: row.activeDays,
    winRate: row.winRate,
    netPerBet: row.netPerBet,
    residualPerBet: row.residualPerBet,
    pnl: row.pnl,
    profitStress: row.profitStress,
  })[key];
  const strategies = [...strategyRows].sort(
    (a, b) =>
      compareValues(
        strategyValue(a, strategySort.key),
        strategyValue(b, strategySort.key),
        strategySort.direction,
      )
      || a.name.localeCompare(b.name),
  );
  const activeStrategies = strategyRows.filter((row) => row.n > 0);
  const leader = [...strategyRows]
    .filter((row) => row.n >= 10)
    .sort((a, b) =>
      (b.residualPerBet ?? Number.NEGATIVE_INFINITY)
      - (a.residualPerBet ?? Number.NEGATIVE_INFINITY)
      || b.pnl - a.pnl
      || b.n - a.n
    )[0]
    ?? activeStrategies[0];
  const segments = (performance.data?.segments ?? []) as PolymarketPerformanceSegment[];
  const dailyValue = (row: PolymarketPerformanceSegment, key: DailySortKey) => ({
    day: row.key,
    n: row.n,
    up: row.losses,
    down: row.wins,
    upRate: row.n ? row.losses / row.n : null,
  })[key];
  const daily = segments
    .filter((row) => row.dimension === "day")
    .sort(
      (a, b) =>
        compareValues(
          dailyValue(a, dailySort.key),
          dailyValue(b, dailySort.key),
          dailySort.direction,
        )
        || b.key.localeCompare(a.key),
    );
  const feedValue = (
    row: NonNullable<typeof feed.data>[number],
    key: FeedSortKey,
  ) => ({
    time: row.at,
    strategy: cohorts.find((cohort) => cohort.botKey === row.bot)?.name ?? row.bot,
    side: row.side,
    ask: row.ask,
    edge: row.edge,
    size: row.size,
    pnl: row.pnl,
    status: row.status,
  })[key];
  const recent = [...(feed.data ?? [])].sort(
    (a, b) =>
      compareValues(
        feedValue(a, feedSort.key),
        feedValue(b, feedSort.key),
        feedSort.direction,
      )
      || b.at - a.at,
  );
  const botByKey = new Map(
    cohorts
      .filter((row) => row.horizonMin === horizonMin)
      .map((row) => [row.botKey, row] as const),
  );
  const uniqueN = control?.n ?? 0;
  const up = control?.losses ?? 0;
  const down = control?.wins ?? 0;
  const scopeLabel = scope === "paper"
    ? "Current paper"
    : scope === "forward"
      ? "Forward / gate cohort"
      : "All history";
  const toggleStrategySort = (key: StrategySortKey) =>
    setStrategySort((current) => ({
      key,
      direction: current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));
  const toggleDailySort = (key: DailySortKey) =>
    setDailySort((current) => ({
      key,
      direction: current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));
  const toggleFeedSort = (key: FeedSortKey) =>
    setFeedSort((current) => ({
      key,
      direction: current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));

  return (
    <div className="space-y-5">
      <Link to="/polymarket" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Polymarket overview
      </Link>
      <PageHeader
        title={`${asset} Up/Down`}
        subtitle={`One asset, separated by timeframe: unique market direction, strategy dispersion, daily behavior, and recent paper decisions. Asset slices are diagnostic and never replace a strategy's frozen pooled verdict.`}
        actions={(
          <div className="inline-flex items-center gap-1.5 rounded-md border bg-muted/20 px-2.5 py-1.5 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" /> paper evidence only
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
          <div>{scopeLabel}</div>
          <div>{period === "all" ? "full selected scope" : `${period} diagnostic window`} · {timezone}</div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="Unique markets" value={uniqueN.toLocaleString()} sub={`${asset} ${horizonMin}m`} />
        <Metric label="Resolved UP" value={up.toLocaleString()} sub={pct(uniqueN ? up / uniqueN : null)} />
        <Metric label="Resolved DOWN" value={down.toLocaleString()} sub={pct(uniqueN ? down / uniqueN : null)} />
        <Metric label="Direction balance" value={uniqueN ? `${Math.abs(up - down)} market${Math.abs(up - down) === 1 ? "" : "s"}` : "—"} sub={up === down ? "even" : up > down ? "UP lead" : "DOWN lead"} />
        <Metric label="Active strategies" value={activeStrategies.length.toLocaleString()} sub={`${strategies.length} registered at ${horizonMin}m`} />
        <Metric
          label="Best ≥10 vs control"
          value={leader?.residualPerBet == null ? "—" : `${leader.residualPerBet >= 0 ? "+" : ""}${(leader.residualPerBet * 100).toFixed(1)}¢`}
          sub={leader ? `${leader.name} · ${leader.n} graded` : "no graded strategy rows"}
          tone={Number(leader?.residualPerBet) > 0 ? "good" : Number(leader?.residualPerBet) < 0 ? "bad" : "neutral"}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.65fr_1fr]">
        <Card className="overflow-hidden shadow-none">
          <CardHeader className="border-b p-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers3 className="h-4 w-4 text-muted-foreground" />
              Strategy comparison · {asset} {horizonMin}m
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Ranked by same-tick residual versus the opposite-side control; rows below 10 graded decisions are muted. Click any metric heading to re-sort.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[38rem] overflow-auto">
              <table className="w-full min-w-[760px] text-sm tabular-nums">
                <thead className="sticky top-0 z-10 border-b bg-card text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">#</th>
                    <SortHeader column="name" active={strategySort.key} direction={strategySort.direction} onSort={toggleStrategySort}>Strategy</SortHeader>
                    <SortHeader column="n" active={strategySort.key} direction={strategySort.direction} onSort={toggleStrategySort} align="right">N</SortHeader>
                    <SortHeader column="days" active={strategySort.key} direction={strategySort.direction} onSort={toggleStrategySort} align="right">Days</SortHeader>
                    <SortHeader column="winRate" active={strategySort.key} direction={strategySort.direction} onSort={toggleStrategySort} align="right">WR</SortHeader>
                    <SortHeader column="netPerBet" active={strategySort.key} direction={strategySort.direction} onSort={toggleStrategySort} align="right">Net / bet</SortHeader>
                    <SortHeader column="residualPerBet" active={strategySort.key} direction={strategySort.direction} onSort={toggleStrategySort} align="right">Vs control</SortHeader>
                    <SortHeader column="pnl" active={strategySort.key} direction={strategySort.direction} onSort={toggleStrategySort} align="right">RAW</SortHeader>
                    <SortHeader column="profitStress" active={strategySort.key} direction={strategySort.direction} onSort={toggleStrategySort} align="right" edge>Stress −36%</SortHeader>
                  </tr>
                </thead>
                <tbody>
                  {strategies.map((row, index) => (
                    <tr key={row.key} className={`border-b last:border-0 ${row.n < 10 ? "opacity-45" : ""}`}>
                      <td className="px-4 py-2.5 text-muted-foreground">{index + 1}</td>
                      <td className="px-3 py-2.5 font-medium">
                        <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: row.color }} />
                        <Link
                          to="/polymarket/strategy/$botKey"
                          params={{ botKey: row.botKey }}
                          search={{ scope, period, horizon }}
                          className="rounded-sm transition-colors hover:text-primary hover:underline hover:underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {row.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-right">{row.n}</td>
                      <td className="px-3 py-2.5 text-right">{row.activeDays}</td>
                      <td className="px-3 py-2.5 text-right">{pct(row.winRate)}</td>
                      <td className={`px-3 py-2.5 text-right ${Number(row.netPerBet) > 0 ? "text-success" : Number(row.netPerBet) < 0 ? "text-destructive" : ""}`}>{usd(row.netPerBet)}</td>
                      <td className={`px-3 py-2.5 text-right ${Number(row.residualPerBet) > 0 ? "text-success" : Number(row.residualPerBet) < 0 ? "text-destructive" : ""}`}>
                        {row.residualPerBet == null ? "—" : `${row.residualPerBet >= 0 ? "+" : ""}${(row.residualPerBet * 100).toFixed(1)}¢`}
                      </td>
                      <td className={`px-3 py-2.5 text-right ${row.pnl > 0 ? "text-success" : row.pnl < 0 ? "text-destructive" : ""}`}>{usd(row.pnl)}</td>
                      <td className={`px-4 py-2.5 text-right font-medium ${row.profitStress > 0 ? "text-success" : row.profitStress < 0 ? "text-destructive" : ""}`} title="Legacy sensitivity only; winning profit is reduced by 36%.">{usd(row.profitStress)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden shadow-none">
          <CardHeader className="border-b p-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-muted-foreground" />
              Unique market direction by day
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Counted once from the universal Always Down control; not summed across strategies.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[38rem] overflow-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="sticky top-0 border-b bg-card text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <SortHeader column="day" active={dailySort.key} direction={dailySort.direction} onSort={toggleDailySort} edge>Chicago day</SortHeader>
                    <SortHeader column="n" active={dailySort.key} direction={dailySort.direction} onSort={toggleDailySort} align="right">N</SortHeader>
                    <SortHeader column="up" active={dailySort.key} direction={dailySort.direction} onSort={toggleDailySort} align="right">UP</SortHeader>
                    <SortHeader column="down" active={dailySort.key} direction={dailySort.direction} onSort={toggleDailySort} align="right">DOWN</SortHeader>
                    <SortHeader column="upRate" active={dailySort.key} direction={dailySort.direction} onSort={toggleDailySort} align="right" edge>UP %</SortHeader>
                  </tr>
                </thead>
                <tbody>
                  {daily.map((row) => (
                    <tr key={row.key} className="border-b last:border-0">
                      <td className="px-4 py-2.5">{new Date(`${row.key}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</td>
                      <td className="px-2 py-2.5 text-right">{row.n}</td>
                      <td className="px-2 py-2.5 text-right">{row.losses}</td>
                      <td className="px-2 py-2.5 text-right">{row.wins}</td>
                      <td className="px-4 py-2.5 text-right">{pct(row.n ? row.losses / row.n : null)}</td>
                    </tr>
                  ))}
                  {!daily.length && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No resolved {asset} {horizonMin}m markets in this period.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden shadow-none">
        <CardHeader className="border-b p-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock3 className="h-4 w-4 text-muted-foreground" />
            Recent {asset} {horizonMin}m paper decisions
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            The same market can appear once per strategy. This reveals agreement and crowding; it is not a unique-market count.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full min-w-[860px] text-sm tabular-nums">
              <thead className="sticky top-0 border-b bg-card text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <SortHeader column="time" active={feedSort.key} direction={feedSort.direction} onSort={toggleFeedSort} edge>Time</SortHeader>
                  <SortHeader column="strategy" active={feedSort.key} direction={feedSort.direction} onSort={toggleFeedSort}>Strategy</SortHeader>
                  <SortHeader column="side" active={feedSort.key} direction={feedSort.direction} onSort={toggleFeedSort}>Side</SortHeader>
                  <SortHeader column="ask" active={feedSort.key} direction={feedSort.direction} onSort={toggleFeedSort} align="right">Ask</SortHeader>
                  <SortHeader column="edge" active={feedSort.key} direction={feedSort.direction} onSort={toggleFeedSort} align="right">Edge</SortHeader>
                  <SortHeader column="size" active={feedSort.key} direction={feedSort.direction} onSort={toggleFeedSort} align="right">Size</SortHeader>
                  <SortHeader column="pnl" active={feedSort.key} direction={feedSort.direction} onSort={toggleFeedSort} align="right">P&amp;L</SortHeader>
                  <SortHeader column="status" active={feedSort.key} direction={feedSort.direction} onSort={toggleFeedSort} align="right" edge>Result</SortHeader>
                </tr>
              </thead>
              <tbody>
                {recent.map((trade) => {
                  const bot = botByKey.get(trade.bot);
                  return (
                    <tr key={trade.id} className="border-b last:border-0">
                      <td className="px-4 py-2.5 text-muted-foreground">{new Date(trade.at).toLocaleString()}</td>
                      <td className="px-3 py-2.5 font-medium">
                        <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: bot?.color }} />
                        <Link
                          to="/polymarket/strategy/$botKey"
                          params={{ botKey: trade.bot }}
                          search={{ scope, period, horizon }}
                          className="rounded-sm transition-colors hover:text-primary hover:underline hover:underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {bot?.name ?? trade.bot}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 uppercase">{trade.side}</td>
                      <td className="px-3 py-2.5 text-right">{Math.round(trade.ask * 100)}¢</td>
                      <td className="px-3 py-2.5 text-right">{trade.edge == null ? "—" : `${trade.edge >= 0 ? "+" : ""}${(trade.edge * 100).toFixed(1)}¢`}</td>
                      <td className="px-3 py-2.5 text-right">${trade.size.toFixed(2)}</td>
                      <td className={`px-3 py-2.5 text-right ${Number(trade.pnl) > 0 ? "text-success" : Number(trade.pnl) < 0 ? "text-destructive" : ""}`}>{usd(trade.pnl)}</td>
                      <td className="px-4 py-2.5 text-right">{trade.status}</td>
                    </tr>
                  );
                })}
                {feed.isLoading && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">Loading asset decisions…</td></tr>}
                {feed.error && <tr><td colSpan={8} className="p-8 text-center text-destructive">Asset decisions are unavailable; no empty substitute is shown.</td></tr>}
                {!feed.isLoading && !feed.error && !recent.length && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No {asset} {horizonMin}m decisions in this scope.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="border-t bg-muted/10 px-4 py-2.5 text-[11px] text-muted-foreground">
            Asset pages are exploratory slices. They do not create an asset-only strategy, change a registered rule, or unlock execution.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function ControlGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="flex rounded-md border bg-background/70 p-0.5">{children}</div>
    </div>
  );
}

function ControlButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`rounded px-2 py-1 transition-colors ${active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>
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
    <Card className="shadow-none">
      <CardContent className="p-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`mt-1 text-xl font-semibold tabular-nums ${tone === "good" ? "text-success" : tone === "bad" ? "text-destructive" : ""}`}>{value}</div>
        {sub && <div className="mt-1 truncate text-[11px] text-muted-foreground" title={sub}>{sub}</div>}
      </CardContent>
    </Card>
  );
}

function SortHeader<Key extends string>({
  column,
  active,
  direction,
  onSort,
  align = "left",
  edge = false,
  children,
}: {
  column: Key;
  active: Key;
  direction: SortDirection;
  onSort: (column: Key) => void;
  align?: "left" | "right";
  edge?: boolean;
  children: ReactNode;
}) {
  const selected = column === active;
  const Icon = selected
    ? direction === "asc" ? ArrowUp : ArrowDown
    : ChevronsUpDown;
  return (
    <th
      className={`${edge ? "px-4" : "px-3"} py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}
      aria-sort={selected ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`inline-flex w-full items-center gap-1 rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${align === "right" ? "justify-end" : "justify-start"}`}
      >
        {children}
        <Icon className={`h-3 w-3 ${selected ? "text-foreground" : "opacity-35"}`} />
      </button>
    </th>
  );
}
