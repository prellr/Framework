import { useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Boxes, TrendingUp, TrendingDown, Activity, LineChart } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/EmptyState";
import { StatusPill } from "@/components/ui/status-pill";
import { TimeSeriesChart } from "@/components/ui/time-series-chart";
import { trpc } from "@/lib/trpc";
import { effectiveTz, tzLabel } from "@/lib/tz";

const PERIODS = [
  { days: 7, label: "7D" },
  { days: 30, label: "30D" },
  { days: 90, label: "90D" },
  { days: 365, label: "1Y" },
];

const n = (v: unknown, d = 2) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "—");
const usd = (v: unknown) => (typeof v === "number" ? `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—");
const pctOf = (v: unknown) => (typeof v === "number" ? `${v.toFixed(1)}%` : "—");
const signClass = (v: unknown) => (typeof v === "number" ? (v >= 0 ? "text-success" : "text-destructive") : "");
const fmtTime = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function PositionsPage({ embedded }: { embedded?: boolean } = {}) {
  const cred = trpc.credentials.status.useQuery();
  const hasKey = cred.data?.hasKey === true;
  const [days, setDays] = useState(30);
  const me = trpc.admin.me.useQuery(undefined, { staleTime: 60_000 });
  const userTz = effectiveTz((me.data as any)?.timezone);
  const portfolio = trpc.account.portfolio.useQuery(undefined, { enabled: hasKey });
  const perfHist = trpc.account.performanceHistory.useQuery({ days }, { enabled: hasKey });
  const fills = trpc.account.fills.useQuery({ days, limit: 500, tz: userTz }, { enabled: hasKey });
  const canTrade = ["manager", "admin"].includes((me.data?.role as string) ?? "");
  const paramPerf = trpc.trading.paramPerformance.useQuery(undefined, { enabled: hasKey && canTrade });
  const liveStrat = trpc.trading.myStrategies.useQuery(undefined, { enabled: hasKey && canTrade });
  const coverage = trpc.trading.attributionCoverage.useQuery(undefined, { enabled: hasKey && canTrade });
  const portHist = trpc.account.portfolioHistory.useQuery(undefined, { enabled: hasKey });

  // Actual account EQUITY over the selected window (absolute value, with real high/low) — the
  // realized-PnL curve alone is relative-from-zero and can't show what the portfolio was worth.
  const equity = useMemo(() => {
    const want = days <= 7 ? "week" : days <= 30 ? "month" : "allTime";
    const series = (portHist.data?.series ?? []) as any[];
    const chosen = series.find((s) => s.period === want) ?? series.find((s) => s.period === "allTime") ?? series[0];
    const pts = (chosen?.accountValue ?? []) as { t: number; v: number }[];
    const cutoff = Date.now() - days * 86_400_000;
    const win = pts.filter((p) => p.t >= cutoff);
    return win.length >= 2 ? win : pts;
  }, [portHist.data, days]);

  if (cred.data && !cred.data.hasKey) {
    return (
      <div className="space-y-6">
        {!embedded && <PageHeader title="Positions" subtitle="Open positions and trading performance." />}
        <Card>
          <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <span>
              Connect a Jester key on the{" "}
              <Link to="/settings" className="text-primary hover:underline">Jester Connection</Link>{" "}
              page to see your positions.
            </span>
          </CardContent>
        </Card>
      </div>
    );
  }

  const open = portfolio.data?.positions ?? [];
  const liveStrategies = ((liveStrat.data as any)?.strategies ?? []) as any[];
  const livePortfolioValue: number | null =
    typeof (liveStrat.data as any)?.portfolioValue === "number" ? (liveStrat.data as any).portfolioValue : null;
  const fstats = fills.data?.stats as any;
  const ftrades = fills.data?.trades ?? [];

  // Attribute each fill to the strategy whose parameter-set period was live for that coin at that
  // moment (from the tracked param-periods). Uniquely-attributable → the strategy; a coin shared by
  // multiple live strategies → "shared"; before tracking began → null.
  const coinOf = (pair: string) => pair.split(/[-/]/)[0].toUpperCase();
  const periods = ((paramPerf.data as any)?.periods ?? []) as any[];
  const attributeStrategy = (coin: string, timeMs: number): { strat: string | null; shared: boolean } => {
    const now = Date.now();
    const hits = periods.filter(
      (p) => coinOf(p.pair) === coin && new Date(p.startedAt).getTime() <= timeMs && timeMs <= (p.endedAt ? new Date(p.endedAt).getTime() : now),
    );
    const strats = [...new Set(hits.map((p) => p.strategyId))];
    return strats.length === 1 ? { strat: strats[0] as string, shared: false } : strats.length > 1 ? { strat: null, shared: true } : { strat: null, shared: false };
  };
  // Open positions keyed by coin — so the scorecard can show an active (unrealized) position instead
  // of "no trades yet" when a combo is holding but hasn't closed a trade.
  const openByCoin = new Map<string, any>();
  for (const p of open) if (p?.pair) openByCoin.set(coinOf(p.pair), p);

  return (
    // flex + order so trade history sits right under open positions without the big perf charts
    // burying it (charts still render, just lower). Non-ordered children (PageHeader) stay first.
    <div className="flex flex-col gap-8">
      {!embedded && (
        <PageHeader
          title="Positions & Performance"
          subtitle="Your open Hyperliquid positions and trading performance, via Jester. Read-only — this tool can't open or close positions."
        />
      )}

      {/* Open positions */}
      <section className="order-1 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Open positions</h2>
        {open.length === 0 ? (
          <EmptyState icon={Boxes} title="No open positions" description="Positions you hold on Hyperliquid appear here." />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Pair</th>
                  <th className="px-3 py-2">Side</th>
                  <th className="px-3 py-2 text-right">Size</th>
                  <th className="px-3 py-2 text-right">Entry</th>
                  <th className="px-3 py-2 text-right">Unrealized</th>
                  <th className="px-3 py-2 text-right">Leverage</th>
                </tr>
              </thead>
              <tbody>
                {open.map((p: any, i: number) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">{p.pair ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span className={"inline-flex items-center gap-1 " + (p.side === "long" ? "text-success" : "text-destructive")}>
                        {p.side === "long" ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {p.side ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{n(p.size, 4)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{n(p.entryPrice, 4)}</td>
                    <td className={"px-3 py-2 text-right tabular-nums " + signClass(p.unrealizedPnl)}>{usd(p.unrealizedPnl)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{p.leverage != null ? `${p.leverage}x` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Trading performance */}
      <section className="order-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Trading performance
          </h2>
          <div className="flex gap-1">
            {PERIODS.map((p) => (
              <button
                key={p.days}
                onClick={() => setDays(p.days)}
                className={
                  "transition-spring rounded-md border px-2.5 py-1 text-xs font-medium " +
                  (days === p.days
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-background text-muted-foreground hover:bg-accent")
                }
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Account equity over the window — absolute portfolio value with its real high/low. */}
        {equity.length >= 2 && (
          <Card>
            <CardContent className="py-4">
              <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <LineChart className="h-3.5 w-3.5" /> Portfolio value
                <span className="font-normal normal-case">
                  · account equity — <span className="text-foreground">includes</span> unrealized PnL from open positions
                </span>
              </div>
              <TimeSeriesChart points={equity} money />
            </CardContent>
          </Card>
        )}

        {/* Realized PnL over time (cumulative, from Hyperliquid closed-trade fills). */}
        {perfHist.data?.wallet && (perfHist.data.points.length ?? 0) >= 2 && (
          <Card>
            <CardContent className="py-4">
              <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <LineChart className="h-3.5 w-3.5" /> Realized PnL over time
                <span className="font-normal normal-case">
                  · {perfHist.data.trades} closed trades — <span className="text-foreground">excludes</span> open positions
                </span>
              </div>
              <TimeSeriesChart points={perfHist.data.points} money signed />
            </CardContent>
          </Card>
        )}

        {/* Daily win/loss + PnL — "is it working?" answered over time, from the fill ledger. */}
        {(fills.data?.daily?.length ?? 0) > 0 && <DailyChart daily={fills.data!.daily as any[]} tz={userTz} />}
      </section>

      {/* Parameter-set scorecard — is "pick for me" actually working, per asset/param combo? */}
      {canTrade && (paramPerf.data?.periods?.length ?? 0) > 0 && (
        <section className="order-3 space-y-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Parameter-set scorecard
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Each asset + parameter combo Jester is running, scored over the last 24h and over the
              whole period that combo has been live. Attributed from the fill ledger to the combo that
              was active at the time — so you can see which picks are actually earning their place.
            </p>
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Strategy</th>
                  <th className="px-3 py-2">Asset · TF</th>
                  <th className="px-3 py-2">Params</th>
                  <th className="px-3 py-2">Live since</th>
                  <th className="px-3 py-2 text-right">24h</th>
                  <th className="px-3 py-2 text-right">Whole period</th>
                </tr>
              </thead>
              <tbody>
                {(paramPerf.data!.periods as any[]).map((p) => (
                  <ParamPeriodRow key={p.id} p={p} openPos={openByCoin.get(coinOf(p.pair))} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Tracking began when a combo was first observed live — periods predating that aren't
            recoverable. Rows marked <span className="font-medium text-warning">shared</span> trade a coin
            another strategy also trades, so the ledger can't attribute their fills. Click a row to see its
            individual trades.
          </p>
          {coverage.data && coverage.data.total > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-xs">
              <span className="font-medium uppercase tracking-wide text-muted-foreground">Attribution coverage</span>
              <span className="text-success">{coverage.data.attributed} uniquely attributed</span>
              <span className="text-warning">{coverage.data.contested} contested</span>
              <span className="text-muted-foreground">{coverage.data.untracked} untracked</span>
              <span className="text-muted-foreground">
                of {coverage.data.total} realized trades since{" "}
                {coverage.data.since ? new Date(coverage.data.since).toLocaleDateString() : "—"}
              </span>
            </div>
          )}
        </section>
      )}

      {/* Live strategy performance — sourced from jester_my_strategies (COMPLETE list of
          subscriptions). jester_my_live_performance omits strategies with no executed-trade record,
          so it silently showed only 3 of 5. PnL is expressed against the portfolio, with Jester's
          leveraged margin % kept as secondary context. */}
      {canTrade && liveStrategies.length > 0 && (
        <section className="order-4 space-y-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <Activity className="h-4 w-4" /> Live strategy performance
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Real-money results of every strategy Jester is currently subscribed to on your account —
              not backtests. Cumulative per strategy and spans parameter changes, so it is not scoped to
              the current combo (see the scorecard above for per-combo attribution).
            </p>
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Strategy</th>
                  <th className="px-3 py-2">Pairs</th>
                  <th className="px-3 py-2 text-right">Trades</th>
                  <th className="px-3 py-2 text-right">Win %</th>
                  <th className="px-3 py-2 text-right">PnL $</th>
                  <th className="px-3 py-2 text-right">% of portfolio</th>
                  <th className="px-3 py-2 text-right">On margin</th>
                </tr>
              </thead>
              <tbody>
                {liveStrategies.map((r: any) => {
                  const pf = r.performance ?? {};
                  const pctPort =
                    livePortfolioValue && typeof pf.totalPnLUsd === "number"
                      ? (pf.totalPnLUsd / livePortfolioValue) * 100
                      : null;
                  const noData = pf.totalTrades == null;
                  return (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="max-w-56 truncate px-3 py-2 font-medium">{r.name ?? r.id}</td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                        {(r.pairs ?? []).map((p: any) => p.pair).join(", ") || "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {noData ? <span className="text-muted-foreground">no data</span> : pf.totalTrades}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{pf.winRate != null ? pctOf(pf.winRate) : "—"}</td>
                      <td className={"px-3 py-2 text-right tabular-nums " + signClass(pf.totalPnLUsd)}>
                        {pf.totalPnLUsd != null ? usd(pf.totalPnLUsd) : "—"}
                      </td>
                      <td className={"px-3 py-2 text-right tabular-nums " + signClass(pctPort)}>
                        {pctPort != null ? `${pctPort >= 0 ? "+" : ""}${pctPort.toFixed(2)}%` : "—"}
                      </td>
                      <td
                        className={"px-3 py-2 text-right text-xs tabular-nums " + signClass(pf.totalPnLPct)}
                        title="Jester's leveraged return on allocated margin — not portfolio impact"
                      >
                        {pf.totalPnLPct != null ? pctOf(pf.totalPnLPct) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Strategies showing <span className="font-medium">no data</span> are subscribed but Jester has
            no executed-trade record for them yet.
          </p>
        </section>
      )}

      {/* Full trade history + stats — computed from the raw Hyperliquid fill ledger. */}
      <section className="order-2 space-y-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Trade history &amp; stats</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Every realized trade on your Hyperliquid account and stats computed from the full fill
            ledger (the authoritative source, not a sample). Closed trades only — open positions are
            excluded until they close. <span className="font-medium">Net</span> is profit after
            round-trip fees (entry + exit); hover a fee to see the split. Read-only. Follows the
            {" "}{days}-day window above.
          </p>
        </div>

        {fills.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !fills.data?.wallet ? (
          <Card>
            <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <AlertTriangle className="h-4 w-4 text-warning" />
              Link your Hyperliquid wallet address on the{" "}
              <Link to="/settings" className="text-primary hover:underline">Jester Connection</Link> page to see full trade history.
            </CardContent>
          </Card>
        ) : !fstats || fstats.trades === 0 ? (
          <EmptyState icon={Boxes} title="No trades in this window" description="Try a longer period, or trade to build history." />
        ) : (
          <>
            {/* Comprehensive stats */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Tile label="Net PnL" value={usd(fstats.net)} tone={fstats.net} />
              <Tile label="Realized" value={usd(fstats.realized)} tone={fstats.realized} />
              <Tile label="Fees" value={usd(fstats.fees)} tone={-1} />
              <Tile label="Trades" value={String(fstats.trades)} />
              <Tile label="Win rate" value={pctOf(fstats.winRate)} />
              <Tile label="Profit factor" value={fstats.profitFactor == null ? "—" : n(fstats.profitFactor)} tone={(fstats.profitFactor ?? 0) - 1} />
              <Tile label="Expectancy" value={usd(fstats.expectancy)} tone={fstats.expectancy} />
              <Tile label="Volume" value={usd(fstats.volumeUsd)} />
              <Tile label="Avg win" value={usd(fstats.avgWin)} tone={1} />
              <Tile label="Avg loss" value={usd(fstats.avgLoss)} tone={-1} />
              <Tile label="Largest win" value={usd(fstats.largestWin)} tone={1} />
              <Tile label="Largest loss" value={usd(fstats.largestLoss)} tone={-1} />
            </div>

            {/* Long / short split */}
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              {(["long", "short"] as const).map((side) => {
                const st = fstats.bySide?.[side];
                return st && st.trades > 0 ? (
                  <span key={side}>
                    <span className="font-medium uppercase">{side}</span>: {st.trades} tr · {pctOf(st.winRate)} win ·{" "}
                    <span className={signClass(st.realized)}>{usd(st.realized)}</span>
                  </span>
                ) : null;
              })}
            </div>

            {/* Per-coin breakdown */}
            {fstats.byCoin?.length > 0 && (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Coin</th>
                      <th className="px-3 py-2 text-right">Trades</th>
                      <th className="px-3 py-2 text-right">Win %</th>
                      <th className="px-3 py-2 text-right">Net</th>
                      <th className="px-3 py-2 text-right">Realized</th>
                      <th className="px-3 py-2 text-right">Fees</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fstats.byCoin.map((cn: any) => (
                      <tr key={cn.coin} className="border-b last:border-0">
                        <td className="px-3 py-2 font-medium">{cn.coin}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{cn.trades}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{pctOf(cn.winRate)}</td>
                        <td className={"px-3 py-2 text-right font-medium tabular-nums " + signClass(cn.net ?? cn.realized)}>
                          {usd(cn.net ?? cn.realized)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{usd(cn.realized)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{usd(cn.fees)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Individual trades */}
            <div className="max-h-[34rem] overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground backdrop-blur">
                  <tr>
                    <th className="px-3 py-2">Time</th>
                    <th className="px-3 py-2">Coin</th>
                    <th className="px-3 py-2">Strategy</th>
                    <th className="px-3 py-2">Direction</th>
                    <th className="px-3 py-2 text-right">Size</th>
                    <th className="px-3 py-2 text-right">Price</th>
                    <th className="px-3 py-2 text-right">Net</th>
                    <th className="px-3 py-2 text-right">Gross</th>
                    <th className="px-3 py-2 text-right">Fees</th>
                  </tr>
                </thead>
                <tbody>
                  {ftrades.map((tr: any, i: number) => (
                    <tr key={tr.hash ?? i} className="border-b last:border-0">
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{fmtTime(tr.time)}</td>
                      <td className="px-3 py-2 font-medium">{tr.coin}</td>
                      <td className="px-3 py-2 text-xs">
                        {(() => {
                          const a = attributeStrategy(tr.coin, tr.time);
                          return a.strat ? (
                            <span className="max-w-40 truncate font-mono text-muted-foreground" title={a.strat}>{a.strat}</span>
                          ) : a.shared ? (
                            <span className="text-warning" title="Coin traded by multiple live strategies — the ledger can't say which">shared</span>
                          ) : (
                            <span className="text-muted-foreground/50" title="Before parameter tracking began, or no live strategy attributed">—</span>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2">
                        <span className={tr.side === "long" ? "text-success" : tr.side === "short" ? "text-destructive" : "text-muted-foreground"}>
                          {tr.dir}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{n(tr.sz, 4)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{n(tr.px, 4)}</td>
                      <td className={"px-3 py-2 text-right font-medium tabular-nums " + signClass(tr.net ?? tr.closedPnl)}>
                        {usd(tr.net ?? tr.closedPnl)}
                      </td>
                      <td className={"px-3 py-2 text-right tabular-nums text-muted-foreground"}>{usd(tr.closedPnl)}</td>
                      <td
                        className="px-3 py-2 text-right tabular-nums text-muted-foreground"
                        title={tr.entryFee != null ? `entry ${usd(tr.entryFee)} + exit ${usd(tr.exitFee)}` : undefined}
                      >
                        {usd(tr.fee)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              {ftrades.length} of {fills.data.total} realized trades in the last {days}d
              {fstats.fills >= 2000 ? " · Hyperliquid caps history at 2000 fills" : ""}
            </p>
          </>
        )}
      </section>
    </div>
  );
}

/**
 * Daily win rate + net PnL from the fill ledger, with an interactive scrubber. Bars are each day's
 * NET (realized - fees) colored by sign; the overlaid line is that day's win rate (0-100% across the
 * full height). Hovering anywhere in a day's column reads out that day's full numbers — a blended
 * average hides whether performance is trending or just noisy.
 */
function DailyChart({ daily, tz }: { daily: any[]; tz: string }) {
  const days = daily.slice(-60); // keep it readable
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  if (days.length === 0) return null;

  const W = 720;
  const H = 150;
  const padB = 18;
  const maxAbs = Math.max(...days.map((d) => Math.abs(d.net)), 0.01);
  const bw = W / days.length;
  const zeroY = (H - padB) / 2;
  const scale = (v: number) => (v / maxAbs) * ((H - padB) / 2 - 4);
  const winY = (wr: number) => (H - padB) - (wr / 100) * (H - padB);
  const winPts = days.map((d, i) => `${i * bw + bw / 2},${winY(d.winRate)}`).join(" ");
  const totalNet = days.reduce((a, d) => a + d.net, 0);
  const traded = days.filter((d) => d.trades > 0);
  const meanWinRate = traded.length ? traded.reduce((a, d) => a + d.winRate, 0) / traded.length : 0;

  const onMove = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * W;
    setHover(Math.max(0, Math.min(days.length - 1, Math.floor(x / bw))));
  };

  const h = hover != null ? days[hover] : null;

  return (
    <Card>
      <CardContent className="py-4">
        <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Daily win rate &amp; net PnL
          </span>
          {h ? (
            <span className="text-xs tabular-nums">
              <span className="font-medium text-foreground">{h.date}</span>{" "}
              <span className="text-muted-foreground">
                {h.trades} tr ({h.wins}W/{h.losses}L) · {h.winRate.toFixed(0)}% win ·{" "}
              </span>
              <span className={h.net >= 0 ? "text-success" : "text-destructive"}>
                net {h.net < 0 ? "-" : ""}${Math.abs(h.net).toFixed(2)}
              </span>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              {days.length} days · avg win rate{" "}
              <span className="font-medium text-foreground">{meanWinRate.toFixed(0)}%</span> · net{" "}
              <span className={totalNet >= 0 ? "text-success" : "text-destructive"}>
                {totalNet < 0 ? "-" : ""}${Math.abs(totalNet).toFixed(2)}
              </span>
            </span>
          )}
        </div>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full touch-none select-none"
          preserveAspectRatio="none"
          style={{ height: 150 }}
          onMouseMove={(e) => onMove(e.clientX)}
          onMouseLeave={() => setHover(null)}
          onTouchStart={(e) => onMove(e.touches[0].clientX)}
          onTouchMove={(e) => onMove(e.touches[0].clientX)}
          onTouchEnd={() => setHover(null)}
        >
          {/* hovered column highlight */}
          {hover != null && (
            <rect x={hover * bw} y={0} width={bw} height={H - padB} className="fill-muted" opacity={0.25} />
          )}
          <line x1={0} y1={zeroY} x2={W} y2={zeroY} stroke="currentColor" strokeOpacity={0.15} />
          {days.map((d, i) => {
            const bh = Math.abs(scale(d.net));
            const y = d.net >= 0 ? zeroY - bh : zeroY;
            return (
              <rect
                key={d.date}
                x={i * bw + 1}
                y={y}
                width={Math.max(bw - 2, 1)}
                height={Math.max(bh, 0.5)}
                className={d.net >= 0 ? "fill-success" : "fill-destructive"}
                opacity={hover == null || hover === i ? 0.85 : 0.4}
              />
            );
          })}
          <polyline points={winPts} fill="none" stroke="currentColor" strokeOpacity={0.55} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          {/* hovered win-rate marker */}
          {h && (
            <circle cx={hover! * bw + bw / 2} cy={winY(h.winRate)} r={3.5} className="fill-foreground" />
          )}
        </svg>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>{days[0].date}</span>
          <span>bars = net PnL · line = win rate (0–100%) · closed trades only · days in {tzLabel(tz)}</span>
          <span>{days[days.length - 1].date}</span>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * One parameter-set row in the scorecard, expandable into the individual live trades attributed to
 * it. Trades on a coin another strategy was also running are marked `contested` (with the rival
 * named) rather than credited to this param set — the fill ledger has no strategy tag, so guessing
 * would fabricate attribution.
 */
function ParamPeriodRow({ p, openPos }: { p: any; openPos?: any }) {
  const [open, setOpen] = useState(false);
  const trades = trpc.trading.paramTrades.useQuery({ periodId: p.id }, { enabled: open });
  const rows = trades.data?.trades ?? [];

  return (
    <>
      <tr
        onClick={() => setOpen((v) => !v)}
        className="cursor-pointer border-b last:border-0 hover:bg-accent/40"
        title="Show the individual trades attributed to this parameter set"
      >
        <td className="max-w-48 truncate px-3 py-2 font-medium">
          <span className="mr-1 inline-block text-muted-foreground">{open ? "▾" : "▸"}</span>
          {p.strategyId}
        </td>
        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{p.pair} · {p.timeframe}</td>
        <td className="px-3 py-2 font-mono text-xs">
          {p.paramHash8 ?? "—"}
          {p.active && <span className="ml-1.5 rounded bg-success/15 px-1 py-0.5 text-[10px] uppercase text-success">live</span>}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
          {new Date(p.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          {p.endedAt ? ` – ${new Date(p.endedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}
        </td>
        <td className="px-3 py-2 text-right text-xs">
          {p.ambiguous ? (
            <span className="text-warning" title={`Coin shared with ${p.ambiguousWith.join(", ")}`}>shared</span>
          ) : p.trades24 > 0 ? (
            <span>
              <span className={signClass(p.realized24)}>{usd(p.realized24)}</span>{" "}
              <span className="text-muted-foreground">{p.winRate24.toFixed(0)}% · {p.trades24} tr</span>
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-3 py-2 text-right text-xs">
          {p.ambiguous ? (
            <span className="text-warning">unattributable</span>
          ) : p.trades > 0 ? (
            <span>
              <span className={signClass(p.realized)}>{usd(p.realized)}</span>{" "}
              <span className="text-muted-foreground">{p.winRate.toFixed(0)}% · {p.trades} tr</span>
            </span>
          ) : openPos ? (
            <span className={signClass(openPos.unrealizedPnl)} title="Holding an open position — no closed trade yet">
              ● holding · {usd(openPos.unrealizedPnl)}
            </span>
          ) : (
            <span className="text-muted-foreground">no trades yet</span>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-b last:border-0 bg-muted/20">
          <td colSpan={6} className="px-3 py-2">
            {trades.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading trades…</p>
            ) : rows.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No realized trades on {p.pair} while this parameter set was live.
              </p>
            ) : (
              <div className="overflow-x-auto rounded border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-left uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5">Time</th>
                      <th className="px-2 py-1.5">Direction</th>
                      <th className="px-2 py-1.5 text-right">Size</th>
                      <th className="px-2 py-1.5 text-right">Price</th>
                      <th className="px-2 py-1.5 text-right">PnL</th>
                      <th className="px-2 py-1.5 text-right">Fee</th>
                      <th className="px-2 py-1.5">Attribution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((t: any) => (
                      <tr key={t.hash + t.time} className="border-t last:border-0">
                        <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">{fmtTime(t.time)}</td>
                        <td className={"px-2 py-1.5 " + (t.side === "long" ? "text-success" : t.side === "short" ? "text-destructive" : "")}>
                          {t.dir}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{n(t.sz, 4)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{n(t.px, 4)}</td>
                        <td className={"px-2 py-1.5 text-right tabular-nums " + signClass(t.closedPnl)}>{usd(t.closedPnl)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{usd(t.fee)}</td>
                        <td className="px-2 py-1.5">
                          {t.contested ? (
                            <span className="text-warning" title={`Also live on ${t.coin}: ${t.candidates.join(", ")}`}>
                              contested ({t.candidates.length + 1} strategies)
                            </span>
                          ) : (
                            <span className="text-success">this param set</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: number }) {
  const toneClass = tone == null ? "" : tone >= 0 ? "text-success" : "text-destructive";
  return (
    <Card>
      <CardContent className="py-3">
        <div className={"text-lg font-semibold tabular-nums " + toneClass}>{value}</div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}
