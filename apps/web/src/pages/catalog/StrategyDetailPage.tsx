import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { ArrowLeft, BookOpen, LogIn, LogOut, Activity, Shield, Sparkles, Database, Play, Zap } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import { CopyCode } from "@/components/ui/copy-code";
import { AssetPicker } from "@/components/ui/asset-picker";
import { OptimizeDialog } from "@/pages/catalog/OptimizeDialog";
import { ActivateDialog } from "@/pages/trading/ActivateDialog";
import { trpc } from "@/lib/trpc";
import { describeParam, CATEGORY_LABEL, type ParamCategory } from "@/lib/param-glossary";
import { pfLabel, pfRank } from "@/lib/metrics";
import type { RouterOutput } from "@framework/api/router";

type RobustnessReport = RouterOutput["robustness"]["evaluate"];

const TFS = ["5m", "15m", "1h", "4h"];
const WINDOWS: { label: string; days: number }[] = [
  { label: "30d", days: 30 },
  { label: "60d", days: 60 },
  { label: "90d", days: 90 },
  { label: "max", days: 100000 },
];

type RKey = "pair" | "tf" | "params" | "return" | "trades" | "pf" | "maxdd" | "span";

const num = (v: string | null) => (v == null ? null : parseFloat(v));
const pct = (v: string | null) => (num(v) == null ? "—" : `${num(v)!.toFixed(2)}%`);
const dec = (v: string | null) => (num(v) == null ? "—" : num(v)!.toFixed(2));

