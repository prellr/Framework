import { useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  CircleDollarSign,
  Clock3,
  Gauge,
  Layers3,
  Lock,
  Network,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

type ScopeKey = "paper" | "forward" | "history";
type PeriodKey = "24h" | "3d" | "7d" | "30d" | "all";
type HorizonKey = "all" | 5 | 15;
type TrendMetric = "pnl" | "netPerBet" | "winRate" | "n";
type DimensionKey = "ask" | "macro" | "day" | "freshness";

const ASK_BUCKETS = ["<35¢", "35–49¢", "50–64¢", "65¢+"] as const;
const ASK_COLORS: Record<string, string> = {
  "<35¢": "#38bdf8",
  "35–49¢": "#2dd4bf",
  "50–64¢": "#a78bfa",
  "65¢+": "#f59e0b",
};

const money = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value)
    ? "—"
    : `${value < 0 ? "-" : ""}$${Math.abs(value).toFixed(digits)}`;
const signedMoney = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value)
    ? "—"
    : `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(digits)}`;
const pct = (value: number | null | undefined, digits = 1) =>
  value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
const bps = (value: number | null | undefined, digits = 1) =>
  value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(digits)} bps`;
const duration = (milliseconds: number | null | undefined) => {
  if (milliseconds == null || !Number.isFinite(milliseconds)) return "—";
  if (milliseconds < 1) return `${Math.round(milliseconds * 1_000)}µs`;
  return `${milliseconds.toFixed(milliseconds < 10 ? 1 : 0)}ms`;
};

const metricLabel: Record<TrendMetric, string> = {
  pnl: "Raw net",
  netPerBet: "Net / bet",
  winRate: "Win rate",
  n: "Decisions",
};

function Toggle<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border bg-background p-0.5">
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
    <div className="rounded-xl border bg-muted/10 p-4">
      <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-2 text-2xl font-semibold tabular-nums ${
          tone === "good" ? "text-success" : tone === "warning" ? "text-warning" : ""
        }`}
      >
        {value}
      </div>
      <div className="mt-1 text-xs leading-5 text-muted-foreground">{note}</div>
    </div>
  );
}

type TrendRow = {
  botKey: string;
  name: string;
  color: string;
  horizonMin: 5 | 15;
  day: string;
  askBucket: string;
  n: number;
  wins: number;
  winRate: number | null;
  pnl: number;
  netPerBet: number | null;
};

