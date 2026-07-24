import { Link } from "@tanstack/react-router";
import { CheckCircle2, AlertTriangle, Clock, Radar, Power, Trophy, Wallet } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { trpc } from "@/lib/trpc";

const num = (v: string | null) => (v == null ? null : parseFloat(v));
function relTime(d: string | Date): string {
  const ms = Date.now() - new Date(d).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}


export function DashboardPage() {
  const health = trpc.health.useQuery(undefined, { refetchInterval: 60_000 });
  const me = trpc.admin.me.useQuery();
  const cred = trpc.credentials.status.useQuery();
  const recent = trpc.results.query.useQuery({ limit: 6 });
  // Analytics-forward pulse.
  const candidates = trpc.leaderboard.top.useQuery({ minTrades: 20, limit: 5 });
  const portfolio = trpc.account.portfolio.useQuery(undefined, { enabled: cred.data?.hasKey === true });
  const screens = trpc.screens.list.useQuery();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        subtitle="What matters now — coverage, the strongest candidates, your live account, and anything that needs attention."
        actions={
          health.data ? (
            <Badge variant="success">API healthy</Badge>
          ) : (
            <Badge variant="warning">API unreachable</Badge>
          )
        }
      />

      {/* Connection status — the gate on everything else */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          <span className="text-sm font-medium">Jester connection</span>
          {cred.isLoading ? (
            <span className="text-sm text-muted-foreground">checking…</span>
          ) : cred.data?.hasKey ? (
            <>
              <StatusPill tone="success">
                <CheckCircle2 className="h-3 w-3" />
                key connected
              </StatusPill>
              <StatusPill tone={cred.data.hyperliquidReady ? "success" : "warning"}>
                {cred.data.hyperliquidReady ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                Hyperliquid {cred.data.hyperliquidReady ? "ready" : "setup incomplete"}
              </StatusPill>
              <span className="text-sm text-muted-foreground">
                You're set — start with the Strategy Catalog.
              </span>
            </>
          ) : (
            <>
              <StatusPill tone="warning">
                <AlertTriangle className="h-3 w-3" />
                no key
              </StatusPill>
              <Link to="/settings" className="text-sm font-medium text-primary hover:underline">
                Connect your Jester key to begin →
              </Link>
            </>
          )}
        </CardContent>
      </Card>

      {/* Autonomous coverage engine */}
      <CoverageCard canArm={["manager", "admin"].includes((me.data?.role as string) ?? "")} />

      {/* Recent backtests */}
      {(recent.data?.length ?? 0) > 0 && (
        <Card>
          <CardContent className="py-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <Clock className="h-4 w-4 text-muted-foreground" /> Recent backtests
              </span>
              <Link to="/results" className="text-xs font-medium text-primary hover:underline">
                View all →
              </Link>
            </div>
            <div className="divide-y">
              {recent.data!.map((r) => {
                const pf = num(r.profitFactor);
                const ret = num(r.totalReturn);
                return (
                  <Link
                    key={r.id}
                    to="/results"
                    className="flex items-center gap-3 py-1.5 text-sm hover:bg-accent/40"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{r.strategyId}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{r.pair} · {r.timeframe}</span>
                    <span className={"w-16 shrink-0 text-right tabular-nums " + (ret != null ? (ret >= 0 ? "text-success" : "text-destructive") : "")}>
                      {ret == null ? "—" : `${ret.toFixed(1)}%`}
                    </span>
                    <span className="w-14 shrink-0 text-right tabular-nums font-medium">
                      PF {pf == null ? "—" : pf.toFixed(2)}
                    </span>
                    <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">{relTime(r.ranAt)}</span>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pulse: top candidates + live account + alerts */}
      <div className="grid gap-3 lg:grid-cols-3">
        {/* Top candidates */}
        <Card className="lg:col-span-2">
          <CardContent className="py-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <Trophy className="h-4 w-4 text-muted-foreground" /> Top candidates
              </span>
              <Link to="/analytics" className="text-xs font-medium text-primary hover:underline">Leaderboard →</Link>
            </div>
            {(candidates.data?.length ?? 0) === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">No ranked cells yet — run backtests or arm the coverage engine.</p>
            ) : (
              <div className="divide-y">
                {candidates.data!.map((r) => (
                  <Link
                    key={`${r.strategyId}|${r.pair}|${r.timeframe}`}
                    to="/strategy/$strategyId"
                    params={{ strategyId: r.strategyId }}
                    search={{ pair: r.pair, tf: r.timeframe, days: r.daysRequested }}
                    className="flex items-center gap-3 py-1.5 text-sm hover:bg-accent/40"
                  >
                    <span className={"w-8 shrink-0 text-right font-bold tabular-nums " + (r.score >= 60 ? "text-success" : r.score >= 35 ? "text-warning" : "text-muted-foreground")}>{r.score}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{r.strategyName}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{r.pair} · {r.timeframe}</span>
                    <span className="w-14 shrink-0 text-right tabular-nums">PF {r.profitFactor?.toFixed(2) ?? "—"}</span>
                    {r.robustnessVerdict && (
                      <span className="w-16 shrink-0 text-right text-[10px] uppercase text-muted-foreground">{r.outlook ?? r.robustnessVerdict}</span>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Live account + alerts */}
        <div className="space-y-3">
          <Card>
            <CardContent className="py-4">
              <div className="mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-medium"><Wallet className="h-4 w-4 text-muted-foreground" /> Live account</span>
                <Link to="/live" className="text-xs font-medium text-primary hover:underline">Live →</Link>
              </div>
              {cred.data?.hasKey ? (
                <div className="text-sm">
                  <div className="text-2xl font-bold tabular-nums">
                    ${(portfolio.data?.pnl?.totalPortfolioValue ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {portfolio.data?.pnl?.totalPositions ?? 0} open position{(portfolio.data?.pnl?.totalPositions ?? 0) === 1 ? "" : "s"}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Connect a key to see your account.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-medium"><Radar className="h-4 w-4 text-muted-foreground" /> Alerts</span>
                <Link to="/screens" className="text-xs font-medium text-primary hover:underline">Screens →</Link>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {(screens.data?.length ?? 0) === 0 ? "No screens yet." : `${screens.data!.length} screen${screens.data!.length === 1 ? "" : "s"} watching the warehouse.`}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Signed in{me.data ? ` as ${me.data.email} · ${me.data.role}` : ""}. This is an analysis tool —
        it reads, backtests, and screens, but never places orders or moves funds.
      </p>
    </div>
  );
}

/**
 * Autonomous coverage engine — keeps the backtest matrix filled + fresh without hand-built sweeps.
 * Ships DISABLED; a manager arms it (which starts a standing Jester spend), so the toggle is gated.
 */
function CoverageCard({ canArm }: { canArm: boolean }) {
  const utils = trpc.useUtils();
  const status = trpc.coverage.status.useQuery(undefined, { refetchInterval: 30_000 });
  const setEnabled = trpc.coverage.setEnabled.useMutation({ onSuccess: () => utils.coverage.status.invalidate() });
  const scanNow = trpc.coverage.scanNow.useMutation({ onSuccess: () => utils.coverage.status.invalidate() });
  const d = status.data;
  const pct = d?.pct ?? 0;
  const on = d?.enabled ?? false;

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <Radar className="h-4 w-4 text-muted-foreground" /> Coverage engine
          </span>
          <StatusPill tone={on ? "success" : "muted"}>
            <Power className="h-3 w-3" />
            {on ? "armed" : "disarmed"}
          </StatusPill>
          {d && (
            <span className="text-sm text-muted-foreground">
              {d.covered.toLocaleString()} / {d.target.toLocaleString()} cells fresh
              {d.stale > 0 && <> · <span className="text-foreground">{d.stale.toLocaleString()} stale</span></>}
              {d.lastScanAt && <> · scanned {relTime(d.lastScanAt)}</>}
            </span>
          )}
          {canArm && (
            <div className="ml-auto flex items-center gap-2">
              {on && (
                <Button size="sm" variant="outline" disabled={scanNow.isPending} onClick={() => scanNow.mutate()}>
                  {scanNow.isPending ? "Scanning…" : "Scan now"}
                </Button>
              )}
              <Button
                size="sm"
                variant={on ? "outline" : "default"}
                disabled={setEnabled.isPending}
                onClick={() => setEnabled.mutate({ enabled: !on })}
                title={on ? "Stop the standing backtest spend" : "Start continuously filling the coverage matrix (spends Jester backtest budget)"}
              >
                <Power className="h-3.5 w-3.5" />
                {on ? "Disarm" : "Arm engine"}
              </Button>
            </div>
          )}
        </div>
        {/* Progress bar */}
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Continuously backtests each strategy on its tested pairs plus the majors (15m · 1h · 30d), refreshing
          cells older than a week. {on ? "Filling a few cells a minute." : "Disarmed — no backtests run until you arm it."}
        </p>
      </CardContent>
    </Card>
  );
}
