import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Activity, CalendarDays, Clock3, Compass, Filter, Layers3 } from "lucide-react";
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

type ScopeKey = "paper" | "forward" | "history";
type PeriodKey = "24h" | "3d" | "7d" | "30d" | "all";
type TimeframeKey = "split" | "5" | "15" | "combined";
type MetricKey = "profitStress" | "pnl" | "netPerBet" | "residualPerBet" | "winRate";
type SegmentSortKey = "slice" | "n" | "days" | "winRate" | "pnl" | "residual" | "stress";
type CohortSortKey =
  | "rank"
  | "strategy"
  | "timeframe"
  | "gate"
  | "n"
  | "days"
  | "winRate"
  | "netPerBet"
  | "residual"
  | "pnl"
  | "stress";

type Cohort = {
  key: string;
  botKey: string;
  name: string;
  color: string;
  horizonMin: number | null;
  control: boolean;
  n: number;
  wins: number;
  losses: number;
  winRate: number | null;
  pnl: number;
  profitStress: number;
  netPerBet: number | null;
  pairedN: number;
  residual: number;
  residualPerBet: number | null;
  firstAtMs: number | null;
  lastAtMs: number | null;
  activeDays: number;
};

export type PolymarketPerformanceSegment = {
  dimension:
    | "day"
    | "hour"
    | "session"
    | "weekday"
    | "asset"
    | "side"
    | "ask"
    | "macro"
    | "technical"
    | "freshness";
  key: string;
  n: number;
  activeDays: number;
  wins: number;
  losses: number;
  winRate: number | null;
  pnl: number;
  profitStress: number;
  netPerBet: number | null;
  pairedN: number;
  residual: number;
  residualPerBet: number | null;
};

const usd = (value: number | null | undefined) =>
  value == null ? "—" : `${value < 0 ? "-" : "+"}$${Math.abs(value).toFixed(2)}`;
const pct = (value: number | null | undefined) =>
  value == null ? "—" : `${Math.round(value * 100)}%`;
const metricValue = (row: Cohort, metric: MetricKey) => row[metric] ?? Number.NEGATIVE_INFINITY;
const metricLabel: Record<MetricKey, string> = {
  profitStress: "Profit stress −36%",
  pnl: "Raw net",
  netPerBet: "Net / bet",
  residualPerBet: "Vs control",
  winRate: "Win rate",
};
const DOW = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function combineCohorts(rows: Cohort[]): Cohort[] {
  const byBot = new Map<string, Cohort>();
  for (const row of rows) {
    const current = byBot.get(row.botKey);
    if (!current) {
      byBot.set(row.botKey, { ...row, key: `${row.botKey}:combined`, horizonMin: null });
      continue;
    }
    const n = current.n + row.n;
    const wins = current.wins + row.wins;
    current.n = n;
    current.wins = wins;
    current.losses += row.losses;
    current.pnl += row.pnl;
    current.profitStress += row.profitStress;
    current.winRate = n ? wins / n : null;
    current.netPerBet = n ? current.pnl / n : null;
    current.pairedN += row.pairedN;
    current.residual += row.residual;
    current.residualPerBet = current.pairedN ? current.residual / current.pairedN : null;
    current.firstAtMs =
      current.firstAtMs == null
        ? row.firstAtMs
        : row.firstAtMs == null
          ? current.firstAtMs
          : Math.min(current.firstAtMs, row.firstAtMs);
    current.lastAtMs =
      current.lastAtMs == null
        ? row.lastAtMs
        : row.lastAtMs == null
          ? current.lastAtMs
          : Math.max(current.lastAtMs, row.lastAtMs);
    current.activeDays = Math.max(current.activeDays, row.activeDays);
  }
  return [...byBot.values()];
}

