import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Wallet, TrendingUp, TrendingDown, AlertTriangle, LineChart } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TimeSeriesChart } from "@/components/ui/time-series-chart";
import { trpc } from "@/lib/trpc";

const money = (v: number) =>
  `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

function PnlTile({ label, value, sub }: { label: string; value: number; sub?: string }) {
  const pos = value >= 0;
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={"mt-1 flex items-center gap-1.5 text-xl font-bold tabular-nums " + (pos ? "text-success" : "text-destructive")}>
        {pos ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
        {money(value)}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function PortfolioPage({ embedded }: { embedded?: boolean } = {}) {
  const cred = trpc.credentials.status.useQuery();
  const portfolio = trpc.account.portfolio.useQuery(undefined, { enabled: cred.data?.hasKey === true });

  if (cred.data && !cred.data.hasKey) {
    return (
      <div className="space-y-6">
        {!embedded && <PageHeader title="Portfolio" subtitle="Your Jester account equity and PnL." />}
        <Card>
          <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <span>
              Connect a Jester key on the{" "}
              <Link to="/settings" className="text-primary hover:underline">
                Jester Connection
              </Link>{" "}
              page to see your portfolio.
            </span>
          </CardContent>
        </Card>
      </div>
    );
  }

  const p = portfolio.data;
  const pnl = p?.pnl;
  const periodPnl = (p as any)?.periodPnl as
    | { day: any; week: any; month: any; allTime: any }
    | null
    | undefined;

  return (
    <div className="space-y-6">
      {!embedded && (
        <PageHeader
          title="Portfolio"
          subtitle="Your Jester account equity, unrealized PnL, and performance by period. Read-only — this tool never trades."
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border bg-card px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Equity</div>
          <div className="mt-1 flex items-center gap-1.5 text-xl font-bold tabular-nums">
            <Wallet className="h-4 w-4 text-muted-foreground" />
            {money(pnl?.totalPortfolioValue ?? 0)}
          </div>
        </div>
        <PnlTile label="Unrealized PnL" value={pnl?.totalUnrealizedPnL ?? 0} />
        <div className="rounded-lg border bg-card px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Open positions</div>
          <div className="mt-1 text-xl font-bold tabular-nums">{pnl?.totalPositions ?? p?.positions.length ?? 0}</div>
        </div>
      </div>

      {/* Realized PnL by period, computed from the Hyperliquid fill ledger — Jester's own
          pnl block returns all zeros, so these tiles were permanently $0 before. */}
      {periodPnl && (
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Realized PnL — rolling windows
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <PnlTile label="Last 24h" value={periodPnl.day.net} sub={`${periodPnl.day.trades} trades`} />
            <PnlTile label="Last 7 days" value={periodPnl.week.net} sub={`${periodPnl.week.trades} trades`} />
            <PnlTile label="Last 30 days" value={periodPnl.month.net} sub={`${periodPnl.month.trades} trades`} />
            <PnlTile label="All time" value={periodPnl.allTime.net} sub={`${periodPnl.allTime.trades} trades`} />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Rolling windows (not calendar), so they're unaffected by the server's UTC day boundary.
            Net of fees, from closed trades in the Hyperliquid ledger. Excludes the{" "}
            {money(pnl?.totalUnrealizedPnL ?? 0)} unrealized on open positions. All-time covers the most recent
            2,000 fills Hyperliquid returns.
          </p>
        </div>
      )}

      {(pnl?.totalPortfolioValue ?? 0) === 0 && (
        <Card>
          <CardContent className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4 text-warning" />
            Your Hyperliquid account has no equity yet — fund it and complete setup on Jester to see live figures.
          </CardContent>
        </Card>
      )}

      <PortfolioHistory />
    </div>
  );
}

const PERIODS = [
  { key: "day", label: "1D" },
  { key: "week", label: "1W" },
  { key: "month", label: "1M" },
  { key: "allTime", label: "All" },
];

/** Equity + PnL history from Hyperliquid's public API. Prompts for the wallet if not set yet. */
function PortfolioHistory() {
  const utils = trpc.useUtils();
  const history = trpc.account.portfolioHistory.useQuery();
  const [period, setPeriod] = useState("week");
  const [walletInput, setWalletInput] = useState("");
  const setWallet = trpc.account.setWallet.useMutation({
    onSuccess: () => utils.account.portfolioHistory.invalidate(),
  });

  if (history.isLoading) return null;

  // No wallet on file — let the user provide it (public address, enables the history chart).
  if (!history.data?.wallet) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <LineChart className="h-4 w-4 text-muted-foreground" /> Portfolio history
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Add your Hyperliquid wallet address to chart your equity and PnL over time. Jester masks
            the address, so enter it here (it's public — not a secret). History is read from
            Hyperliquid's public API; nothing here can trade.
          </p>
          <div className="flex flex-wrap gap-2">
            <Input
              value={walletInput}
              onChange={(e) => setWalletInput(e.target.value)}
              placeholder="0x…"
              className="max-w-md font-mono text-sm"
            />
            <Button
              onClick={() => setWallet.mutate({ wallet: walletInput.trim() })}
              disabled={setWallet.isPending || !/^0x[0-9a-fA-F]{40}$/.test(walletInput.trim())}
            >
              {setWallet.isPending ? "Saving…" : "Save & load"}
            </Button>
          </div>
          {setWallet.error && <p className="text-sm text-destructive">{setWallet.error.message}</p>}
        </CardContent>
      </Card>
    );
  }

  const series = (history.data.series ?? []).find((s) => s.period === period) ?? history.data.series?.[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <LineChart className="h-4 w-4 text-muted-foreground" /> Portfolio history
          </span>
          <div className="flex gap-1">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={
                  "transition-spring rounded-md border px-2.5 py-1 text-xs font-medium " +
                  (period === p.key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-background text-muted-foreground hover:bg-accent")
                }
              >
                {p.label}
              </button>
            ))}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!series || series.accountValue.length < 2 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Not enough history for this period yet.
          </p>
        ) : (
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Account value <span className="font-normal normal-case text-muted-foreground/70">· equity over the period (its change is the period PnL)</span>
            </h3>
            <TimeSeriesChart points={series.accountValue} money />
          </section>
        )}
      </CardContent>
    </Card>
  );
}
