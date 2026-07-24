import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Activity, Archive, Lock, Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { FAMILY_META, strategyMeta, type StrategyFamily } from "./polymarket-strategy-meta";
import { PolymarketDailyRawLedger } from "./PolymarketDailyRawLedger";
import { PolymarketUniqueMarketTape } from "./PolymarketUniqueMarketTape";
import { PolymarketPerformanceLens } from "./PolymarketPerformanceLens";
import {
  nextSortState,
  PolymarketSortableHeader,
  stableSortRows,
  type SortState,
  type SortValue,
} from "./PolymarketSortableHeader";

type ScopeKey = "paper" | "forward" | "history";
type MetricKey = "stress" | "net" | "avg" | "wr";
type ScoreSortKey =
  | "rank"
  | "strategy"
  | "family"
  | "gate"
  | "n"
  | "winRate"
  | "netPerBet"
  | "pnl"
  | "stress"
  | "overlap"
  | "open"
  | "engine";
type SeedSortKey = "name" | "bets" | "winRate" | "net";

type FloorBot = {
  key: string;
  name: string;
  color: string;
  tradesToday: number;
  pnlToday: number;
  openNow: number;
  openUsd: number;
  wins: number;
  losses: number;
  pnlAll: number;
  profitStressAll: number;
  engineHeartbeatAgoSec: number | null;
  overlapVsFade: { shared: number; agreement: number | null } | null;
};

const usd = (v: number | null | undefined) =>
  v == null ? "—" : `${v < 0 ? "-" : "+"}$${Math.abs(v).toFixed(2)}`;
