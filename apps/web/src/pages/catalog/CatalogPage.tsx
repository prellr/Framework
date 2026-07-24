import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Boxes, RefreshCw, Play, Zap, Database, Search, Clock, Sparkles, ChevronDown, BookOpen, ArrowDown, ArrowUp, ArrowDownUp, AlertTriangle } from "lucide-react";
import { OptimizeDialog } from "./OptimizeDialog";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { CopyCode } from "@/components/ui/copy-code";
import { AssetPicker } from "@/components/ui/asset-picker";
import { pfLabel, pfRank } from "@/lib/metrics";
import { trpc } from "@/lib/trpc";
import type { RouterOutput } from "@framework/api/router";

type Strategy = RouterOutput["catalog"]["list"][number];
// Sourced from results.cellResults (one stored row per strategy for the selected cell) — NOT from
// results.query, whose rows carry an extra dedup `variants` count this page doesn't use.
type RunRow = RouterOutput["results"]["cellResults"][string];
type SortKey = "name" | "return" | "trades" | "pf" | "span";
const SORT_LABELS: { key: SortKey; label: string }[] = [
  { key: "pf", label: "PF" },
  { key: "return", label: "Return" },
  { key: "trades", label: "Trades" },
  { key: "span", label: "Span" },
  { key: "name", label: "Name" },
];

// Defaults + presets for the catalog's backtest cell (the user can change these).
const DEFAULT_PAIR = "BTC-USD";
const DEFAULT_TF = "15m";
const DEFAULT_DAYS = 30;
const TF_PRESETS = ["5m", "15m", "1h", "4h"];
const WINDOW_PRESETS: { label: string; days: number }[] = [
  { label: "30d", days: 30 },
  { label: "60d", days: 60 },
  { label: "90d", days: 90 },
  { label: "max", days: 100000 },
];

interface Cell {
  pair: string;
  timeframe: string;
  days: number;
}

const TIER_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  PREMIUM: "default",
  STANDARD: "secondary",
  BASIC: "outline",
};

