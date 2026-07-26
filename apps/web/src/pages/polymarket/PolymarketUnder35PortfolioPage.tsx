import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Filter,
  FlaskConical,
  History,
  Layers3,
  Lock,
  Search,
  Sigma,
  WalletCards,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc, type RouterOutput } from "@/lib/trpc";
import {
  nextSortState,
  PolymarketSortableHeader,
  stableSortRows,
  type SortState,
} from "./PolymarketSortableHeader";

type ScopeKey = "paper" | "forward" | "history";
type HorizonKey = "all" | 5 | 15;
type PortfolioData = RouterOutput["polymarket"]["under35Portfolio"];
type Cohort = PortfolioData["cohorts"][number];
type TradeHistoryData = RouterOutput["polymarket"]["under35TradeHistory"];
type Under35Trade = TradeHistoryData["trades"][number];
type TradeGroupMode = "window" | "hour" | "day";
type RosterMetric = "raw" | "trades" | "winRate";
type StakeUsd = 5 | 10 | 20 | 50;
type SortKey =
  "included" | "strategy" | "timeframe" | "n" | "winRate" | "average" | "rawNet" | `day:${string}`;

const SELECTION_STORAGE_KEY = "alchemy.polymarket.under35.selected-cohorts.v1";
const WORKSPACE_STORAGE_KEY = "alchemy.polymarket.under35.workspace.v1";

type StoredWorkspace = {
  scope: ScopeKey;
  horizon: HorizonKey;
  stakeUsd: StakeUsd;
  rosterMetric: RosterMetric;
  groupMode: TradeGroupMode;
  search: string;
  sort: SortState<SortKey>;
};

const DEFAULT_WORKSPACE: StoredWorkspace = {
  scope: "paper",
  horizon: "all",
  stakeUsd: 5,
  rosterMetric: "raw",
  groupMode: "window",
  search: "",
  sort: { key: "rawNet", direction: "desc" },
};

const signedMoney = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value)
    ? "—"
    : `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(digits)}`;
const pct = (value: number | null | undefined, digits = 0) =>
  value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
const dayLabel = (day: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
const askLabel = (ask: number) => `${(ask * 100).toFixed(ask * 100 < 10 ? 1 : 0)}¢`;
const tradeTimeLabel = (atMs: number, includeDate = true) =>
  new Intl.DateTimeFormat("en-US", {
    ...(includeDate ? { weekday: "short", month: "short", day: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/Chicago",
  }).format(new Date(atMs));
const scaledTradeRaw = (trade: Under35Trade, stakeUsd: StakeUsd) =>
  trade.sizeUsd > 0 ? trade.rawNet * (stakeUsd / trade.sizeUsd) : 0;

function readStoredSelection(): Set<string> | null {
  try {
    const raw = localStorage.getItem(SELECTION_STORAGE_KEY);
    if (raw == null) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((value): value is string => typeof value === "string"))
      : null;
  } catch {
    return null;
  }
}

function readStoredWorkspace(): StoredWorkspace {
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return DEFAULT_WORKSPACE;
    const parsed = JSON.parse(raw) as Partial<StoredWorkspace>;
    const scope = ["paper", "forward", "history"].includes(String(parsed.scope))
      ? (parsed.scope as ScopeKey)
      : DEFAULT_WORKSPACE.scope;
    const horizon = ["all", 5, 15].includes(parsed.horizon as string | number)
      ? (parsed.horizon as HorizonKey)
      : DEFAULT_WORKSPACE.horizon;
    const stakeUsd = [5, 10, 20, 50].includes(Number(parsed.stakeUsd))
      ? (Number(parsed.stakeUsd) as StakeUsd)
      : DEFAULT_WORKSPACE.stakeUsd;
    const rosterMetric = ["raw", "trades", "winRate"].includes(String(parsed.rosterMetric))
      ? (parsed.rosterMetric as RosterMetric)
      : DEFAULT_WORKSPACE.rosterMetric;
    const groupMode = ["window", "hour", "day"].includes(String(parsed.groupMode))
      ? (parsed.groupMode as TradeGroupMode)
      : DEFAULT_WORKSPACE.groupMode;
    const sortDirection = parsed.sort?.direction === "asc" ? "asc" : "desc";
    const sortKey =
      typeof parsed.sort?.key === "string" ? parsed.sort.key : DEFAULT_WORKSPACE.sort.key;
    return {
      scope,
      horizon,
      stakeUsd,
      rosterMetric,
      groupMode,
      search: typeof parsed.search === "string" ? parsed.search : "",
      sort: { key: sortKey as SortKey, direction: sortDirection },
    };
  } catch {
    return DEFAULT_WORKSPACE;
  }
}

function Toggle<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div>
      <div className="text-muted-foreground mb-1.5 text-[10px] font-medium uppercase tracking-[0.16em]">
        {label}
      </div>
      <div className="bg-background inline-flex rounded-lg border p-0.5">
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            onClick={() => onChange(option.value)}
            className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
              value === option.value
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  note,
  tone = "neutral",
}: {
  label: string;
  value: string;
  note: string;
  tone?: "neutral" | "good" | "warning";
}) {
  return (
    <div className="bg-muted/10 rounded-xl border p-4">
      <div className="text-muted-foreground text-[10px] font-medium uppercase tracking-[0.16em]">
        {label}
      </div>
      <div
        className={`mt-2 text-2xl font-semibold tabular-nums ${
          tone === "good" ? "text-success" : tone === "warning" ? "text-warning" : ""
        }`}
      >
        {value}
      </div>
      <div className="text-muted-foreground mt-1 text-xs leading-5">{note}</div>
    </div>
  );
}