const cents = (v: number | null | undefined) =>
  v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}¢`;
const percent = (v: number | null | undefined, digits = 0) =>
  v == null ? "—" : `${(v * 100).toFixed(digits)}%`;
const age = (seconds: number | null) =>
  seconds == null ? "—" : seconds < 90 ? `${seconds}s` : seconds < 5_400 ? `${Math.round(seconds / 60)}m` : `${(seconds / 3_600).toFixed(1)}h`;

const METRICS: Record<MetricKey, { label: string; value: (bot: FloorBot) => number }> = {
  stress: { label: "Profit stress −36%", value: (bot) => bot.profitStressAll },
  net: { label: "Raw net", value: (bot) => bot.pnlAll },
  avg: {
    label: "Net / bet",
    value: (bot) => {
      const n = bot.wins + bot.losses;
      return n ? bot.pnlAll / n : Number.NEGATIVE_INFINITY;
    },
  },
  wr: {
    label: "Win rate",
    value: (bot) => {
      const n = bot.wins + bot.losses;
      return n ? bot.wins / n : Number.NEGATIVE_INFINITY;
    },
  },
};

const stateStyle = (state: string) => ({
  passing: "border-success/30 bg-success/10 text-success",
  failing: "border-destructive/30 bg-destructive/10 text-destructive",
  collecting: "border-warning/30 bg-warning/10 text-warning",
  waiting: "border-border bg-muted/50 text-muted-foreground",
  control: "border-border bg-muted/50 text-muted-foreground",
  split: "border-primary/30 bg-primary/10 text-primary",
}[state] ?? "border-border bg-muted/50 text-muted-foreground");

export function PolymarketScoreboard() {
  const [scope, setScope] = useState<ScopeKey>(() => {
    const saved = localStorage.getItem("scoreboard.scope");
    return saved === "history" || saved === "paper" ? saved : "forward";
  });
  const floorQuery = trpc.polymarket.floorView.useQuery({ scope, view: "scoreboard" }, {
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const seedQuery = trpc.polymarket.scoreboard.useQuery(undefined, { staleTime: 60_000 });
  const [metric, setMetric] = useState<MetricKey>(() => {
    const saved = localStorage.getItem("scoreboard.metric");
    if (saved === "worst") return "stress";
    return saved && saved in METRICS ? saved as MetricKey : "net";
  });
  const [minN, setMinN] = useState(() => Number(localStorage.getItem("scoreboard.minN") ?? 10));
  const [scoreSort, setScoreSort] = useState<SortState<ScoreSortKey>>({
    key: "rank",
    direction: "asc",
  });
  const [seedSort, setSeedSort] = useState<SortState<SeedSortKey>>({
    key: "net",
    direction: "desc",
  });

  const response = floorQuery.data;
  const scoped = response?.scope;
  const gateStateByKey = useMemo(() => {
    const grouped = new Map<string, string[]>();
    for (const hypothesis of response?.familywiseGate.hypotheses ?? []) {
      grouped.set(hypothesis.sourceKey, [
        ...(grouped.get(hypothesis.sourceKey) ?? []),
        hypothesis.state,
      ]);
    }
    return new Map([...grouped].map(([key, states]) => [
      key,
      new Set(states).size === 1 ? states[0] : "split",
    ]));
  }, [response]);

  if (floorQuery.isLoading) {
    return <div className="rounded-xl border p-8 text-sm text-muted-foreground">Loading forward scoreboard…</div>;
  }
  if (!response || !scoped) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm">
        The forward ledger is unavailable. No historical or zero-filled values are being substituted.
      </div>
    );
  }

  const bots = scoped.bots as FloorBot[];
  const metricSpec = METRICS[metric];
  const ranked = [...bots].sort((a, b) => {
    if (a.key === "drift") return 1;
    if (b.key === "drift") return -1;
    const an = a.wins + a.losses;
    const bn = b.wins + b.losses;
    if ((an >= minN) !== (bn >= minN)) return an >= minN ? -1 : 1;
    return metricSpec.value(b) - metricSpec.value(a);
  });
  const rankByKey = new Map(ranked.map((bot, index) => [bot.key, index]));
  const scoreValue = (bot: FloorBot, key: ScoreSortKey): SortValue => {
    const n = bot.wins + bot.losses;
    const state = bot.key === "drift" ? "control" : gateStateByKey.get(bot.key) ?? "waiting";
    return {
      rank: rankByKey.get(bot.key),
      strategy: bot.name,
      family: FAMILY_META[strategyMeta(bot.key).family].label,
      gate: state,
      n,
      winRate: n ? bot.wins / n : null,
      netPerBet: n ? bot.pnlAll / n : null,
      pnl: bot.pnlAll,
      stress: bot.profitStressAll,
      overlap: bot.overlapVsFade?.agreement,
      open: bot.openNow,
      engine: bot.engineHeartbeatAgoSec,
    }[key];
  };
  const scoreRows = stableSortRows(
    ranked,
    (bot) => scoreValue(bot, scoreSort.key),
    scoreSort.direction,
  );
  const qualified = bots.filter((bot) => bot.key !== "drift" && bot.wins + bot.losses >= minN);
  const leader = qualified.length
    ? [...qualified].sort((a, b) => metricSpec.value(b) - metricSpec.value(a))[0]
    : null;
  const totalGraded = bots
    .filter((bot) => bot.key !== "drift")
    .reduce((sum, bot) => sum + bot.wins + bot.losses, 0);
  const openTrades = bots
    .filter((bot) => bot.key !== "drift")
    .reduce((sum, bot) => sum + bot.openNow, 0);
  const gateStates = response.familywiseGate.hypotheses.reduce<Record<string, number>>((counts, bot) => {
    counts[bot.state] = (counts[bot.state] ?? 0) + 1;
    return counts;
  }, {});

  const setScopePersist = (next: ScopeKey) => {
    setScope(next);
    localStorage.setItem("scoreboard.scope", next);
  };
  const setMetricPersist = (next: MetricKey) => {
    setMetric(next);
    localStorage.setItem("scoreboard.metric", next);
  };
  const setMinNPersist = (next: number) => {
    setMinN(next);
    localStorage.setItem("scoreboard.minN", String(next));
  };

  const seed = seedQuery.data;
  const seedResidual = seed?.fadeEdgeBeyondDrift?.residualEdge ?? null;
  const seedRows = seed
    ? [
        { name: "Follow Tesseract", bets: seed.followTesseract.bets, winRate: seed.followTesseract.winRate, net: seed.followTesseract.netAvg },
        { name: "Fade Tesseract", bets: seed.fadeTesseract.bets, winRate: seed.fadeTesseract.winRate, net: seed.fadeTesseract.netAvg },
        { name: "Always DOWN", bets: seed.total, winRate: seed.baselineAlwaysDown.winRate, net: seed.baselineAlwaysDown.grossAvg },
      ]
    : [];
  const sortedSeedRows = stableSortRows(
    seedRows,
    (row) => row[seedSort.key],
    seedSort.direction,
  );
  const sortScore = (key: ScoreSortKey, initialDirection: "asc" | "desc" = "desc") =>
    setScoreSort((current) => nextSortState(current, key, initialDirection));
  const sortSeed = (key: SeedSortKey, initialDirection: "asc" | "desc" = "desc") =>
    setSeedSort((current) => nextSortState(current, key, initialDirection));

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <Activity className="h-3.5 w-3.5" />
              Forward paper ledger
            </div>
            <h2 className="text-xl font-semibold tracking-tight">One comparable scoreboard for every registered strategy</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              RAW uses the fee-adjusted $5 book-walk VWAP captured at decision time and binary settlement.
              The legacy profit stress merely discounts winning profit by 36%; it is uncalibrated, is not an
              execution model, and is not used by the verdict gate.
            </p>
          </div>
          <div className="flex flex-wrap gap-1 rounded-lg border bg-muted/20 p-1 text-xs">
            {([
              ["forward", "Gate cohort"],
              ["paper", "Current paper"],
              ["history", "All history"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setScopePersist(key)}
                className={`rounded-md px-2.5 py-1.5 transition-colors ${
                  scope === key ? "bg-foreground font-medium text-background" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid border-t sm:grid-cols-2 xl:grid-cols-5">
          {[
            ["Registered", `${bots.filter((bot) => bot.key !== "drift").length} + control`, "paper-only rules"],
            ["Qualified", `${qualified.length}`, `≥${minN} graded bets`],
            ["Graded decisions", totalGraded.toLocaleString(), scope === "forward" ? "gate cohort" : "selected cohort"],
            ["Open decisions", openTrades.toLocaleString(), `$${bots.filter((bot) => bot.key !== "drift").reduce((sum, bot) => sum + bot.openUsd, 0).toFixed(0)} at risk on paper`],
            ["Gate", `${gateStates.passing ?? 0} pass · ${gateStates.collecting ?? 0} collect`, `${gateStates.waiting ?? 0} waiting · ${gateStates.failing ?? 0} fail`],
          ].map(([label, value, note]) => (
            <div key={label} className="border-b p-4 last:border-b-0 sm:border-r xl:border-b-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
              <div className="mt-1 font-mono text-lg font-semibold tabular-nums">{value}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{note}</div>
            </div>
          ))}
        </div>
      </section>

      <PolymarketUniqueMarketTape
        assetTape={scoped.assetTape}
        scopeLabel={scope === "forward" ? "Gate cohort" : scope === "paper" ? "Current paper" : "All history"}
        scope={scope}
      />

      <PolymarketPerformanceLens
        scope={scope}
        familywiseGate={response.familywiseGate}
      />

      <PolymarketDailyRawLedger
        ledger={scoped.dailyLedger}
        bots={ranked}
        title="Daily RAW trend"
        subtitle="strategy × day realized P&L"
      />

      <Card className="overflow-hidden shadow-none">
        <CardHeader className="border-b p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Trophy className="h-4 w-4 text-muted-foreground" />
                Pooled gate reference
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {leader ? `${leader.name} leads the legacy pooled view by ${metricSpec.label.toLowerCase()}. The primary lens above keeps 5m and 15m separate.` : `No strategy has ${minN} graded bets in this cohort yet.`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <div className="flex flex-wrap gap-1">
                {(Object.entries(METRICS) as [MetricKey, (typeof METRICS)[MetricKey]][]).map(([key, spec]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setMetricPersist(key)}
                    className={`rounded-md border px-2 py-1 ${
                      metric === key ? "border-foreground/30 bg-muted font-medium" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {spec.label}
                  </button>
                ))}
              </div>
              <label className="inline-flex items-center gap-1.5 text-muted-foreground">
                qualify at
                <select
                  value={minN}
                  onChange={(event) => setMinNPersist(Number(event.target.value))}
                  className="rounded-md border bg-background px-2 py-1 text-foreground"
                >
                  {[5, 10, 25, 50, 100].map((value) => <option key={value} value={value}>{value} bets</option>)}
                </select>
              </label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-sm tabular-nums">
              <thead>
                <tr className="border-b bg-muted/20 text-left text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  <PolymarketSortableHeader column="rank" active={scoreSort.key} direction={scoreSort.direction} onSort={sortScore} align="center" initialDirection="asc" className="w-12 px-4 py-2.5 font-medium">#</PolymarketSortableHeader>
                  <PolymarketSortableHeader column="strategy" active={scoreSort.key} direction={scoreSort.direction} onSort={sortScore} initialDirection="asc" className="px-3 py-2.5 font-medium">Strategy</PolymarketSortableHeader>
                  <PolymarketSortableHeader column="family" active={scoreSort.key} direction={scoreSort.direction} onSort={sortScore} initialDirection="asc" className="px-3 py-2.5 font-medium">Family</PolymarketSortableHeader>
                  <PolymarketSortableHeader column="gate" active={scoreSort.key} direction={scoreSort.direction} onSort={sortScore} initialDirection="asc" className="px-3 py-2.5 font-medium">Gate</PolymarketSortableHeader>
                  <PolymarketSortableHeader column="n" active={scoreSort.key} direction={scoreSort.direction} onSort={sortScore} align="right" className="px-3 py-2.5 font-medium">N</PolymarketSortableHeader>
                  <PolymarketSortableHeader column="winRate" active={scoreSort.key} direction={scoreSort.direction} onSort={sortScore} align="right" className="px-3 py-2.5 font-medium">Win</PolymarketSortableHeader>
                  <PolymarketSortableHeader column="netPerBet" active={scoreSort.key} direction={scoreSort.direction} onSort={sortScore} align="right" className="px-3 py-2.5 font-medium">Net / bet</PolymarketSortableHeader>
                  <PolymarketSortableHeader column="pnl" active={scoreSort.key} direction={scoreSort.direction} onSort={sortScore} align="right" className="px-3 py-2.5 font-medium">Raw net</PolymarketSortableHeader>
                  <PolymarketSortableHeader column="stress" active={scoreSort.key} direction={scoreSort.direction} onSort={sortScore} align="right" className="px-3 py-2.5 font-medium" title="Legacy sensitivity: winning profit reduced by 36%. Uncalibrated and not a verdict input.">Stress −36%</PolymarketSortableHeader>
                  <PolymarketSortableHeader column="overlap" active={scoreSort.key} direction={scoreSort.direction} onSort={sortScore} align="right" className="px-3 py-2.5 font-medium">Overlap</PolymarketSortableHeader>
                  <PolymarketSortableHeader column="open" active={scoreSort.key} direction={scoreSort.direction} onSort={sortScore} align="right" className="px-3 py-2.5 font-medium">Open</PolymarketSortableHeader>
                  <PolymarketSortableHeader column="engine" active={scoreSort.key} direction={scoreSort.direction} onSort={sortScore} align="right" initialDirection="asc" className="px-4 py-2.5 font-medium">Engine</PolymarketSortableHeader>
                </tr>
              </thead>
              <tbody>
                {scoreRows.map((bot) => {
                  const n = bot.wins + bot.losses;
                  const meta = strategyMeta(bot.key);
                  const family = FAMILY_META[meta.family];
                  const state = bot.key === "drift" ? "control" : gateStateByKey.get(bot.key) ?? "waiting";
                  const tooSmall = n < minN && bot.key !== "drift";
                  return (
                    <tr
                      key={bot.key}
                      className={`border-b last:border-0 ${bot.key === "drift" ? "bg-muted/20" : ""} ${tooSmall ? "opacity-55" : ""}`}
                      title={tooSmall ? `${n} graded bets — below the ${minN}-bet ranking floor` : undefined}
                    >
                      <td className="px-4 py-3 text-center font-mono text-xs text-muted-foreground">
                        {bot.key === "drift" ? "C" : (rankByKey.get(bot.key) ?? 0) + 1}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-start gap-2.5">
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: bot.color }} />
                          <div>
                            <Link
                              to="/polymarket/strategy/$botKey"
                              params={{ botKey: bot.key }}
                              search={{ scope }}
                              className="font-medium transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {bot.name}
                            </Link>
                            <div className="mt-0.5 max-w-md text-[11px] leading-snug text-muted-foreground">{meta.thesis}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: family.color }} />
                          {family.short}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${stateStyle(state)}`}>
                          {state}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">{n.toLocaleString()}</td>
                      <td className="px-3 py-3 text-right">{n ? percent(bot.wins / n) : "—"}</td>
                      <td className={`px-3 py-3 text-right ${n && bot.pnlAll / n > 0 ? "text-success" : n && bot.pnlAll / n < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                        {n ? usd(bot.pnlAll / n) : "—"}
                      </td>
                      <td className={`px-3 py-3 text-right ${bot.pnlAll > 0 ? "text-success" : bot.pnlAll < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                        {usd(bot.pnlAll)}
                      </td>
                      <td className={`px-3 py-3 text-right font-medium ${bot.profitStressAll > 0 ? "text-success" : bot.profitStressAll < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                        {usd(bot.profitStressAll)}
                      </td>
                      <td className="px-3 py-3 text-right text-muted-foreground">
                        {bot.overlapVsFade?.agreement == null ? "—" : `${percent(bot.overlapVsFade.agreement)} · ${bot.overlapVsFade.shared}`}
                      </td>
                      <td className="px-3 py-3 text-right">{bot.openNow || "—"}</td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground" title="Independent general paper-worker runtime heartbeat; not the strategy's last decision.">{age(bot.engineHeartbeatAgoSec)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t bg-muted/10 px-4 py-2.5 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" /> No execution path exists.</span>
            <span>Muted rows are below the selected sample floor.</span>
            <span>Overlap is same-market side agreement with Fade Tesseract; it is not independent confirmation.</span>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden shadow-none">
        <CardHeader className="border-b p-4">
          <CardTitle className="text-base">Coverage by strategy family</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {(Object.keys(FAMILY_META) as StrategyFamily[]).filter((family) => family !== "control").map((family) => {
              const members = bots.filter((bot) => strategyMeta(bot.key).family === family);
              const n = members.reduce((sum, bot) => sum + bot.wins + bot.losses, 0);
              const net = members.reduce((sum, bot) => sum + bot.pnlAll, 0);
              const profitStress = members.reduce((sum, bot) => sum + bot.profitStressAll, 0);
              const active = members.filter((bot) => bot.wins + bot.losses + bot.openNow > 0).length;
              return (
                <div key={family} className="grid items-center gap-2 px-4 py-3 sm:grid-cols-[minmax(180px,1fr)_120px_140px_140px]">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: FAMILY_META[family].color }} />
                    <div>
                      <div className="text-sm font-medium">{FAMILY_META[family].label}</div>
                      <div className="text-[11px] text-muted-foreground">{active}/{members.length} have paper activity</div>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground sm:text-right"><span className="font-mono text-foreground">{n}</span> graded</div>
                  <div className={`text-xs sm:text-right ${net > 0 ? "text-success" : net < 0 ? "text-destructive" : "text-muted-foreground"}`}>raw {usd(net)}</div>
                  <div className={`text-xs font-medium sm:text-right ${profitStress > 0 ? "text-success" : profitStress < 0 ? "text-destructive" : "text-muted-foreground"}`}>stress −36% {usd(profitStress)}</div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <details className="group overflow-hidden rounded-xl border bg-card">
        <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
          <Archive className="h-4 w-4 text-muted-foreground" />
          <div className="min-w-0">
            <div className="text-sm font-medium">Original BTC / ETH seed study</div>
            <div className="text-[11px] text-muted-foreground">Retained for continuity; retrospective and not part of the forward verdict.</div>
          </div>
          <span className="ml-auto text-xs text-muted-foreground group-open:hidden">show</span>
          <span className="ml-auto hidden text-xs text-muted-foreground group-open:inline">hide</span>
        </summary>
        <div className="border-t p-4">
          {!seed || seed.total === 0 ? (
            <p className="text-sm text-muted-foreground">No seed-study records are available.</p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border">
                {[
                  ["Markets", seed.total.toLocaleString()],
                  ["Base up-rate", percent(seed.baseUpRate)],
                  ["Fade residual", cents(seedResidual)],
                  ["Window", `${new Date(seed.firstAt!).toLocaleDateString()} → ${new Date(seed.lastAt!).toLocaleDateString()}`],
                ].map(([label, value]) => (
                  <div key={label} className="bg-card p-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
                    <div className="mt-1 font-mono text-sm">{value}</div>
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm tabular-nums">
                  <thead><tr className="border-b text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <PolymarketSortableHeader column="name" active={seedSort.key} direction={seedSort.direction} onSort={sortSeed} initialDirection="asc" className="p-2.5 font-medium">Seed strategy</PolymarketSortableHeader>
                    <PolymarketSortableHeader column="bets" active={seedSort.key} direction={seedSort.direction} onSort={sortSeed} align="right" className="p-2.5 font-medium">Bets</PolymarketSortableHeader>
                    <PolymarketSortableHeader column="winRate" active={seedSort.key} direction={seedSort.direction} onSort={sortSeed} align="right" className="p-2.5 font-medium">Win</PolymarketSortableHeader>
                    <PolymarketSortableHeader column="net" active={seedSort.key} direction={seedSort.direction} onSort={sortSeed} align="right" className="p-2.5 font-medium">Net / contract</PolymarketSortableHeader>
                  </tr></thead>
                  <tbody>
                    {sortedSeedRows.map((stats) => (
                      <tr key={stats.name} className="border-b last:border-0">
                        <td className="p-2.5">{stats.name}</td>
                        <td className="p-2.5 text-right">{stats.bets.toLocaleString()}</td>
                        <td className="p-2.5 text-right">{percent(stats.winRate)}</td>
                        <td className="p-2.5 text-right">{cents(stats.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
