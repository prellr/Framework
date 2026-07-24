import { useEffect, useState } from "react";
import { Play, Sparkles, Zap, Database, ChevronDown } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { CopyCode } from "@/components/ui/copy-code";
import { AssetPicker } from "@/components/ui/asset-picker";
import { pfLabel } from "@/lib/metrics";
import { OptimizeDialog } from "@/pages/catalog/OptimizeDialog";
import { trpc } from "@/lib/trpc";

interface Cell {
  pair: string;
  timeframe: string;
  days: number;
}

const TFS = ["5m", "15m", "1h", "4h"];
const WINDOWS = [
  { label: "30d", days: 30 },
  { label: "60d", days: 60 },
  { label: "90d", days: 90 },
  { label: "max", days: 100000 },
];

const fmt = (v: string | null, s = "") => (v == null ? "—" : `${parseFloat(v).toFixed(2)}${s}`);

/** Re-run a warehouse result on different settings — backtest a new cell, or optimize the strategy. */
export function ResultRunDialog({
  open,
  onClose,
  strategyId,
  initial,
  initialCode,
}: {
  open: boolean;
  onClose: () => void;
  strategyId: string;
  initial: Cell;
  initialCode?: string | null;
}) {
  const utils = trpc.useUtils();
  const [cell, setCell] = useState<Cell>(initial);
  const [optOpen, setOptOpen] = useState(false);
  const [fetchedCode, setFetchedCode] = useState<string | null>(null);
  const run = trpc.results.runOne.useMutation({ onSuccess: () => utils.results.query.invalidate() });
  const fetchCode = trpc.results.fetchCode.useMutation({ onSuccess: (res) => setFetchedCode(res.code) });

  // Re-seed the cell whenever a new row is opened.
  useEffect(() => {
    if (open) {
      setCell(initial);
      run.reset();
      fetchCode.reset();
      setFetchedCode(null);
    }
  }, [open, strategyId, initial.pair, initial.timeframe, initial.days]); // eslint-disable-line react-hooks/exhaustive-deps

  const r = run.data;
  const shownCode = r?.run.jesterParamCode ?? fetchedCode ?? initialCode ?? null;

  return (
    <>
      <Dialog open={open && !optOpen} onClose={onClose} title={<span className="font-mono text-sm">{strategyId}</span>}>
        <p className="mb-4 text-sm text-muted-foreground">
          Re-run this strategy on a different cell, or optimize its parameters.
        </p>

        {/* Cell controls */}
        <div className="flex flex-wrap items-center gap-2">
          <AssetPicker value={cell.pair} onChange={(pair) => setCell((c) => ({ ...c, pair }))} />
          <Select value={cell.timeframe} onChange={(v) => setCell((c) => ({ ...c, timeframe: v }))} options={TFS.map((t) => ({ label: t, value: t }))} />
          <Select
            value={String(cell.days)}
            onChange={(v) => setCell((c) => ({ ...c, days: Number(v) }))}
            options={WINDOWS.map((w) => ({ label: w.label, value: String(w.days) }))}
          />
        </div>

        {/* Inline result */}
        {r && (
          <div className="animate-spring-pop mt-4 flex flex-wrap items-center gap-4 rounded-md border bg-muted/30 px-3 py-3 text-sm tabular-nums">
            <Metric label="return" value={fmt(r.run.totalReturn, "%")} />
            <Metric label="trades" value={r.run.totalTrades?.toString() ?? "—"} />
            <Metric label="PF" value={pfLabel(r.run.profitFactor != null ? parseFloat(r.run.profitFactor) : null)} />
            <Metric label="span" value={`${r.run.spanDays}d`} />
            <StatusPill tone={r.source === "cache" ? "muted" : "success"}>
              {r.source === "cache" ? <Database className="h-3 w-3" /> : <Zap className="h-3 w-3" />}
              {r.source}
            </StatusPill>
          </div>
        )}
        {run.error && <p className="mt-2 text-sm text-destructive">{run.error.message}</p>}

        {shownCode ? (
          <div className="mt-3">
            <CopyCode code={shownCode} />
          </div>
        ) : r ? (
          <div className="mt-3 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={fetchCode.isPending}
              onClick={() => fetchCode.mutate({ runId: r.run.id })}
            >
              {fetchCode.isPending ? "Fetching…" : "Fetch Jester code"}
            </Button>
            {fetchCode.error && <span className="text-xs text-destructive">{fetchCode.error.message}</span>}
          </div>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setOptOpen(true)}>
            <Sparkles className="h-3.5 w-3.5" />
            Optimize…
          </Button>
          <Button size="sm" disabled={run.isPending} onClick={() => run.mutate({ strategyId, ...cell })}>
            <Play className={run.isPending ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
            {run.isPending ? "Running…" : "Backtest"}
          </Button>
        </div>
      </Dialog>

      <OptimizeDialog
        open={optOpen}
        onClose={() => setOptOpen(false)}
        strategyId={strategyId}
        strategyName={strategyId}
        cell={cell}
      />
    </>
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

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 appearance-none rounded-md border border-input bg-background pl-3 pr-7 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