function AverageRawChart({
  cohorts,
  dayKeys,
  currentDay,
  stakeMultiplier,
}: {
  cohorts: Cohort[];
  dayKeys: string[];
  currentDay: string;
  stakeMultiplier: number;
}) {
  const values = dayKeys.map((day) => {
    const raw =
      cohorts.reduce(
        (sum, cohort) => sum + (cohort.days.find((cell) => cell.day === day)?.rawNet ?? 0),
        0,
      ) * stakeMultiplier;
    const n = cohorts.reduce(
      (sum, cohort) => sum + (cohort.days.find((cell) => cell.day === day)?.n ?? 0),
      0,
    );
    return {
      day,
      raw,
      n,
      average: cohorts.length ? raw / cohorts.length : 0,
    };
  });

  if (!cohorts.length) {
    return (
      <div className="text-muted-foreground flex h-64 flex-col items-center justify-center rounded-lg border border-dashed text-center text-sm">
        <Sigma className="mb-3 h-5 w-5 opacity-60" />
        Select at least one strategy cohort to build the average RAW chart.
      </div>
    );
  }

  const width = 1_020;
  const height = 300;
  const margin = { top: 34, right: 24, bottom: 52, left: 72 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(0, ...values.map((row) => row.average));
  const minValue = Math.min(0, ...values.map((row) => row.average));
  const span = Math.max(1, maxValue - minValue);
  const y = (value: number) => margin.top + ((maxValue - value) / span) * plotHeight;
  const zeroY = y(0);
  const columnWidth = plotWidth / Math.max(1, values.length);
  const barWidth = Math.min(72, columnWidth * 0.56);
  const ticks = [maxValue, minValue + span / 2, minValue];

  return (
    <div className="overflow-x-auto">
      <svg
        role="img"
        aria-label="Average under 35 cent RAW net per selected strategy cohort by calendar day"
        viewBox={`0 0 ${width} ${height}`}
        className="w-full min-w-[760px]"
      >
        {ticks.map((tick, index) => (
          <g key={`${tick}:${index}`}>
            <line
              x1={margin.left}
              x2={width - margin.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="currentColor"
              className="text-border"
              strokeDasharray={tick === 0 ? undefined : "3 5"}
            />
            <text
              x={margin.left - 10}
              y={y(tick) + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[11px]"
            >
              {signedMoney(tick)}
            </text>
          </g>
        ))}
        {values.map((row, index) => {
          const center = margin.left + columnWidth * (index + 0.5);
          const valueY = y(row.average);
          const positive = row.average >= 0;
          const top = Math.min(zeroY, valueY);
          const barHeight = Math.max(2, Math.abs(zeroY - valueY));
          return (
            <g key={row.day}>
              {row.day === currentDay ? (
                <rect
                  x={center - columnWidth / 2 + 4}
                  y={margin.top - 10}
                  width={columnWidth - 8}
                  height={plotHeight + 20}
                  rx={6}
                  fill="currentColor"
                  className="text-cyan-400"
                  opacity={0.035}
                />
              ) : null}
              <rect
                x={center - barWidth / 2}
                y={top}
                width={barWidth}
                height={barHeight}
                rx={4}
                fill={positive ? "#22c55e" : "#ef4444"}
                opacity={0.74}
              >
                <title>
                  {`${dayLabel(row.day)} · ${signedMoney(row.average)} average RAW per selected cohort · ${signedMoney(row.raw)} row-summed RAW · ${row.n} decisions`}
                </title>
              </rect>
              <text
                x={center}
                y={positive ? top - 8 : top + barHeight + 16}
                textAnchor="middle"
                className={positive ? "fill-success text-[11px]" : "fill-destructive text-[11px]"}
              >
                {signedMoney(row.average)}
              </text>
              <text
                x={center}
                y={height - 23}
                textAnchor="middle"
                className="fill-muted-foreground text-[11px]"
              >
                {dayLabel(row.day)}
              </text>
              {row.day === currentDay ? (
                <text
                  x={center}
                  y={height - 8}
                  textAnchor="middle"
                  className="fill-cyan-400 text-[9px] uppercase tracking-wider"
                >
                  live
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Under35TradeHistory({
  history,
  trades,
  loading,
  failed,
  selectedCohortCount,
  scope,
  stakeUsd,
  groupMode,
  onGroupModeChange,
}: {
  history: TradeHistoryData | undefined;
  trades: Under35Trade[];
  loading: boolean;
  failed: boolean;
  selectedCohortCount: number;
  scope: ScopeKey;
  stakeUsd: StakeUsd;
  groupMode: TradeGroupMode;
  onGroupModeChange: (mode: TradeGroupMode) => void;
}) {
  const [visibleGroupCount, setVisibleGroupCount] = useState(24);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const byKey = new Map<string, Under35Trade[]>();
    for (const trade of trades) {
      const key =
        groupMode === "day"
          ? trade.localDay
          : groupMode === "hour"
            ? String(Math.floor(trade.windowStartMs / 3_600_000) * 3_600_000)
            : String(trade.windowStartMs);
      const existing = byKey.get(key);
      if (existing) existing.push(trade);
      else byKey.set(key, [trade]);
    }
    return [...byKey.entries()]
      .map(([key, rows]) => {
        const uniqueMarketSides = new Set(rows.map((trade) => `${trade.conditionId}:${trade.side}`))
          .size;
        const uniqueMarkets = new Set(rows.map((trade) => trade.conditionId)).size;
        const strategyCohorts = new Set(rows.map((trade) => trade.cohortKey)).size;
        const stake = rows.length * stakeUsd;
        const rawNet = rows.reduce((sum, trade) => sum + scaledTradeRaw(trade, stakeUsd), 0);
        const wins = rows.filter((trade) => trade.status === "won").length;
        const ask = rows.reduce((sum, trade) => sum + trade.ask, 0) / rows.length;
        const sortMs =
          groupMode === "day" ? Math.max(...rows.map((trade) => trade.windowStartMs)) : Number(key);
        return {
          key,
          rows,
          sortMs,
          uniqueMarketSides,
          uniqueMarkets,
          strategyCohorts,
          stake,
          rawNet,
          wins,
          ask,
          overlap: Math.max(0, rows.length - uniqueMarketSides),
        };
      })
      .sort((left, right) => right.sortMs - left.sortMs);
  }, [groupMode, stakeUsd, trades]);

  const selectedStake = trades.length * stakeUsd;
  const selectedRaw = trades.reduce((sum, trade) => sum + scaledTradeRaw(trade, stakeUsd), 0);
  const selectedWins = trades.filter((trade) => trade.status === "won").length;
  const uniqueMarketSides = new Set(trades.map((trade) => `${trade.conditionId}:${trade.side}`))
    .size;
  const visibleGroups = groups.slice(0, visibleGroupCount);
  const setMode = (next: TradeGroupMode) => {
    onGroupModeChange(next);
    setVisibleGroupCount(24);
    setExpandedGroups(new Set());
  };
  const toggleExpanded = (key: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const groupLabel = (key: string, rows: Under35Trade[]) => {
    if (groupMode === "day") return dayLabel(key);
    const label = tradeTimeLabel(Number(key), true);
    return groupMode === "hour" ? `${label.replace(/:00:\d{2}/, ":00")} hour` : label;
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="gap-4 border-b">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4 text-cyan-400" />
              Selected-cohort trade history
            </CardTitle>
            <p className="text-muted-foreground mt-1 max-w-4xl text-xs leading-5">
              Group coincident decisions by exact market window, Chicago hour, or Chicago calendar
              day. Expand a group to inspect every strategy decision, recorded entry ask, result,
              and RAW P&amp;L.
            </p>
          </div>
          <Toggle
            label="Group trades by time"
            value={groupMode}
            onChange={setMode}
            options={[
              { value: "window", label: "Market window" },
              { value: "hour", label: "Hour" },
              { value: "day", label: "Calendar day" },
            ]}
          />
        </div>
        {!loading && !failed ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div className="bg-muted/10 rounded-lg border px-3 py-2.5">
              <div className="text-muted-foreground text-[9px] uppercase tracking-wider">
                Decisions
              </div>
              <div className="mt-1 font-semibold tabular-nums">
                {trades.length.toLocaleString()}
              </div>
            </div>
            <div className="bg-muted/10 rounded-lg border px-3 py-2.5">
              <div className="text-muted-foreground text-[9px] uppercase tracking-wider">
                Unique market-sides
              </div>
              <div className="mt-1 font-semibold tabular-nums">
                {uniqueMarketSides.toLocaleString()}
              </div>
            </div>
            <div className="bg-muted/10 rounded-lg border px-3 py-2.5">
              <div className="text-muted-foreground text-[9px] uppercase tracking-wider">
                Row-summed stake
              </div>
              <div className="mt-1 font-semibold tabular-nums">
                ${selectedStake.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </div>
            <div className="bg-muted/10 rounded-lg border px-3 py-2.5">
              <div className="text-muted-foreground text-[9px] uppercase tracking-wider">
                Wins / losses
              </div>
              <div className="mt-1 font-semibold tabular-nums">
                {selectedWins.toLocaleString()} / {(trades.length - selectedWins).toLocaleString()}
              </div>
            </div>
            <div className="bg-muted/10 rounded-lg border px-3 py-2.5">
              <div className="text-muted-foreground text-[9px] uppercase tracking-wider">
                Row-summed RAW
              </div>
              <div
                className={`mt-1 font-semibold tabular-nums ${
                  selectedRaw >= 0 ? "text-success" : "text-destructive"
                }`}
              >
                {signedMoney(selectedRaw)}
              </div>
            </div>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="text-muted-foreground p-10 text-center text-sm">
            Loading the bounded seven-day trade ledger…
          </div>
        ) : failed || !history ? (
          <div className="border-destructive/30 bg-destructive/5 m-5 rounded-lg border p-6 text-sm">
            Trade history is unavailable. No synthetic rows have been substituted.
          </div>
        ) : !selectedCohortCount ? (
          <div className="text-muted-foreground p-10 text-center text-sm">
            Select at least one strategy cohort to inspect its under-35¢ trades.
          </div>
        ) : !trades.length ? (
          <div className="text-muted-foreground p-10 text-center text-sm">
            The selected cohorts have no graded under-35¢ decisions in this seven-day scope.
          </div>
        ) : (
          <>
            <div className="divide-y overflow-x-auto">
              {visibleGroups.map((group) => {
                const expanded = expandedGroups.has(group.key);
                return (
                  <div key={`${groupMode}:${group.key}`}>
                    <button
                      type="button"
                      onClick={() => toggleExpanded(group.key)}
                      aria-expanded={expanded}
                      className="hover:bg-muted/20 grid w-full min-w-[1050px] grid-cols-[minmax(190px,1.5fr)_repeat(7,minmax(78px,0.7fr))] items-center gap-3 px-5 py-3 text-left text-xs transition-colors"
                    >
                      <span className="flex min-w-0 items-center gap-2 font-medium">
                        {expanded ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-cyan-400" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-cyan-400" />
                        )}
                        <Clock3 className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{groupLabel(group.key, group.rows)}</span>
                      </span>
                      <span className="text-right tabular-nums">
                        <span className="text-muted-foreground block text-[9px] uppercase">
                          decisions
                        </span>
                        {group.rows.length}
                      </span>
                      <span className="text-right tabular-nums">
                        <span className="text-muted-foreground block text-[9px] uppercase">
                          market-sides
                        </span>
                        {group.uniqueMarketSides}
                      </span>
                      <span className="text-right tabular-nums">
                        <span className="text-muted-foreground block text-[9px] uppercase">
                          strategies
                        </span>
                        {group.strategyCohorts}
                      </span>
                      <span className="text-right tabular-nums">
                        <span className="text-muted-foreground block text-[9px] uppercase">
                          avg ask
                        </span>
                        {askLabel(group.ask)}
                      </span>
                      <span className="text-right tabular-nums">
                        <span className="text-muted-foreground block text-[9px] uppercase">
                          stake
                        </span>
                        ${group.stake.toFixed(0)}
                      </span>
                      <span className="text-right tabular-nums">
                        <span className="text-muted-foreground block text-[9px] uppercase">
                          W / L
                        </span>
                        {group.wins} / {group.rows.length - group.wins}
                      </span>
                      <span
                        className={`text-right font-semibold tabular-nums ${
                          group.rawNet >= 0 ? "text-success" : "text-destructive"
                        }`}
                      >
                        <span className="text-muted-foreground block text-[9px] uppercase">
                          RAW
                        </span>
                        {signedMoney(group.rawNet)}
                      </span>
                    </button>
                    {expanded ? (
                      <div className="bg-background/50 border-t px-5 pb-4">
                        <div className="text-muted-foreground flex flex-wrap items-center gap-3 py-3 text-[10px]">
                          <span className="flex items-center gap-1">
                            <Layers3 className="h-3 w-3" />
                            {group.uniqueMarkets} unique markets
                          </span>
                          <span>{group.overlap} overlapping strategy decisions</span>
                          <span>row sums are not capital-deduplicated</span>
                        </div>
                        <div className="overflow-x-auto rounded-lg border">
                          <table className="w-full min-w-[980px] text-xs tabular-nums">
                            <thead className="bg-muted/20 text-muted-foreground text-[9px] uppercase tracking-wider">
                              <tr>
                                <th className="px-3 py-2 text-left font-medium">Decision time</th>
                                <th className="px-3 py-2 text-left font-medium">Strategy</th>
                                <th className="px-3 py-2 text-left font-medium">Market</th>
                                <th className="px-3 py-2 text-left font-medium">Side</th>
                                <th className="px-3 py-2 text-right font-medium">Entry ask</th>
                                <th className="px-3 py-2 text-right font-medium">Stake</th>
                                <th className="px-3 py-2 text-right font-medium">Result</th>
                                <th className="px-3 py-2 text-right font-medium">RAW</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.rows.map((trade) => (
                                <tr key={trade.id} className="border-t first:border-t-0">
                                  <td className="text-muted-foreground px-3 py-2">
                                    {tradeTimeLabel(trade.decidedAtMs, false)}
                                  </td>
                                  <td className="px-3 py-2 font-medium">
                                    <Link
                                      to="/polymarket/strategy/$botKey"
                                      params={{ botKey: trade.botKey }}
                                      search={{ horizon: trade.horizonMin as 5 | 15, scope }}
                                      className="hover:underline"
                                    >
                                      <span
                                        className="mr-2 inline-block h-2 w-2 rounded-full"
                                        style={{ backgroundColor: trade.botColor }}
                                      />
                                      {trade.botName}
                                    </Link>
                                  </td>
                                  <td className="px-3 py-2">
                                    {trade.pair} · {trade.horizonMin}m
                                  </td>
                                  <td className="px-3 py-2 uppercase">{trade.side}</td>
                                  <td className="px-3 py-2 text-right">{askLabel(trade.ask)}</td>
                                  <td className="px-3 py-2 text-right">${stakeUsd.toFixed(2)}</td>
                                  <td
                                    className={`px-3 py-2 text-right font-medium ${
                                      trade.status === "won" ? "text-success" : "text-destructive"
                                    }`}
                                  >
                                    {trade.status === "won" ? "Won" : "Lost"}
                                  </td>
                                  <td
                                    className={`px-3 py-2 text-right font-semibold ${
                                      scaledTradeRaw(trade, stakeUsd) >= 0
                                        ? "text-success"
                                        : "text-destructive"
                                    }`}
                                  >
                                    {signedMoney(scaledTradeRaw(trade, stakeUsd))}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {groups.length > visibleGroups.length ? (
              <div className="border-t p-4 text-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setVisibleGroupCount((count) => count + 24)}
                >
                  Show 24 more time groups
                </Button>
              </div>
            ) : null}
            <div className="text-muted-foreground border-t px-5 py-4 text-xs leading-5">
              {history.methodology.rows} {history.methodology.overlap}
              {stakeUsd === 5
                ? " Dollar values use the captured $5 book walk."
                : ` Dollar values are a ${stakeUsd / 5}× linear $${stakeUsd} model from the captured $5 book walk; deeper-book slippage is not included.`}
              {history.truncated
                ? ` Showing the newest ${history.returned.toLocaleString()} of ${history.total.toLocaleString()} matching decisions.`
                : ` Showing all ${history.returned.toLocaleString()} matching decisions returned for this scope.`}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function PolymarketUnder35PortfolioPage() {
  const [initialWorkspace] = useState(readStoredWorkspace);
  const [scope, setScope] = useState<ScopeKey>(initialWorkspace.scope);
  const [horizon, setHorizon] = useState<HorizonKey>(initialWorkspace.horizon);
  const [stakeUsd, setStakeUsd] = useState<StakeUsd>(initialWorkspace.stakeUsd);
  const [rosterMetric, setRosterMetric] = useState<RosterMetric>(initialWorkspace.rosterMetric);
  const [groupMode, setGroupMode] = useState<TradeGroupMode>(initialWorkspace.groupMode);
  const [search, setSearch] = useState(initialWorkspace.search);
  const [storedSelection, setStoredSelection] = useState<Set<string> | null>(readStoredSelection);
  const [sort, setSort] = useState<SortState<SortKey>>(initialWorkspace.sort);

  useEffect(() => {
    localStorage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({ scope, horizon, stakeUsd, rosterMetric, groupMode, search, sort }),
    );
  }, [groupMode, horizon, rosterMetric, scope, search, sort, stakeUsd]);

  const query = trpc.polymarket.under35Portfolio.useQuery(
    { scope, horizon: "all", timezone: "America/Chicago" },
    { staleTime: 30_000, refetchInterval: 60_000 },
  );
  const data = query.data;
  const allKeys = useMemo(
    () => new Set((data?.cohorts ?? []).map((cohort) => cohort.key)),
    [data?.cohorts],
  );
  const selectedKeys = storedSelection ?? allKeys;
  const horizonCohorts = (data?.cohorts ?? []).filter(
    (cohort) => horizon === "all" || cohort.horizonMin === horizon,
  );
  const selectedCohorts = horizonCohorts.filter((cohort) => selectedKeys.has(cohort.key));
  const historyCohortKeys = selectedCohorts.map((cohort) => cohort.key).sort();
  const historyQuery = trpc.polymarket.under35TradeHistory.useQuery(
    { scope, timezone: "America/Chicago", cohortKeys: historyCohortKeys },
    {
      enabled: Boolean(data && historyCohortKeys.length),
      staleTime: 120_000,
      refetchInterval: 300_000,
    },
  );
  const selectedTrades = (historyQuery.data?.trades ?? []).filter(
    (trade) =>
      selectedKeys.has(trade.cohortKey) && (horizon === "all" || trade.horizonMin === horizon),
  );
  const normalizedSearch = search.trim().toLowerCase();
  const visibleCohorts = horizonCohorts.filter(
    (cohort) =>
      !normalizedSearch ||
      cohort.name.toLowerCase().includes(normalizedSearch) ||
      cohort.botKey.toLowerCase().includes(normalizedSearch),
  );

  const commitSelection = (next: Set<string>) => {
    setStoredSelection(next);
    localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify([...next].sort()));
  };
  const toggleCohort = (key: string) => {
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    commitSelection(next);
  };
  const selectVisible = () => {
    const next = new Set(selectedKeys);
    for (const cohort of visibleCohorts) next.add(cohort.key);
    commitSelection(next);
  };
  const clearVisible = () => {
    const next = new Set(selectedKeys);
    for (const cohort of visibleCohorts) next.delete(cohort.key);
    commitSelection(next);
  };

  const dayValue = (cohort: Cohort, day: string) => cohort.days.find((cell) => cell.day === day);
  const averageObservedWinRate = (cohort: Cohort) => {
    const observed = cohort.days.filter((day) => day.observed && day.winRate != null);
    return observed.length
      ? observed.reduce((sum, day) => sum + (day.winRate ?? 0), 0) / observed.length
      : null;
  };
  const averageRosterValue = (cohort: Cohort) =>
    rosterMetric === "raw"
      ? cohort.averageRawPerCalendarDay * (stakeUsd / 5)
      : rosterMetric === "trades"
        ? cohort.n / (data?.dayKeys.length ?? 7)
        : averageObservedWinRate(cohort);
  const totalRosterValue = (cohort: Cohort) =>
    rosterMetric === "raw"
      ? cohort.rawNet * (stakeUsd / 5)
      : rosterMetric === "trades"
        ? cohort.n
        : cohort.winRate;
  const dailyRosterValue = (cohort: Cohort, day: string) => {
    const cell = dayValue(cohort, day);
    if (!cell?.observed) return null;
    return rosterMetric === "raw"
      ? cell.rawNet * (stakeUsd / 5)
      : rosterMetric === "trades"
        ? cell.n
        : cell.winRate;
  };
  const rosterValueLabel = (value: number | null, digits = 0) =>
    rosterMetric === "raw"
      ? signedMoney(value)
      : rosterMetric === "trades"
        ? value == null
          ? "—"
          : value.toFixed(digits)
        : pct(value);
  const sortedCohorts = stableSortRows(
    visibleCohorts,
    (cohort) => {
      if (sort.key === "included") return selectedKeys.has(cohort.key);
      if (sort.key === "strategy") return cohort.name;
      if (sort.key === "timeframe") return cohort.horizonMin;
      if (sort.key === "n") return cohort.n;
      if (sort.key === "winRate") return cohort.winRate;
      if (sort.key === "average") return averageRosterValue(cohort);
      if (sort.key === "rawNet") return totalRosterValue(cohort);
      return dailyRosterValue(cohort, sort.key.slice(4));
    },
    sort.direction,
  );
  const sortBy = (key: SortKey, initialDirection: "asc" | "desc" = "desc") =>
    setSort((current) => nextSortState(current, key, initialDirection));

  const selectedN = selectedCohorts.reduce((sum, cohort) => sum + cohort.n, 0);
  const selectedWins = selectedCohorts.reduce((sum, cohort) => sum + cohort.wins, 0);
  const stakeMultiplier = stakeUsd / 5;
  const selectedRaw =
    selectedCohorts.reduce((sum, cohort) => sum + cohort.rawNet, 0) * stakeMultiplier;
  const averageSelectedRaw = selectedCohorts.length ? selectedRaw / selectedCohorts.length : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Under 35¢ Portfolio"
        subtitle="Build and compare a candidate basket from every registered Polymarket strategy × timeframe using only graded entries with a recorded fee-adjusted ask below 35¢."
        actions={
          <div className="text-muted-foreground flex items-center gap-2 rounded-lg border px-3 py-2 text-xs">
            <Lock className="h-3.5 w-3.5" />
            Research selection · no strategy mutation
          </div>
        }
      />

      <section className="from-card via-card overflow-hidden rounded-2xl border bg-gradient-to-br to-cyan-500/[0.04]">
        <div className="grid gap-6 p-5 lg:grid-cols-[1fr_auto] lg:items-start">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.2em] text-cyan-400">
              <FlaskConical className="h-3.5 w-3.5" />
              Candidate basket workbench
            </div>
            <h2 className="mt-2 text-xl font-semibold tracking-tight">Low-ask strategy roster</h2>
            <p className="text-muted-foreground mt-2 max-w-4xl text-sm leading-6">
              The chart averages RAW P&amp;L across the selected cohorts. Each selected cohort is
              treated as funded even on a no-trade day, so a blank table cell contributes $0 to that
              day&apos;s average.
            </p>
          </div>
          <div className="bg-background/70 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs">
            <WalletCards className="h-3.5 w-3.5 text-cyan-400" />
            <span className="text-muted-foreground">
              {stakeUsd === 5 ? "Captured stake" : "Linear model stake"}
            </span>
            <span className="font-semibold">${stakeUsd} / decision</span>
          </div>
        </div>
        <div className="bg-background/40 flex flex-wrap items-end gap-4 border-t px-5 py-3">
          <Toggle
            label="Stats scope"
            value={scope}
            onChange={setScope}
            options={[
              { value: "paper", label: "Current paper" },
              { value: "forward", label: "Gate cohort" },
              { value: "history", label: "All history" },
            ]}
          />
          <Toggle
            label="Timeframe"
            value={horizon}
            onChange={setHorizon}
            options={[
              { value: "all", label: "5m + 15m" },
              { value: 5, label: "5m" },
              { value: 15, label: "15m" },
            ]}
          />
          <Toggle
            label="Stake per decision"
            value={stakeUsd}
            onChange={setStakeUsd}
            options={[
              { value: 5, label: "$5" },
              { value: 10, label: "$10" },
              { value: 20, label: "$20" },
              { value: 50, label: "$50" },
            ]}
          />
          <div className="text-muted-foreground ml-auto text-right text-xs leading-5">
            {data
              ? `${selectedCohorts.length} of ${horizonCohorts.length} cohorts included`
              : "Loading exact registered roster…"}
            <br />
            America/Chicago · current day remains live
            {stakeUsd === 5 ? "" : ` · ${stakeMultiplier}× linear stake model`}
          </div>
        </div>
      </section>

      {query.isLoading ? (
        <div className="text-muted-foreground rounded-xl border p-10 text-center text-sm">
          Building seven calendar days of under-35¢ evidence…
        </div>
      ) : query.isError || !data ? (
        <div className="border-destructive/30 bg-destructive/5 rounded-xl border p-8 text-sm">
          Under-35¢ evidence is unavailable. No zero-filled results have been substituted.
        </div>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricTile
              label="Included cohorts"
              value={`${selectedCohorts.length} / ${horizonCohorts.length}`}
              note="strategy × timeframe selections in the current view"
              tone={selectedCohorts.length ? "good" : "warning"}
            />
            <MetricTile
              label="Average 7d RAW / cohort"
              value={signedMoney(averageSelectedRaw)}
              note={`row-summed seven-day RAW divided by included cohorts · $${stakeUsd} model`}
              tone={
                averageSelectedRaw == null
                  ? "warning"
                  : averageSelectedRaw >= 0
                    ? "good"
                    : "warning"
              }
            />
            <MetricTile
              label="Selected decisions"
              value={selectedN.toLocaleString()}
              note={`below 35¢ · ${pct(selectedN ? selectedWins / selectedN : null)} win rate`}
            />
            <MetricTile
              label="Row-summed RAW"
              value={signedMoney(selectedRaw)}
              note={`$${stakeUsd} model; shared market-side exposures are not deduplicated`}
              tone={selectedRaw >= 0 ? "good" : "warning"}
            />
          </section>

          <Card className="overflow-hidden">
            <CardHeader className="gap-2 border-b">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sigma className="h-4 w-4 text-cyan-400" />
                Average RAW net per selected cohort
              </CardTitle>
              <p className="text-muted-foreground text-xs leading-5">
                Daily selected-cohort RAW sum ÷ selected cohort count. This is a comparison chart,
                not a capital-deduplicated portfolio curve.
              </p>
            </CardHeader>
            <CardContent className="pt-5">
              <AverageRawChart
                cohorts={selectedCohorts}
                dayKeys={data.dayKeys}
                currentDay={data.currentDay}
                stakeMultiplier={stakeMultiplier}
              />
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="gap-4 border-b">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Filter className="h-4 w-4 text-cyan-400" />
                    Strategy inclusion roster
                  </CardTitle>
                  <p className="text-muted-foreground mt-1 text-xs leading-5">
                    All registered cohorts remain visible. Inclusion choices are saved in this
                    browser and do not alter the paper engine.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={selectVisible}>
                    Select visible
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={clearVisible}>
                    Clear visible
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-4">
                <div className="relative w-full max-w-md">
                  <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search strategies or registry keys…"
                    className="pl-9"
                    aria-label="Search under 35 cent strategy roster"
                  />
                </div>
                <Toggle
                  label="Seven-day cells"
                  value={rosterMetric}
                  onChange={setRosterMetric}
                  options={[
                    { value: "raw", label: "RAW net" },
                    { value: "trades", label: "Trade quantity" },
                    { value: "winRate", label: "Win rate" },
                  ]}
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1440px] text-xs tabular-nums">
                  <thead>
                    <tr className="bg-muted/15 text-muted-foreground border-b text-[10px] uppercase tracking-wider">
                      <PolymarketSortableHeader
                        column="included"
                        active={sort.key}
                        direction={sort.direction}
                        onSort={sortBy}
                        align="center"
                        className="w-20 px-3 py-2.5"
                      >
                        Include
                      </PolymarketSortableHeader>
                      <PolymarketSortableHeader
                        column="strategy"
                        active={sort.key}
                        direction={sort.direction}
                        onSort={sortBy}
                        initialDirection="asc"
                        className="bg-card sticky left-0 z-10 min-w-64 px-3 py-2.5"
                      >
                        Strategy
                      </PolymarketSortableHeader>
                      <PolymarketSortableHeader
                        column="timeframe"
                        active={sort.key}
                        direction={sort.direction}
                        onSort={sortBy}
                        align="center"
                        className="w-20 px-3 py-2.5"
                      >
                        TF
                      </PolymarketSortableHeader>
                      <PolymarketSortableHeader
                        column="n"
                        active={sort.key}
                        direction={sort.direction}
                        onSort={sortBy}
                        align="right"
                        className="w-20 px-3 py-2.5"
                      >
                        N
                      </PolymarketSortableHeader>
                      <PolymarketSortableHeader
                        column="winRate"
                        active={sort.key}
                        direction={sort.direction}
                        onSort={sortBy}
                        align="right"
                        className="w-20 px-3 py-2.5"
                      >
                        WR
                      </PolymarketSortableHeader>
                      {data.dayKeys.map((day) => (
                        <PolymarketSortableHeader
                          key={day}
                          column={`day:${day}`}
                          active={sort.key}
                          direction={sort.direction}
                          onSort={sortBy}
                          align="right"
                          className="min-w-28 px-3 py-2.5"
                        >
                          <span>
                            {dayLabel(day)}
                            {day === data.currentDay ? (
                              <span className="ml-1 text-cyan-400">live</span>
                            ) : null}
                          </span>
                        </PolymarketSortableHeader>
                      ))}
                      <PolymarketSortableHeader
                        column="average"
                        active={sort.key}
                        direction={sort.direction}
                        onSort={sortBy}
                        align="right"
                        className="min-w-28 px-3 py-2.5"
                        title={
                          rosterMetric === "raw"
                            ? "Seven-day modeled RAW divided by seven calendar days"
                            : rosterMetric === "trades"
                              ? "Seven-day trade count divided by seven calendar days"
                              : "Mean win rate across observed calendar days"
                        }
                      >
                        {rosterMetric === "winRate" ? "Avg day WR" : "Avg / day"}
                      </PolymarketSortableHeader>
                      <PolymarketSortableHeader
                        column="rawNet"
                        active={sort.key}
                        direction={sort.direction}
                        onSort={sortBy}
                        align="right"
                        className="min-w-28 px-3 py-2.5"
                      >
                        {rosterMetric === "raw"
                          ? "7d RAW"
                          : rosterMetric === "trades"
                            ? "7d trades"
                            : "7d WR"}
                      </PolymarketSortableHeader>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedCohorts.map((cohort) => {
                      const included = selectedKeys.has(cohort.key);
                      return (
                        <tr
                          key={cohort.key}
                          className={`border-b last:border-b-0 ${
                            included ? "bg-cyan-400/[0.025]" : "opacity-55"
                          }`}
                        >
                          <td className="px-3 py-2.5 text-center">
                            <button
                              type="button"
                              onClick={() => toggleCohort(cohort.key)}
                              role="checkbox"
                              aria-checked={included}
                              aria-label={`${included ? "Exclude" : "Include"} ${cohort.name} ${cohort.horizonMin} minute`}
                              className={`mx-auto flex h-5 w-5 items-center justify-center rounded border transition-colors ${
                                included
                                  ? "border-cyan-400 bg-cyan-400 text-slate-950"
                                  : "border-input bg-background hover:border-cyan-400/70"
                              }`}
                            >
                              {included ? <Check className="h-3.5 w-3.5" /> : null}
                            </button>
                          </td>
                          <th className="bg-card sticky left-0 z-10 px-3 py-2.5 text-left font-medium">
                            <Link
                              to="/polymarket/strategy/$botKey"
                              params={{ botKey: cohort.botKey }}
                              search={{ horizon: cohort.horizonMin, scope }}
                              className="hover:underline"
                            >
                              <span
                                className="mr-2 inline-block h-2 w-2 rounded-full"
                                style={{ backgroundColor: cohort.color }}
                              />
                              {cohort.name}
                            </Link>
                            {cohort.control ? (
                              <span className="text-muted-foreground ml-2 text-[10px] font-normal uppercase tracking-wider">
                                control
                              </span>
                            ) : null}
                          </th>
                          <td className="px-3 py-2.5 text-center font-medium">
                            {cohort.horizonMin}m
                          </td>
                          <td className="px-3 py-2.5 text-right">{cohort.n.toLocaleString()}</td>
                          <td className="px-3 py-2.5 text-right">{pct(cohort.winRate)}</td>
                          {data.dayKeys.map((day) => {
                            const cell = cohort.days.find((candidate) => candidate.day === day);
                            const value = dailyRosterValue(cohort, day);
                            return (
                              <td
                                key={day}
                                className={`px-3 py-2.5 text-right ${
                                  !cell?.observed
                                    ? "text-muted-foreground"
                                    : rosterMetric === "raw"
                                      ? (value ?? 0) >= 0
                                        ? "bg-success/[0.06] text-success"
                                        : "bg-destructive/[0.06] text-destructive"
                                      : rosterMetric === "winRate"
                                        ? "bg-cyan-400/[0.04] text-cyan-400"
                                        : ""
                                }`}
                                title={
                                  cell?.observed
                                    ? `${cell.n} decisions · ${pct(cell.winRate)} WR · ${signedMoney(cell.rawNet * stakeMultiplier)} modeled RAW at $${stakeUsd}`
                                    : "No graded decision below 35¢"
                                }
                              >
                                {cell?.observed ? rosterValueLabel(value) : "—"}
                              </td>
                            );
                          })}
                          <td
                            className={`px-3 py-2.5 text-right ${
                              rosterMetric === "raw"
                                ? (averageRosterValue(cohort) ?? 0) >= 0
                                  ? "text-success"
                                  : "text-destructive"
                                : rosterMetric === "winRate"
                                  ? "text-cyan-400"
                                  : ""
                            }`}
                          >
                            {rosterValueLabel(
                              averageRosterValue(cohort),
                              rosterMetric === "trades" ? 1 : 0,
                            )}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-right font-semibold ${
                              rosterMetric === "raw"
                                ? (totalRosterValue(cohort) ?? 0) >= 0
                                  ? "text-success"
                                  : "text-destructive"
                                : rosterMetric === "winRate"
                                  ? "text-cyan-400"
                                  : ""
                            }`}
                          >
                            {rosterValueLabel(totalRosterValue(cohort))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!sortedCohorts.length ? (
                <div className="text-muted-foreground p-10 text-center text-sm">
                  No registered cohort matches this search.
                </div>
              ) : null}
              <div className="text-muted-foreground border-t px-5 py-4 text-xs leading-5">
                {data.methodology.table} {data.methodology.overlap} {data.methodology.selection}
                {stakeUsd === 5
                  ? " Dollar values use the captured $5 book walk."
                  : ` Dollar values are a ${stakeMultiplier}× linear $${stakeUsd} model from the captured $5 book walk and do not include deeper-book slippage.`}
              </div>
            </CardContent>
          </Card>

          <Under35TradeHistory
            history={historyQuery.data}
            trades={selectedTrades}
            loading={historyQuery.isLoading}
            failed={historyQuery.isError}
            selectedCohortCount={selectedCohorts.length}
            scope={scope}
            stakeUsd={stakeUsd}
            groupMode={groupMode}
            onGroupModeChange={setGroupMode}
          />
        </>
      )}
    </div>
  );
}
