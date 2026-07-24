import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight, Coins, Database, ArrowUp, ArrowDown } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { trpc } from "@/lib/trpc";
import type { RouterOutput } from "@framework/api/router";
import { pfLabel, pfRank, isInfinitePf } from "@/lib/metrics";

type Row = RouterOutput["results"]["query"][number];
const num = (v: string | null) => (v == null ? null : parseFloat(v));
const pct = (v: string | null) => (num(v) == null ? "—" : `${num(v)!.toFixed(2)}%`);
/** PF sort key for a warehouse row (downweights low-sample no-loss "∞" so it can't top a board). */
const rankOf = (r: Row) => pfRank(num(r.profitFactor), r.totalTrades);

// Sortable columns for the per-asset strategy table.
type SortKey = "strategy" | "tf" | "return" | "trades" | "pf" | "maxdd" | "span";
const TF_MIN: Record<string, number> = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240, "1d": 1440 };
/** Raw sortable value per column (what the cell displays) — null-ish sinks to the bottom of a desc sort. */
function sortVal(r: Row, key: SortKey): number | string {
  switch (key) {
    case "strategy": return r.strategyId;
    case "tf": return TF_MIN[r.timeframe] ?? 999;
    case "return": return num(r.totalReturn) ?? -Infinity;
    case "trades": return r.totalTrades ?? -Infinity;
    case "pf": return num(r.profitFactor) ?? -Infinity;
    case "maxdd": return num(r.maxDrawdown) ?? -Infinity; // drawdowns are ≤0, so desc = shallowest first
    case "span": return r.spanDays ?? -Infinity;
  }
}

/** Compact USD formatter for market figures ($2.4B, $1.8M). */
const usd = (v: number | null | undefined) => {
  if (v == null) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
};

/** Live market data for one pair — fetched only when its asset row is expanded. */
function MarketSnapshot({ pair }: { pair: string }) {
  const q = trpc.markets.snapshot.useQuery({ pair });
  if (q.isLoading) return <div className="border-t px-4 py-2 text-xs text-muted-foreground">Loading market data…</div>;
  const m = q.data;
  if (!m) return null;
  const funding = m.fundingRate != null ? `${(m.fundingRate * 100).toFixed(4)}%` : "—";
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t bg-muted/20 px-4 py-2 text-xs">
      <Stat label="mark" value={m.markPx != null ? `$${m.markPx.toLocaleString(undefined, { maximumFractionDigits: 4 })}` : "—"} />
      <Stat label="24h vol" value={usd(m.dayVolumeUsd)} />
      <Stat label="open interest" value={usd(m.openInterestUsd)} />
      <Stat label="funding" value={funding} />
    </div>
  );
}

