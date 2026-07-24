import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Archive,
  Database,
  FlaskConical,
  Search,
  ShieldCheck,
} from "lucide-react";
import type { RouterOutput } from "@framework/api/router";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import {
  nextSortState,
  PolymarketSortableHeader as SortableHeader,
  stableSortRows,
  type SortState,
  type SortValue,
} from "@/pages/polymarket/PolymarketSortableHeader";

type Observatory = RouterOutput["crucible"]["observatory"];
type Collection = Observatory["collections"][number];
type Result = Observatory["results"][number];
type View = "collections" | "results";
type CollectionSortKey =
  | "target"
  | "lifecycle"
  | "results"
  | "assets"
  | "timeframes"
  | "positive"
  | "sufficient"
  | "bestPf"
  | "medianPf"
  | "bestReturn"
  | "worstDrawdown"
  | "latest";
type ResultSortKey =
  | "strategy"
  | "asset"
  | "timeframe"
  | "span"
  | "return"
  | "trades"
  | "winRate"
  | "profitFactor"
  | "sharpe"
  | "drawdown"
  | "ranAt";

const TF_MINUTES: Record<string, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "4h": 240,
  "1d": 1_440,
};

const percent = (value: number | null) =>
  value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
const decimal = (value: number | null) =>
  value == null ? "—" : value.toFixed(2);
const dateTime = (value: Date | string | null) =>
  value == null
    ? "—"
    : new Date(value).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });

function collectionValue(row: Collection, key: CollectionSortKey): SortValue {
  switch (key) {
    case "target": return `${row.target} ${row.direction}`;
    case "lifecycle": return row.lifecycle;
    case "results": return row.results;
    case "assets": return row.assets;
    case "timeframes": return row.timeframes;
    case "positive": return row.positiveReturnCells;
    case "sufficient": return row.sufficientSampleCells;
    case "bestPf": return row.bestProfitFactor;
    case "medianPf": return row.medianProfitFactor;
    case "bestReturn": return row.bestReturn;
    case "worstDrawdown": return row.worstDrawdown;
    case "latest": return row.latestRunAt == null ? null : new Date(row.latestRunAt).getTime();
  }
}

function resultValue(row: Result, key: ResultSortKey): SortValue {
  switch (key) {
    case "strategy": return row.strategyName;
    case "asset": return row.pair;
    case "timeframe": return TF_MINUTES[row.timeframe] ?? Number.MAX_SAFE_INTEGER;
    case "span": return row.spanDays;
    case "return": return row.totalReturn;
    case "trades": return row.totalTrades;
    case "winRate": return row.winRate;
    case "profitFactor": return row.profitFactor;
    case "sharpe": return row.sharpe;
    case "drawdown": return row.maxDrawdown;
    case "ranAt": return new Date(row.ranAt).getTime();
  }
}

