import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Database, Trophy } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { trpc } from "@/lib/trpc";
import type { RouterOutput } from "@framework/api/router";
import { pfLabel, pfRank, isInfinitePf } from "@/lib/metrics";

type Row = RouterOutput["results"]["query"][number];
const num = (v: string | null) => (v == null ? null : parseFloat(v));
const TF_MINUTES: Record<string, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "4h": 240,
  "1d": 1_440,
};

const TIMEFRAMES = ["all", "5m", "15m", "1h", "4h"];
const MIN_TRADE_OPTS = [0, 10, 20, 30];

/**
 * Analytics over the whole warehouse — focused on the winners: profit-factor and return
 * distributions, the risk/reward and quality (win-rate, sample-size) trade-offs, which assets
 * carry an edge, which strategies are robust across many assets, and a top-performers board.
 * All charts are self-contained SVG (no external lib) and theme-aware via currentColor.
 */
export function ChartsPage({ embedded }: { embedded?: boolean } = {}) {
  const q = trpc.results.query.useQuery({ limit: 2000 });
  const [tf, setTf] = useState("all");
  const [minTrades, setMinTrades] = useState(20);
  const [edgesOnly, setEdgesOnly] = useState(false);

  // Best row per (strategy, pair, timeframe) — one point per distinct backtest identity, so a
  // strategy re-run many times over the same window doesn't dominate the distribution.
  const best = useMemo(() => {
    const map = new Map<string, Row>();
    for (const r of q.data ?? []) {
      if (isInfinitePf(num(r.profitFactor))) continue; // drop ∞ PF (1-trade no-loss sentinel)
      const k = `${r.strategyId}|${r.pair}|${r.timeframe}`;
      const prev = map.get(k);
      if (!prev || (num(r.profitFactor) ?? -Infinity) > (num(prev.profitFactor) ?? -Infinity)) {
        map.set(k, r);
      }
    }
    return [...map.values()];
  }, [q.data]);

  const rows = useMemo(() => {
    return best.filter((r) => {
      if (tf !== "all" && r.timeframe !== tf) return false;
      if ((r.totalTrades ?? 0) < minTrades) return false;
      if (edgesOnly && (num(r.profitFactor) ?? 0) <= 1) return false;
      return true;
    });
  }, [best, tf, minTrades, edgesOnly]);

  if (q.data && q.data.length === 0) {
    return (
      <div className="space-y-6">
        {!embedded && <PageHeader title="Charts" subtitle="Visualize the warehouse." />}
        <EmptyState icon={Database} title="No backtests yet" description="Run backtests or a sweep — charts appear here." />
      </div>
    );
  }

  const edges = rows.filter((r) => (num(r.profitFactor) ?? 0) > 1).length;

  return (
    <div className="space-y-6">
      {!embedded && (
        <PageHeader
          title="Charts & Analytics"
          subtitle="The whole warehouse at a glance — profit factor, returns, quality and robustness of every distinct backtest (best per strategy · asset · timeframe). Use the filters to focus on statistically meaningful edges."
        />
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <FilterGroup label="Timeframe">
          {TIMEFRAMES.map((t) => (
            <Chip key={t} on={tf === t} onClick={() => setTf(t)}>{t}</Chip>
          ))}
        </FilterGroup>
        <FilterGroup label="Min trades">
          {MIN_TRADE_OPTS.map((n) => (
            <Chip key={n} on={minTrades === n} onClick={() => setMinTrades(n)}>{n === 0 ? "any" : `≥${n}`}</Chip>
          ))}
        </FilterGroup>
        <Chip on={edgesOnly} onClick={() => setEdgesOnly((v) => !v)}>edges only (PF&gt;1)</Chip>
        <span className="ml-auto text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{rows.length}</span> backtests ·{" "}
          <span className="font-semibold text-success">{edges}</span> edges
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={Database} title="Nothing matches these filters" description="Loosen the min-trades or edges filter." />
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard title="Profit-factor distribution">
              <Histogram rows={rows} value={(r) => num(r.profitFactor)} buckets={PF_BUCKETS} edgeAt={(v) => v >= 1} />
            </ChartCard>
            <ChartCard title="Return distribution">
              <Histogram rows={rows} value={(r) => num(r.totalReturn)} buckets={RET_BUCKETS} edgeAt={(v) => v >= 0} />
            </ChartCard>

            <ChartCard title="Return vs. max drawdown" note="Up & left is better — high return for low drawdown. Larger dots = PF > 1.2.">
              <Scatter
                rows={rows}
                x={(r) => Math.abs(num(r.maxDrawdown) ?? 0)}
                y={(r) => num(r.totalReturn)}
                size={(r) => ((num(r.profitFactor) ?? 0) > 1.2 ? 4.5 : 3)}
                good={(r) => (num(r.totalReturn) ?? 0) >= 0}
                xLabel="max drawdown %"
                yLabel="return %"
                yZero
              />
            </ChartCard>
            <ChartCard title="Win rate vs. profit factor" note="Top-right = wins often AND makes money. High PF with low win rate = a few big winners.">
              <Scatter
                rows={rows}
                x={(r) => num(r.winRate)}
                y={(r) => num(r.profitFactor)}
                good={(r) => (num(r.profitFactor) ?? 0) > 1}
                xLabel="win rate %"
                yLabel="profit factor"
                yRef={1}
                xRef={50}
              />
            </ChartCard>

            <ChartCard title="Sample size vs. profit factor" note="High PF on few trades is likely noise — amber dots clear PF>1 but on < 20 trades.">
              <Scatter
                rows={rows}
                x={(r) => Math.min(r.totalTrades ?? 0, 200)}
                y={(r) => num(r.profitFactor)}
                tone={(r) => {
                  const pf = num(r.profitFactor) ?? 0;
                  if (pf <= 1) return "bad";
                  return (r.totalTrades ?? 0) >= 20 ? "good" : "warn";
                }}
                xLabel="trades (capped 200)"
                yLabel="profit factor"
                yRef={1}
              />
            </ChartCard>
            <ChartCard title="Best profit factor by asset">
              <AssetBars rows={rows} />
            </ChartCard>
          </div>

          <ChartCard title="Most robust strategies" icon={Trophy} note="Strategies ranked by how many distinct assets they clear PF>1 on — breadth beats a single lucky asset.">
            <StrategyBreadth rows={rows} />
          </ChartCard>

          <ChartCard title="Top performers" icon={Trophy}>
            <Leaderboard rows={rows} />
          </ChartCard>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ layout */

function ChartCard({
  title,
  note,
  icon: Icon,
  children,
}: {
  title: string;
  note?: string;
  icon?: typeof Trophy;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {children}
        {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
      </CardContent>
    </Card>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        "transition-spring rounded-md border px-2.5 py-1 text-xs font-medium " +
        (on ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background text-muted-foreground hover:bg-accent")
      }
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ histogram */

interface Bucket {
  label: string;
  lo: number;
  hi: number;
}
const PF_BUCKETS: Bucket[] = [
  { label: "<0.8", lo: -Infinity, hi: 0.8 },
  { label: "0.8–1", lo: 0.8, hi: 1 },
  { label: "1–1.2", lo: 1, hi: 1.2 },
  { label: "1.2–1.5", lo: 1.2, hi: 1.5 },
  { label: "1.5–2", lo: 1.5, hi: 2 },
  { label: "2+", lo: 2, hi: Infinity },
];
const RET_BUCKETS: Bucket[] = [
  { label: "<-20%", lo: -Infinity, hi: -20 },
  { label: "-20–0", lo: -20, hi: 0 },
  { label: "0–20%", lo: 0, hi: 20 },
  { label: "20–50%", lo: 20, hi: 50 },
  { label: "50–100%", lo: 50, hi: 100 },
  { label: "100%+", lo: 100, hi: Infinity },
];

function Histogram({
  rows,
  value,
  buckets,
  edgeAt,
}: {
  rows: Row[];
  value: (r: Row) => number | null;
  buckets: Bucket[];
  edgeAt: (v: number) => boolean;
}) {
  const counts = buckets.map((b) => ({
    ...b,
    n: rows.filter((r) => {
      const v = value(r);
      return v != null && v >= b.lo && v < b.hi;
    }).length,
    edge: edgeAt(b.lo === -Infinity ? b.hi - 0.0001 : b.lo),
  }));
  const max = Math.max(1, ...counts.map((c) => c.n));
  const W = 640, H = 220, pad = { l: 32, r: 12, t: 12, b: 28 };
  const bw = (W - pad.l - pad.r) / counts.length;

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-56 w-full min-w-[420px]">
        {[0, 0.5, 1].map((f) => {
          const y = pad.t + (H - pad.t - pad.b) * (1 - f);
          return (
            <g key={f} className="text-border">
              <line x1={pad.l} y1={y} x2={W - pad.r} y2={y} stroke="currentColor" strokeWidth={1} strokeDasharray="2 3" />
              <text x={pad.l - 6} y={y + 3} textAnchor="end" className="fill-muted-foreground text-[9px]">{Math.round(max * f)}</text>
            </g>
          );
        })}
        {counts.map((c, i) => {
          const h = (H - pad.t - pad.b) * (c.n / max);
          const x = pad.l + i * bw;
          const y = H - pad.b - h;
          return (
            <g key={c.label} className={c.edge ? "text-success" : "text-destructive"}>
              <rect x={x + 6} y={y} width={bw - 12} height={h} rx={3} fill="currentColor" opacity={0.85} />
              {c.n > 0 && <text x={x + bw / 2} y={y - 4} textAnchor="middle" className="fill-foreground text-[10px] font-medium">{c.n}</text>}
              <text x={x + bw / 2} y={H - pad.b + 16} textAnchor="middle" className="fill-muted-foreground text-[10px]">{c.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ scatter */

type Tone = "good" | "bad" | "warn";
const TONE_CLASS: Record<Tone, string> = { good: "text-success", bad: "text-destructive", warn: "text-warning" };

function Scatter({
  rows,
  x,
  y,
  good,
  tone,
  size,
  xLabel,
  yLabel,
  yZero,
  yRef,
  xRef,
}: {
  rows: Row[];
  x: (r: Row) => number | null;
  y: (r: Row) => number | null;
  good?: (r: Row) => boolean;
  tone?: (r: Row) => Tone;
  size?: (r: Row) => number;
  xLabel: string;
  yLabel: string;
  yZero?: boolean;
  yRef?: number;
  xRef?: number;
}) {
  const pts = rows
    .map((r) => ({ x: x(r), y: y(r), r }))
    .filter((p) => p.x != null && p.y != null) as { x: number; y: number; r: Row }[];
  const W = 400, H = 300, pad = { l: 42, r: 12, t: 12, b: 34 };
  if (!pts.length) return <p className="py-8 text-center text-sm text-muted-foreground">No data.</p>;

  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const xMax = Math.max(...xs, 1);
  const xMin = Math.min(...xs, 0);
  const yMax = Math.max(...ys, yRef ?? 0, 1);
  const yMin = Math.min(...ys, yZero ? 0 : yMax, 0);
  const xOf = (v: number) => pad.l + (W - pad.l - pad.r) * ((v - xMin) / (xMax - xMin || 1));
  const yOf = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - (v - yMin) / (yMax - yMin || 1));

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-72 w-full min-w-[320px]">
        <g className="text-border">
          <line x1={pad.l} y1={pad.t} x2={pad.l} y2={H - pad.b} stroke="currentColor" strokeWidth={1} />
          <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} stroke="currentColor" strokeWidth={1} />
          {yRef != null && (
            <line x1={pad.l} y1={yOf(yRef)} x2={W - pad.r} y2={yOf(yRef)} stroke="currentColor" strokeWidth={1} strokeDasharray="3 3" />
          )}
          {yZero && (
            <line x1={pad.l} y1={yOf(0)} x2={W - pad.r} y2={yOf(0)} stroke="currentColor" strokeWidth={1} strokeDasharray="3 3" />
          )}
          {xRef != null && (
            <line x1={xOf(xRef)} y1={pad.t} x2={xOf(xRef)} y2={H - pad.b} stroke="currentColor" strokeWidth={1} strokeDasharray="3 3" />
          )}
        </g>
        <text x={pad.l - 6} y={yOf(yMax) + 3} textAnchor="end" className="fill-muted-foreground text-[9px]">{yMax.toFixed(1)}</text>
        <text x={pad.l - 6} y={yOf(yMin) - 1} textAnchor="end" className="fill-muted-foreground text-[9px]">{yMin.toFixed(1)}</text>
        <text x={(pad.l + W - pad.r) / 2} y={H - 4} textAnchor="middle" className="fill-muted-foreground text-[10px]">{xLabel}</text>
        <text x={4} y={pad.t + 4} className="fill-muted-foreground text-[10px]">{yLabel}</text>
        {pts.map((p, i) => (
          <g key={i} className={tone ? TONE_CLASS[tone(p.r)] : good?.(p.r) ? "text-success" : "text-destructive"}>
            <circle cx={xOf(p.x)} cy={yOf(p.y)} r={size ? size(p.r) : 3.2} fill="currentColor" opacity={0.6}>
              <title>{`${p.r.strategyId} · ${p.r.pair} ${p.r.timeframe}\n${xLabel} ${p.x.toFixed(2)}, ${yLabel} ${p.y.toFixed(2)}`}</title>
            </circle>
          </g>
        ))}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ asset bars */

function AssetBars({ rows }: { rows: Row[] }) {
  const byAsset = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const pf = num(r.profitFactor);
      if (pf == null) continue;
      map.set(r.pair, Math.max(map.get(r.pair) ?? -Infinity, pf));
    }
    return [...map.entries()].map(([pair, pf]) => ({ pair, pf })).sort((a, b) => b.pf - a.pf).slice(0, 14);
  }, [rows]);
  if (!byAsset.length) return <p className="py-8 text-center text-sm text-muted-foreground">No data.</p>;
  // Scale bars by the max FINITE PF so a no-loss "∞" (sentinel) doesn't flatten every other bar.
  const finiteMax = Math.max(2, ...byAsset.filter((a) => !isInfinitePf(a.pf)).map((a) => a.pf));
  return (
    <div className="space-y-1.5">
      {byAsset.map((a) => {
        const inf = isInfinitePf(a.pf);
        const w = inf ? 100 : (a.pf / finiteMax) * 100;
        return (
          <div key={a.pair} className="flex items-center gap-2 text-xs">
            <span className="w-24 shrink-0 truncate font-medium">{a.pair}</span>
            <div className="relative h-4 flex-1 overflow-hidden rounded bg-muted">
              <div className="absolute inset-y-0 w-px bg-border" style={{ left: `${(1 / finiteMax) * 100}%` }} />
              <div className={"h-full rounded " + (a.pf >= 1 ? "bg-success" : "bg-destructive")} style={{ width: `${w}%`, opacity: 0.85 }} />
            </div>
            <span className="w-10 shrink-0 text-right font-mono tabular-nums">{pfLabel(a.pf)}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ strategy breadth */

function StrategyBreadth({ rows }: { rows: Row[] }) {
  const ranked = useMemo(() => {
    const map = new Map<string, { assets: Set<string>; bestPf: number }>();
    for (const r of rows) {
      const pf = num(r.profitFactor) ?? 0;
      if (pf <= 1) continue;
      const e = map.get(r.strategyId) ?? { assets: new Set<string>(), bestPf: 0 };
      e.assets.add(r.pair);
      e.bestPf = Math.max(e.bestPf, pf);
      map.set(r.strategyId, e);
    }
    return [...map.entries()]
      .map(([id, e]) => ({ id, count: e.assets.size, bestPf: e.bestPf }))
      .sort((a, b) => b.count - a.count || b.bestPf - a.bestPf)
      .slice(0, 12);
  }, [rows]);
  if (!ranked.length) return <p className="py-8 text-center text-sm text-muted-foreground">No edges in the current filter.</p>;
  const max = Math.max(1, ...ranked.map((r) => r.count));
  return (
    <div className="space-y-1.5">
      {ranked.map((r) => (
        <div key={r.id} className="flex items-center gap-2 text-xs">
          <span className="w-56 shrink-0 truncate font-mono" title={r.id}>{r.id}</span>
          <div className="relative h-4 flex-1 overflow-hidden rounded bg-muted">
            <div className="h-full rounded bg-primary" style={{ width: `${(r.count / max) * 100}%`, opacity: 0.85 }} />
          </div>
          <span className="w-24 shrink-0 text-right font-mono tabular-nums text-muted-foreground">
            {r.count} asset{r.count === 1 ? "" : "s"} · PF {pfLabel(r.bestPf)}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ leaderboard */

type LeaderboardSortKey =
  | "rank"
  | "strategy"
  | "asset"
  | "timeframe"
  | "params"
  | "return"
  | "trades"
  | "winRate"
  | "profitFactor"
  | "sharpe"
  | "maxDrawdown"
  | "span"
  | "ranAt";

type LeaderboardSort = {
  key: LeaderboardSortKey;
  dir: "asc" | "desc";
};

const DEFAULT_LEADERBOARD_SORT: LeaderboardSort = { key: "rank", dir: "asc" };

function leaderboardSortValue(row: Row, key: LeaderboardSortKey): number | string | null {
  switch (key) {
    case "rank":
      return pfRank(num(row.profitFactor), row.totalTrades);
    case "strategy":
      return row.strategyId;
    case "asset":
      return row.pair;
    case "timeframe":
      return TF_MINUTES[row.timeframe] ?? Number.MAX_SAFE_INTEGER;
    case "params":
      return row.paramHash === "default" ? "default" : (row.jesterParamCode ?? "custom");
    case "return":
      return num(row.totalReturn);
    case "trades":
      return row.totalTrades;
    case "winRate":
      return num(row.winRate);
    case "profitFactor":
      return num(row.profitFactor);
    case "sharpe":
      return num(row.sharpe);
    case "maxDrawdown":
      return num(row.maxDrawdown);
    case "span":
      return row.spanDays;
    case "ranAt":
      return new Date(row.ranAt).getTime();
  }
}

function compareLeaderboardRows(a: Row, b: Row, sort: LeaderboardSort): number {
  const left = leaderboardSortValue(a, sort.key);
  const right = leaderboardSortValue(b, sort.key);

  // Missing values always sink, regardless of direction.
  if (left == null && right == null) return a.id.localeCompare(b.id);
  if (left == null) return 1;
  if (right == null) return -1;

  const base = typeof left === "string"
    ? left.localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" })
    : left - Number(right);
  const direction = sort.dir === "asc" ? base : -base;
  if (direction !== 0) return direction;

  // Stable, deterministic tie-breakers keep rows from jumping between renders.
  return (
    a.strategyId.localeCompare(b.strategyId)
    || a.pair.localeCompare(b.pair)
    || a.timeframe.localeCompare(b.timeframe)
    || a.id.localeCompare(b.id)
  );
}

function LeaderboardSortTh({
  column,
  sort,
  onSort,
  align = "left",
  children,
}: {
  column: LeaderboardSortKey;
  sort: LeaderboardSort;
  onSort: (column: LeaderboardSortKey) => void;
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const active = sort.key === column;
  const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={"px-3 py-2 " + (align === "right" ? "text-right" : "text-left")}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={
          "inline-flex items-center gap-1 whitespace-nowrap transition-colors hover:text-foreground "
          + (align === "right" ? "ml-auto " : "")
          + (active ? "text-foreground" : "")
        }
        title={`Sort by ${String(children)}`}
      >
        {children}
        <Icon className={"h-3 w-3 " + (active ? "" : "opacity-45")} aria-hidden="true" />
      </button>
    </th>
  );
}

function Leaderboard({ rows }: { rows: Row[] }) {
  const navigate = useNavigate();
  const [sort, setSort] = useState<LeaderboardSort>(DEFAULT_LEADERBOARD_SORT);
  const me = trpc.admin.me.useQuery(undefined, { staleTime: 60_000 });
  const canTrade = ["manager", "admin"].includes((me.data?.role as string) ?? "");
  const catalog = trpc.catalog.list.useQuery(undefined, { staleTime: 60_000 });
  const live = trpc.trading.myStrategies.useQuery(undefined, { enabled: canTrade, staleTime: 60_000 });

  // strategyId -> tunable, and the set of strategy|pair combos currently trading live.
  const tunableById = useMemo(() => {
    const m = new Map<string, boolean | null>();
    for (const s of catalog.data ?? []) m.set(s.id, s.tunable ?? null);
    return m;
  }, [catalog.data]);
  const liveKeys = useMemo(() => {
    const set = new Set<string>();
    for (const s of ((live.data as any)?.strategies ?? []) as any[]) {
      for (const p of s.pairs ?? []) set.add(`${s.id}|${p.pair}`);
    }
    return set;
  }, [live.data]);

  const rankById = useMemo(
    () => new Map(
      [...rows]
        .sort((a, b) =>
          pfRank(num(b.profitFactor), b.totalTrades)
          - pfRank(num(a.profitFactor), a.totalTrades)
          || a.id.localeCompare(b.id)
        )
        .map((row, index) => [row.id, index + 1]),
    ),
    [rows],
  );
  const top = useMemo(() => {
    const effectiveSort =
      sort.key === "rank"
        ? { key: "rank" as const, dir: sort.dir === "asc" ? "desc" as const : "asc" as const }
        : sort;
    return [...rows].sort((a, b) => compareLeaderboardRows(a, b, effectiveSort)).slice(0, 20);
  }, [rows, sort]);
  const toggleSort = (column: LeaderboardSortKey) => {
    setSort((current) => {
      if (current.key === column) return { key: column, dir: current.dir === "asc" ? "desc" : "asc" };
      const dir: LeaderboardSort["dir"] =
        column === "rank" || column === "strategy" || column === "asset" || column === "timeframe" || column === "params"
          ? "asc"
          : "desc";
      return { key: column, dir };
    });
  };
  const pct = (v: string | null) => (num(v) == null ? "—" : `${num(v)!.toFixed(1)}%`);
  const ago = (d: Date | string) => {
    const days = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
    return days <= 0 ? "today" : days === 1 ? "1d ago" : `${days}d ago`;
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <LeaderboardSortTh column="rank" sort={sort} onSort={toggleSort}>#</LeaderboardSortTh>
            <LeaderboardSortTh column="strategy" sort={sort} onSort={toggleSort}>Strategy</LeaderboardSortTh>
            <LeaderboardSortTh column="asset" sort={sort} onSort={toggleSort}>Asset</LeaderboardSortTh>
            <LeaderboardSortTh column="timeframe" sort={sort} onSort={toggleSort}>TF</LeaderboardSortTh>
            <LeaderboardSortTh column="params" sort={sort} onSort={toggleSort}>Params</LeaderboardSortTh>
            <LeaderboardSortTh column="return" sort={sort} onSort={toggleSort} align="right">Return</LeaderboardSortTh>
            <LeaderboardSortTh column="trades" sort={sort} onSort={toggleSort} align="right">Trades</LeaderboardSortTh>
            <LeaderboardSortTh column="winRate" sort={sort} onSort={toggleSort} align="right">Win %</LeaderboardSortTh>
            <LeaderboardSortTh column="profitFactor" sort={sort} onSort={toggleSort} align="right">PF</LeaderboardSortTh>
            <LeaderboardSortTh column="sharpe" sort={sort} onSort={toggleSort} align="right">Sharpe</LeaderboardSortTh>
            <LeaderboardSortTh column="maxDrawdown" sort={sort} onSort={toggleSort} align="right">Max DD</LeaderboardSortTh>
            <LeaderboardSortTh column="span" sort={sort} onSort={toggleSort} align="right">Span</LeaderboardSortTh>
            <LeaderboardSortTh column="ranAt" sort={sort} onSort={toggleSort} align="right">Run</LeaderboardSortTh>
          </tr>
        </thead>
        <tbody>
          {top.map((r) => {
            const tunable = tunableById.get(r.strategyId);
            const isLive = liveKeys.has(`${r.strategyId}|${r.pair}`);
            const variants = (r as any).variants ?? 1;
            const thin = (r.totalTrades ?? 0) < 20;
            return (
              <tr
                key={r.id}
                onClick={() =>
                  navigate({
                    to: "/strategy/$strategyId",
                    params: { strategyId: r.strategyId },
                    search: { pair: r.pair, tf: r.timeframe, days: r.daysRequested },
                  })
                }
                className="cursor-pointer border-t last:border-0 hover:bg-accent/40"
                title="Open this strategy's full detail — data, optimize, activate"
              >
                <td className="px-3 py-2 text-muted-foreground">{rankById.get(r.id) ?? "—"}</td>
                <td className="max-w-56 px-3 py-2 font-medium">
                  <span className="block truncate">{r.strategyId}</span>
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {isLive && (
                      <span className="rounded bg-success/15 px-1 py-0.5 text-[10px] font-semibold uppercase text-success">live</span>
                    )}
                    {tunable === true && (
                      <span className="rounded bg-primary/15 px-1 py-0.5 text-[10px] font-medium uppercase text-primary">tunable</span>
                    )}
                    {tunable === false && (
                      <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">fixed</span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2">{r.pair}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.timeframe}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {r.paramHash === "default" ? "default" : (r.jesterParamCode ?? "custom")}
                  {variants > 1 && (
                    <span
                      className="ml-1 rounded bg-warning/15 px-1 py-0.5 text-[10px] font-medium uppercase text-warning"
                      title={`${variants} parameter sets produced an identical result — this strategy ignores parameter overrides.`}
                    >
                      ×{variants}
                    </span>
                  )}
                </td>
                <td className={"px-3 py-2 text-right tabular-nums " + ((num(r.totalReturn) ?? 0) >= 0 ? "text-success" : "text-destructive")}>{pct(r.totalReturn)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <span className={thin ? "text-warning" : ""} title={thin ? "Thin sample — under 20 trades, treat the edge as unproven" : undefined}>
                    {r.totalTrades ?? "—"}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{pct(r.winRate)}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">
                  <span className="inline-flex items-center gap-1.5">
                    {pfLabel(num(r.profitFactor))}
                    <StatusPill tone={(num(r.profitFactor) ?? 0) > 1 ? "success" : "warning"} className="px-1.5 py-0">
                      {(num(r.profitFactor) ?? 0) > 1 ? "edge" : "loser"}
                    </StatusPill>
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{num(r.sharpe) == null ? "—" : num(r.sharpe)!.toFixed(2)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{pct(r.maxDrawdown)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.spanDays}d</td>
                <td className="px-3 py-2 text-right text-xs text-muted-foreground">{ago(r.ranAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
