import { Fragment, useEffect, useMemo, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { Database, Zap, Loader2, AlertTriangle, Ban, ChevronRight, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { CopyCode } from "@/components/ui/copy-code";
import { ResultRunDialog } from "@/pages/results/ResultRunDialog";
import { ActivateDialog } from "@/pages/trading/ActivateDialog";
import { useSSE } from "@/lib/use-sse";
import { trpc } from "@/lib/trpc";

interface Metrics {
  returnPct: string | number | null;
  trades: number | null;
  profitFactor: string | number | null;
  maxDrawdown: string | number | null;
  spanDays: number | null;
}
interface CellState {
  id: string;
  strategyId: string;
  pair: string;
  timeframe: string;
  days: number;
  paramLabel?: string | null;
  parameters?: Record<string, unknown> | null;
  jesterParamCode?: string | null;
  backtestRunId?: string | null;
  status: string;
  error?: string | null;
  metrics?: Metrics | null;
}

const num = (v: string | number | null | undefined) =>
  v == null ? null : typeof v === "number" ? v : parseFloat(v);

export function SweepDetail() {
  const { sweepId } = useParams({ strict: false }) as { sweepId: string };
  const utils = trpc.useUtils();
  const get = trpc.sweeps.get.useQuery({ id: sweepId });
  const cancel = trpc.sweeps.cancel.useMutation({ onSuccess: () => utils.sweeps.get.invalidate() });
  const retry = trpc.sweeps.retryFailed.useMutation({
    onSuccess: () => {
      setFinished(false);
      utils.sweeps.get.invalidate();
    },
  });

  const [cells, setCells] = useState<Record<string, CellState>>({});
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [finished, setFinished] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const me = trpc.admin.me.useQuery(undefined, { staleTime: 60_000 });
  const canTrade = ["manager", "admin"].includes((me.data?.role as string) ?? "");
  const [activateTarget, setActivateTarget] = useState<CellState | null>(null);
  const [runTarget, setRunTarget] = useState<{
    strategyId: string;
    pair: string;
    timeframe: string;
    days: number;
  } | null>(null);

  // Seed from the initial query; SSE takes over for live updates.
  useEffect(() => {
    if (!get.data) return;
    setProgress({ done: get.data.sweep.doneCells, total: get.data.sweep.totalCells });
    if (get.data.sweep.status === "done") setFinished(true);
    setCells((prev) => {
      const next = { ...prev };
      for (const c of get.data!.cells) {
        if (!next[c.id]) {
          next[c.id] = {
            id: c.id,
            strategyId: c.strategyId,
            pair: c.pair,
            timeframe: c.timeframe,
            days: c.days,
            paramLabel: c.paramLabel,
            parameters: c.parameters as Record<string, unknown> | null,
            jesterParamCode: c.jesterParamCode,
            backtestRunId: c.backtestRunId,
            status: c.status,
            error: c.error,
            metrics: {
              returnPct: c.totalReturn,
              trades: c.totalTrades,
              profitFactor: c.profitFactor,
              maxDrawdown: c.maxDrawdown,
              spanDays: c.spanDays,
            },
          };
        }
      }
      return next;
    });
  }, [get.data]);

  useSSE({
    "sweep.cell": (e) => {
      const p = JSON.parse(e.data);
      if (p.sweepId !== sweepId) return;
      setCells((prev) => ({
        ...prev,
        [p.cellId]: {
          ...prev[p.cellId],
          id: p.cellId,
          strategyId: p.strategyId,
          pair: p.pair,
          timeframe: p.timeframe,
          days: prev[p.cellId]?.days ?? 0,
          paramLabel: p.paramLabel ?? prev[p.cellId]?.paramLabel ?? null,
          parameters: prev[p.cellId]?.parameters ?? null,
          jesterParamCode: p.jesterParamCode ?? prev[p.cellId]?.jesterParamCode ?? null,
          backtestRunId: p.backtestRunId ?? prev[p.cellId]?.backtestRunId ?? null,
          status: p.error ? "failed" : p.source === "cache" ? "cache_hit" : "done",
          error: p.error ?? null,
          metrics: p.metrics ?? null,
        },
      }));
    },
    "sweep.progress": (e) => {
      const p = JSON.parse(e.data);
      if (p.sweepId !== sweepId) return;
      setProgress({ done: p.done, total: p.total });
    },
    "sweep.finished": (e) => {
      const p = JSON.parse(e.data);
      if (p.sweepId !== sweepId) return;
      setFinished(true);
    },
  });

  // Ranked: done cells by profit factor desc, then pending/running below.
  const ranked = useMemo(() => {
    const list = Object.values(cells);
    return list.sort((a, b) => {
      const done = (c: CellState) => c.status === "done" || c.status === "cache_hit";
      if (done(a) !== done(b)) return done(a) ? -1 : 1;
      return (num(b.metrics?.profitFactor) ?? -Infinity) - (num(a.metrics?.profitFactor) ?? -Infinity);
    });
  }, [cells]);

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const running = !finished && get.data?.sweep.status !== "canceled";
  const failedCount = Object.values(cells).filter((c) => c.status === "failed").length;

  // Optimize runs whose parameter sets all produced identical results → this strategy's
  // Jester backtest ignores parameter overrides (support varies by strategy).
  const doneCells = ranked.filter((c) => c.status === "done" || c.status === "cache_hit");
  const isOptimize = doneCells.some((c) => c.paramLabel);
  const flatGrid =
    isOptimize &&
    finished &&
    doneCells.length > 1 &&
    doneCells.every(
      (c) =>
        num(c.metrics?.returnPct) === num(doneCells[0].metrics?.returnPct) &&
        c.metrics?.trades === doneCells[0].metrics?.trades,
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title={get.data?.sweep.name || "Sweep"}
        subtitle={
          <span>
            Backtests run live and rank by profit factor as they land — <b>fresh</b> = newly computed,{" "}
            <b>cache</b> = reused from the warehouse (free). All results are saved to Results.
          </span>
        }
        actions={
          running ? (
            <Button variant="outline" onClick={() => cancel.mutate({ id: sweepId })} disabled={cancel.isPending}>
              <Ban className="h-4 w-4" />
              Cancel
            </Button>
          ) : failedCount > 0 ? (
            <Button variant="outline" onClick={() => retry.mutate({ id: sweepId })} disabled={retry.isPending}>
              <RefreshCw className={retry.isPending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              Retry {failedCount} failed
            </Button>
          ) : null
        }
      />

      {/* Progress ring + counts */}
      <div className="flex items-center gap-4">
        <ProgressRing pct={pct} spinning={running} />
        <div>
          <div className="text-2xl font-bold tabular-nums">
            {progress.done}
            <span className="text-muted-foreground"> / {progress.total}</span>
          </div>
          <div className="text-sm text-muted-foreground">
            {finished ? (
              failedCount > 0 ? (
                <span className="text-warning">complete · {failedCount} failed</span>
              ) : (
                "complete"
              )
            ) : running ? (
              "running…"
            ) : (
              "canceled"
            )}
          </div>
        </div>
      </div>

      {flatGrid && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>
            Every parameter set produced the <b>same</b> result — this strategy's Jester backtest
            ignores parameter overrides, so it can't be tuned this way. (Support varies by strategy;
            some, like <span className="font-mono text-xs">macd_ema_conservative</span>, do respond.)
          </span>
        </div>
      )}

      {/* Live grid */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Strategy</th>
              <th className="px-3 py-2">Pair</th>
              <th className="px-3 py-2">TF</th>
              <th className="px-3 py-2 text-right">Return</th>
              <th className="px-3 py-2 text-right">Trades</th>
              <th className="px-3 py-2 text-right">PF</th>
              <th className="px-3 py-2 text-right">Max DD</th>
              <th className="px-3 py-2 text-right">Span</th>
              <th className="px-3 py-2">State</th>
              {canTrade && <th className="px-3 py-2 text-right">Action</th>}
            </tr>
          </thead>
          <tbody>
            {ranked.map((c) => {
              const canExpand = !!c.parameters && Object.keys(c.parameters).length > 0;
              const isDone = c.status === "done" || c.status === "cache_hit";
              const isOpen = expanded === c.id;
              // Optimize rows (with params) expand; plain sweep rows open the run/optimize dialog.
              const onClick = canExpand
                ? () => setExpanded((e) => (e === c.id ? null : c.id))
                : isDone
                  ? () => setRunTarget({ strategyId: c.strategyId, pair: c.pair, timeframe: c.timeframe, days: c.days })
                  : undefined;
              return (
                <Fragment key={c.id}>
                  <CellRow
                    cell={c}
                    expandable={canExpand}
                    open={isOpen}
                    onClick={onClick}
                    canTrade={canTrade}
                    onActivate={() => setActivateTarget(c)}
                  />
                  {isOpen && c.parameters && (
                    <tr className="border-b bg-muted/20">
                      <td colSpan={canTrade ? 10 : 9} className="px-3 py-3">
                        <ParamGrid params={c.parameters} code={c.jesterParamCode} runId={c.backtestRunId} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {activateTarget && (
        <ActivateDialog
          open={!!activateTarget}
          onClose={() => setActivateTarget(null)}
          strategyId={activateTarget.strategyId}
          strategyName={activateTarget.strategyId}
          pair={activateTarget.pair}
          timeframe={activateTarget.timeframe}
          days={activateTarget.days}
          parameters={activateTarget.parameters ?? undefined}
        />
      )}

      {runTarget && (
        <ResultRunDialog
          open={!!runTarget}
          onClose={() => setRunTarget(null)}
          strategyId={runTarget.strategyId}
          initial={{ pair: runTarget.pair, timeframe: runTarget.timeframe, days: runTarget.days }}
        />
      )}
    </div>
  );
}

function CellRow({
  cell,
  expandable,
  open,
  onClick,
  canTrade,
  onActivate,
}: {
  cell: CellState;
  canTrade?: boolean;
  onActivate?: () => void;
  expandable: boolean;
  open: boolean;
  onClick?: () => void;
}) {
  const m = cell.metrics;
  const done = cell.status === "done" || cell.status === "cache_hit";
  const fmt = (v: string | number | null | undefined, s = "") => {
    const n = num(v);
    return n == null ? "—" : `${n.toFixed(2)}${s}`;
  };
  const ret = num(m?.returnPct);
  return (
    <tr
      onClick={onClick}
      className={"border-b last:border-0 hover:bg-accent/40" + (onClick ? " cursor-pointer" : "")}
      title={expandable ? "Click to see all parameters" : onClick ? "Click to backtest or optimize this cell" : undefined}
    >
      <td className="max-w-64 truncate px-3 py-2 font-medium">
        {cell.paramLabel ? (
          <span className="inline-flex items-center gap-1 font-mono text-xs">
            {expandable && (
              <ChevronRight
                className={"h-3 w-3 shrink-0 text-muted-foreground transition-transform " + (open ? "rotate-90" : "")}
              />
            )}
            {cell.paramLabel}
          </span>
        ) : (
          cell.strategyId
        )}
      </td>
      <td className="px-3 py-2">{cell.pair}</td>
      <td className="px-3 py-2 text-muted-foreground">{cell.timeframe}</td>
      <td className={"px-3 py-2 text-right tabular-nums " + (ret != null ? (ret >= 0 ? "text-success" : "text-destructive") : "")}>
        {done ? fmt(m?.returnPct, "%") : ""}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{done ? (m?.trades ?? "—") : ""}</td>
      <td className="px-3 py-2 text-right tabular-nums">{done ? fmt(m?.profitFactor) : ""}</td>
      <td className="px-3 py-2 text-right tabular-nums">{done ? fmt(m?.maxDrawdown, "%") : ""}</td>
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{done ? `${m?.spanDays}d` : ""}</td>
      <td className="px-3 py-2">
        <CellStatus status={cell.status} error={cell.error} />
      </td>
      {canTrade && (
        <td className="px-3 py-2 text-right">
          {done && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2"
              onClick={(e) => {
                e.stopPropagation();
                onActivate?.();
              }}
              title={
                cell.parameters && Object.keys(cell.parameters).length > 0
                  ? "Go live — choose these tuned params or the strategy's defaults"
                  : "Go live on this pair"
              }
            >
              <Zap className="h-3.5 w-3.5" /> Activate
            </Button>
          )}
        </td>
      )}
    </tr>
  );
}

function CellStatus({ status, error }: { status: string; error?: string | null }) {
  if (status === "failed")
    return (
      <StatusPill tone="destructive">
        <AlertTriangle className="h-3 w-3" />
        {error ? "failed" : "failed"}
      </StatusPill>
    );
  if (status === "cache_hit")
    return (
      <StatusPill tone="muted">
        <Database className="h-3 w-3" />
        cache
      </StatusPill>
    );
  if (status === "done")
    return (
      <StatusPill tone="success">
        <Zap className="h-3 w-3" />
        fresh
      </StatusPill>
    );
  if (status === "running")
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        running
      </span>
    );
  return <span className="text-xs text-muted-foreground">pending</span>;
}

function ProgressRing({ pct, spinning }: { pct: number; spinning: boolean }) {
  const r = 26;
  const circ = 2 * Math.PI * r;
  return (
    <div className="relative h-16 w-16">
      <svg className="h-16 w-16 -rotate-90" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--color-muted)" strokeWidth="6" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct / 100)}
          style={{ transition: "stroke-dashoffset 0.5s var(--ease-spring-soft)" }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums">
        {spinning && pct < 100 ? `${pct}%` : `${pct}%`}
      </span>
    </div>
  );
}

/** Full parameter set for an optimization cell, shown when a row is expanded. */
function ParamGrid({
  params,
  code,
  runId,
}: {
  params: Record<string, unknown>;
  code?: string | null;
  runId?: string | null;
}) {
  const entries = Object.entries(params);
  const fmt = (v: unknown) =>
    v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);

  // Sweep cells run on the fast async queue, which doesn't return Jester's param code. Fetch it
  // on demand (one synchronous re-run) when the user actually wants it.
  const [fetched, setFetched] = useState<string | null>(null);
  const fetchCode = trpc.results.fetchCode.useMutation({ onSuccess: (r) => setFetched(r.code) });
  const shownCode = code ?? fetched;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          All parameters ({entries.length})
        </div>
        {shownCode ? (
          <CopyCode code={shownCode} />
        ) : runId ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => fetchCode.mutate({ runId })}
            disabled={fetchCode.isPending}
          >
            {fetchCode.isPending ? "Fetching…" : "Fetch Jester code"}
          </Button>
        ) : null}
        {fetchCode.error && <span className="text-xs text-destructive">{fetchCode.error.message}</span>}
      </div>
      {/* Key above value in each cell; both min-w-0 so long/object values wrap inside the cell
          instead of overflowing into the next column. */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-6 gap-y-2">
        {entries.map(([k, v]) => (
          <div key={k} className="min-w-0 border-b border-border/50 pb-1">
            <div className="truncate font-mono text-[11px] text-muted-foreground" title={k}>
              {k}
            </div>
            <div className="break-all font-mono text-xs tabular-nums">{fmt(v)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