export function CruciblePage() {
  const observatory = trpc.crucible.observatory.useQuery(undefined, {
    staleTime: 60_000,
  });
  const [view, setView] = useState<View>("collections");
  const [query, setQuery] = useState("");
  const [timeframe, setTimeframe] = useState("all");
  const [minimumTrades, setMinimumTrades] = useState(0);
  const [collectionSort, setCollectionSort] = useState<SortState<CollectionSortKey>>({
    key: "latest",
    direction: "desc",
  });
  const [resultSort, setResultSort] = useState<SortState<ResultSortKey>>({
    key: "profitFactor",
    direction: "desc",
  });
  const search = query.trim().toLowerCase();
  const timeframes = useMemo(
    () => [...new Set((observatory.data?.results ?? []).map((row) => row.timeframe))]
      .sort((left, right) => (TF_MINUTES[left] ?? 999_999) - (TF_MINUTES[right] ?? 999_999)),
    [observatory.data],
  );
  const collections = useMemo(() => {
    const filtered = (observatory.data?.collections ?? []).filter((row) =>
      !search
      || row.name.toLowerCase().includes(search)
      || row.strategyId.toLowerCase().includes(search)
      || row.target.toLowerCase().includes(search)
    );
    return stableSortRows(
      filtered,
      (row) => collectionValue(row, collectionSort.key),
      collectionSort.direction,
    );
  }, [collectionSort, observatory.data, search]);
  const results = useMemo(() => {
    const filtered = (observatory.data?.results ?? []).filter((row) =>
      (timeframe === "all" || row.timeframe === timeframe)
      && (row.totalTrades ?? 0) >= minimumTrades
      && (
        !search
        || row.strategyName.toLowerCase().includes(search)
        || row.strategyId.toLowerCase().includes(search)
        || row.target.toLowerCase().includes(search)
        || row.pair.toLowerCase().includes(search)
      )
    );
    return stableSortRows(
      filtered,
      (row) => resultValue(row, resultSort.key),
      resultSort.direction,
    );
  }, [minimumTrades, observatory.data, resultSort, search, timeframe]);
  const sortCollections = (key: CollectionSortKey, initialDirection: "asc" | "desc" = "desc") =>
    setCollectionSort((current) => nextSortState(current, key, initialDirection));
  const sortResults = (key: ResultSortKey, initialDirection: "asc" | "desc" = "desc") =>
    setResultSort((current) => nextSortState(current, key, initialDirection));

  if (observatory.isLoading) {
    return (
      <div className="space-y-5" aria-label="Loading Crucible observatory">
        <div className="h-16 animate-pulse rounded-xl bg-muted/60" />
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-xl bg-muted/50" />
          ))}
        </div>
        <div className="h-96 animate-pulse rounded-xl bg-muted/40" />
      </div>
    );
  }

  if (observatory.isError || !observatory.data) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm">
        The read-only Crucible observatory is unavailable. No empty result set has been substituted.
      </div>
    );
  }

  const data = observatory.data;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Crucible Observatory"
        subtitle="Discovery outputs mirrored into Jester’s catalog and backtest warehouse. These are fitted research leads, not forward-validated strategies."
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-md border border-success/30 bg-success/10 px-2.5 py-1.5 text-xs font-medium text-success">
            <ShieldCheck className="h-3.5 w-3.5" />
            read-only
          </span>
        }
      />

      <section className="grid gap-3 md:grid-cols-4" aria-label="Crucible warehouse summary">
        <Metric icon={FlaskConical} label="Discovery programs" value={data.summary.programs.toLocaleString()} />
        <Metric icon={Database} label="Stored results" value={data.summary.results.toLocaleString()} />
        <Metric icon={Archive} label="Assets / timeframes" value={`${data.summary.assets} / ${data.summary.timeframes}`} />
        <Metric icon={Database} label="Latest warehouse run" value={dateTime(data.summary.latestRunAt)} small />
      </section>

      <section className="rounded-xl border border-warning/25 bg-warning/5 px-4 py-3">
        <div className="flex gap-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="space-y-1 text-sm">
            <p className="font-medium">Evidence boundary</p>
            <p className="max-w-5xl text-muted-foreground">
              This view reads the local catalog mirror and warehouse only. Live Crucible status and
              target collections are not queried. Starting, replaying, cancelling, validating,
              promoting, activating, or cycling a target is structurally absent.
            </p>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border bg-card p-1">
          {([
            ["collections", `Collections ${data.summary.programs}`],
            ["results", `Results ${data.summary.results}`],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                view === key
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex min-w-56 flex-1 items-center gap-2 rounded-md border border-input bg-background px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <span className="sr-only">Filter Crucible results</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter target, strategy, or asset…"
            className="h-9 w-full bg-transparent text-sm outline-none"
          />
        </label>
        {view === "results" && (
          <>
            <select
              value={timeframe}
              onChange={(event) => setTimeframe(event.target.value)}
              aria-label="Filter by timeframe"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="all">All timeframes</option>
              {timeframes.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select
              value={minimumTrades}
              onChange={(event) => setMinimumTrades(Number(event.target.value))}
              aria-label="Filter by minimum trades"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value={0}>Any sample</option>
              <option value={10}>10+ trades</option>
              <option value={20}>20+ trades</option>
              <option value={30}>30+ trades</option>
            </select>
          </>
        )}
      </div>

      {view === "collections" ? (
        <CollectionsTable rows={collections} sort={collectionSort} onSort={sortCollections} />
      ) : (
        <ResultsTable rows={results} sort={resultSort} onSort={sortResults} />
      )}

      <p className="text-xs text-muted-foreground">
        Catalog mirrored {dateTime(data.summary.catalogRefreshedAt)} · warehouse generated{" "}
        {dateTime(data.generatedAt)} · positive returns and high profit factors remain descriptive
        because Crucible selected these programs in-sample.
      </p>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  small = false,
}: {
  icon: typeof Database;
  label: string;
  value: string;
  small?: boolean;
}) {
  return (
    <Card className="shadow-none">
      <CardContent className="flex items-start gap-3 p-4">
        <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`mt-1 truncate font-semibold tabular-nums ${small ? "text-sm" : "text-xl"}`} title={value}>
            {value}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function CollectionsTable({
  rows,
  sort,
  onSort,
}: {
  rows: Collection[];
  sort: SortState<CollectionSortKey>;
  onSort: (key: CollectionSortKey, initialDirection?: "asc" | "desc") => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="border-b px-4 py-3">
        <h2 className="font-semibold">Result collections</h2>
        <p className="text-xs text-muted-foreground">
          One collection per mirrored Crucible program; every column is sortable.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1220px] text-sm tabular-nums">
          <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <SortableHeader column="target" active={sort.key} direction={sort.direction} onSort={onSort} initialDirection="asc" className="px-4 py-2.5 font-medium">Target</SortableHeader>
              <SortableHeader column="lifecycle" active={sort.key} direction={sort.direction} onSort={onSort} initialDirection="asc" className="px-3 py-2.5 font-medium">State</SortableHeader>
              <SortableHeader column="results" active={sort.key} direction={sort.direction} onSort={onSort} align="right" className="px-3 py-2.5 font-medium">Results</SortableHeader>
              <SortableHeader column="assets" active={sort.key} direction={sort.direction} onSort={onSort} align="right" className="px-3 py-2.5 font-medium">Assets</SortableHeader>
              <SortableHeader column="timeframes" active={sort.key} direction={sort.direction} onSort={onSort} align="right" className="px-3 py-2.5 font-medium">TFs</SortableHeader>
              <SortableHeader column="positive" active={sort.key} direction={sort.direction} onSort={onSort} align="right" className="px-3 py-2.5 font-medium">Positive</SortableHeader>
              <SortableHeader column="sufficient" active={sort.key} direction={sort.direction} onSort={onSort} align="right" className="px-3 py-2.5 font-medium">N≥20</SortableHeader>
              <SortableHeader column="bestPf" active={sort.key} direction={sort.direction} onSort={onSort} align="right" className="px-3 py-2.5 font-medium">Best PF</SortableHeader>
              <SortableHeader column="medianPf" active={sort.key} direction={sort.direction} onSort={onSort} align="right" className="px-3 py-2.5 font-medium">Median PF</SortableHeader>
              <SortableHeader column="bestReturn" active={sort.key} direction={sort.direction} onSort={onSort} align="right" className="px-3 py-2.5 font-medium">Best return</SortableHeader>
              <SortableHeader column="worstDrawdown" active={sort.key} direction={sort.direction} onSort={onSort} align="right" className="px-3 py-2.5 font-medium">Worst DD</SortableHeader>
              <SortableHeader column="latest" active={sort.key} direction={sort.direction} onSort={onSort} align="right" className="px-4 py-2.5 font-medium">Latest</SortableHeader>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.strategyId} className="border-t hover:bg-accent/30">
                <td className="px-4 py-3">
                  <Link
                    to="/strategy/$strategyId"
                    params={{ strategyId: row.strategyId }}
                    search={{}}
                    className="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {row.target} {row.direction}
                  </Link>
                  <p className="mt-0.5 max-w-64 truncate font-mono text-[11px] text-muted-foreground" title={row.strategyId}>
                    {row.strategyId}
                  </p>
                </td>
                <td className="px-3 py-3">
                  <span className="rounded border bg-muted/40 px-1.5 py-0.5 text-xs text-muted-foreground">
                    {row.lifecycle}
                  </span>
                </td>
                <td className="px-3 py-3 text-right">{row.results}</td>
                <td className="px-3 py-3 text-right">{row.assets}</td>
                <td className="px-3 py-3 text-right">{row.timeframes}</td>
                <td className="px-3 py-3 text-right">{row.positiveReturnCells}</td>
                <td className="px-3 py-3 text-right">{row.sufficientSampleCells}</td>
                <td className="px-3 py-3 text-right">{decimal(row.bestProfitFactor)}</td>
                <td className="px-3 py-3 text-right">{decimal(row.medianProfitFactor)}</td>
                <td className={`px-3 py-3 text-right ${(row.bestReturn ?? 0) >= 0 ? "text-success" : "text-destructive"}`}>
                  {percent(row.bestReturn)}
                </td>
                <td className="px-3 py-3 text-right text-destructive">{percent(row.worstDrawdown)}</td>
                <td className="px-4 py-3 text-right text-xs text-muted-foreground">{dateTime(row.latestRunAt)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={12} className="px-4 py-12 text-center text-muted-foreground">No collections match this filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ResultsTable({
  rows,
  sort,
  onSort,
}: {
  rows: Result[];
  sort: SortState<ResultSortKey>;
  onSort: (key: ResultSortKey, initialDirection?: "asc" | "desc") => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="border-b px-4 py-3">
        <h2 className="font-semibold">Warehouse results</h2>
        <p className="text-xs text-muted-foreground">
          Deduplicated backtest cells; rows with fewer than 20 trades are visually muted.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1180px] text-sm tabular-nums">
          <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <SortableHeader column="strategy" active={sort.key} direction={sort.direction} onSort={onSort} initialDirection="asc" className="px-4 py-2.5 font-medium">Strategy</SortableHeader>
              <SortableHeader column="asset" active={sort.key} direction={sort.direction} onSort={onSort} initialDirection="asc" className="px-3 py-2.5 font-medium">Asset</SortableHeader>
              <SortableHeader column="timeframe" active={sort.key} direction={sort.direction} onSort={onSort} initialDirection="asc" className="px-3 py-2.5 font-medium">TF</SortableHeader>
              <SortableHeader column="span" active={sort.key} direction={sort.direction} onSort={onSort} align="right" className="px-3 py-2.5 font-medium">Span</SortableHeader>
              <SortableHeader column="return" active={sort.key} direction={sort.direction} onSort={onSort} align="right" className="px-3 py-2.5 font-medium">Return</SortableHeader>
              <SortableHeader column="trades" active={sort.key} direction={sort.direction} onSort={onSort} align="right" className="px-3 py-2.5 font-medium">Trades</SortableHeader>
              <SortableHeader column="winRate" active={sort.key} direction={sort.direction} onSort={onSort} align="right" className="px-3 py-2.5 font-medium">Win %</SortableHeader>
              <SortableHeader column="profitFactor" active={sort.key} direction={sort.direction} onSort={onSort} align="right" className="px-3 py-2.5 font-medium">PF</SortableHeader>
              <SortableHeader column="sharpe" active={sort.key} direction={sort.direction} onSort={onSort} align="right" className="px-3 py-2.5 font-medium">Sharpe</SortableHeader>
              <SortableHeader column="drawdown" active={sort.key} direction={sort.direction} onSort={onSort} align="right" className="px-3 py-2.5 font-medium">Max DD</SortableHeader>
              <SortableHeader column="ranAt" active={sort.key} direction={sort.direction} onSort={onSort} align="right" className="px-4 py-2.5 font-medium">Run</SortableHeader>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const thin = (row.totalTrades ?? 0) < 20;
              return (
                <tr key={row.id} className={`border-t hover:bg-accent/30 ${thin ? "text-muted-foreground" : ""}`}>
                  <td className="px-4 py-3">
                    <Link
                      to="/strategy/$strategyId"
                      params={{ strategyId: row.strategyId }}
                      search={{ pair: row.pair, tf: row.timeframe, days: row.daysRequested }}
                      className="block max-w-72 truncate font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title={row.strategyName}
                    >
                      {row.strategyName}
                    </Link>
                  </td>
                  <td className="px-3 py-3">{row.pair}</td>
                  <td className="px-3 py-3">{row.timeframe}</td>
                  <td className="px-3 py-3 text-right">{row.spanDays}d</td>
                  <td className={`px-3 py-3 text-right ${(row.totalReturn ?? 0) >= 0 ? "text-success" : "text-destructive"}`}>{percent(row.totalReturn)}</td>
                  <td className="px-3 py-3 text-right">{row.totalTrades ?? "—"}</td>
                  <td className="px-3 py-3 text-right">{row.winRate == null ? "—" : `${row.winRate.toFixed(1)}%`}</td>
                  <td className="px-3 py-3 text-right font-medium">{decimal(row.profitFactor)}</td>
                  <td className="px-3 py-3 text-right">{decimal(row.sharpe)}</td>
                  <td className="px-3 py-3 text-right text-destructive">{percent(row.maxDrawdown)}</td>
                  <td className="px-4 py-3 text-right text-xs">{dateTime(row.ranAt)}</td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={11} className="px-4 py-12 text-center text-muted-foreground">No results match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