export function PolymarketSegmentTable({
  title,
  icon,
  rows,
  label,
  stakeScale = 1,
}: {
  title: string;
  icon: React.ReactNode;
  rows: PolymarketPerformanceSegment[];
  label: (row: PolymarketPerformanceSegment) => React.ReactNode;
  stakeScale?: number;
}) {
  const [sort, setSort] = useState<SortState<SegmentSortKey>>({
    key: "slice",
    direction: "asc",
  });
  const value = (row: PolymarketPerformanceSegment, key: SegmentSortKey): SortValue =>
    ({
      slice: row.key,
      n: row.n,
      days: row.activeDays,
      winRate: row.winRate,
      pnl: row.pnl,
      residual: row.residualPerBet,
      stress: row.profitStress,
    })[key];
  const sortedRows = stableSortRows(rows, (row) => value(row, sort.key), sort.direction);
  const onSort = (key: SegmentSortKey, initialDirection: "asc" | "desc" = "desc") =>
    setSort((current) => nextSortState(current, key, initialDirection));

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="bg-muted/15 flex items-center gap-2 border-b px-3 py-2 text-xs font-medium">
        {icon}
        {title}
      </div>
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="text-muted-foreground border-b text-[10px] uppercase tracking-wider">
            <PolymarketSortableHeader
              column="slice"
              active={sort.key}
              direction={sort.direction}
              onSort={onSort}
              initialDirection="asc"
              className="px-3 py-1.5 font-medium"
            >
              Slice
            </PolymarketSortableHeader>
            <PolymarketSortableHeader
              column="n"
              active={sort.key}
              direction={sort.direction}
              onSort={onSort}
              align="right"
              className="px-2 py-1.5 font-medium"
            >
              N
            </PolymarketSortableHeader>
            <PolymarketSortableHeader
              column="days"
              active={sort.key}
              direction={sort.direction}
              onSort={onSort}
              align="right"
              className="px-2 py-1.5 font-medium"
            >
              Days
            </PolymarketSortableHeader>
            <PolymarketSortableHeader
              column="winRate"
              active={sort.key}
              direction={sort.direction}
              onSort={onSort}
              align="right"
              className="px-2 py-1.5 font-medium"
            >
              WR
            </PolymarketSortableHeader>
            <PolymarketSortableHeader
              column="pnl"
              active={sort.key}
              direction={sort.direction}
              onSort={onSort}
              align="right"
              className="px-2 py-1.5 font-medium"
            >
              Net
            </PolymarketSortableHeader>
            <PolymarketSortableHeader
              column="residual"
              active={sort.key}
              direction={sort.direction}
              onSort={onSort}
              align="right"
              className="px-2 py-1.5 font-medium"
            >
              Vs ctrl
            </PolymarketSortableHeader>
            <PolymarketSortableHeader
              column="stress"
              active={sort.key}
              direction={sort.direction}
              onSort={onSort}
              align="right"
              className="px-3 py-1.5 font-medium"
              title="Legacy sensitivity only; winning profit is reduced by 36%."
            >
              Stress −36%
            </PolymarketSortableHeader>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => {
            const immature = row.n < 10 || (row.dimension !== "day" && row.activeDays < 2);
            return (
              <tr
                key={`${row.dimension}:${row.key}`}
                className={`border-b last:border-0 ${immature ? "opacity-45" : ""}`}
              >
                <td className="px-3 py-1.5">{label(row)}</td>
                <td className="px-2 py-1.5 text-right">{row.n}</td>
                <td className="px-2 py-1.5 text-right">{row.activeDays}</td>
                <td className="px-2 py-1.5 text-right">{pct(row.winRate)}</td>
                <td
                  className={`px-2 py-1.5 text-right ${row.pnl > 0 ? "text-success" : row.pnl < 0 ? "text-destructive" : ""}`}
                >
                  {usd(row.pnl * stakeScale)}
                </td>
                <td
                  className={`px-2 py-1.5 text-right ${Number(row.residualPerBet) > 0 ? "text-success" : Number(row.residualPerBet) < 0 ? "text-destructive" : ""}`}
                >
                  {row.residualPerBet == null
                    ? "—"
                    : `${row.residualPerBet >= 0 ? "+" : ""}${(row.residualPerBet * stakeScale * 100).toFixed(1)}¢`}
                </td>
                <td
                  className={`px-3 py-1.5 text-right ${row.profitStress > 0 ? "text-success" : row.profitStress < 0 ? "text-destructive" : ""}`}
                >
                  {usd(row.profitStress * stakeScale)}
                </td>
              </tr>
            );
          })}
          {!rows.length && (
            <tr>
              <td colSpan={7} className="text-muted-foreground px-3 py-6 text-center">
                No graded rows.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

type TimeframeGate = {
  version: string;
  constants: { evalStartMs: number };
  bots: {
    key: string;
    state: string;
    decisions: number;
    pairedBookDecisions: number;
    resolvedDecisions: number;
    bets: number;
    markets: number;
    spanDays: number;
  }[];
};

type FamilywiseGate = {
  version: string;
  constants: { evalStartMs: number };
  familySize: number;
  hypotheses: TimeframeGate["bots"];
};

export function PolymarketPerformanceLens({
  scope,
  familywiseGate,
}: {
  scope: ScopeKey;
  familywiseGate: FamilywiseGate;
}) {
  const [period, setPeriod] = useState<PeriodKey>(() => {
    const saved = localStorage.getItem("scoreboard.period") as PeriodKey | null;
    return saved && ["24h", "3d", "7d", "30d", "all"].includes(saved) ? saved : "all";
  });
  const [timeframe, setTimeframe] = useState<TimeframeKey>(() => {
    const saved = localStorage.getItem("scoreboard.timeframe") as TimeframeKey | null;
    return saved && ["split", "5", "15", "combined"].includes(saved) ? saved : "split";
  });
  const [metric, setMetric] = useState<MetricKey>(() => {
    const saved = localStorage.getItem("scoreboard.performanceMetric");
    if (saved === "worst") return "profitStress";
    return saved &&
      ["profitStress", "pnl", "netPerBet", "residualPerBet", "winRate"].includes(saved)
      ? (saved as MetricKey)
      : "residualPerBet";
  });
  const [selectedKey, setSelectedKey] = useState<string | null>(() =>
    localStorage.getItem("scoreboard.segmentCohort"),
  );
  const [cohortSort, setCohortSort] = useState<SortState<CohortSortKey>>({
    key: "rank",
    direction: "asc",
  });
  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago",
    [],
  );
  const [selectedBotKey, selectedHorizon] = selectedKey?.split(":") ?? [];
  const segmentHorizonMin =
    selectedHorizon === "5" || selectedHorizon === "15"
      ? (Number(selectedHorizon) as 5 | 15)
      : undefined;
  const query = trpc.polymarket.performance.useQuery(
    {
      scope,
      period,
      timezone,
      segmentBotKey: selectedBotKey || undefined,
      segmentHorizonMin,
    },
    {
      staleTime: 30_000,
      refetchInterval: 60_000,
    },
  );

  const data = query.data;
  const cohorts = (data?.cohorts ?? []) as Cohort[];
  const displayed =
    timeframe === "combined"
      ? combineCohorts(cohorts)
      : cohorts.filter(
          (row) =>
            timeframe === "split" ||
            (timeframe === "5" && row.horizonMin === 5) ||
            (timeframe === "15" && row.horizonMin === 15),
        );
  const ranked = [...displayed].sort((a, b) => {
    if (a.control !== b.control) return a.control ? 1 : -1;
    if (a.n >= 10 !== b.n >= 10) return a.n >= 10 ? -1 : 1;
    return metricValue(b, metric) - metricValue(a, metric);
  });
  const actualSelectedKey = data?.selectedKey ?? null;
  const segments = (data?.segments ?? []) as PolymarketPerformanceSegment[];
  const byDimension = (dimension: PolymarketPerformanceSegment["dimension"]) =>
    segments.filter((row) => row.dimension === dimension);
  const dayRows = byDimension("day").sort((a, b) => b.key.localeCompare(a.key));
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
  const macroRows = ordered("macro", ["UP", "DOWN", "RANGE", "NEUTRAL", "UNAVAILABLE"]);
  const technicalRows = ordered("technical", [
    "Trend",
    "Chop",
    "Compression",
    "Neutral",
    "Unavailable",
  ]);
  const freshnessRows = ordered("freshness", ["<2s", "2–5s", "5–15s", "15s+", "Unavailable"]);
  const askRows = ordered("ask", ["<35¢", "35–49¢", "50–64¢", "65¢+"]);
  const sessions = ordered("session", ["00–06", "06–12", "12–18", "18–24"]);
  const selected = cohorts.find((row) => row.key === actualSelectedKey);
  const splitGateByKey = new Map(familywiseGate.hypotheses.map((row) => [row.key, row] as const));
  const cohortRankByKey = new Map(ranked.map((row, index) => [row.key, index]));
  const cohortValue = (row: Cohort, key: CohortSortKey): SortValue => {
    const splitGate = splitGateByKey.get(row.key);
    const gateState = row.control
      ? "control"
      : row.horizonMin == null
        ? "pooled"
        : scope !== "forward" || period !== "all"
          ? "diagnostic"
          : (splitGate?.state ?? "waiting");
    return {
      rank: cohortRankByKey.get(row.key),
      strategy: row.name,
      timeframe: row.horizonMin,
      gate: gateState,
      n: row.n,
      days: row.activeDays,
      winRate: row.winRate,
      netPerBet: row.netPerBet,
      residual: row.residualPerBet,
      pnl: row.pnl,
      stress: row.profitStress,
    }[key];
  };
  const cohortRows = stableSortRows(
    ranked,
    (row) => cohortValue(row, cohortSort.key),
    cohortSort.direction,
  );
  const sortCohorts = (key: CohortSortKey, initialDirection: "asc" | "desc" = "desc") =>
    setCohortSort((current) => nextSortState(current, key, initialDirection));

  const choose = (key: string) => {
    setSelectedKey(key);
    localStorage.setItem("scoreboard.segmentCohort", key);
  };
  const choosePeriod = (next: PeriodKey) => {
    setPeriod(next);
    localStorage.setItem("scoreboard.period", next);
  };
  const chooseTimeframe = (next: TimeframeKey) => {
    setTimeframe(next);
    localStorage.setItem("scoreboard.timeframe", next);
  };
  const chooseMetric = (next: MetricKey) => {
    setMetric(next);
    localStorage.setItem("scoreboard.performanceMetric", next);
  };

  return (
    <Card className="overflow-hidden shadow-none">
      <CardHeader className="border-b p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers3 className="text-muted-foreground h-4 w-4" />
              Strategy × timeframe performance
            </CardTitle>
            <p className="text-muted-foreground mt-1 max-w-3xl text-xs leading-relaxed">
              Every strategy is shown separately at 5m and 15m. N, win rate, and net retain the
              selected historical scope for context; the Familywise gate column alone reports each
              independent prospective verdict from its frozen boundary. Click a row to inspect
              calendar, time-of-day, weekday, macro/technical regime, asset, side, price, and
              signal-freshness behavior. Those slices remain diagnostic.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-xs">
            <div>
              <div className="text-muted-foreground mb-1 text-[10px] uppercase tracking-wider">
                Period
              </div>
              <div className="bg-muted/10 flex rounded-md border p-0.5">
                {(["24h", "3d", "7d", "30d", "all"] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => choosePeriod(key)}
                    className={`rounded px-2 py-1 ${period === key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {key === "all" ? "All" : key}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground mb-1 text-[10px] uppercase tracking-wider">
                Timeframe rows
              </div>
              <div className="bg-muted/10 flex rounded-md border p-0.5">
                {(
                  [
                    ["split", "5m + 15m"],
                    ["5", "5m"],
                    ["15", "15m"],
                    ["combined", "Pooled"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => chooseTimeframe(key)}
                    className={`rounded px-2 py-1 ${timeframe === key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {query.isLoading ? (
          <div className="text-muted-foreground p-8 text-center text-sm">
            Loading performance cohorts…
          </div>
        ) : query.error || !data ? (
          <div className="text-destructive p-8 text-center text-sm">
            Performance lens unavailable; no zero-filled substitute is shown.
          </div>
        ) : (
          <>
            <div className="bg-muted/10 text-muted-foreground flex flex-wrap items-center gap-2 border-b px-4 py-2 text-[11px]">
              <Filter className="h-3.5 w-3.5" />
              <span>
                {data.authoritative
                  ? "Frozen forward population"
                  : "Diagnostic filtered population"}
              </span>
              <span>·</span>
              <span>{timezone}</span>
              <span>·</span>
              <span>
                {data.fromMs == null
                  ? "all captured history"
                  : `from ${new Date(data.fromMs).toLocaleString()}`}
              </span>
              <span>·</span>
              <span>
                familywise gate starts{" "}
                {new Date(familywiseGate.constants.evalStartMs).toLocaleString()}
              </span>
              <span>· {familywiseGate.familySize} frozen hypotheses</span>
              <span className="ml-auto">{data.note}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1 border-b px-4 py-2 text-xs">
              <span className="text-muted-foreground mr-1">Rank:</span>
              {(Object.keys(metricLabel) as MetricKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => chooseMetric(key)}
                  className={`rounded-md border px-2 py-1 ${metric === key ? "border-foreground/30 bg-muted font-medium" : "text-muted-foreground"}`}
                >
                  {metricLabel[key]}
                </button>
              ))}
            </div>
            <div className="max-h-[34rem] overflow-auto">
              <table className="w-full min-w-[900px] text-sm tabular-nums">
                <thead className="bg-card text-muted-foreground sticky top-0 z-10 border-b text-[10px] uppercase tracking-wider">
                  <tr>
                    <PolymarketSortableHeader
                      column="rank"
                      active={cohortSort.key}
                      direction={cohortSort.direction}
                      onSort={sortCohorts}
                      initialDirection="asc"
                      className="px-4 py-2 font-medium"
                    >
                      #
                    </PolymarketSortableHeader>
                    <PolymarketSortableHeader
                      column="strategy"
                      active={cohortSort.key}
                      direction={cohortSort.direction}
                      onSort={sortCohorts}
                      initialDirection="asc"
                      className="px-3 py-2 font-medium"
                    >
                      Strategy
                    </PolymarketSortableHeader>
                    <PolymarketSortableHeader
                      column="timeframe"
                      active={cohortSort.key}
                      direction={cohortSort.direction}
                      onSort={sortCohorts}
                      initialDirection="asc"
                      className="px-3 py-2 font-medium"
                    >
                      TF
                    </PolymarketSortableHeader>
                    <PolymarketSortableHeader
                      column="gate"
                      active={cohortSort.key}
                      direction={cohortSort.direction}
                      onSort={sortCohorts}
                      initialDirection="asc"
                      className="px-3 py-2 font-medium"
                    >
                      Familywise gate
                    </PolymarketSortableHeader>
                    <PolymarketSortableHeader
                      column="n"
                      active={cohortSort.key}
                      direction={cohortSort.direction}
                      onSort={sortCohorts}
                      align="right"
                      className="px-3 py-2 font-medium"
                    >
                      N
                    </PolymarketSortableHeader>
                    <PolymarketSortableHeader
                      column="days"
                      active={cohortSort.key}
                      direction={cohortSort.direction}
                      onSort={sortCohorts}
                      align="right"
                      className="px-3 py-2 font-medium"
                    >
                      Days
                    </PolymarketSortableHeader>
                    <PolymarketSortableHeader
                      column="winRate"
                      active={cohortSort.key}
                      direction={cohortSort.direction}
                      onSort={sortCohorts}
                      align="right"
                      className="px-3 py-2 font-medium"
                    >
                      Win
                    </PolymarketSortableHeader>
                    <PolymarketSortableHeader
                      column="netPerBet"
                      active={cohortSort.key}
                      direction={cohortSort.direction}
                      onSort={sortCohorts}
                      align="right"
                      className="px-3 py-2 font-medium"
                    >
                      Net / bet
                    </PolymarketSortableHeader>
                    <PolymarketSortableHeader
                      column="residual"
                      active={cohortSort.key}
                      direction={cohortSort.direction}
                      onSort={sortCohorts}
                      align="right"
                      className="px-3 py-2 font-medium"
                    >
                      Vs control
                    </PolymarketSortableHeader>
                    <PolymarketSortableHeader
                      column="pnl"
                      active={cohortSort.key}
                      direction={cohortSort.direction}
                      onSort={sortCohorts}
                      align="right"
                      className="px-3 py-2 font-medium"
                    >
                      Raw net
                    </PolymarketSortableHeader>
                    <PolymarketSortableHeader
                      column="stress"
                      active={cohortSort.key}
                      direction={cohortSort.direction}
                      onSort={sortCohorts}
                      align="right"
                      className="px-4 py-2 font-medium"
                      title="Legacy sensitivity only; winning profit is reduced by 36%."
                    >
                      Stress −36%
                    </PolymarketSortableHeader>
                  </tr>
                </thead>
                <tbody>
                  {cohortRows.map((row) => {
                    const active = row.key === actualSelectedKey;
                    const splitGate = splitGateByKey.get(row.key);
                    const splitState = row.control
                      ? "control"
                      : row.horizonMin == null
                        ? "pooled"
                        : scope !== "forward" || period !== "all"
                          ? "diagnostic"
                          : (splitGate?.state ?? "waiting");
                    return (
                      <tr
                        key={row.key}
                        onClick={() => row.horizonMin && choose(row.key)}
                        className={`border-b last:border-0 ${row.n < 10 && !row.control ? "opacity-45" : ""} ${row.horizonMin ? "hover:bg-muted/20 cursor-pointer" : ""} ${active ? "bg-muted/30 outline-inset outline-foreground/15 outline outline-1" : ""}`}
                      >
                        <td className="text-muted-foreground px-4 py-2.5">
                          {row.control ? "C" : (cohortRankByKey.get(row.key) ?? 0) + 1}
                        </td>
                        <td className="px-3 py-2.5 font-medium">
                          <span
                            className="mr-2 inline-block h-2 w-2 rounded-full"
                            style={{ background: row.color }}
                          />
                          {row.horizonMin == null ? (
                            row.name
                          ) : (
                            <Link
                              to="/polymarket/strategy/$botKey"
                              params={{ botKey: row.botKey }}
                              search={{
                                scope,
                                period,
                                horizon: row.horizonMin === 15 ? 15 : 5,
                              }}
                              onClick={(event) => event.stopPropagation()}
                              className="hover:text-primary focus-visible:ring-ring rounded-sm transition-colors hover:underline hover:underline-offset-2 focus-visible:outline-none focus-visible:ring-2"
                            >
                              {row.name}
                            </Link>
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs">
                          {row.horizonMin == null ? "ALL" : `${row.horizonMin}m`}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                              splitState === "passing"
                                ? "border-success/30 bg-success/10 text-success"
                                : splitState === "failing"
                                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                                  : "border-border bg-muted/40 text-muted-foreground"
                            }`}
                          >
                            {splitState}
                          </span>
                          {splitGate && row.horizonMin != null && (
                            <div className="text-muted-foreground mt-1 text-[10px]">
                              {splitGate.decisions.toLocaleString()} captured ·{" "}
                              {splitGate.bets.toLocaleString()} graded pair
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right">{row.n}</td>
                        <td className="px-3 py-2.5 text-right">{row.activeDays}</td>
                        <td className="px-3 py-2.5 text-right">{pct(row.winRate)}</td>
                        <td
                          className={`px-3 py-2.5 text-right ${Number(row.netPerBet) > 0 ? "text-success" : Number(row.netPerBet) < 0 ? "text-destructive" : ""}`}
                        >
                          {usd(row.netPerBet)}
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right ${Number(row.residualPerBet) > 0 ? "text-success" : Number(row.residualPerBet) < 0 ? "text-destructive" : ""}`}
                        >
                          {row.residualPerBet == null
                            ? "—"
                            : `${row.residualPerBet >= 0 ? "+" : ""}${(row.residualPerBet * 100).toFixed(1)}¢`}
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right ${row.pnl > 0 ? "text-success" : row.pnl < 0 ? "text-destructive" : ""}`}
                        >
                          {usd(row.pnl)}
                        </td>
                        <td
                          className={`px-4 py-2.5 text-right font-medium ${row.profitStress > 0 ? "text-success" : row.profitStress < 0 ? "text-destructive" : ""}`}
                        >
                          {usd(row.profitStress)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {selected && (
              <div className="border-t p-4">
                <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <h3 className="text-sm font-semibold">
                    {selected.name} · {selected.horizonMin}m segmentation
                  </h3>
                  <span className="text-muted-foreground text-[11px]">
                    {selected.n} graded · {timezone} · cells under 10 or spanning fewer than 2 days
                    are muted
                  </span>
                </div>
                <div className="grid gap-3 xl:grid-cols-3">
                  <PolymarketSegmentTable
                    title="Calendar day"
                    icon={<CalendarDays className="text-muted-foreground h-3.5 w-3.5" />}
                    rows={dayRows}
                    label={(row) =>
                      new Date(`${row.key}T12:00:00`).toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })
                    }
                  />
                  <PolymarketSegmentTable
                    title="Time of day"
                    icon={<Clock3 className="text-muted-foreground h-3.5 w-3.5" />}
                    rows={sessions}
                    label={(row) => row.key}
                  />
                  <PolymarketSegmentTable
                    title="Day of week"
                    icon={<CalendarDays className="text-muted-foreground h-3.5 w-3.5" />}
                    rows={byDimension("weekday")}
                    label={(row) => DOW[Number(row.key)] ?? row.key}
                  />
                  <PolymarketSegmentTable
                    title="Macro direction"
                    icon={<Compass className="text-muted-foreground h-3.5 w-3.5" />}
                    rows={macroRows}
                    label={(row) => row.key}
                  />
                  <PolymarketSegmentTable
                    title="Technical regime"
                    icon={<Activity className="text-muted-foreground h-3.5 w-3.5" />}
                    rows={technicalRows}
                    label={(row) => row.key}
                  />
                  <PolymarketSegmentTable
                    title="Asset"
                    icon={<Layers3 className="text-muted-foreground h-3.5 w-3.5" />}
                    rows={byDimension("asset")}
                    label={(row) => (
                      <PolymarketAssetLink
                        asset={row.key}
                        scope={scope}
                        period={period}
                        horizonMin={selected?.horizonMin ?? undefined}
                      />
                    )}
                  />
                  <PolymarketSegmentTable
                    title="Chosen side"
                    icon={<Layers3 className="text-muted-foreground h-3.5 w-3.5" />}
                    rows={byDimension("side")}
                    label={(row) => row.key}
                  />
                  <PolymarketSegmentTable
                    title="Entry ask"
                    icon={<Layers3 className="text-muted-foreground h-3.5 w-3.5" />}
                    rows={askRows}
                    label={(row) => row.key}
                  />
                  <PolymarketSegmentTable
                    title="Signal freshness"
                    icon={<Clock3 className="text-muted-foreground h-3.5 w-3.5" />}
                    rows={freshnessRows}
                    label={(row) => row.key}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
