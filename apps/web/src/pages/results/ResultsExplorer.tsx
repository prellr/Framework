import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUpDown, ArrowDown, ArrowUp, Check, Copy, Database, Download, Search, Zap } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { trpc } from "@/lib/trpc";
import type { RouterOutput } from "@framework/api/router";
import { cn } from "@/lib/utils";
import { pfLabel, isInfinitePf } from "@/lib/metrics";
import { ActivateDialog } from "@/pages/trading/ActivateDialog";

type Row = RouterOutput["results"]["query"][number];

const num = (v: string | null) => (v == null ? null : parseFloat(v));

type SortKey = "profitFactor" | "totalReturn" | "totalTrades" | "maxDrawdown" | "spanDays" | "ranAt";
const COLUMNS: { key: SortKey; label: string; align: "left" | "right"; fmt?: (r: Row) => string }[] = [
  { key: "totalReturn", label: "Return", align: "right", fmt: (r) => pct(r.totalReturn) },
  { key: "totalTrades", label: "Trades", align: "right", fmt: (r) => r.totalTrades?.toString() ?? "—" },
  { key: "profitFactor", label: "PF", align: "right", fmt: (r) => dec(r.profitFactor) },
  { key: "maxDrawdown", label: "Max DD", align: "right", fmt: (r) => pct(r.maxDrawdown) },
  { key: "spanDays", label: "Span", align: "right", fmt: (r) => `${r.spanDays}d` },
];

const pct = (v: string | null) => (num(v) == null ? "—" : `${num(v)!.toFixed(2)}%`);
const dec = (v: string | null) => (num(v) == null ? "—" : num(v)!.toFixed(2));

const windowLabel = (d: number) => (d >= 100000 ? "max" : `${d}d`);

