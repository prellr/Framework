import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Loader2, Sparkles, AlertTriangle, Zap } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

interface Cell {
  pair: string;
  timeframe: string;
  days: number;
}

const MAX_COMBOS = 32;
const parseCsv = (s: string) =>
  [...new Set(s.split(",").map((x) => parseFloat(x.trim())).filter((n) => Number.isFinite(n)))];

/**
 * Optimization picker: introspects the strategy's tunable params, pre-probes whether Jester
 * honors overrides for it, and lets the user choose which params/values to grid — or auto-optimize.
 */
export function OptimizeDialog({
  open,
  onClose,
  strategyId,
  strategyName,
  cell,
}: {
  open: boolean;
  onClose: () => void;
  strategyId: string;
  strategyName: string;
  cell: Cell;
}) {
  const navigate = useNavigate();
  const inspect = trpc.sweeps.inspect.useQuery(
    { strategyId, ...cell },
    { enabled: open, staleTime: 60_000, refetchOnWindowFocus: false },
  );
  const optimize = trpc.sweeps.optimize.useMutation({
    onSuccess: (s) => {
      onClose();
      navigate({ to: "/sweeps/$sweepId", params: { sweepId: s.id } });
    },
  });

  // param name -> comma-separated values string (present = selected)
  const [sel, setSel] = useState<Record<string, string>>({});

  // Default-select the top param once params load.
  useEffect(() => {
    if (open && inspect.data?.params.length && Object.keys(sel).length === 0) {
      const top = inspect.data.params[0];
      setSel({ [top.name]: top.autoValues.join(", ") });
    }
    if (!open) setSel({});
  }, [open, inspect.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const grid = useMemo(() => {
    const g: Record<string, number[]> = {};
    for (const [k, v] of Object.entries(sel)) {
      const vals = parseCsv(v);
      if (vals.length) g[k] = vals;
    }
    return g;
  }, [sel]);

  const comboCount = Object.values(grid).reduce((a, v) => a * v.length, Object.keys(grid).length ? 1 : 0);
  const tunable = inspect.data?.tunable ?? false;
  // Manual grid is always runnable when a valid combo count is set — the single-param probe isn't
  // authoritative for every parameter, so we don't block hand-picked grids on it.
  const canRun = comboCount > 0 && comboCount <= MAX_COMBOS && !optimize.isPending;

  const toggle = (name: string, auto: number[]) =>
    setSel((s) => {
      const n = { ...s };
      if (name in n) delete n[name];
      else n[name] = auto.join(", ");
      return n;
    });

  const guided = inspect.data?.guided ?? null;

  return (
    <Dialog open={open} onClose={onClose} title={`Optimize ${strategyName}`}>
      <p className="mb-4 text-sm text-muted-foreground">
        Backtest parameter variations on{" "}
        <span className="font-mono text-xs">
          {cell.pair}/{cell.timeframe}/{cell.days >= 100000 ? "max" : `${cell.days}d`}
        </span>
        , ranked by profit factor.
      </p>

      {inspect.isLoading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Analyzing this strategy's parameters…
        </div>
      ) : inspect.error ? (
        <p className="text-sm text-destructive">{inspect.error.message}</p>
      ) : inspect.data && inspect.data.params.length === 0 ? (
        <p className="text-sm text-muted-foreground">This strategy exposes no tunable numeric parameters.</p>
      ) : (
        <>
          {/* When the guided lever showed no effect, don't dead-end — explain and offer Jester's combos.
              The manual grid below stays available (the single probe isn't authoritative per-param). */}
          {!tunable && (
            <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <span>
                  The guided lever (<span className="font-mono text-xs">{inspect.data?.testedParam}</span>) showed no
                  effect on this cell, so guided optimize likely can't tune it. You can still hand-pick specific
                  parameters below, or backtest Jester's published combos.
                </span>
              </div>
              <div className="mt-2 flex justify-end">
                <Button size="sm" disabled={optimize.isPending} onClick={() => optimize.mutate({ strategyId, ...cell, mode: "auto" })}>
                  {optimize.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Backtest Jester's combos
                </Button>
              </div>
            </div>
          )}

          {/* Primary: one-click guided optimization — only recommended when the guided lever works. */}
          {tunable && guided && (
            <div className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <Sparkles className="h-4 w-4 text-primary" />
                    Guided optimization
                    <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">
                      recommended
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Automatically sweeps the levers that matter for this strategy:{" "}
                    <span className="font-mono">{guided.summary}</span> — {guided.comboCount} backtests.
                    {guided.auto && " Levers auto-selected from parameter roles."}
                  </p>
                </div>
                <Button
                  disabled={optimize.isPending}
                  onClick={() => optimize.mutate({ strategyId, ...cell, mode: "guided" })}
                  title="One-click: backtest the logic-driven parameter plan for this strategy"
                >
                  {optimize.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                  Run guided
                </Button>
              </div>
            </div>
          )}

          {/* Advanced: hand-pick parameters + values (auto-open when guided can't tune). */}
          <details className="mt-4 rounded-md border border-border" open={!tunable}>
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-muted-foreground">
              Advanced — pick parameters manually
            </summary>
            <div className="space-y-1.5 border-t px-3 py-3">
              {inspect.data?.params.map((p) => {
                const on = p.name in sel;
                return (
                  <div
                    key={p.name}
                    className={"rounded-md border px-3 py-2 " + (on ? "border-primary/40 bg-accent/40" : "border-border")}
                  >
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input type="checkbox" checked={on} onChange={() => toggle(p.name, p.autoValues)} />
                      <span className="font-mono text-xs">{p.name}</span>
                      <span className="text-xs text-muted-foreground">default {p.value}</span>
                    </label>
                    {on && (
                      <input
                        value={sel[p.name]}
                        onChange={(e) => setSel((s) => ({ ...s, [p.name]: e.target.value }))}
                        placeholder="comma-separated values"
                        className="mt-2 h-8 w-full rounded-md border border-input bg-background px-2 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                    )}
                  </div>
                );
              })}
              <div className="flex items-center justify-between gap-3 pt-1">
                <span className="text-xs text-muted-foreground">
                  {comboCount > MAX_COMBOS
                    ? `${comboCount} combinations — too many (max ${MAX_COMBOS})`
                    : `${comboCount || 0} backtest${comboCount === 1 ? "" : "s"}`}
                </span>
                <Button size="sm" variant="outline" disabled={!canRun} onClick={() => optimize.mutate({ strategyId, ...cell, grid })}>
                  <Zap className="h-3.5 w-3.5" />
                  Run manual grid
                </Button>
              </div>
            </div>
          </details>

          {optimize.error && <p className="mt-2 text-sm text-destructive">{optimize.error.message}</p>}
        </>
      )}
    </Dialog>
  );
}