/** A clickable, sort-aware table header cell. */
function SortTh({
  k, sort, onSort, align, children,
}: {
  k: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" } | null;
  onSort: (k: SortKey) => void;
  align?: "right";
  children: ReactNode;
}) {
  const active = sort?.key === k;
  return (
    <th className={"px-3 py-2 first:pl-4 " + (align === "right" ? "text-right" : "text-left")}>
      <button
        onClick={() => onSort(k)}
        className={"inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-foreground " + (active ? "text-foreground" : "")}
      >
        {align === "right" && active && (sort!.dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
        {children}
        {align !== "right" && active && (sort!.dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </button>
    </th>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </span>
  );
}

export function AssetsPage({ embedded }: { embedded?: boolean } = {}) {
  const q = trpc.results.query.useQuery({ limit: 1000 });
  const universe = trpc.markets.pairs.useQuery(undefined, { staleTime: 5 * 60_000 });
  const [expanded, setExpanded] = useState<string | null>(null);
  const navigate = useNavigate();
  const [showUniverse, setShowUniverse] = useState(false);
  // null = keep the default smart order (PF rank, sample-aware); a key = explicit column sort.
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);
  const toggleSort = (key: SortKey) =>
    setSort((s) => (s && s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
  const applySort = (rows: Row[]): Row[] => {
    if (!sort) return rows; // default: incoming order (already PF-rank sorted)
    const { key, dir } = sort;
    const sorted = [...rows].sort((a, b) => {
      const va = sortVal(a, key), vb = sortVal(b, key);
      const base = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return dir === "asc" ? base : -base;
    });
    return sorted;
  };

  // pair -> best backtest_run per strategy (by profit factor)
  const byPair = useMemo(() => {
    const map = new Map<string, Map<string, Row>>();
    for (const r of q.data ?? []) {
      if (isInfinitePf(num(r.profitFactor))) continue; // drop ∞ PF (1-trade no-loss sentinel)
      if (!map.has(r.pair)) map.set(r.pair, new Map());
      const sm = map.get(r.pair)!;
      const prev = sm.get(r.strategyId);
      if (!prev || rankOf(r) > rankOf(prev)) {
        sm.set(r.strategyId, r);
      }
    }
    // Sort pairs by their best strategy's profit factor, descending (rank downweights thin ∞).
    return [...map.entries()]
      .map(([pair, sm]) => {
        const strategies = [...sm.values()].sort((a, b) => rankOf(b) - rankOf(a));
        return { pair, strategies };
      })
      .sort((a, b) => {
        const ra = a.strategies[0] ? rankOf(a.strategies[0]) : -Infinity;
        const rb = b.strategies[0] ? rankOf(b.strategies[0]) : -Infinity;
        return rb - ra;
      });
  }, [q.data]);

  const testedPairs = useMemo(() => new Set(byPair.map((b) => b.pair)), [byPair]);
  const untested = useMemo(
    () => (universe.data?.pairs ?? []).filter((p) => !testedPairs.has(p.pair)),
    [universe.data, testedPairs],
  );
  const universeCount = universe.data?.count ?? 0;

  return (
    <div className="space-y-6">
      {!embedded && (
        <PageHeader
          title="By Asset"
          subtitle="Every asset you've backtested, with its top strategies ranked by full-window profit factor and live market data. Click an asset to see the leaderboard; click a strategy to re-run or optimize it."
          actions={
            universeCount > 0 && (
              <span className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{testedPairs.size}</span> of{" "}
                <span className="font-semibold text-foreground">{universeCount}</span> tradable pairs tested
              </span>
            )
          }
        />
      )}

      {byPair.length === 0 && (
        <EmptyState icon={Database} title="No backtests yet" description="Run backtests or a sweep — then assets appear here. The full tradable universe is below." />
      )}

      <div className="space-y-2">
        {byPair.map(({ pair, strategies }) => {
          const best = strategies[0];
          const isOpen = expanded === pair;
          return (
            <Card key={pair}>
              <CardContent className="p-0">
                <button
                  onClick={() => setExpanded((e) => (e === pair ? null : pair))}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/40"
                >
                  <ChevronRight className={"h-4 w-4 shrink-0 text-muted-foreground transition-transform " + (isOpen ? "rotate-90" : "")} />
                  <Coins className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="font-semibold">{pair}</span>
                  <span className="text-xs text-muted-foreground">{strategies.length} strategies</span>
                  {best && (
                    <span className="ml-auto flex items-center gap-3 text-sm">
                      <span className="text-muted-foreground">best:</span>
                      <span className="font-mono text-xs">{best.strategyId}</span>
                      <span className="font-semibold tabular-nums">PF {pfLabel(num(best.profitFactor))}</span>
                      <StatusPill tone={(num(best.profitFactor) ?? 0) > 1 ? "success" : "warning"} className="px-1.5 py-0">
                        {(num(best.profitFactor) ?? 0) > 1 ? "edge" : "loser"}
                      </StatusPill>
                    </span>
                  )}
                </button>

                {isOpen && <MarketSnapshot pair={pair} />}

                {isOpen && (
                  <div className="overflow-x-auto border-t">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <SortTh k="strategy" sort={sort} onSort={toggleSort}>Strategy</SortTh>
                          <SortTh k="tf" sort={sort} onSort={toggleSort}>TF</SortTh>
                          <SortTh k="return" sort={sort} onSort={toggleSort} align="right">Return</SortTh>
                          <SortTh k="trades" sort={sort} onSort={toggleSort} align="right">Trades</SortTh>
                          <SortTh k="pf" sort={sort} onSort={toggleSort} align="right">PF</SortTh>
                          <SortTh k="maxdd" sort={sort} onSort={toggleSort} align="right">Max DD</SortTh>
                          <SortTh k="span" sort={sort} onSort={toggleSort} align="right">Span</SortTh>
                        </tr>
                      </thead>
                      <tbody>
                        {applySort(strategies).map((r) => {
                          const ret = num(r.totalReturn);
                          const pf = num(r.profitFactor);
                          return (
                            <tr
                              key={r.id}
                              onClick={() =>
                                navigate({
                                  to: "/strategy/$strategyId",
                                  params: { strategyId: r.strategyId },
                                  // Carry the cell so the detail page opens on the exact row clicked.
                                  search: { pair: r.pair, tf: r.timeframe, days: r.daysRequested },
                                })
                              }
                              className="cursor-pointer border-t last:border-0 hover:bg-accent/40"
                              title="Open this strategy's full detail — data, optimize, activate"
                            >
                              <td className="max-w-64 truncate px-4 py-2 font-medium">{r.strategyId}</td>
                              <td className="px-3 py-2 text-muted-foreground">{r.timeframe}</td>
                              <td className={"px-3 py-2 text-right tabular-nums " + (ret != null && (ret >= 0 ? "text-success" : "text-destructive"))}>
                                {pct(r.totalReturn)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">{r.totalTrades ?? "—"}</td>
                              <td className="px-3 py-2 text-right tabular-nums font-medium">
                                <span className="inline-flex items-center gap-1.5">
                                  {pfLabel(pf)}
                                  {pf != null && (
                                    <StatusPill tone={pf > 1 ? "success" : "warning"} className="px-1.5 py-0">
                                      {pf > 1 ? "edge" : "loser"}
                                    </StatusPill>
                                  )}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">{pct(r.maxDrawdown)}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.spanDays}d</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* The rest of the tradable universe — assets Jester supports that haven't been backtested yet. */}
      {untested.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <button
              onClick={() => setShowUniverse((v) => !v)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/40"
            >
              <ChevronRight className={"h-4 w-4 shrink-0 text-muted-foreground transition-transform " + (showUniverse ? "rotate-90" : "")} />
              <Coins className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="font-semibold">Tradable universe</span>
              <span className="text-xs text-muted-foreground">{untested.length} pairs not yet backtested</span>
            </button>
            {showUniverse && (
              <div className="flex flex-wrap gap-1.5 border-t p-3">
                {untested.map((p) => (
                  <span
                    key={p.pair}
                    title={p.displayName}
                    className="rounded-md border bg-muted/30 px-2 py-1 font-mono text-xs text-muted-foreground"
                  >
                    {p.pair}
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

    </div>
  );
}