function AskTrendChart({
  rows,
  metric,
}: {
  rows: TrendRow[];
  metric: TrendMetric;
}) {
  const series = useMemo(() => {
    const grouped = new Map<string, { day: string; bucket: string; n: number; wins: number; pnl: number }>();
    for (const row of rows) {
      const key = `${row.day}|${row.askBucket}`;
      const current = grouped.get(key) ?? {
        day: row.day,
        bucket: row.askBucket,
        n: 0,
        wins: 0,
        pnl: 0,
      };
      current.n += row.n;
      current.wins += row.wins;
      current.pnl += row.pnl;
      grouped.set(key, current);
    }
    return [...grouped.values()].map((row) => ({
      ...row,
      value:
        metric === "pnl"
          ? row.pnl
          : metric === "netPerBet"
            ? row.n
              ? row.pnl / row.n
              : 0
            : metric === "winRate"
              ? row.n
                ? row.wins / row.n
                : 0
              : row.n,
    }));
  }, [rows, metric]);
  const days = [...new Set(series.map((row) => row.day))].sort();

  if (!series.length) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        No graded entry-ask observations match this scope.
      </div>
    );
  }

  const width = 1_040;
  const height = 300;
  const margin = { top: 18, right: 24, bottom: 48, left: 72 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const values = series.map((row) => row.value);
  const minValue = metric === "winRate" || metric === "n" ? 0 : Math.min(0, ...values);
  const maxValue = Math.max(metric === "winRate" ? 1 : 0, ...values);
  const span = Math.max(1e-9, maxValue - minValue);
  const y = (value: number) => margin.top + ((maxValue - value) / span) * plotHeight;
  const zeroY = y(0);
  const dayWidth = plotWidth / Math.max(1, days.length);
  const groupWidth = Math.min(dayWidth * 0.78, 136);
  const barGap = 3;
  const barWidth = Math.max(5, (groupWidth - barGap * 3) / 4);
  const formatValue = (value: number) =>
    metric === "pnl"
      ? signedMoney(value)
      : metric === "netPerBet"
        ? signedMoney(value)
        : metric === "winRate"
          ? pct(value, 0)
          : Math.round(value).toLocaleString();
  const tickValues = [maxValue, minValue + span * 0.5, minValue];

  return (
    <div className="overflow-x-auto">
      <svg
        role="img"
        aria-label={`${metricLabel[metric]} by calendar day and entry ask`}
        viewBox={`0 0 ${width} ${height}`}
        className="min-w-[760px] w-full"
      >
        {tickValues.map((tick) => (
          <g key={tick}>
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
              {formatValue(tick)}
            </text>
          </g>
        ))}
        {days.map((day, dayIndex) => {
          const center = margin.left + dayWidth * (dayIndex + 0.5);
          const groupStart = center - groupWidth / 2;
          return (
            <g key={day}>
              {ASK_BUCKETS.map((bucket, bucketIndex) => {
                const row = series.find((item) => item.day === day && item.bucket === bucket);
                const value = row?.value ?? 0;
                const valueY = y(value);
                const top = Math.min(valueY, zeroY);
                const barHeight = Math.max(row ? 2 : 0, Math.abs(valueY - zeroY));
                return (
                  <rect
                    key={bucket}
                    x={groupStart + bucketIndex * (barWidth + barGap)}
                    y={top}
                    width={barWidth}
                    height={barHeight}
                    rx={2}
                    fill={ASK_COLORS[bucket]}
                    opacity={row ? 0.9 : 0.12}
                  >
                    <title>
                      {`${day} · ${bucket} · ${formatValue(value)} · ${row?.n ?? 0} decisions · ${pct(
                        row?.n ? row.wins / row.n : null,
                        0,
                      )} win rate`}
                    </title>
                  </rect>
                );
              })}
              <text
                x={center}
                y={height - 18}
                textAnchor="middle"
                className="fill-muted-foreground text-[11px]"
              >
                {new Intl.DateTimeFormat("en-US", {
                  month: "short",
                  day: "numeric",
                  timeZone: "UTC",
                }).format(new Date(`${day}T12:00:00Z`))}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

type SegmentRow = {
  botKey: string;
  name: string;
  color: string;
  horizonMin: 5 | 15;
  dimension: DimensionKey;
  key: string;
  n: number;
  wins: number;
  winRate: number | null;
  pnl: number;
  netPerBet: number | null;
  avgAsk: number | null;
  avgFeeUsd: number | null;
  avgDepthBps: number | null;
};

const dimensionColumns = (dimension: DimensionKey, rows: SegmentRow[]) => {
  if (dimension === "ask") return [...ASK_BUCKETS];
  if (dimension === "macro") return ["UP", "DOWN", "RANGE", "NEUTRAL", "UNAVAILABLE"];
  if (dimension === "freshness") return ["<2s", "2–5s", "5–15s", "15s+", "UNAVAILABLE"];
  return [...new Set(rows.map((row) => row.key))].sort();
};

const displayMetric = (row: SegmentRow | undefined, metric: TrendMetric) => {
  if (!row) return "—";
  if (metric === "pnl") return signedMoney(row.pnl);
  if (metric === "netPerBet") return signedMoney(row.netPerBet);
  if (metric === "winRate") return pct(row.winRate, 0);
  return row.n.toLocaleString();
};

const heatValue = (row: SegmentRow | undefined, metric: TrendMetric) => {
  if (!row) return null;
  if (metric === "pnl") return row.pnl;
  if (metric === "netPerBet") return row.netPerBet;
  if (metric === "winRate") return row.winRate == null ? null : row.winRate - 0.5;
  return row.n;
};

function SegmentMatrix({
  rows,
  dimension,
  metric,
}: {
  rows: SegmentRow[];
  dimension: DimensionKey;
  metric: TrendMetric;
}) {
  const selected = rows.filter((row) => row.dimension === dimension);
  const columns = dimensionColumns(dimension, selected);
  const cohorts = [...new Map(
    selected.map((row) => [`${row.botKey}:${row.horizonMin}`, row]),
  ).values()].sort((left, right) => {
    const leftNet = selected
      .filter((row) => row.botKey === left.botKey && row.horizonMin === left.horizonMin)
      .reduce((sum, row) => sum + row.pnl, 0);
    const rightNet = selected
      .filter((row) => row.botKey === right.botKey && row.horizonMin === right.horizonMin)
      .reduce((sum, row) => sum + row.pnl, 0);
    return rightNet - leftNet || left.name.localeCompare(right.name);
  });
  const maxAbs = Math.max(
    1e-9,
    ...selected.map((row) => Math.abs(heatValue(row, metric) ?? 0)),
  );

  if (!cohorts.length) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No segment cells match this scope.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="min-w-[860px] w-full text-xs tabular-nums">
        <thead>
          <tr className="border-b bg-muted/15 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="sticky left-0 z-10 min-w-60 bg-card px-3 py-2 font-medium">
              Strategy × timeframe
            </th>
            {columns.map((column) => (
              <th key={column} className="min-w-28 px-3 py-2 text-right font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((cohort) => (
            <tr key={`${cohort.botKey}:${cohort.horizonMin}`} className="border-b last:border-b-0">
              <th className="sticky left-0 z-10 bg-card px-3 py-2.5 text-left font-medium">
                <span
                  className="mr-2 inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: cohort.color }}
                />
                {cohort.name}
                <span className="ml-2 text-muted-foreground">{cohort.horizonMin}m</span>
              </th>
              {columns.map((column) => {
                const cell = selected.find(
                  (row) =>
                    row.botKey === cohort.botKey
                    && row.horizonMin === cohort.horizonMin
                    && row.key === column,
                );
                const value = heatValue(cell, metric);
                const signed = metric !== "n";
                const positive = value != null && value >= 0;
                const intensity = value == null
                  ? 0
                  : metric === "n"
                    ? Math.min(0.24, 0.04 + 0.2 * (value / maxAbs))
                    : Math.min(0.28, 0.04 + 0.24 * (Math.abs(value) / maxAbs));
                const backgroundColor = value == null
                  ? undefined
                  : metric === "n"
                    ? `rgba(56, 189, 248, ${intensity})`
                    : positive
                      ? `rgba(34, 197, 94, ${intensity})`
                      : `rgba(239, 68, 68, ${intensity})`;
                return (
                  <td
                    key={column}
                    className={`px-3 py-2.5 text-right ${
                      value == null
                        ? "text-muted-foreground"
                        : signed
                          ? positive
                            ? "text-success"
                            : "text-destructive"
                          : ""
                    }`}
                    style={{ backgroundColor }}
                    title={
                      cell
                        ? `${cell.n} decisions · ${pct(cell.winRate, 0)} WR · ${signedMoney(
                            cell.pnl,
                          )} RAW · ask ${pct(cell.avgAsk, 1)}`
                        : "No graded decisions"
                    }
                  >
                    {displayMetric(cell, metric)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PolymarketExecutionCapital() {
  const [scope, setScope] = useState<ScopeKey>("paper");
  const [period, setPeriod] = useState<PeriodKey>("all");
  const [horizon, setHorizon] = useState<HorizonKey>("all");
  const [trendMetric, setTrendMetric] = useState<TrendMetric>("pnl");
  const [dimension, setDimension] = useState<DimensionKey>("ask");
  const [matrixMetric, setMatrixMetric] = useState<TrendMetric>("netPerBet");
  const [hiddenBots, setHiddenBots] = useState<Set<string>>(() => new Set());

  const execution = trpc.polymarket.executionCapital.useQuery(
    { scope, period, horizon, timezone: "America/Chicago" },
    { staleTime: 30_000, refetchInterval: 60_000 },
  );
  const capacity = trpc.polymarket.multiStakeCapacityTape.useQuery(undefined, {
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  const markout = trpc.polymarket.paperMarkoutTape.useQuery(undefined, {
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  const shadow = trpc.polymarket.shadowConnectorAudit.useQuery(undefined, {
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  const independence = trpc.polymarket.strategyIndependence.useQuery(undefined, {
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const data = execution.data;
  const botOptions = useMemo(
    () =>
      [...new Map(
        (data?.segments ?? []).map((row) => [row.botKey, {
          key: row.botKey,
          name: row.name,
          color: row.color,
        }]),
      ).values()].sort((left, right) => left.name.localeCompare(right.name)),
    [data],
  );
  const visibleTrend = (data?.askTrend ?? []).filter((row) => !hiddenBots.has(row.botKey));
  const visibleSegments = (data?.segments ?? []).filter((row) => !hiddenBots.has(row.botKey));

  if (execution.isLoading) {
    return (
      <div className="rounded-xl border p-8 text-sm text-muted-foreground">
        Building the paper execution and capital projection…
      </div>
    );
  }
  if (execution.isError || !data) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm">
        Execution evidence is unavailable. No zero-filled cost or capital values are being substituted.
      </div>
    );
  }

  const quote = data.quoteCosts;
  const capitalData = data.capital;
  const capacityData = capacity.data;
  const markoutData = markout.data;
  const shadowData = shadow.data;
  const independenceData = independence.data;
  const capacityReady = capacityData?.readyForCapacityDistribution ?? false;

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border bg-gradient-to-br from-card via-card to-cyan-500/[0.04]">
        <div className="grid gap-6 p-5 lg:grid-cols-[1fr_auto] lg:items-start">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.2em] text-cyan-400">
              <ShieldCheck className="h-3.5 w-3.5" />
              Paper execution observatory
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">Execution &amp; Capital</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-muted-foreground">
              Separate captured quote economics from strategy results and portfolio assumptions.
              Depth and fee metrics deduplicate identical market-side snapshots; result charts retain
              each strategy decision and are diagnostic only.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border bg-background/70 px-3 py-2 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
            Paper only · no order route
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t bg-background/40 px-5 py-3">
          <Toggle
            value={scope}
            onChange={setScope}
            options={[
              { value: "paper", label: "Current paper" },
              { value: "forward", label: "Gate cohort" },
              { value: "history", label: "All history" },
            ]}
          />
          <Toggle
            value={horizon}
            onChange={setHorizon}
            options={[
              { value: "all", label: "5m + 15m" },
              { value: 5, label: "5m" },
              { value: 15, label: "15m" },
            ]}
          />
          <Toggle
            value={period}
            onChange={setPeriod}
            options={[
              { value: "24h", label: "24h" },
              { value: "3d", label: "3d" },
              { value: "7d", label: "7d" },
              { value: "30d", label: "30d" },
              { value: "all", label: "All" },
            ]}
          />
          <div className="ml-auto text-xs text-muted-foreground">
            {data.quoteCosts.quoteSamples.toLocaleString()} unique quote samples · America/Chicago
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MetricTile
          label="Execution coverage"
          value={pct(quote.executionCoverage)}
          note={`${quote.executionRows.toLocaleString()} fee-adjusted book walks`}
          tone={quote.executionCoverage >= 0.95 ? "good" : "warning"}
        />
        <MetricTile
          label="Median fee"
          value={money(quote.medianFeeUsd, 3)}
          note={`${bps(quote.medianFeeBps)} of contract price`}
        />
        <MetricTile
          label="P95 depth slippage"
          value={bps(quote.p95DepthBps)}
          note="gross VWAP minus captured top ask"
          tone={(quote.p95DepthBps ?? 0) > 500 ? "warning" : "neutral"}
        />
        <MetricTile
          label="Multi-level quotes"
          value={pct(quote.multilevelRate)}
          note={`${quote.multilevelRows.toLocaleString()} paper book walks consumed 2+ levels`}
        />
        <MetricTile
          label="Peak paper capital"
          value={money(capitalData.peakDeduplicatedCapitalUsd, 0)}
          note={`${pct(capitalData.deduplicationRate)} below naive strategy stacking`}
          tone="good"
        />
        <MetricTile
          label="Opposed markets"
          value={pct(capitalData.opposedMarketRate)}
          note={`${capitalData.opposedMarkets.toLocaleString()} markets had both sides`}
          tone={capitalData.opposedMarketRate > 0.5 ? "warning" : "neutral"}
        />
      </section>

      <Card>
        <CardHeader className="gap-4 border-b">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="h-4 w-4 text-cyan-400" />
                Entry-ask economics over time
              </CardTitle>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Strategy decisions are pooled for comparison, not summed as a deployable portfolio.
                The low-ask bucket can earn positive dollars with a low win rate because each winner
                buys more contracts per fixed $5 outlay.
              </p>
            </div>
            <Toggle
              value={trendMetric}
              onChange={setTrendMetric}
              options={[
                { value: "pnl", label: "Raw net" },
                { value: "netPerBet", label: "Net / bet" },
                { value: "winRate", label: "Win rate" },
                { value: "n", label: "Decisions" },
              ]}
            />
          </div>
          <details className="rounded-lg border bg-muted/10">
            <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium">
              <span className="inline-flex items-center gap-2">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Strategies · {botOptions.length - hiddenBots.size} of {botOptions.length} shown
              </span>
            </summary>
            <div className="flex flex-wrap gap-1.5 border-t px-3 py-3">
              <button
                type="button"
                className="rounded-full border px-2.5 py-1 text-[11px] hover:bg-muted"
                onClick={() => setHiddenBots(new Set())}
              >
                all
              </button>
              <button
                type="button"
                className="rounded-full border px-2.5 py-1 text-[11px] hover:bg-muted"
                onClick={() => setHiddenBots(new Set(botOptions.map((bot) => bot.key)))}
              >
                none
              </button>
              {botOptions.map((bot) => {
                const visible = !hiddenBots.has(bot.key);
                return (
                  <button
                    key={bot.key}
                    type="button"
                    aria-pressed={visible}
                    onClick={() =>
                      setHiddenBots((current) => {
                        const next = new Set(current);
                        if (next.has(bot.key)) next.delete(bot.key);
                        else next.add(bot.key);
                        return next;
                      })
                    }
                    className={`rounded-full border px-2.5 py-1 text-[11px] transition-opacity ${
                      visible ? "opacity-100" : "opacity-35"
                    }`}
                  >
                    <span
                      className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: bot.color }}
                    />
                    {bot.name}
                  </button>
                );
              })}
            </div>
          </details>
        </CardHeader>
        <CardContent className="pt-5">
          <AskTrendChart rows={visibleTrend as TrendRow[]} metric={trendMetric} />
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
            {ASK_BUCKETS.map((bucket) => (
              <span key={bucket} className="inline-flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-sm"
                  style={{ backgroundColor: ASK_COLORS[bucket] }}
                />
                {bucket}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-4 border-b">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Layers3 className="h-4 w-4 text-violet-400" />
                Cross-strategy diagnostic map
              </CardTitle>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Compare every visible strategy × timeframe under the same ask, macro, calendar, or
                freshness slices. Cells remain retrospective diagnostics and cannot alter a frozen gate.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Toggle
                value={dimension}
                onChange={setDimension}
                options={[
                  { value: "ask", label: "Entry ask" },
                  { value: "macro", label: "Macro" },
                  { value: "day", label: "Calendar day" },
                  { value: "freshness", label: "Freshness" },
                ]}
              />
              <Toggle
                value={matrixMetric}
                onChange={setMatrixMetric}
                options={[
                  { value: "netPerBet", label: "Net / bet" },
                  { value: "pnl", label: "Raw net" },
                  { value: "winRate", label: "Win rate" },
                  { value: "n", label: "N" },
                ]}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          <SegmentMatrix
            rows={visibleSegments as SegmentRow[]}
            dimension={dimension}
            metric={matrixMetric}
          />
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-base">
              <CircleDollarSign className="h-4 w-4 text-emerald-400" />
              Capital stacking
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <MetricTile
                label="Naive peak"
                value={money(capitalData.peakNaiveCapitalUsd, 0)}
                note="every strategy intent funded separately"
              />
              <MetricTile
                label="Deduplicated peak"
                value={money(capitalData.peakDeduplicatedCapitalUsd, 0)}
                note="same market + side netted to one $5 position"
                tone="good"
              />
              <MetricTile
                label="Duplicate intents"
                value={capitalData.sameSideDuplicateIntents.toLocaleString()}
                note={`${capitalData.sameSideSharedMarkets.toLocaleString()} markets shared a side`}
              />
              <MetricTile
                label="Unique positions"
                value={capitalData.uniquePositions.toLocaleString()}
                note={`${capitalData.markets.toLocaleString()} distinct markets`}
              />
            </div>
            <p className="rounded-lg border border-warning/20 bg-warning/5 p-3 text-xs leading-5 text-muted-foreground">
              Deduplication is a capital model, not an allocator. Opposite sides are deliberately not
              netted because they represent separate contracts and can still consume fees and liquidity.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="h-4 w-4 text-amber-400" />
              Stake capacity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            <div className="grid grid-cols-3 gap-3">
              <MetricTile
                label="$5"
                value="Captured"
                note="fee-adjusted book walk"
                tone="good"
              />
              <MetricTile
                label="$10"
                value={capacityReady ? "Reviewable" : "Collecting"}
                note="prospective same-book walk"
                tone={capacityReady ? "good" : "warning"}
              />
              <MetricTile
                label="$20"
                value={capacityReady ? "Reviewable" : "Collecting"}
                note="prospective same-book walk"
                tone={capacityReady ? "good" : "warning"}
              />
            </div>
            {capacityData ? (
              <div className="grid grid-cols-2 gap-x-5 gap-y-3 rounded-lg border p-3 text-xs">
                <div>
                  <div className="text-muted-foreground">Usable rows</div>
                  <div className="mt-1 font-medium tabular-nums">
                    {capacityData.usableRows.toLocaleString()} / {capacityData.rows.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Coverage</div>
                  <div className="mt-1 font-medium tabular-nums">{pct(capacityData.coverage)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Markets</div>
                  <div className="mt-1 font-medium tabular-nums">
                    {capacityData.markets.toLocaleString()} / {capacityData.minMarkets.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Observed span</div>
                  <div className="mt-1 font-medium tabular-nums">
                    {capacityData.spanDays.toFixed(2)} / {capacityData.minSpanDays}d
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Capacity tape status unavailable.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock3 className="h-4 w-4 text-sky-400" />
              30-second markout
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-5">
            {markoutData ? (
              <div className="space-y-3">
                <MetricTile
                  label="Terminal observations"
                  value={markoutData.terminalRows.toLocaleString()}
                  note={`${markoutData.markets.toLocaleString()} markets · ${markoutData.spanDays.toFixed(2)}d`}
                  tone={markoutData.readyForDescriptiveAudit ? "good" : "warning"}
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  {markoutData.readyForDescriptiveAudit
                    ? "The frozen count/span floor is met; descriptive execution-quality signs may be reviewed."
                    : `Signs remain locked until ${markoutData.minimums.terminalRows.toLocaleString()} rows, ${markoutData.minimums.markets.toLocaleString()} markets, and ${markoutData.minimums.spanDays} days are all observed.`}
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Markout tape status unavailable.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-teal-400" />
              Preparation latency
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-5">
            {shadowData ? (
              <div className="grid grid-cols-2 gap-3">
                <MetricTile
                  label="Prepared coverage"
                  value={pct(shadowData.preparedCoverage)}
                  note={`${shadowData.markets.toLocaleString()} markets`}
                  tone={shadowData.requirements.coverage ? "good" : "warning"}
                />
                <MetricTile
                  label="P95 preparation"
                  value={duration(
                    shadowData.preparationMicros.p95 == null
                      ? null
                      : shadowData.preparationMicros.p95 / 1_000,
                  )}
                  note={`P95 book age ${duration(shadowData.marketDataAgeMs.p95)}`}
                  tone={shadowData.requirements.p95Preparation ? "good" : "warning"}
                />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Shadow connector audit unavailable.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-base">
              <Network className="h-4 w-4 text-violet-400" />
              Strategy dependence
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-5">
            {independenceData ? (
              <div className="space-y-3">
                <MetricTile
                  label="Unexpected exact collisions"
                  value={independenceData.unexpectedExactCollisions.toLocaleString()}
                  note={`${independenceData.expectedStructuralPairs.toLocaleString()} expected structural pairs`}
                  tone={independenceData.unexpectedExactCollisions === 0 ? "good" : "warning"}
                />
                <div className="space-y-2">
                  {independenceData.pairs
                    .filter((pair) => pair.sharedMarkets >= 10)
                    .slice(0, 3)
                    .map((pair) => (
                      <div
                        key={`${pair.leftKey}:${pair.rightKey}`}
                        className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs"
                      >
                        <span className="truncate text-muted-foreground">
                          {pair.leftKey} ↔ {pair.rightKey}
                        </span>
                        <span className="shrink-0 font-medium tabular-nums">
                          {pct(pair.dependencyStrength)}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Overlap audit unavailable.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-base">Measurement contract</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 pt-5 text-xs leading-5 text-muted-foreground md:grid-cols-2 xl:grid-cols-4">
          <div>
            <div className="mb-1 font-medium text-foreground">Quote sample</div>
            {data.methodology.quoteSample}
          </div>
          <div>
            <div className="mb-1 font-medium text-foreground">Depth slippage</div>
            {data.methodology.depthSlippage}
          </div>
          <div>
            <div className="mb-1 font-medium text-foreground">Fee drag</div>
            {data.methodology.feeDrag}
          </div>
          <div>
            <div className="mb-1 font-medium text-foreground">What remains unknown</div>
            {data.methodology.limitations}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
