import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Trophy, Shield, Search, Download } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CopyCode } from "@/components/ui/copy-code";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { pfLabel } from "@/lib/metrics";

const TFS = ["", "5m", "15m", "1h", "4h"];

const VERDICT_STYLE: Record<string, string> = {
  robust: "bg-success/15 text-success",
  mixed: "bg-warning/15 text-warning",
  fragile: "bg-destructive/15 text-destructive",
  "insufficient-data": "bg-muted text-muted-foreground",
};

const TRAJ_ICON: Record<string, string> = { improving: "↑", decaying: "↓", stable: "→", insufficient: "" };
const TRAJ_STYLE: Record<string, string> = {
  improving: "text-success",
  decaying: "text-destructive",
  stable: "text-muted-foreground",
  insufficient: "text-muted-foreground",
};

const scoreColor = (s: number) =>
  s >= 60 ? "text-success" : s >= 35 ? "text-warning" : "text-muted-foreground";

/** Download the ranked rows as CSV — preserves the export capability from the old Results page. */
function exportCsv(rows: Array<Record<string, unknown>> | readonly any[]) {
  if (!rows.length) return;
  const cols = ["score", "strategyId", "strategyName", "tier", "pair", "timeframe", "spanDays", "totalReturn", "profitFactor", "winRate", "maxDrawdown", "totalTrades", "expectancyR", "totalR", "estAccountReturn", "robustnessVerdict", "outlook", "trajectory", "jesterParamCode", "paramHash"];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `leaderboard-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Cross-strategy leaderboard — one composite score per (strategy · pair · timeframe · param set),
 * ranked across the whole warehouse. Score is PF/risk/sample-centric with a sample-size shrinkage,
 * and a computed robustness verdict caps it (so a "fragile" cell can't sit at the top).
 */
export function LeaderboardPage({ embedded }: { embedded?: boolean } = {}) {
  const [minTrades, setMinTrades] = useState(20);
  const [timeframe, setTimeframe] = useState("");
  const [q, setQ] = useState("");
  const [onlyValidated, setOnlyValidated] = useState(false);
  const [riskPct, setRiskPct] = useState(2);

  const rows = trpc.leaderboard.top.useQuery({
    minTrades,
    timeframe: timeframe || undefined,
    q: q.trim() || undefined,
    onlyValidated,
    riskPct,
    limit: 100,
  });
  const stats = trpc.leaderboard.stats.useQuery();

  return (
    <div className="space-y-5">
      {!embedded && (
        <PageHeader
          title="Leaderboard"
          subtitle="Every strategy · pair · timeframe ranked by one composite score — profit factor, drawdown and win rate, shrunk for sample size, and capped by any robustness verdict. Not raw return, which isn't comparable across windows."
          actions={
            <Badge variant="secondary">
              {stats.data ? `${stats.data.validated} validated` : "…"}
            </Badge>
          }
        />
      )}

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Strategy…" className="h-8 w-44" />
          </div>
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            Timeframe
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              {TFS.map((tf) => (
                <option key={tf} value={tf}>{tf || "any"}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            Min trades
            <Input
              type="number"
              value={minTrades}
              onChange={(e) => setMinTrades(Math.max(0, parseInt(e.target.value) || 0))}
              className="h-8 w-20"
            />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground" title="Account risked per trade — the est. account column scales with this">
            Risk/trade
            <div className="relative">
              <Input
                type="number"
                step="0.5"
                value={riskPct}
                onChange={(e) => setRiskPct(Math.min(100, Math.max(0.1, parseFloat(e.target.value) || 2)))}
                className="h-8 w-20 pr-5"
              />
              <span className="pointer-events-none absolute right-2 top-1.5 text-xs text-muted-foreground">%</span>
            </div>
          </label>
          <button
            onClick={() => setOnlyValidated((v) => !v)}
            className={
              "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors " +
              (onlyValidated ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background text-muted-foreground hover:bg-accent")
            }
          >
            <Shield className="h-3 w-3" /> Validated only
          </button>
          <span className="ml-auto text-xs text-muted-foreground">
            {rows.data ? `${rows.data.length} ranked` : rows.isLoading ? "loading…" : ""}
          </span>
          <button
            onClick={() => exportCsv(rows.data ?? [])}
            disabled={!rows.data?.length}
            className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            <Download className="h-3 w-3" /> CSV
          </button>
        </CardContent>
      </Card>

      {/* Ranked table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="p-3 font-medium">#</th>
                  <th className="p-3 font-medium">Score</th>
                  <th className="p-3 font-medium">Strategy</th>
                  <th className="p-3 font-medium">Cell</th>
                  <th className="p-3 font-medium" title="Param code for this set — copy it, or paste into ⌘K for the full details">Param code</th>
                  <th className="p-3 font-medium" title="Backtest return over the window (strategy sizing) — not account impact">Return</th>
                  <th className="p-3 font-medium" title={`Estimated % of account over the window at ${riskPct}% risk per trade (assumes losers ≈ 1R)`}>
                    Acct @{riskPct}%
                  </th>
                  <th className="p-3 font-medium" title="Per-trade expectancy in R (risk units)">E[R]</th>
                  <th className="p-3 font-medium">PF</th>
                  <th className="p-3 font-medium">Win</th>
                  <th className="p-3 font-medium">MaxDD</th>
                  <th className="p-3 font-medium">Trades</th>
                  <th className="p-3 font-medium">Robustness</th>
                </tr>
              </thead>
              <tbody>
                {rows.data?.length === 0 && (
                  <tr>
                    <td colSpan={13} className="p-6 text-center text-sm text-muted-foreground">
                      No cells match. Lower the min-trades gate, or run more backtests (arm the coverage engine).
                    </td>
                  </tr>
                )}
                {rows.data?.map((r, i) => (
                  <tr key={`${r.strategyId}|${r.pair}|${r.timeframe}|${r.paramHash}`} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="p-3 text-muted-foreground">{i + 1}</td>
                    <td className={"p-3 text-base font-bold " + scoreColor(r.score)}>{r.score}</td>
                    <td className="p-3">
                      <Link
                        to="/strategy/$strategyId"
                        params={{ strategyId: r.strategyId }}
                        search={{ pair: r.pair, tf: r.timeframe, days: r.daysRequested }}
                        className="font-medium hover:text-primary hover:underline"
                      >
                        {r.strategyName}
                      </Link>
                      {r.tier && <span className="ml-2 text-[10px] uppercase text-muted-foreground">{r.tier}</span>}
                    </td>
                    <td className="p-3 font-mono text-xs text-muted-foreground">
                      {r.pair} · {r.timeframe} · {r.spanDays}d
                    </td>
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                      {r.jesterParamCode ? (
                        <CopyCode code={r.jesterParamCode} label="" />
                      ) : r.paramHash !== "default" ? (
                        <CopyCode code={r.paramHash} label="" />
                      ) : (
                        <span className="text-xs text-muted-foreground/60" title="Strategy default parameters">default</span>
                      )}
                    </td>
                    <td className={"p-3 " + (r.totalReturn != null && r.totalReturn >= 0 ? "text-success" : "text-destructive")}>
                      {r.totalReturn == null ? "—" : `${r.totalReturn.toFixed(1)}%`}
                    </td>
                    <td className={"p-3 font-medium " + (r.estAccountReturn != null && r.estAccountReturn >= 0 ? "text-success" : "text-destructive")}>
                      {r.estAccountReturn == null ? "—" : `${r.estAccountReturn >= 0 ? "+" : ""}${r.estAccountReturn.toFixed(1)}%`}
                    </td>
                    <td className={"p-3 text-muted-foreground " + (r.expectancyR != null && r.expectancyR < 0 ? "text-destructive" : "")}>
                      {r.expectancyR == null ? "—" : `${r.expectancyR >= 0 ? "+" : ""}${r.expectancyR.toFixed(2)}R`}
                    </td>
                    <td className="p-3">{pfLabel(r.profitFactor)}</td>
                    <td className="p-3 text-muted-foreground">{r.winRate == null ? "—" : `${r.winRate.toFixed(0)}%`}</td>
                    <td className="p-3 text-muted-foreground">{r.maxDrawdown == null ? "—" : `${Math.abs(r.maxDrawdown).toFixed(1)}%`}</td>
                    <td className="p-3">{r.totalTrades ?? "—"}</td>
                    <td className="p-3">
                      {r.robustnessVerdict ? (
                        <span className="inline-flex items-center gap-1">
                          <span className={"rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase " + (VERDICT_STYLE[r.robustnessVerdict] ?? "")}>
                            {r.outlook && r.outlook !== "unclear" ? r.outlook : r.robustnessVerdict === "insufficient-data" ? "insufficient" : r.robustnessVerdict}
                          </span>
                          {r.trajectory && (
                            <span
                              className={TRAJ_STYLE[r.trajectory] ?? "text-muted-foreground"}
                              title={`trajectory: ${r.trajectory}`}
                            >
                              {TRAJ_ICON[r.trajectory] ?? ""}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/60">unvalidated</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        <Trophy className="mr-1 inline h-3 w-3" />
        Ranked on the widest-span backtest we hold per cell. <span className="font-medium">Acct @{riskPct}%</span> estimates account
        impact at {riskPct}% risk per trade (= total R × {riskPct}%, where E[R] = (1−winRate)(PF−1) assuming losers ≈ 1R) — an estimate for
        comparing on a common risk basis, not a P&amp;L guarantee. <span className="font-medium">Return</span> is the backtest's own sizing, not account impact.
        Open a strategy and click <span className="font-medium">Validate</span> to run its robustness check — the verdict then caps its score.
      </p>
    </div>
  );
}