export function CatalogPage() {
  const utils = trpc.useUtils();
  const me = trpc.admin.me.useQuery(undefined, { staleTime: 60_000 });
  const list = trpc.catalog.list.useQuery();
  const universe = trpc.markets.pairs.useQuery(undefined, { staleTime: 5 * 60_000 });
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<string | null>(null);
  const [tunableOnly, setTunableOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "pf", dir: "desc" });
  const [resortNonce, setResortNonce] = useState(0);

  // The backtest cell the catalog operates on — user-adjustable, and remembered across reloads so
  // it reloads the asset/timeframe/window you were last on instead of resetting to the default.
  const [cell, setCell] = useState<Cell>(() => {
    try {
      const s = localStorage.getItem("jester.catalog.cell");
      if (s) {
        const c = JSON.parse(s);
        if (c?.pair && c?.timeframe && typeof c?.days === "number") return c as Cell;
      }
    } catch {
      /* ignore */
    }
    return { pair: DEFAULT_PAIR, timeframe: DEFAULT_TF, days: DEFAULT_DAYS };
  });
  useEffect(() => {
    try {
      localStorage.setItem("jester.catalog.cell", JSON.stringify(cell));
    } catch {
      /* ignore */
    }
  }, [cell]);

  const refresh = trpc.catalog.refresh.useMutation({
    onSuccess: () => utils.catalog.list.invalidate(),
  });

  // Stored warehouse results for the EXACT selected cell — so every strategy already run on
  // this cell shows its result inline on load (not only after clicking to discover it's cached).
  // Server-side exact lookup avoids row-limit truncation when the warehouse is large.
  const stored = trpc.results.cellResults.useQuery({
    pair: cell.pair,
    timeframe: cell.timeframe,
    days: cell.days,
  });
  const storedByStrategy = useMemo(() => {
    const map = new Map<string, RunRow>();
    for (const [id, r] of Object.entries(stored.data ?? {})) map.set(id, r);
    return map;
  }, [stored.data]);

  const isManager = ["manager", "admin"].includes((me.data?.role as string) ?? "");

  const tiers = useMemo(() => {
    const set = new Set<string>();
    list.data?.forEach((s) => s.tier && set.add(s.tier));
    return [...set];
  }, [list.data]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (list.data ?? []).filter(
      (s) =>
        (!tier || s.tier === tier) &&
        (!tunableOnly || s.tunable === true) &&
        (!term || s.name.toLowerCase().includes(term) || s.id.toLowerCase().includes(term)),
    );
  }, [list.data, q, tier, tunableOnly]);

  // Sort by the stored result metric for the current cell. Strategies with no result for this cell
  // sort to the bottom (so backtested winners surface). Default: best profit factor first.
  const sorted = useMemo(() => {
    const num = (v: string | null | undefined) => (v == null ? null : parseFloat(v));
    const metric = (s: Strategy): number => {
      const m = storedByStrategy.get(s.id);
      if (!m) return -Infinity;
      switch (sort.key) {
        case "return": return num(m.totalReturn) ?? -Infinity;
        case "trades": return m.totalTrades ?? -Infinity;
        case "pf": return pfRank(num(m.profitFactor), m.totalTrades);
        case "span": return m.spanDays ?? -Infinity;
        default: return -Infinity;
      }
    };
    const arr = [...filtered];
    if (sort.key === "name") {
      arr.sort((a, b) => (sort.dir === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)));
    } else {
      arr.sort((a, b) => (sort.dir === "desc" ? metric(b) - metric(a) : metric(a) - metric(b)));
    }
    return arr;
  }, [filtered, storedByStrategy, sort]);

  // Row order is PINNED across data refreshes. `sorted` is the *true* order for the current sort,
  // but re-rendering in that order every time a result lands means finishing a backtest yanks the
  // row you just clicked somewhere else in a 191-row list — you lose the strategy you were working
  // on. Instead the row updates its numbers in place, and re-sorting is something you ask for.
  //
  // The pin is rebuilt whenever the *inputs* change (sort, filters, cell, or an explicit Re-sort),
  // or when the visible set of strategies changes — never merely because the data refreshed.
  const orderKey = `${sort.key}|${sort.dir}|${q.trim()}|${tier}|${tunableOnly}|${cell.pair}|${cell.timeframe}|${cell.days}|${resortNonce}`;
  const pin = useRef<{ key: string; ids: string[] }>({ key: "", ids: [] });
  const shown = useMemo(() => {
    const ids = sorted.map((s) => s.id);
    const prev = pin.current;
    const prevSet = new Set(prev.ids);
    const sameSet = prev.key === orderKey && prev.ids.length === ids.length && ids.every((id) => prevSet.has(id));
    if (!sameSet) {
      pin.current = { key: orderKey, ids };
      return sorted;
    }
    const rank = new Map(prev.ids.map((id, i) => [id, i] as const));
    return [...sorted].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  }, [sorted, orderKey]);

  // True when fresh results mean the pinned order no longer matches the chosen sort.
  const orderStale = useMemo(() => shown.some((s, i) => s.id !== sorted[i]?.id), [shown, sorted]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: key === "name" ? "asc" : "desc" }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Strategy Catalog"
        subtitle="Set the Backtest cell (asset · timeframe · window) below, then Backtest a strategy on that cell — or Optimize it to backtest Jester's tuned parameter sets. Click a strategy name or its Docs button to open its knowledge base (concept, parameters, results). Results are saved and shared."
        actions={
          isManager && (
            <Button onClick={() => refresh.mutate()} disabled={refresh.isPending} variant="outline">
              <RefreshCw className={refresh.isPending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              {refresh.isPending ? "Refreshing…" : "Refresh from Jester"}
            </Button>
          )
        }
      />

      {list.data && list.data.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="Catalog is empty"
          description={
            isManager
              ? "Click “Refresh from Jester” to mirror the strategy catalog (needs a connected key)."
              : "Ask a manager to refresh the catalog from Jester."
          }
        />
      ) : (
        <>
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-md border border-input bg-background px-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter by name or id…"
                className="h-9 w-full bg-transparent text-sm outline-none"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <FilterChip active={tier === null} onClick={() => setTier(null)}>
                All
              </FilterChip>
              {tiers.map((tr) => (
                <FilterChip key={tr} active={tier === tr} onClick={() => setTier(tr)}>
                  {tr}
                </FilterChip>
              ))}
              <FilterChip active={tunableOnly} onClick={() => setTunableOnly((v) => !v)}>
                Tunable only
              </FilterChip>
            </div>
          </div>

          {/* Backtest cell — which asset / timeframe / window the row buttons operate on */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Backtest cell
            </span>
            <AssetPicker value={cell.pair} onChange={(pair) => setCell((c) => ({ ...c, pair }))} />
            <span className="text-[11px] text-muted-foreground">
              {universe.data?.count ?? 150}+ assets — search &amp; pick, then Backtest any strategy
            </span>
            <PillSelect
              value={cell.timeframe}
              options={TF_PRESETS.map((t) => ({ label: t, value: t }))}
              onChange={(v) => setCell((c) => ({ ...c, timeframe: v }))}
            />
            <PillSelect
              value={String(cell.days)}
              options={WINDOW_PRESETS.map((w) => ({ label: w.label, value: String(w.days) }))}
              onChange={(v) => setCell((c) => ({ ...c, days: Number(v) }))}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {filtered.length} of {list.data?.length ?? 0} strategies · cell{" "}
              <span className="font-mono">
                {cell.pair}/{cell.timeframe}/{cell.days >= 100000 ? "max" : `${cell.days}d`}
              </span>
            </p>
            <div className="flex items-center gap-1.5">
              {orderStale && (
                <button
                  onClick={() => setResortNonce((n) => n + 1)}
                  className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/20"
                  title="New results have arrived — reorder the list to match the current sort"
                >
                  <ArrowDownUp className="h-3 w-3" />
                  Re-sort
                </button>
              )}
              <span className="text-xs text-muted-foreground">Sort</span>
              {SORT_LABELS.map((s) => {
                const active = sort.key === s.key;
                return (
                  <button
                    key={s.key}
                    onClick={() => toggleSort(s.key)}
                    className={
                      "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors " +
                      (active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background text-muted-foreground hover:bg-accent")
                    }
                  >
                    {s.label}
                    {active && (sort.dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-2">
            {shown.map((s) => (
              <StrategyRow
                key={s.id}
                strategy={s}
                canRun={isManager || me.data?.role === "operator"}
                cell={cell}
                stored={storedByStrategy.get(s.id)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "transition-spring rounded-md border px-2.5 py-1.5 text-xs font-medium " +
        (active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background text-muted-foreground hover:bg-accent")
      }
    >
      {children}
    </button>
  );
}

const windowLabel = (days: number) => (days >= 100000 ? "max" : `${days}d`);

/**
 * Turn a raw backtest error into one line a human can act on. The server already auto-retries
 * transient failures (candle gaps, rate limits) a few times before surfacing anything — so if the
 * user sees these, retries were exhausted and the honest message is "briefly unavailable, try again".
 */
function friendlyBacktestError(msg: string): string {
  if (/no historical candles|data feed|temporar/i.test(msg))
    return "Jester returned no candle data for this cell — its feed is briefly unavailable. This usually clears within a minute; retry shortly.";
  if (/rate limit|429/i.test(msg))
    return "Jester rate-limited the backtest — give it a moment, then retry.";
  if (/did not finish|timed?\s?out/i.test(msg))
    return "The backtest didn't finish in time on Jester's side. Retry in a moment.";
  return msg;
}

/**
 * One catalog row. Shows the stored warehouse result for the SELECTED cell so it persists
 * across navigation; a fresh run replaces it and is written back to the warehouse. Also offers
 * an optimization run (backtests Jester's optimized parameter combos for this strategy/cell).
 */
function StrategyRow({
  strategy,
  canRun,
  cell,
  stored,
}: {
  strategy: Strategy;
  canRun: boolean;
  cell: Cell;
  stored?: RunRow;
}) {
  const utils = trpc.useUtils();
  const [optimizeOpen, setOptimizeOpen] = useState(false);
  const run = trpc.results.runOne.useMutation({
    // Persist: refresh the stored cell results so the row survives navigation.
    onSuccess: () => {
      utils.results.cellResults.invalidate();
      utils.results.query.invalidate();
    },
  });

  const fmt = (v: string | null, suffix = "") =>
    v == null ? "—" : `${parseFloat(v).toFixed(2)}${suffix}`;

  // Prefer a just-run result; otherwise fall back to the stored warehouse row.
  const justRan = run.data;
  const m = justRan?.run ?? stored ?? null;

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-3 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link
              to="/strategy/$strategyId"
              params={{ strategyId: strategy.id }}
              search={{}}
              className="truncate font-medium hover:text-primary hover:underline"
              title="Open the strategy knowledge base"
            >
              {strategy.name}
            </Link>
            {strategy.tier && (
              <Badge variant={TIER_VARIANT[strategy.tier] ?? "outline"}>{strategy.tier}</Badge>
            )}
            {strategy.tunable === true && (
              <span className="rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-success" title="Jester honors parameter overrides — guided optimize works">
                tunable
              </span>
            )}
            {strategy.tunable === false && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground" title="Jester ignores parameter overrides — can't be optimized via the API">
                fixed
              </span>
            )}
          </div>
          <p className="truncate font-mono text-xs text-muted-foreground">{strategy.id}</p>
        </div>

        {/* Result — spring-pops when just run; otherwise the persisted warehouse value. When the
            last run FAILED, the shown numbers are the previous (stale) result, so we dim them and
            label them "last result" rather than "saved" — a failed run shouldn't look live. */}
        {m && (
          <div className={"flex items-center gap-4 text-sm tabular-nums " + (run.isError ? "opacity-40" : "animate-spring-pop")}>
            <Metric label="return" value={fmt(m.totalReturn, "%")} />
            <Metric label="trades" value={m.totalTrades?.toString() ?? "—"} />
            <Metric label="PF" value={pfLabel(m.profitFactor != null ? parseFloat(m.profitFactor) : null)} />
            <Metric label="span" value={`${m.spanDays}d`} />
            {run.isError ? (
              <StatusPill tone="muted">
                <Clock className="h-3 w-3" />
                last result
              </StatusPill>
            ) : justRan ? (
              <StatusPill tone={justRan.source === "cache" ? "muted" : "success"}>
                {justRan.source === "cache" ? <Database className="h-3 w-3" /> : <Zap className="h-3 w-3" />}
                {justRan.source}
              </StatusPill>
            ) : (
              <StatusPill tone="muted">
                <Clock className="h-3 w-3" />
                saved
              </StatusPill>
            )}
          </div>
        )}
        {/* The Jester parameter code being tested — the shown result's own code, else the strategy's
            default-param code (same thing for a default backtest). Fills in as the backfill resolves. */}
        {(m?.jesterParamCode || strategy.defaultParamCode) && (
          <CopyCode code={(m?.jesterParamCode ?? strategy.defaultParamCode) as string} label="" />
        )}

        {run.isError && (
          <div className="flex w-full items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">{friendlyBacktestError(run.error.message)}</span>
          </div>
        )}

        <div className="flex gap-1.5">
          <Link
            to="/strategy/$strategyId"
            params={{ strategyId: strategy.id }}
            search={{}}
            className={buttonVariants({ variant: "outline", size: "sm" })}
            title="Open this strategy's knowledge base — concept, parameters, results"
          >
            <BookOpen className="h-3.5 w-3.5" />
            Docs
          </Link>
          {canRun && (
            <>
              <Button
                size="sm"
                variant="secondary"
                disabled={run.isPending}
                onClick={() => run.mutate({ strategyId: strategy.id, ...cell })}
              >
                {run.isError && !run.isPending ? (
                  <RefreshCw className="h-3.5 w-3.5" />
                ) : (
                  <Play className={run.isPending ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
                )}
                {run.isPending
                  ? "Running…"
                  : run.isError
                    ? `Retry ${windowLabel(cell.days)}`
                    : m
                      ? `Re-run ${windowLabel(cell.days)}`
                      : `Backtest ${windowLabel(cell.days)}`}
              </Button>
              <Button
                size="sm"
                variant="outline"
                title="Choose parameters to grid-search, or auto-optimize"
                onClick={() => setOptimizeOpen(true)}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Optimize
              </Button>
            </>
          )}
        </div>
      </CardContent>

      <OptimizeDialog
        open={optimizeOpen}
        onClose={() => setOptimizeOpen(false)}
        strategyId={strategy.id}
        strategyName={strategy.name}
        cell={cell}
      />
    </Card>
  );
}

/** Small dropdown styled to match the chip controls. */
function PillSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { label: string; value: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 appearance-none rounded-md border border-input bg-background pl-3 pr-7 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="font-semibold">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