/** Serialize the currently-shown rows to CSV and trigger a client-side download. */
function downloadCsv(rows: Row[]) {
  const cols: { h: string; get: (r: Row) => string | number | null }[] = [
    { h: "strategyId", get: (r) => r.strategyId },
    { h: "pair", get: (r) => r.pair },
    { h: "timeframe", get: (r) => r.timeframe },
    { h: "daysRequested", get: (r) => r.daysRequested },
    { h: "spanDays", get: (r) => r.spanDays },
    { h: "totalReturn", get: (r) => r.totalReturn },
    { h: "totalTrades", get: (r) => r.totalTrades },
    { h: "winRate", get: (r) => r.winRate },
    { h: "maxDrawdown", get: (r) => r.maxDrawdown },
    { h: "sharpe", get: (r) => r.sharpe },
    { h: "profitFactor", get: (r) => r.profitFactor },
    { h: "jesterParamCode", get: (r) => r.jesterParamCode },
    { h: "ranAt", get: (r) => new Date(r.ranAt).toISOString() },
  ];
  const esc = (v: string | number | null) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.map((c) => c.h).join(",")];
  for (const r of rows) lines.push(cols.map((c) => esc(c.get(r))).join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `jester-results-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Copyable strategy config — everything needed to reproduce a winning row. */
function configText(r: Row): string {
  return JSON.stringify(
    {
      strategyId: r.strategyId,
      pair: r.pair,
      timeframe: r.timeframe,
      days: r.daysRequested,
      jesterParamCode: r.jesterParamCode ?? null,
      parameters: r.parameters ?? {},
    },
    null,
    2,
  );
}

export function ResultsExplorer() {
  const [pair, setPair] = useState<string>("");
  const [timeframe, setTimeframe] = useState<string>("");
  const [strategyQ, setStrategyQ] = useState<string>("");
  const [win, setWin] = useState<string>(""); // daysRequested as string; "" = all
  const [minPf, setMinPf] = useState<string>("");
  const [minReturn, setMinReturn] = useState<string>("");
  // Off by default — crypto backtests over short windows often run < 20 trades, so gating
  // by default hides most results (including ones the user just ran). Opt-in for rigor.
  const [gateLowN, setGateLowN] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "profitFactor", dir: "desc" });
  const navigate = useNavigate();
  const [activateTarget, setActivateTarget] = useState<Row | null>(null);
  const me = trpc.admin.me.useQuery(undefined, { staleTime: 60_000 });
  const canTrade = ["manager", "admin"].includes((me.data?.role as string) ?? "");

  const q = trpc.results.query.useQuery({
    pair: pair || undefined,
    timeframe: timeframe || undefined,
    limit: 500,
  });

  // Dedup now happens in SQL (results.query collapses on the result signature via DISTINCT ON and
  // returns a `variants` count), so the only client-side filter left is dropping infinite-PF rows —
  // the "zero losing trades" sentinel, effectively a 1-trade fluke rather than a real edge.
  const deduped = useMemo(
    () => (q.data ?? []).filter((r) => !isInfinitePf(num(r.profitFactor))),
    [q.data],
  );

  const MIN_TRADES = 20;
  const rows = useMemo(() => {
    let list = deduped;
    if (gateLowN) list = list.filter((r) => (r.totalTrades ?? 0) >= MIN_TRADES);
    if (strategyQ.trim()) {
      const t = strategyQ.trim().toLowerCase();
      list = list.filter((r) => r.strategyId.toLowerCase().includes(t));
    }
    if (win) list = list.filter((r) => r.daysRequested === Number(win));
    const pf = parseFloat(minPf);
    if (Number.isFinite(pf)) list = list.filter((r) => (num(r.profitFactor) ?? -Infinity) >= pf);
    const ret = parseFloat(minReturn);
    if (Number.isFinite(ret)) list = list.filter((r) => (num(r.totalReturn) ?? -Infinity) >= ret);
    const val = (r: Row): number => {
      if (sort.key === "ranAt") return new Date(r.ranAt).getTime();
      if (sort.key === "totalTrades") return r.totalTrades ?? -Infinity;
      if (sort.key === "spanDays") return r.spanDays ?? -Infinity;
      return num(r[sort.key] as string | null) ?? -Infinity;
    };
    return [...list].sort((a, b) => (sort.dir === "desc" ? val(b) - val(a) : val(a) - val(b)));
  }, [deduped, gateLowN, strategyQ, win, minPf, minReturn, sort]);

  const pairs = useMemo(() => [...new Set((q.data ?? []).map((r) => r.pair))], [q.data]);
  const tfs = useMemo(() => [...new Set((q.data ?? []).map((r) => r.timeframe))], [q.data]);
  const wins = useMemo(
    () => [...new Set((q.data ?? []).map((r) => r.daysRequested))].sort((a, b) => a - b),
    [q.data],
  );
  const anyFilter = !!(strategyQ.trim() || win || minPf || minReturn || pair || timeframe || gateLowN);
  const clearFilters = () => {
    setStrategyQ("");
    setWin("");
    setMinPf("");
    setMinReturn("");
    setPair("");
    setTimeframe("");
    setGateLowN(false);
  };

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));

  if (q.data && q.data.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Results Warehouse" subtitle="Every backtest, deduplicated and shared." />
        <EmptyState
          icon={Database}
          title="Warehouse is empty"
          description="Run a backtest from the Catalog, or launch a Sweep — results land here."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Results Warehouse"
        subtitle="Every backtest ever run, shared across the team. Repeat runs — and parameter sets that produced an identical result on the same cell — collapse to one row (tagged with how many collapsed). Filter by pair/timeframe, click a column to sort, and toggle the sample-size gate to hide statistically thin (< 20 trade) runs. Profit factor > 1 = an edge."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadCsv(rows)}
            disabled={rows.length === 0}
            title="Download the filtered rows as CSV"
          >
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-48 flex-1 items-center gap-2 rounded-md border border-input bg-background px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={strategyQ}
            onChange={(e) => setStrategyQ(e.target.value)}
            placeholder="Filter by strategy…"
            className="h-9 w-full bg-transparent text-sm outline-none"
          />
        </div>
        <Select value={pair} onChange={setPair} placeholder="All pairs" options={pairs} />
        <Select value={timeframe} onChange={setTimeframe} placeholder="All timeframes" options={tfs} />
        <Select
          value={win}
          onChange={setWin}
          placeholder="All windows"
          options={wins.map((d) => ({ value: String(d), label: windowLabel(d) }))}
        />
        <NumFilter value={minPf} onChange={setMinPf} label="Min PF" width="w-24" />
        <NumFilter value={minReturn} onChange={setMinReturn} label="Min ret %" width="w-28" />
        <button
          onClick={() => setGateLowN((v) => !v)}
          className={cn(
            "transition-spring rounded-md border px-3 py-1.5 text-xs font-medium",
            gateLowN ? "border-primary bg-primary text-primary-foreground" : "border-input text-muted-foreground",
          )}
        >
          ≥{MIN_TRADES} trades
        </button>
        {anyFilter && (
          <button onClick={clearFilters} className="rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:underline">
            Clear
          </button>
        )}
        <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground">
          {rows.length} of {deduped.length} unique
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Strategy</th>
              <th className="px-3 py-2">Pair</th>
              <th className="px-3 py-2">TF</th>
              {COLUMNS.map((c) => (
                <th key={c.key} className="px-3 py-2 text-right">
                  <button
                    onClick={() => toggleSort(c.key)}
                    className="ml-auto inline-flex items-center gap-1 hover:text-foreground"
                  >
                    {c.label}
                    <SortIcon active={sort.key === c.key} dir={sort.dir} />
                  </button>
                </th>
              ))}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No results match these filters.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const ret = num(r.totalReturn);
              const pf = num(r.profitFactor);
              return (
                <tr
                  key={r.id}
                  onClick={() => navigate({ to: "/strategy/$strategyId", params: { strategyId: r.strategyId }, search: {} })}
                  className="cursor-pointer border-b last:border-0 hover:bg-accent/40"
                  title="Open this strategy's full detail — data, optimize, activate"
                >
                  <td className="max-w-56 px-3 py-2 font-medium">
                    <span className="block truncate">{r.strategyId}</span>
                    {(r as any).variants > 1 && (
                      <span
                        className="mt-0.5 inline-block rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium uppercase text-warning"
                        title={`${(r as any).variants} parameter sets produced an identical result on this cell — this strategy ignores parameter overrides, so tuning it changes nothing.`}
                      >
                        ×{(r as any).variants} identical params
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{r.pair}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.timeframe}</td>
                  <td className={cn("px-3 py-2 text-right tabular-nums", ret != null && (ret >= 0 ? "text-success" : "text-destructive"))}>
                    {pct(r.totalReturn)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.totalTrades ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      {pfLabel(num(r.profitFactor))}
                      {pf != null && (
                        <StatusPill tone={pf > 1 ? "success" : "warning"} className="px-1.5 py-0">
                          {pf > 1 ? "edge" : "loser"}
                        </StatusPill>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(r.maxDrawdown)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.spanDays}d</td>
                  <td className="px-2 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {canTrade && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActivateTarget(r);
                          }}
                          title="Activate this strategy live on Jester"
                          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-primary"
                        >
                          <Zap className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <CopyConfigButton row={r} />
                    </div>
                  </td>
                </tr>
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
        />
      )}
    </div>
  );
}

/** Copies a row's reproducible config JSON to the clipboard. Stops row-click propagation. */
function CopyConfigButton({ row }: { row: Row }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(configText(row)).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      title="Copy config (strategy, pair, timeframe, window, code)"
      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
  return dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />;
}

function Select({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: (string | { value: string; label: string })[];
}) {
  const opts = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <option value="">{placeholder}</option>
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Compact numeric filter input with a placeholder label. */
function NumFilter({
  value,
  onChange,
  label,
  width,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  width: string;
}) {
  return (
    <input
      type="number"
      step="any"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={label}
      className={
        "h-9 rounded-md border border-input bg-background px-3 text-sm tabular-nums outline-none focus-visible:ring-1 focus-visible:ring-ring " +
        width
      }
    />
  );
}
