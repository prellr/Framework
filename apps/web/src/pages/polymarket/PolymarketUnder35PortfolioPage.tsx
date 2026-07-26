import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Filter, FlaskConical, Lock, Search, Sigma, WalletCards } from "lucide-react";
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
type SortKey =
  "included" | "strategy" | "timeframe" | "n" | "winRate" | "average" | "rawNet" | `day:${string}`;

const SELECTION_STORAGE_KEY = "alchemy.polymarket.under35.selected-cohorts.v1";

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
}: {
  cohorts: Cohort[];
  dayKeys: string[];
  currentDay: string;
}) {
  const values = dayKeys.map((day) => {
    const raw = cohorts.reduce(
      (sum, cohort) => sum + (cohort.days.find((cell) => cell.day === day)?.rawNet ?? 0),
      0,
    );
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

export function PolymarketUnder35PortfolioPage() {
  const [scope, setScope] = useState<ScopeKey>("paper");
  const [horizon, setHorizon] = useState<HorizonKey>("all");
  const [search, setSearch] = useState("");
  const [storedSelection, setStoredSelection] = useState<Set<string> | null>(readStoredSelection);
  const [sort, setSort] = useState<SortState<SortKey>>({
    key: "rawNet",
    direction: "desc",
  });

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

  const dayValue = (cohort: Cohort, day: string) =>
    cohort.days.find((cell) => cell.day === day)?.rawNet ?? null;
  const sortedCohorts = stableSortRows(
    visibleCohorts,
    (cohort) => {
      if (sort.key === "included") return selectedKeys.has(cohort.key);
      if (sort.key === "strategy") return cohort.name;
      if (sort.key === "timeframe") return cohort.horizonMin;
      if (sort.key === "n") return cohort.n;
      if (sort.key === "winRate") return cohort.winRate;
      if (sort.key === "average") return cohort.averageRawPerCalendarDay;
      if (sort.key === "rawNet") return cohort.rawNet;
      return dayValue(cohort, sort.key.slice(4));
    },
    sort.direction,
  );
  const sortBy = (key: SortKey, initialDirection: "asc" | "desc" = "desc") =>
    setSort((current) => nextSortState(current, key, initialDirection));

  const selectedN = selectedCohorts.reduce((sum, cohort) => sum + cohort.n, 0);
  const selectedWins = selectedCohorts.reduce((sum, cohort) => sum + cohort.wins, 0);
  const selectedRaw = selectedCohorts.reduce((sum, cohort) => sum + cohort.rawNet, 0);
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
            <span className="text-muted-foreground">Captured stake</span>
            <span className="font-semibold">$5 / decision</span>
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
          <div className="text-muted-foreground ml-auto text-right text-xs leading-5">
            {data
              ? `${selectedCohorts.length} of ${horizonCohorts.length} cohorts included`
              : "Loading exact registered roster…"}
            <br />
            America/Chicago · current day remains live
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
              note="row-summed seven-day RAW divided by included cohorts"
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
              note="diagnostic only; shared market-side exposures are not deduplicated"
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
              <div className="relative max-w-md">
                <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search strategies or registry keys…"
                  className="pl-9"
                  aria-label="Search under 35 cent strategy roster"
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
                        title="Seven-day RAW divided by seven calendar days"
                      >
                        Avg / day
                      </PolymarketSortableHeader>
                      <PolymarketSortableHeader
                        column="rawNet"
                        active={sort.key}
                        direction={sort.direction}
                        onSort={sortBy}
                        align="right"
                        className="min-w-28 px-3 py-2.5"
                      >
                        7d RAW
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
                            return (
                              <td
                                key={day}
                                className={`px-3 py-2.5 text-right ${
                                  !cell?.observed
                                    ? "text-muted-foreground"
                                    : cell.rawNet >= 0
                                      ? "bg-success/[0.06] text-success"
                                      : "bg-destructive/[0.06] text-destructive"
                                }`}
                                title={
                                  cell?.observed
                                    ? `${cell.n} decisions · ${pct(cell.winRate)} WR · ${signedMoney(cell.rawNet)} RAW`
                                    : "No graded decision below 35¢"
                                }
                              >
                                {cell?.observed ? signedMoney(cell.rawNet) : "—"}
                              </td>
                            );
                          })}
                          <td
                            className={`px-3 py-2.5 text-right ${
                              cohort.averageRawPerCalendarDay >= 0
                                ? "text-success"
                                : "text-destructive"
                            }`}
                          >
                            {signedMoney(cohort.averageRawPerCalendarDay)}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-right font-semibold ${
                              cohort.rawNet >= 0 ? "text-success" : "text-destructive"
                            }`}
                          >
                            {signedMoney(cohort.rawNet)}
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
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