export function StrategyDetailPage() {
  const { strategyId } = useParams({ strict: false }) as { strategyId: string };
  const utils = trpc.useUtils();
  const detail = trpc.catalog.detail.useQuery({ id: strategyId });
  const params = trpc.catalog.params.useQuery({ id: strategyId });
  const me = trpc.admin.me.useQuery(undefined, { staleTime: 60_000 });
  const canRun = ["operator", "manager", "admin"].includes((me.data?.role as string) ?? "");
  const canTrade = ["manager", "admin"].includes((me.data?.role as string) ?? "");
  const liveStatus = trpc.trading.liveStatus.useQuery({ strategyId }, { enabled: canTrade, refetchInterval: 60_000 });
  const paramPerf = trpc.trading.paramPerformance.useQuery({ strategyId }, { enabled: canTrade });

  // Action cell (asset · timeframe · window), resolved in priority order:
  //   1. link context (?pair&tf&days) — e.g. clicked from By Asset / Results / Charts
  //   2. the cell last used on THIS strategy — so returning from Optimize/Sweep lands where you left
  //   3. the strategy's best result (seeded from data once it loads)
  // Without (2), navigating away to a sweep and coming back silently reset the window/asset.
  //
  // Read (1) from the router, NOT window.location: arriving here from ⌘K while already on a
  // strategy page is a search-param change on the same route, so the component never remounts. A
  // mount-only read left the cell frozen — clicking a param code for the strategy you were already
  // viewing changed the URL and nothing else.
  const storeKey = `jester.strategy.cell.${strategyId}`;
  const sp = useSearch({ strict: false }) as { pair?: string; tf?: string; days?: number };
  const linked = useMemo(
    () =>
      sp.pair && sp.tf && Number.isFinite(sp.days) && (sp.days as number) > 0
        ? { pair: sp.pair, timeframe: sp.tf, days: sp.days as number }
        : null,
    [sp.pair, sp.tf, sp.days],
  );
  const remembered = useMemo(() => {
    try {
      const s = localStorage.getItem(storeKey);
      if (s) {
        const c = JSON.parse(s);
        if (c?.pair && c?.timeframe && typeof c?.days === "number") return c as typeof linked;
      }
    } catch {
      /* ignore */
    }
    return null;
  }, [storeKey]);
  const initialCell = linked ?? remembered;
  const [cell, setCell] = useState(initialCell ?? { pair: "BTC-USD", timeframe: "15m", days: 30 });
  const [seeded, setSeeded] = useState(!!initialCell);
  useEffect(() => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(cell));
    } catch {
      /* ignore */
    }
  }, [storeKey, cell]);

  // Re-point the cell when the link context changes *after* mount (⌘K → a param code while already
  // on a strategy page). Also re-arm best-result seeding when the strategy itself changes, so a
  // context-free hop lands on the new strategy's best cell rather than the previous one's.
  // `applied` guards the mount pass: initialCell already handled it, and clearing `seeded` here on
  // mount would let the best-result seeder stomp a remembered cell.
  const applied = useRef(`${strategyId}|${linked?.pair}|${linked?.timeframe}|${linked?.days}`);
  useEffect(() => {
    const sig = `${strategyId}|${linked?.pair}|${linked?.timeframe}|${linked?.days}`;
    if (sig === applied.current) return;
    applied.current = sig;
    if (linked) {
      setCell(linked);
      setSeeded(true);
    } else {
      setSeeded(false); // no context: let the new strategy's best result seed the cell
    }
  }, [strategyId, linked]);

  const [optimizeOpen, setOptimizeOpen] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);
  const runOne = trpc.results.runOne.useMutation({ onSuccess: () => utils.catalog.detail.invalidate() });
  const robustness = trpc.robustness.evaluate.useMutation();

  // Results table sort + filter state.
  const [rSort, setRSort] = useState<{ key: RKey; dir: "asc" | "desc" }>({ key: "pf", dir: "desc" });
  const [rPair, setRPair] = useState("");
  const [rParams, setRParams] = useState<"all" | "default" | "custom">("all");
  const [rMinPf, setRMinPf] = useState("");
  const [rMinTrades, setRMinTrades] = useState("");

  // Seed the action cell to the strategy's best result once data loads (before any early return).
  useEffect(() => {
    if (seeded) return;
    const rs = detail.data?.results ?? [];
    if (rs.length === 0) return;
    const b = rs.reduce<(typeof rs)[number] | null>((acc, r) => {
      const n = (v: string | null) => (v == null ? null : parseFloat(v));
      if (!acc || pfRank(n(r.profitFactor), r.totalTrades) > pfRank(n(acc.profitFactor), acc.totalTrades)) return r;
      return acc;
    }, null);
    if (b) {
      setCell({ pair: b.pair, timeframe: b.timeframe, days: b.daysRequested });
      setSeeded(true);
    }
  }, [detail.data, seeded]);

  const s = detail.data?.strategy;
  const doc = detail.data?.doc;
  const results = detail.data?.results ?? [];
  const keyParamWhy = useMemo(() => {
    const map = new Map<string, string>();
    for (const kp of (doc?.keyParams as { name: string; why: string }[] | null) ?? []) map.set(kp.name, kp.why);
    return map;
  }, [doc]);

  // Filter + sort the backtest results (client-side; the set is small per strategy).
  const shownResults = useMemo(() => {
    const minPf = parseFloat(rMinPf);
    const minTr = parseFloat(rMinTrades);
    const term = rPair.trim().toLowerCase();
    const filtered = results.filter((r) => {
      if (term && !r.pair.toLowerCase().includes(term)) return false;
      if (rParams === "default" && r.paramHash !== "default") return false;
      if (rParams === "custom" && r.paramHash === "default") return false;
      if (Number.isFinite(minPf) && !(num(r.profitFactor) != null && num(r.profitFactor)! >= minPf)) return false;
      if (Number.isFinite(minTr) && !((r.totalTrades ?? 0) >= minTr)) return false;
      return true;
    });
    const dir = rSort.dir === "asc" ? 1 : -1;
    const val = (r: (typeof results)[number]): string | number => {
      switch (rSort.key) {
        case "pair": return r.pair;
        case "tf": return r.timeframe;
        case "params": return r.paramHash === "default" ? "default" : (r.jesterParamCode ?? "custom");
        case "return": return num(r.totalReturn) ?? -Infinity;
        case "trades": return r.totalTrades ?? -Infinity;
        case "pf": return num(r.profitFactor) ?? -Infinity;
        case "maxdd": return num(r.maxDrawdown) ?? -Infinity;
        case "span": return r.spanDays ?? -Infinity;
      }
    };
    return [...filtered].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (typeof va === "string" || typeof vb === "string") return String(va).localeCompare(String(vb)) * dir;
      return (va - vb) * dir;
    });
  }, [results, rPair, rParams, rMinPf, rMinTrades, rSort]);
  // The stored result for the CURRENTLY SELECTED cell — so changing the asset/timeframe/window
  // immediately reflects that choice instead of leaving the page looking inert.
  const cellResult = useMemo(() => {
    const rs = detail.data?.results ?? [];
    const match = rs.filter(
      (r) => r.pair === cell.pair && r.timeframe === cell.timeframe && r.daysRequested === cell.days,
    );
    return match.find((r) => r.paramHash === "default") ?? match[0] ?? null;
  }, [detail.data, cell]);

  const toggleRSort = (key: RKey) =>
    setRSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "pair" || key === "tf" || key === "params" ? "asc" : "desc" },
    );
  const rArrow = (key: RKey) => (rSort.key === key ? (rSort.dir === "asc" ? " ↑" : " ↓") : "");

  if (detail.isLoading) {
    return <p className="p-8 text-center text-muted-foreground">Loading…</p>;
  }
  if (!s) {
    return (
      <div className="space-y-4">
        <BackLink />
        <p className="text-muted-foreground">Strategy not found.</p>
      </div>
    );
  }

  const risk = (s.riskSettings as Record<string, unknown> | null) ?? null;
  const features = (s.features as string[] | null) ?? [];
  const tunable = new Set(params.data?.tunable ?? []);
  const defaults = (params.data?.defaults as Record<string, unknown> | undefined) ?? {};

  // Best warehouse result (highest PF) as a headline stat.
  const best = results.reduce<(typeof results)[number] | null>((acc, r) => {
    if (!acc || pfRank(num(r.profitFactor), r.totalTrades) > pfRank(num(acc.profitFactor), acc.totalTrades)) return r;
    return acc;
  }, null);

  const windowLabel = (d: number) => (d >= 100000 ? "max" : `${d}d`);

  return (
    <div className="space-y-6">
      <BackLink />

      <PageHeader
        title={s.name}
        subtitle={<span className="font-mono text-xs">{s.id}</span>}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {s.tier && <Badge variant="default">{s.tier}</Badge>}
            {s.nativeTimeframe && <Badge variant="secondary">{s.nativeTimeframe}</Badge>}
            {s.tunable === true && (
              <span className="rounded bg-success/15 px-2 py-0.5 text-xs font-semibold uppercase text-success" title="Jester honors parameter overrides — guided optimize works">
                tunable
              </span>
            )}
            {s.tunable === false && (
              <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium uppercase text-muted-foreground" title="Jester ignores parameter overrides — can't be optimized via the API">
                fixed params
              </span>
            )}
            {s.defaultParamCode && <CopyCode code={s.defaultParamCode} label="default code" />}
          </div>
        }
      />

      {/* Actions — backtest / optimize / activate on a chosen cell */}
      {canRun && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 py-3">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cell</span>
            <AssetPicker value={cell.pair} onChange={(pair) => setCell((c) => ({ ...c, pair }))} />
            <select
              value={cell.timeframe}
              onChange={(e) => setCell((c) => ({ ...c, timeframe: e.target.value }))}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {TFS.map((tf) => <option key={tf} value={tf}>{tf}</option>)}
            </select>
            <select
              value={String(cell.days)}
              onChange={(e) => setCell((c) => ({ ...c, days: Number(e.target.value) }))}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {WINDOWS.map((w) => <option key={w.days} value={w.days}>{w.label}</option>)}
            </select>
            <div className="ml-auto flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={runOne.isPending}
                // Focus the results table on the cell just run, so a fresh result is visible
                // instead of buried in a PF-sorted list of every pair.
                onClick={() =>
                  runOne.mutate({ strategyId: s.id, ...cell }, { onSuccess: () => setRPair(cell.pair) })
                }
              >
                <Play className={runOne.isPending ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
                {runOne.isPending ? "Running…" : `Backtest ${windowLabel(cell.days)}`}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setOptimizeOpen(true)}
                disabled={s.tunable === false}
                title={
                  s.tunable === false
                    ? "This strategy ignores parameter overrides — optimizing has no effect"
                    : undefined
                }
              >
                <Sparkles className="h-3.5 w-3.5" /> Optimize
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={robustness.isPending}
                onClick={() => robustness.mutate({ strategyId: s.id, pair: cell.pair, timeframe: cell.timeframe })}
                title="Run this cell at 30/60/90/180d and score whether the edge holds across horizons"
              >
                <Shield className={robustness.isPending ? "h-3.5 w-3.5 animate-pulse" : "h-3.5 w-3.5"} />
                {robustness.isPending ? "Validating…" : "Validate"}
              </Button>
              {canTrade && (
                <Button size="sm" onClick={() => setActivateOpen(true)}>
                  <Zap className="h-3.5 w-3.5" /> Activate
                </Button>
              )}
            </div>

            {/* State of the SELECTED cell — updates the moment you change asset/timeframe/window. */}
            <div className="w-full border-t pt-2 text-xs">
              {runOne.isPending ? (
                <span className="text-muted-foreground">
                  Backtesting <span className="font-mono">{cell.pair} · {cell.timeframe} · {windowLabel(cell.days)}</span>…
                </span>
              ) : cellResult ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-muted-foreground">
                    {cell.pair} · {cell.timeframe} · {windowLabel(cell.days)}
                  </span>
                  <span className={num(cellResult.totalReturn) != null && num(cellResult.totalReturn)! >= 0 ? "text-success" : "text-destructive"}>
                    {pct(cellResult.totalReturn)}
                  </span>
                  <span className="text-muted-foreground">PF {pfLabel(num(cellResult.profitFactor))}</span>
                  <span className="text-muted-foreground">{cellResult.totalTrades ?? "—"} trades</span>
                  <span className="text-muted-foreground">{cellResult.spanDays}d span</span>
                  {runOne.data && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                      {(runOne.data as any).source === "fresh" ? "just run" : "cached"}
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-muted-foreground">
                  No stored backtest for{" "}
                  <span className="font-mono">{cell.pair} · {cell.timeframe} · {windowLabel(cell.days)}</span> — click
                  Backtest to run it.
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Robustness validation — does the edge hold across 30/60/90/180d, or only recently? */}
      {(robustness.isPending || robustness.data || robustness.error) && (
        <RobustnessCard
          pending={robustness.isPending}
          report={robustness.data as any}
          error={robustness.error?.message ?? null}
          cellLabel={`${cell.pair} · ${cell.timeframe}`}
        />
      )}

      {/* Live-trading status — is this strategy running now, and where was it activated? */}
      {canTrade && liveStatus.data?.live && <LiveBanner live={liveStatus.data.live} activatedHere={liveStatus.data.activatedHere} />}

      {/* Which parameter set actually performed best, attributed from the live fill ledger. */}
      {canTrade && (paramPerf.data?.periods?.length ?? 0) > 0 && (
        <ParamPerformanceCard periods={paramPerf.data!.periods as any[]} />
      )}
      {runOne.error && <p className="text-sm text-destructive">{runOne.error.message}</p>}

      {/* Concept + setup — one compact card. Description on top, then Entry/Exit/Indicators as
          three tight columns, then Concepts + risk settings. Collapses five padded cards into one. */}
      {(s.description || s.entrySummary || s.exitSummary || s.indicatorSummary || features.length > 0 || risk) && (
        <Card>
          <CardContent className="space-y-4 p-4">
            {s.description && <p className="text-sm leading-relaxed">{s.description}</p>}

            {(s.entrySummary || s.exitSummary || s.indicatorSummary) && (
              <div className="grid gap-x-6 gap-y-4 border-t pt-4 md:grid-cols-3">
                {s.entrySummary && <Field icon={LogIn} label="Entry">{s.entrySummary}</Field>}
                {s.exitSummary && <Field icon={LogOut} label="Exit">{s.exitSummary}</Field>}
                {s.indicatorSummary && <Field icon={Activity} label="Indicators">{s.indicatorSummary}</Field>}
              </div>
            )}

            {(features.length > 0 || risk) && (
              <div className="grid gap-x-8 gap-y-4 border-t pt-4 md:grid-cols-2">
                {features.length > 0 && (
                  <div>
                    <FieldLabel icon={Sparkles} label="Concepts" />
                    <div className="flex flex-wrap gap-1.5">
                      {features.map((f) => (
                        <span key={f} className="rounded-md bg-muted px-2 py-0.5 text-xs">{f}</span>
                      ))}
                    </div>
                  </div>
                )}
                {risk && (
                  <div>
                    <FieldLabel icon={Shield} label="Default risk settings" />
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                      {Object.entries(risk).map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-2 border-b border-border/40 pb-0.5">
                          <span className="truncate text-muted-foreground" title={k}>{k}</span>
                          <span className="font-mono tabular-nums">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Authored deep-dive */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpen className="h-4 w-4 text-muted-foreground" /> How &amp; why it works
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {doc?.content ? (
            <MiniMarkdown text={doc.content} />
          ) : (
            <p className="text-sm text-muted-foreground">
              A deep-dive for this strategy hasn't been written yet. The concept, entry/exit and
              parameters above are Jester's own documentation.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Warehouse results — above the parameters so the evidence leads. Click a row to load that
          cell into the action bar; managers get a per-row Activate that deploys the pair's ranked combo. */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" /> Backtest results
            </span>
            {best && (
              <span className="text-xs font-normal text-muted-foreground">
                best PF {pfLabel(num(best.profitFactor))} on {best.pair} {best.timeframe}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {results.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No backtests yet — run one from the Catalog.
            </p>
          ) : (
            <>
              {/* Filter bar */}
              <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2">
                <Input
                  placeholder="Filter pair…"
                  value={rPair}
                  onChange={(e) => setRPair(e.target.value)}
                  className="h-8 w-36"
                />
                <select
                  value={rParams}
                  onChange={(e) => setRParams(e.target.value as "all" | "default" | "custom")}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="all">All params</option>
                  <option value="default">Default</option>
                  <option value="custom">Custom</option>
                </select>
                <Input
                  type="number"
                  step="0.1"
                  placeholder="Min PF"
                  value={rMinPf}
                  onChange={(e) => setRMinPf(e.target.value)}
                  className="h-8 w-24"
                />
                <Input
                  type="number"
                  placeholder="Min trades"
                  value={rMinTrades}
                  onChange={(e) => setRMinTrades(e.target.value)}
                  className="h-8 w-28"
                />
                {(rPair || rParams !== "all" || rMinPf || rMinTrades) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8"
                    onClick={() => {
                      setRPair("");
                      setRParams("all");
                      setRMinPf("");
                      setRMinTrades("");
                    }}
                  >
                    Clear
                  </Button>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {shownResults.length} of {results.length}
                </span>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="cursor-pointer select-none px-4 py-2 hover:text-foreground" onClick={() => toggleRSort("pair")}>Pair{rArrow("pair")}</th>
                    <th className="cursor-pointer select-none px-3 py-2 hover:text-foreground" onClick={() => toggleRSort("tf")}>TF{rArrow("tf")}</th>
                    <th className="cursor-pointer select-none px-3 py-2 hover:text-foreground" onClick={() => toggleRSort("params")}>Params{rArrow("params")}</th>
                    <th className="cursor-pointer select-none px-3 py-2 text-right hover:text-foreground" onClick={() => toggleRSort("return")}>Return{rArrow("return")}</th>
                    <th className="cursor-pointer select-none px-3 py-2 text-right hover:text-foreground" onClick={() => toggleRSort("trades")}>Trades{rArrow("trades")}</th>
                    <th className="cursor-pointer select-none px-3 py-2 text-right hover:text-foreground" onClick={() => toggleRSort("pf")}>PF{rArrow("pf")}</th>
                    <th className="cursor-pointer select-none px-3 py-2 text-right hover:text-foreground" onClick={() => toggleRSort("maxdd")}>Max DD{rArrow("maxdd")}</th>
                    <th className="cursor-pointer select-none px-3 py-2 text-right hover:text-foreground" onClick={() => toggleRSort("span")}>Span{rArrow("span")}</th>
                    {canTrade && <th className="px-3 py-2 text-right">Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {shownResults.length === 0 && (
                    <tr>
                      <td colSpan={canTrade ? 9 : 8} className="px-4 py-6 text-center text-sm text-muted-foreground">
                        No results match the filters.
                      </td>
                    </tr>
                  )}
                  {shownResults.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => setCell({ pair: r.pair, timeframe: r.timeframe, days: r.daysRequested })}
                      className={
                        "border-t last:border-0 cursor-pointer hover:bg-muted/40 " +
                        (cell.pair === r.pair && cell.timeframe === r.timeframe && cell.days === r.daysRequested
                          ? "bg-muted/30"
                          : "")
                      }
                      title="Load this cell into the action bar above"
                    >
                      <td className="px-4 py-2 font-medium">{r.pair}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.timeframe}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {r.paramHash === "default" ? "default" : (r.jesterParamCode ?? "custom")}
                        {(r as any).variants > 1 && (
                          <span
                            className="ml-1.5 rounded bg-warning/15 px-1 py-0.5 text-[10px] font-medium uppercase text-warning"
                            title={`${(r as any).variants} parameter sets produced an identical result on this cell — this strategy ignores parameter overrides, so tuning it changes nothing.`}
                          >
                            ×{(r as any).variants}
                          </span>
                        )}
                      </td>
                      <td className={"px-3 py-2 text-right tabular-nums " + (num(r.totalReturn) != null ? (num(r.totalReturn)! >= 0 ? "text-success" : "text-destructive") : "")}>
                        {pct(r.totalReturn)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.totalTrades ?? "—"}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{pfLabel(num(r.profitFactor))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{pct(r.maxDrawdown)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.spanDays}d</td>
                      {canTrade && (
                        <td className="px-3 py-2 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCell({ pair: r.pair, timeframe: r.timeframe, days: r.daysRequested });
                              setActivateOpen(true);
                            }}
                          >
                            <Zap className="h-3.5 w-3.5" /> Activate
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Parameters */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base">Parameters &amp; their impact</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {params.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading parameters…</p>
          ) : Object.keys(defaults).length === 0 ? (
            <p className="text-sm text-muted-foreground">No parameters exposed for this strategy.</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(defaults).map(([name, value]) => {
                const info = describeParam(name);
                const why = keyParamWhy.get(name);
                const isObj = value !== null && typeof value === "object";
                return (
                  <div key={name} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-mono text-sm font-medium">{name}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        = {isObj ? JSON.stringify(value) : String(value)}
                      </span>
                      {tunable.has(name) && (
                        <StatusPill tone="success" className="px-1.5 py-0">tunable</StatusPill>
                      )}
                      {info && (
                        <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
                          {CATEGORY_LABEL[info.category as ParamCategory]}
                        </span>
                      )}
                    </div>
                    {info && <p className="mt-1 text-sm text-muted-foreground">{info.summary}</p>}
                    {info?.impact && <p className="mt-0.5 text-xs text-muted-foreground/80">{info.impact}</p>}
                    {why && (
                      <p className="mt-1 text-xs text-primary">
                        <span className="font-medium">Why it matters here:</span> {why}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <OptimizeDialog
        open={optimizeOpen}
        onClose={() => setOptimizeOpen(false)}
        strategyId={s.id}
        strategyName={s.name}
        cell={cell}
      />
      {activateOpen && (
        <ActivateDialog
          open={activateOpen}
          onClose={() => setActivateOpen(false)}
          strategyId={s.id}
          strategyName={s.name}
          pair={cell.pair}
          timeframe={cell.timeframe}
          days={cell.days}
        />
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/catalog" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" /> Back to catalog
    </Link>
  );
}

/**
 * Live performance broken out BY PARAMETER SET. Jester's own per-strategy numbers span parameter
 * changes, so they can't answer "which params did best". We record when each param set was live and
 * attribute Hyperliquid fills to that window. Honest about its two limits: it only covers time since
 * tracking started, and periods sharing a coin with another strategy are flagged as unattributable.
 */
function ParamPerformanceCard({ periods }: { periods: any[] }) {
  const fmt = (d: string | Date) => new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const money = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
  const withTrades = periods.filter((p) => p.trades > 0);
  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-base">Live performance by parameter set</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Param code</th>
                <th className="px-3 py-2">Cell</th>
                <th className="px-3 py-2">Live window</th>
                <th className="px-3 py-2 text-right">Trades</th>
                <th className="px-3 py-2 text-right">Win %</th>
                <th className="px-3 py-2 text-right">Net</th>
                <th className="px-3 py-2 text-right" title="Net as % of current account — directly measured, no assumption">Acct %</th>
                <th className="px-3 py-2 text-right" title="Net in R units (net ÷ your per-trade risk). Total R, and E[R]/trade in the tooltip.">R</th>
                <th className="px-3 py-2 text-right">Fees</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.id} className="border-t last:border-0">
                  <td className="px-4 py-2 font-mono text-xs">
                    {p.paramHash8 ?? "—"}
                    {p.active && <span className="ml-1.5 rounded bg-success/15 px-1 py-0.5 text-[10px] uppercase text-success">live</span>}
                    {p.ambiguous && (
                      <span
                        className="ml-1.5 rounded bg-warning/15 px-1 py-0.5 text-[10px] uppercase text-warning"
                        title={`Another strategy (${p.ambiguousWith.join(", ")}) traded this coin in the same window — fills can't be uniquely attributed.`}
                      >
                        shared
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{p.pair} · {p.timeframe}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {fmt(p.startedAt)} → {p.endedAt ? fmt(p.endedAt) : "now"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.trades}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.trades ? `${p.winRate.toFixed(0)}%` : "—"}</td>
                  <td className={"px-3 py-2 text-right tabular-nums " + (p.net >= 0 ? "text-success" : "text-destructive")}>
                    {p.trades ? money(p.net) : "—"}
                  </td>
                  <td className={"px-3 py-2 text-right tabular-nums " + (p.accountPct != null && p.accountPct < 0 ? "text-destructive" : p.accountPct != null ? "text-success" : "")}>
                    {p.trades && p.accountPct != null ? `${p.accountPct >= 0 ? "+" : ""}${p.accountPct.toFixed(2)}%` : "—"}
                  </td>
                  <td
                    className={"px-3 py-2 text-right tabular-nums " + (p.rMultiple != null && p.rMultiple < 0 ? "text-destructive" : p.rMultiple != null ? "text-success" : "")}
                    title={p.liveExpectancyR != null ? `${p.liveExpectancyR >= 0 ? "+" : ""}${p.liveExpectancyR.toFixed(2)}R per trade` : undefined}
                  >
                    {p.trades && p.rMultiple != null ? `${p.rMultiple >= 0 ? "+" : ""}${p.rMultiple.toFixed(1)}R` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{money(p.fees)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">
          Attributed from the Hyperliquid fill ledger to whichever parameter set was live at the time.
          Covers only the period since tracking began{withTrades.length === 0 ? " — no trades recorded under a tracked param set yet" : ""}.
          Rows marked <span className="font-medium text-warning">shared</span> overlap another strategy on the same
          coin, so their fills can't be uniquely attributed. <span className="font-medium">Acct %</span> and{" "}
          <span className="font-medium">R</span> are the real risk-of-account result — directly measured net ÷ account
          (and ÷ your per-trade risk), no 1R assumption; the account base is the current portfolio value.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * "This strategy is trading live" banner. Shows the live pairs + active param code + live PnL, and —
 * from the audit log — whether it was activated FROM THIS APP or set up directly in Jester.
 */
function LiveBanner({ live, activatedHere }: { live: any; activatedHere: { at: string | Date; action: string } | null }) {
  const perf = live.performance;
  const pnlClass = (v?: number | null) => (v == null ? "" : v >= 0 ? "text-success" : "text-destructive");
  const when = activatedHere ? new Date(activatedHere.at).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;
  return (
    <Card className="border-success/40 bg-success/5">
      <CardContent className="space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-success">
            <span className="h-2 w-2 animate-pulse rounded-full bg-success" /> Trading live now
          </span>
          {perf && perf.totalPnLPct != null && (
            <span className="flex items-center gap-2 text-xs">
              <span className={pnlClass(perf.totalPnLPct)}>{perf.totalPnLPct.toFixed(2)}%</span>
              {perf.totalPnLUsd != null && (
                <span className="text-muted-foreground">${perf.totalPnLUsd.toFixed(2)}</span>
              )}
              {perf.totalTrades != null && <span className="text-muted-foreground">{perf.totalTrades} live trades</span>}
            </span>
          )}
          <Link to="/live" className="ml-auto text-xs text-primary hover:underline">
            Manage on Live Trading →
          </Link>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(live.pairs ?? []).map((p: any, i: number) => (
            <span key={i} className="rounded bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
              {p.pair} · {p.timeframe}
              {p.paramHash8 && <> · {p.paramHash8}</>}
              {typeof p.pnlPct === "number" && <span className={pnlClass(p.pnlPct)}> · {p.pnlPct.toFixed(2)}%</span>}
            </span>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {activatedHere ? (
            <>Activated from this app{when ? ` on ${when}` : ""}.</>
          ) : (
            <>Set up directly in Jester (no activation record in this app) — e.g. a "pick for me" strategy.</>
          )}
        </p>
      </CardContent>
    </Card>
  );
}

/** A compact uppercase section label with an icon — used inside the dense overview card. */
function FieldLabel({ icon: Icon, label }: { icon: typeof LogIn; label: string }) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      <Icon className="h-3.5 w-3.5" /> {label}
    </div>
  );
}

/** A labeled prose block (label + body) for the dense overview grid. */
function Field({ icon, label, children }: { icon: typeof LogIn; label: string; children: React.ReactNode }) {
  return (
    <div>
      <FieldLabel icon={icon} label={label} />
      <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

/**
 * Minimal markdown renderer for authored deep-dives (trusted content). Supports ## / ### headings,
 * **bold**, `- ` / `* ` bullet lists, and paragraphs. Not a general-purpose parser — just enough
 * for the KB's structured prose.
 */
function MiniMarkdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  let list: string[] = [];
  const flushList = () => {
    if (list.length) {
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="my-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {list.map((li, i) => (
            <li key={i}>{inline(li)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^###\s+/.test(line)) {
      flushList();
      blocks.push(<h4 key={blocks.length} className="mt-3 mb-1 text-sm font-semibold">{line.replace(/^###\s+/, "")}</h4>);
    } else if (/^##\s+/.test(line)) {
      flushList();
      blocks.push(<h3 key={blocks.length} className="mt-4 mb-1 font-semibold">{line.replace(/^##\s+/, "")}</h3>);
    } else if (/^[-*]\s+/.test(line)) {
      list.push(line.replace(/^[-*]\s+/, ""));
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      blocks.push(<p key={blocks.length} className="my-2 text-sm leading-relaxed text-muted-foreground">{inline(line)}</p>);
    }
  }
  flushList();
  return <div>{blocks}</div>;
}

/** Render inline **bold** within a line. */
function inline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    /^\*\*[^*]+\*\*$/.test(p) ? (
      <strong key={i} className="font-semibold text-foreground">{p.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

/**
 * Robustness validation result — the same param set run at 30/60/90/180d, scored on whether the
 * edge holds across horizons (the honest stand-in for walk-forward, which Jester's API can't do).
 */
function RobustnessCard({
  pending,
  report,
  error,
  cellLabel,
}: {
  pending: boolean;
  report: RobustnessReport | null | undefined;
  error: string | null;
  cellLabel: string;
}) {
  const TONE: Record<string, { badge: string; label: string }> = {
    robust: { badge: "bg-success/15 text-success", label: "Robust" },
    mixed: { badge: "bg-warning/15 text-warning", label: "Mixed" },
    fragile: { badge: "bg-destructive/15 text-destructive", label: "Fragile" },
    "insufficient-data": { badge: "bg-muted text-muted-foreground", label: "Insufficient data" },
  };
  const pctv = (v: number | null) => (v == null ? "—" : `${v.toFixed(2)}%`);
  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Shield className="h-4 w-4 text-muted-foreground" />
          Robustness — <span className="font-mono text-sm text-muted-foreground">{cellLabel}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {pending ? (
          <p className="text-sm text-muted-foreground">Running 30 / 60 / 90 / 180-day backtests and scoring consistency…</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : report ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className={"rounded px-2 py-0.5 text-xs font-semibold uppercase " + (TONE[report.verdict]?.badge ?? "bg-muted")}>
                {TONE[report.verdict]?.label ?? report.verdict}
              </span>
              <span className="text-sm">
                Score <span className="font-semibold tabular-nums">{report.score}</span>
                <span className="text-muted-foreground">/100</span>
              </span>
              <span className="text-sm text-muted-foreground">
                positive at {report.positiveHorizons}/{report.totalHorizons} horizons
                {report.minProfitFactor != null && <> · worst PF {report.minProfitFactor.toFixed(2)}</>}
                {report.widestTrades != null && <> · {report.widestTrades} trades (widest)</>}
              </span>
            </div>

            {/* Two-axis read: long-term durability vs short-term trajectory. */}
            <OutlookPanel report={report} />

            {report.horizons.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr className="text-left text-xs uppercase text-muted-foreground">
                      <th className="py-1 pr-4 font-medium">Span</th>
                      <th className="py-1 pr-4 font-medium">Return</th>
                      <th className="py-1 pr-4 font-medium" title={`Est. % of account at ${report.riskPct}% risk/trade`}>Acct @{report.riskPct}%</th>
                      <th className="py-1 pr-4 font-medium" title="Per-trade expectancy in R">E[R]</th>
                      <th className="py-1 pr-4 font-medium">PF</th>
                      <th className="py-1 pr-4 font-medium">Win</th>
                      <th className="py-1 pr-4 font-medium">MaxDD</th>
                      <th className="py-1 pr-4 font-medium">Trades</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.horizons.map((h) => (
                      <tr key={h.spanDays} className="border-t">
                        <td className="py-1 pr-4">{h.spanDays}d</td>
                        <td className={"py-1 pr-4 " + (h.totalReturn != null && h.totalReturn >= 0 ? "text-success" : "text-destructive")}>
                          {pctv(h.totalReturn)}
                        </td>
                        <td className={"py-1 pr-4 font-medium " + (h.estAccountReturn != null && h.estAccountReturn >= 0 ? "text-success" : "text-destructive")}>
                          {h.estAccountReturn == null ? "—" : `${h.estAccountReturn >= 0 ? "+" : ""}${h.estAccountReturn.toFixed(1)}%`}
                        </td>
                        <td className={"py-1 pr-4 text-muted-foreground " + (h.expectancyR != null && h.expectancyR < 0 ? "text-destructive" : "")}>
                          {h.expectancyR == null ? "—" : `${h.expectancyR >= 0 ? "+" : ""}${h.expectancyR.toFixed(2)}R`}
                        </td>
                        <td className="py-1 pr-4">{h.profitFactor != null ? h.profitFactor.toFixed(2) : "—"}</td>
                        <td className="py-1 pr-4 text-muted-foreground">{h.winRate != null ? `${h.winRate.toFixed(0)}%` : "—"}</td>
                        <td className="py-1 pr-4 text-muted-foreground">{pctv(h.maxDrawdown)}</td>
                        <td className="py-1 pr-4">{h.totalTrades ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <ul className="space-y-1 text-xs text-muted-foreground">
              {report.reasons.map((r, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="text-muted-foreground/50">•</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground/70">
              Multi-horizon consistency, not true walk-forward — Jester's backtest only runs windows ending now, so
              this checks whether the edge holds as the window widens rather than on a held-out future period.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * The two-axis outlook: LONG-term durability (the robustness verdict) paired with SHORT-term
 * trajectory (is the recent slice pacing up or down). Together they separate "was good, now decaying"
 * from "was bad, now recovering" — opposite trades that the single verdict would otherwise blur.
 */
function OutlookPanel({ report }: { report: RobustnessReport }) {
  const OUTLOOK: Record<string, { label: string; cls: string; blurb: string }> = {
    durable: { label: "Durable", cls: "border-success/40 bg-success/10 text-success", blurb: "Edge holds long-term and isn't fading." },
    fading: { label: "Fading", cls: "border-warning/40 bg-warning/10 text-warning", blurb: "Long-term edge is weakening lately — watch for an exit." },
    recovering: { label: "Recovering", cls: "border-primary/40 bg-primary/10 text-primary", blurb: "Long-term unproven, but the recent window turned up. Speculative." },
    weak: { label: "Weak", cls: "border-destructive/40 bg-destructive/10 text-destructive", blurb: "Negative long-term and not improving." },
    unclear: { label: "Unclear", cls: "border-muted bg-muted/40 text-muted-foreground", blurb: "Not enough distinct horizons to read a trend." },
  };
  const TRAJ: Record<string, { icon: string; cls: string }> = {
    improving: { icon: "↑", cls: "text-success" },
    decaying: { icon: "↓", cls: "text-destructive" },
    stable: { icon: "→", cls: "text-muted-foreground" },
    insufficient: { icon: "·", cls: "text-muted-foreground" },
  };
  const o = OUTLOOK[report.outlook] ?? OUTLOOK.unclear;
  const tr = TRAJ[report.trajectory] ?? TRAJ.insufficient;
  const perDay = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(3)}%/day`);
  const signCls = (b: boolean | null) => (b == null ? "text-muted-foreground" : b ? "text-success" : "text-destructive");

  return (
    <div className={"rounded-md border px-3 py-2 " + o.cls}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-sm font-semibold uppercase">{o.label}</span>
        <span className="text-xs opacity-90">{o.blurb}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-foreground">
        <span>
          Long-term{" "}
          <span className={signCls(report.longTermPositive)}>
            {report.longTermPositive == null ? "—" : report.longTermPositive ? "positive" : "negative"}
          </span>
        </span>
        <span>
          Short-term (recent){" "}
          <span className={signCls(report.shortTermPositive)}>
            {report.recentReturn == null ? "—" : `${report.recentReturn >= 0 ? "+" : ""}${report.recentReturn.toFixed(1)}%`}
          </span>
        </span>
        <span>
          Trajectory <span className={"font-semibold " + tr.cls}>{tr.icon} {report.trajectory}</span>
        </span>
        <span className="text-muted-foreground">
          recent {perDay(report.recentPerDay)} vs prior {perDay(report.priorPerDay)}
        </span>
      </div>
      {report.slices.length > 1 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {report.slices.map((s, i) => (
            <span
              key={i}
              className={"rounded px-1.5 py-0.5 text-[10px] tabular-nums " + (s.ret != null && s.ret >= 0 ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")}
              title={`${s.fromDays}–${s.toDays} days ago`}
            >
              {s.fromDays === 0 ? `last ${s.toDays}d` : `${s.fromDays}–${s.toDays}d`}: {s.ret == null ? "—" : `${s.ret >= 0 ? "+" : ""}${s.ret.toFixed(1)}%`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
