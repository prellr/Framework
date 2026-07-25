import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronsUpDown, EyeOff, Lock } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { PolymarketDailyRawLedger } from "./PolymarketDailyRawLedger";
import { PolymarketAssetLink } from "./PolymarketAssetLink";
import { PolymarketUniqueMarketTape } from "./PolymarketUniqueMarketTape";
import {
  nextSortState,
  PolymarketSortableHeader,
  stableSortRows,
  type SortState,
} from "./PolymarketSortableHeader";
import { formatElapsedDays } from "./polymarket-age";

/**
 * Paper Floor — Cobra-style live paper-trading dashboard. Bot cards (heartbeat, today, ledger),
 * per-bot RAW equity curves, and the trade feed. PAPER ONLY: the "live"
 * slot on every card is a locked placeholder — the Polymarket flow exposes no execution endpoint, and
 * execution only becomes a separate conversation/build after a verdict-gate PASS.
 */

const usd = (v: number | null | undefined) =>
  v == null ? "—" : `${v < 0 ? "-" : "+"}$${Math.abs(v).toFixed(2)}`;
const ago = (s: number | null) => (s == null ? "—" : s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : `${(s / 3600).toFixed(1)}h ago`);
const cents = (v: number | null | undefined) => v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}¢`;

type FloorBotActivity =
  | {
    kind: "jester-v1-source";
    status: "disabled" | "missing-credential" | "subscribed" | "unsubscribed" | "unknown" | "error" | "stale";
    fresh: boolean;
    checkedAgoSec: number | null;
    signalRows: number;
    lastSignalAgoSec: number | null;
  }
  | {
    kind: "smooth-path-funnel";
    status: "awaiting-observation" | "evaluating" | "path-qualified" | "book-qualified" | "placed" | "stale";
    fresh: boolean;
    capturedAgoSec: number | null;
    eligibleRows: number;
    observedRows: number;
    pathQualifiedRows: number;
    bookQualifiedRows: number;
    placedRows: number;
  };

type FloorBot = {
  key: string;
  name: string;
  color: string;
  activity: FloorBotActivity | null;
  tradesToday: number;
  pnlToday: number;
  openNow: number;
  openUsd: number;
  wins: number;
  losses: number;
  pnlAll: number;
  profitStressAll: number;
  lastDecisionAgoSec: number | null;
  engineHeartbeatAgoSec: number | null;
  overlapVsFade: { shared: number; sameSide: number; gradedShared: number; agreement: number | null } | null;
  buckets: { pair: string; horizonMin: number; n: number; wins: number; pnl: number; openNow: number }[];
};
type Bucket = FloorBot["buckets"][number];
type FloorCombo = {
  botKey: string;
  pair: string;
  horizonMin: number;
  n: number;
  wins: number;
  pnl: number;
  profitStress: number;
  openNow: number;
  openUsd: number;
  todayN: number;
  todayPnl: number;
  lastDecisionAgoSec: number | null;
};
type CardHorizon = "all" | 5 | 15;
type FeedSortKey = "time" | "bot" | "market" | "side" | "p" | "ask" | "edge" | "size" | "pnl" | "status";

const rowCount = (value: number) => value.toLocaleString();

export function paperBotActivityLine(activity: FloorBotActivity): {
  label: "source" | "funnel";
  value: string;
  title: string;
  warning: boolean;
} {
  if (activity.kind === "jester-v1-source") {
    const title = [
      "Read-only Jester V1 source health; independent of the selected paper cohort.",
      `${rowCount(activity.signalRows)} sided entries have been captured locally.`,
      activity.checkedAgoSec == null ? "No health receipt is available." : `Last health receipt: ${ago(activity.checkedAgoSec)}.`,
      activity.lastSignalAgoSec == null ? "No local sided entry exists." : `Last sided entry: ${ago(activity.lastSignalAgoSec)}.`,
    ].join(" ");
    const value = activity.status === "unsubscribed"
      ? "upstream unsubscribed"
      : activity.status === "subscribed"
        ? activity.lastSignalAgoSec == null
          ? "subscribed · awaiting entry"
          : `subscribed · entry ${ago(activity.lastSignalAgoSec)}`
        : activity.status === "missing-credential"
          ? "analysis credential missing"
          : activity.status === "disabled"
            ? "logger disabled"
            : activity.status === "error"
              ? "source check error"
              : activity.status === "stale"
                ? "source check stale"
                : "subscription unknown";
    return {
      label: "source",
      value,
      title,
      warning: activity.status !== "subscribed",
    };
  }

  const title = [
    "Outcome-blind prospective Smooth Path funnel across all registered 5m windows; independent of the selected paper cohort.",
    `${rowCount(activity.eligibleRows)} eligible, ${rowCount(activity.observedRows)} observed,`,
    `${rowCount(activity.pathQualifiedRows)} path-qualified, ${rowCount(activity.bookQualifiedRows)} book-qualified,`,
    `${rowCount(activity.placedRows)} paper rows placed.`,
    activity.capturedAgoSec == null ? "No capture receipt is available." : `Last capture: ${ago(activity.capturedAgoSec)}.`,
  ].join(" ");
  const value = activity.status === "stale"
    ? `capture stale · ${rowCount(activity.observedRows)} observed`
    : activity.status === "placed"
      ? `${rowCount(activity.placedRows)} placed · ${rowCount(activity.observedRows)} observed`
      : activity.status === "book-qualified"
        ? `${rowCount(activity.observedRows)} observed · ${rowCount(activity.bookQualifiedRows)} book`
        : activity.status === "path-qualified"
          ? `${rowCount(activity.observedRows)} observed · ${rowCount(activity.pathQualifiedRows)} path · 0 book`
          : activity.status === "evaluating"
            ? `${rowCount(activity.observedRows)} observed · 0 path`
            : "awaiting observations";
  return {
    label: "funnel",
    value,
    title,
    warning: activity.status === "stale",
  };
}

/** Success metrics the floor can rank/filter by — a data list so new lenses are one-line adds. */
const METRICS: { key: string; label: string; value: (b: FloorBot) => number; fmt: (b: FloorBot) => string }[] = [
  { key: "net", label: "Net $", value: (b) => b.pnlAll, fmt: (b) => usd(b.pnlAll) },
  { key: "wr", label: "Win %", value: (b) => (b.wins + b.losses ? b.wins / (b.wins + b.losses) : -1), fmt: (b) => (b.wins + b.losses ? `${Math.round((100 * b.wins) / (b.wins + b.losses))}%` : "—") },
  { key: "avg", label: "Net/bet", value: (b) => (b.wins + b.losses ? b.pnlAll / (b.wins + b.losses) : -Infinity), fmt: (b) => (b.wins + b.losses ? usd(b.pnlAll / (b.wins + b.losses)) : "—") },
  { key: "today", label: "Today $", value: (b) => b.pnlToday, fmt: (b) => usd(b.pnlToday) },
];

export function scopeFloorBotForCards(
  bot: FloorBot,
  combos: FloorCombo[],
  horizon: CardHorizon,
): FloorBot {
  if (horizon === "all") return bot;
  const selected = combos.filter(
    (combo) => combo.botKey === bot.key && combo.horizonMin === horizon,
  );
  const n = selected.reduce((sum, combo) => sum + combo.n, 0);
  const wins = selected.reduce((sum, combo) => sum + combo.wins, 0);
  const decisionAges = selected
    .map((combo) => combo.lastDecisionAgoSec)
    .filter((age): age is number => age != null);
  return {
    ...bot,
    tradesToday: selected.reduce((sum, combo) => sum + combo.todayN, 0),
    pnlToday: selected.reduce((sum, combo) => sum + combo.todayPnl, 0),
    openNow: selected.reduce((sum, combo) => sum + combo.openNow, 0),
    openUsd: selected.reduce((sum, combo) => sum + combo.openUsd, 0),
    wins,
    losses: Math.max(0, n - wins),
    pnlAll: selected.reduce((sum, combo) => sum + combo.pnl, 0),
    profitStressAll: selected.reduce((sum, combo) => sum + combo.profitStress, 0),
    lastDecisionAgoSec: decisionAges.length ? Math.min(...decisionAges) : null,
    overlapVsFade: null,
    buckets: bot.buckets.filter((bucket) => bucket.horizonMin === horizon),
  };
}

function PaperBotActivityRow({ activity }: { activity: FloorBotActivity | null }) {
  if (!activity) return null;
  const line = paperBotActivityLine(activity);
  return (
    <div className="flex justify-between gap-3" title={line.title}>
      <dt className="shrink-0 text-muted-foreground">{line.label}</dt>
      <dd className={`text-right ${line.warning ? "text-warning" : "text-muted-foreground"}`}>
        {line.value}
      </dd>
    </div>
  );
}

export function PolymarketPaperFloor() {
  const [scope, setScope] = useState<"paper" | "forward" | "history">(() => {
    const saved = localStorage.getItem("floor.scope.v2");
    return saved === "forward" || saved === "history" ? saved : "paper";
  });
  const q = trpc.polymarket.floorView.useQuery(
    { scope, view: "floor" },
    { staleTime: 15_000, refetchInterval: 30_000 },
  );
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("floor.hiddenBots") ?? "[]") as string[]); } catch { return new Set(); }
  });
  const [equityHidden, setEquityHidden] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("floor.equityHiddenBots") ?? "[]") as string[]); } catch { return new Set(); }
  });
  const [equityScrubT, setEquityScrubT] = useState<number | null>(null);
  const [metric, setMetric] = useState<string>(() => {
    const saved = localStorage.getItem("floor.metric");
    return saved === "worst" ? "stress" : saved ?? "net";
  });
  const [comboMinN, setComboMinN] = useState<number>(() => Number(localStorage.getItem("floor.comboMinN") ?? 10));
  const [comboSort, setComboSort] = useState<SortState<string>>({ key: "avg", direction: "desc" });
  const [segmentSort, setSegmentSort] = useState<SortState<string>>({ key: "bot", direction: "asc" });
  const [feedSort, setFeedSort] = useState<SortState<FeedSortKey>>({ key: "time", direction: "desc" });
  const [gateCollapsed, setGateCollapsed] = useState(() => localStorage.getItem("floor.gateCollapsed") === "true");
  const [cardHorizon, setCardHorizon] = useState<CardHorizon>(() => {
    const saved = localStorage.getItem("floor.cardHorizon");
    return saved === "5" ? 5 : saved === "15" ? 15 : "all";
  });
  const response = q.data;

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading floor…</p>;
  if (!response) return <p className="text-sm text-muted-foreground">Floor unavailable.</p>;
  const d = { ...response, ...response.scope };
  const paperHistoryStartMs = response.paperLedgerStartMs;
  const familywiseStartMs = response.familywiseGate.constants.evalStartMs;
  const engineAge = response.engineRuntime.ageSec == null
    ? null
    : Math.round(response.engineRuntime.ageSec);
  const engineHeartbeat = !response.enabled || response.engineRuntime.status === "disabled"
    ? "disabled"
    : response.engineRuntime.status === "error"
      ? `error · ${ago(engineAge)}`
      : response.engineRuntime.source === "runtime" && response.engineRuntime.fresh
        ? `${response.engineRuntime.status === "running" ? "running" : "alive"} · ${ago(engineAge)}`
        : engineAge == null
          ? "unavailable"
          : `stale · ${ago(engineAge)}`;

  const setHiddenPersist = (next: Set<string>) => {
    setHidden(next);
    localStorage.setItem("floor.hiddenBots", JSON.stringify([...next]));
  };
  const setEquityHiddenPersist = (next: Set<string>) => {
    setEquityHidden(next);
    localStorage.setItem("floor.equityHiddenBots", JSON.stringify([...next]));
  };
  const toggleBot = (key: string) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key); else next.add(key);
    setHiddenPersist(next);
  };
  const setMetricPersist = (m: string) => { setMetric(m); localStorage.setItem("floor.metric", m); };
  const setCardHorizonPersist = (next: CardHorizon) => {
    setCardHorizon(next);
    localStorage.setItem("floor.cardHorizon", String(next));
  };
  const toggleGate = () => setGateCollapsed((current) => {
    const next = !current;
    localStorage.setItem("floor.gateCollapsed", String(next));
    return next;
  });
  const setScopePersist = (next: "paper" | "forward" | "history") => {
    setScope(next);
    localStorage.setItem("floor.scope.v2", next);
  };

  const activeMetric = METRICS.find((m) => m.key === metric) ?? METRICS[0];

  // Sort a card's asset×horizon buckets by the active "Rank by" metric (falls back to net for the
  // whole-bot-only metrics). For rate metrics, qualified buckets (≥5 graded) rank above small-n noise
  // so a 100%-on-1-trade cell can't top the card.
  const visibleBots = (d.bots as FloorBot[]).filter((b) => !hidden.has(b.key));
  const overviewBots = [...visibleBots].sort((a, b) => activeMetric.value(b) - activeMetric.value(a));
  const cardBots = visibleBots
    .filter((bot) =>
      cardHorizon === "all"
      || bot.buckets.some((bucket) => bucket.horizonMin === cardHorizon)
    )
    .map((bot) =>
      scopeFloorBotForCards(bot, (d.combos ?? []) as FloorCombo[], cardHorizon)
    );
  const rankedBots = [...cardBots].sort((a, b) => activeMetric.value(b) - activeMetric.value(a));
  const metricEqual = (a: number, b: number) => a === b || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9);
  const ranked = rankedBots.map((bot, index, all) => ({
    bot,
    rank: index > 0 && metricEqual(activeMetric.value(bot), activeMetric.value(all[index - 1]))
      ? null
      : index + 1,
  })).reduce<{ bot: FloorBot; rank: number }[]>((rows, row) => {
    rows.push({ bot: row.bot, rank: row.rank ?? rows[rows.length - 1].rank });
    return rows;
  }, []);
  const isVisible = (key: string) => !hidden.has(key);

  const botColor = new Map(d.bots.map((b) => [b.key, b.color]));
  const botName = new Map(d.bots.map((b) => [b.key, b.name]));
  const visibleFeed = d.feed.filter((trade) => isVisible(trade.bot));
  const sortedFeed = stableSortRows(
    visibleFeed,
    (trade) => ({
      time: new Date(trade.at).getTime(),
      bot: botName.get(trade.bot) ?? trade.bot,
      market: `${trade.pair}:${trade.horizonMin}`,
      side: trade.side,
      p: trade.p,
      ask: trade.ask,
      edge: trade.edge,
      size: trade.size,
      pnl: trade.pnl,
      status: trade.status,
    })[feedSort.key],
    feedSort.direction,
  );
  const sortFeed = (key: FeedSortKey, initialDirection: "asc" | "desc" = "desc") =>
    setFeedSort((current) => nextSortState(current, key, initialDirection));
  const verdictRows = d.familywiseGate.hypotheses.map((bot) => ({
    bot,
    constants: d.familywiseGate.constants,
    comparator: bot.comparator === "same-tick opposite side" ? "opposite side" : "DOWN control",
    sourceKey: bot.sourceKey,
  }));

  // ── Equity chart geometry ──
  const W = 900, H = 300, PAD = 44;
  const eq = d.equity;
  const equityTimes = [...new Set(eq.map((point) => point.t))].sort((a, b) => a - b);
  const scrubIndex = equityTimes.length
    ? equityScrubT == null
      ? equityTimes.length - 1
      : equityTimes.reduce(
        (best, time, index) =>
          Math.abs(time - equityScrubT) < Math.abs(equityTimes[best] - equityScrubT) ? index : best,
        0,
      )
    : 0;
  const scrubT = equityTimes[scrubIndex] ?? 0;
  const equityBotKeys = new Set(eq.map((point) => point.bot));
  const chartBots = overviewBots.filter((bot) => isVisible(bot.key) && equityBotKeys.has(bot.key));
  const isEquityVisible = (key: string) => isVisible(key) && !equityHidden.has(key);
  const t0 = eq.length ? eq[0].t : 0, t1 = eq.length ? eq[eq.length - 1].t : 1;
  const allV = eq.filter((p) => isEquityVisible(p.bot)).map((p) => p.raw);
  const vMin = Math.min(0, ...allV), vMax = Math.max(0.01, ...allV);
  const x = (t: number) => PAD + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - ((v - vMin) / Math.max(1e-6, vMax - vMin)) * (H - 2 * PAD);
  const byBot = new Map<string, { t: number; raw: number; profitStress: number }[]>();
  for (const p of eq) {
    if (!isEquityVisible(p.bot)) continue;
    const arr = byBot.get(p.bot) ?? [];
    arr.push(p); byBot.set(p.bot, arr);
  }
  const scrubPointByBot = new Map(
    [...byBot.entries()].map(([key, points]) => {
      const atOrBefore = points.filter((point) => point.t <= scrubT);
      return [key, atOrBefore[atOrBefore.length - 1] ?? points[0]] as const;
    }),
  );
  const showAllChartBots = () => {
    const next = new Set(equityHidden);
    for (const bot of chartBots) next.delete(bot.key);
    setEquityHiddenPersist(next);
  };
  const hideAllChartBots = () => {
    const next = new Set(equityHidden);
    for (const bot of chartBots) next.add(bot.key);
    setEquityHiddenPersist(next);
  };
  const toggleEquityBot = (key: string) => {
    const next = new Set(equityHidden);
    if (next.has(key)) next.delete(key); else next.add(key);
    setEquityHiddenPersist(next);
  };

  return (
    <div className="space-y-5">
      {/* Mode banner */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-muted/20 px-3 py-2 text-xs">
        <span className="font-semibold tracking-wide text-foreground">MODE — LIVE PAPER TRADING</span>
        <span className="text-muted-foreground">registered entry windows vs the live CLOB · RAW = fee-adjusted $5 book-walk VWAP + binary settlement · legacy stress = winning profit −36% (uncalibrated; not a verdict input)</span>
        <span className={"rounded px-1.5 py-0.5 font-medium " + (scope === "forward" ? "bg-primary/10 text-primary" : scope === "paper" ? "bg-muted text-foreground" : "bg-warning/15 text-warning")}>
          {scope === "forward" ? "gate v3 cohort" : scope === "paper" ? "current paper" : "all history · exploration"}
        </span>
        <span className={"ml-auto rounded px-1.5 py-0.5 font-medium " + (d.enabled ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")}>{d.enabled ? "running" : "disabled"}</span>
        <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-medium text-muted-foreground"><Lock className="h-3 w-3" /> live: locked (no Polymarket execution path — requires verdict-gate PASS + separate build)</span>
      </div>

      <Card data-testid="macro-leader-status">
        <CardContent className="flex flex-wrap items-center gap-x-5 gap-y-3 p-4">
          <div className="min-w-[220px]">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Macro leader</span>
              <span className={
                "rounded px-2 py-0.5 text-[10px] font-semibold tracking-wide "
                + (response.macroLeader.liveState === "up"
                  ? "bg-success/15 text-success"
                  : response.macroLeader.liveState === "down"
                    ? "bg-destructive/15 text-destructive"
                    : response.macroLeader.liveState === "range"
                      ? "bg-warning/15 text-warning"
                      : "bg-muted text-muted-foreground")
              }>
                {response.macroLeader.liveState?.toUpperCase()
                  ?? (response.macroLeader.state ? "STALE" : "WAITING")}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              BTC / ETH / SOL completed-5m CMO breadth · causal paper-strategy input, never a live-execution switch
            </p>
          </div>
          {response.macroLeader.state ? (
            <>
              <div className="flex flex-wrap gap-3 text-xs tabular-nums">
                {Object.entries(response.macroLeader.cmoByAnchor).map(([pair, value]) => (
                  <div key={pair}>
                    <PolymarketAssetLink asset={pair} scope={scope} className="text-muted-foreground transition-colors hover:text-primary hover:underline hover:underline-offset-2">
                      {pair.replace("-USD", "")}
                    </PolymarketAssetLink>{" "}
                    <span className="font-medium">{Number(value) >= 0 ? "+" : ""}{Number(value).toFixed(3)}</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5 text-[10px] tabular-nums">
                {(["up", "down", "range", "neutral"] as const).map((state) => {
                  const summary = response.macroLeader.stateSummary[state];
                  return (
                    <span
                      key={state}
                      title={`${summary.observedWindows} observed windows · ${summary.qualifiedDecisions} qualified decisions · ${summary.placedRows} paper rows`}
                      className={
                        "rounded border px-1.5 py-0.5 uppercase "
                        + (response.macroLeader.liveState === state
                          ? "border-foreground/30 bg-muted text-foreground"
                          : "border-border text-muted-foreground")
                      }
                    >
                      {state} {summary.bars}
                    </span>
                  );
                })}
              </div>
              <div className="text-[11px] tabular-nums text-muted-foreground">
                {response.macroLeader.observedWindows}/{response.macroLeader.eligibleWindows} windows observed
                {" · "}{response.macroLeader.qualifiedDecisions} qualified
                {" · "}{response.macroLeader.placedRows} paper rows
              </div>
              <div className="ml-auto text-right text-[11px] tabular-nums text-muted-foreground">
                <div>bar closed {ago(Math.round(response.macroLeader.liveAgeSec))}</div>
                <div>captured at +{response.macroLeader.sourceAgeAtCaptureSec.toFixed(1)}s</div>
              </div>
              {!response.macroLeader.fresh ? (
                <div className="basis-full rounded border border-warning/30 bg-warning/5 px-2 py-1.5 text-[10px] text-warning">
                  Last stored classification is {response.macroLeader.state.toUpperCase()}, but its
                  completed bar is {Math.round(response.macroLeader.liveAgeSec)}s old and outside
                  the live freshness limit. Macro strategies are abstaining until a synchronized
                  fresh bar is available.
                </div>
              ) : null}
            </>
          ) : (
            <div className="text-xs text-muted-foreground">
              Clean forward capture begins {new Date(response.macroLeader.evalStartMs).toLocaleString()}.
            </div>
          )}
          <div className="basis-full border-t pt-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px]">
              <span className="font-medium text-foreground">Control opportunity audit</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {response.macroDirectionCoverage.version}
              </span>
              {Date.now() < response.macroDirectionCoverage.evalStartMs ? (
                <span className="text-muted-foreground">
                  prospective capture begins{" "}
                  {new Date(response.macroDirectionCoverage.evalStartMs).toLocaleString()}
                </span>
              ) : (
                <>
                  {response.macroDirectionCoverage.horizons.map((coverage) => (
                    <span
                      key={coverage.horizonMin}
                      className="rounded border px-2 py-1 tabular-nums text-muted-foreground"
                    >
                      <span className="font-medium text-foreground">{coverage.horizonMin}m</span>
                      {" · "}{coverage.alignedRows}/{coverage.eligibleRows} causal
                      {" · "}{coverage.placedRows}/{coverage.expectedRows} expected children
                      {" · "}{coverage.unavailableRows} unavailable
                    </span>
                  ))}
                  <span
                    className={
                      "rounded px-2 py-1 font-medium tabular-nums "
                      + (response.macroDirectionCoverage.overall.missingRows === 0
                        && response.macroDirectionCoverage.overall.unexpectedRows === 0
                        ? "bg-success/10 text-success"
                        : "bg-destructive/10 text-destructive")
                    }
                  >
                    {response.macroDirectionCoverage.overall.missingRows} missing
                    {" · "}{response.macroDirectionCoverage.overall.unexpectedRows} unexpected
                  </span>
                </>
              )}
            </div>
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              One count-only denominator per valid-book market. RANGE, NEUTRAL, unavailable,
              stale, or desynchronized macro inputs correctly expect no child.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* The authoritative prospective gate uses one frozen Holm family. The older pooled/split
          contracts remain in the response for historical continuity only. */}
      <Card>
        <CardHeader className={"p-4 " + (gateCollapsed ? "" : "pb-2")}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <CardTitle className="text-base">
                Forward verdict gates
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  {d.familywiseGate.version} · {d.familywiseGate.familySize} frozen strategy × timeframe hypotheses · fee-adjusted $5 total-outlay asks
                </span>
              </CardTitle>
              {gateCollapsed ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {verdictRows.filter(({ bot }) => bot.state === "passing").length} passing · {verdictRows.filter(({ bot }) => bot.state === "collecting").length} collecting · {verdictRows.filter(({ bot }) => bot.state === "waiting").length} waiting · {verdictRows.filter(({ bot }) => bot.state === "failing").length} failing
                </p>
              ) : (
                <>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Paper ledger age {formatElapsedDays(paperHistoryStartMs)}
                    {" · "}familywise gate age {formatElapsedDays(familywiseStartMs)}
                    {" · "}a card's observed span runs only from its first to last eligible gate observation.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Non-macro rows compare with same-tick Always Down; macro UP/DOWN use the same-tick opposite side. Pass requires ≥{d.familywiseGate.constants.minMarkets.toLocaleString()} markets over ≥{d.familywiseGate.constants.minSpanDays}d, ≥{d.familywiseGate.constants.minBets} graded pairs, ≥{d.familywiseGate.constants.minClusters} independent clusters, residual ≥{cents(d.familywiseGate.constants.minResidual)} with cluster-bootstrap 95% CI above zero, positive residual in ≥{d.familywiseGate.constants.sessionsNeeded} UK sessions, and Holm-adjusted p ≤ {d.familywiseGate.constants.alpha}. Unready hypotheses remain in the full family as p=1.
                  </p>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={toggleGate}
              aria-expanded={!gateCollapsed}
              aria-controls="forward-verdict-gate-details"
              className="inline-flex shrink-0 items-center gap-1 rounded-md border bg-muted/20 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronDown className={"h-3.5 w-3.5 transition-transform " + (gateCollapsed ? "-rotate-90" : "")} />
              {gateCollapsed ? "Expand" : "Minimize"}
            </button>
          </div>
        </CardHeader>
        {!gateCollapsed && <CardContent id="forward-verdict-gate-details" className="grid gap-2 p-4 pt-2 sm:grid-cols-2 lg:grid-cols-3">
          {verdictRows.map(({ bot: gateBot, constants, comparator, sourceKey }) => {
            const state = {
              waiting: { label: "WAITING", cls: "bg-muted text-muted-foreground" },
              collecting: { label: "COLLECTING", cls: "bg-warning/15 text-warning" },
              passing: { label: "PASS", cls: "bg-success/15 text-success" },
              failing: { label: "FAIL", cls: "bg-destructive/15 text-destructive" },
            }[gateBot.state];
            const requirements = [
              `${gateBot.markets}/${constants.minMarkets} mkts`,
              `observed span ${gateBot.spanDays.toFixed(2)}/${constants.minSpanDays}d`,
              `${gateBot.bets}/${constants.minBets} graded pairs`,
              `${gateBot.qualifyingSessions}/${constants.sessionsNeeded} sessions`,
            ];
            return (
              <div key={gateBot.key} className="rounded-md border p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium"><span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: botColor.get(sourceKey) }} />{gateBot.name}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">{comparator}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${state.cls}`}>{state.label}</span>
                  </span>
                </div>
                <div className="space-y-0.5 text-[11px] tabular-nums text-muted-foreground">
                  <div>{requirements.join(" · ")}</div>
                  <div>
                    {gateBot.decisions.toLocaleString()} captured · {gateBot.pairedBookDecisions.toLocaleString()} comparator-ready · {gateBot.bets.toLocaleString()} graded
                  </div>
                  <div>
                    residual <span className="font-medium text-foreground">{cents(gateBot.residual?.mean)}</span>
                    <span className="ml-1 opacity-70">[{cents(gateBot.residual?.lo)}, {cents(gateBot.residual?.hi)}]</span>
                    <span className="ml-1">· {gateBot.residual?.clusters ?? 0} clusters</span>
                  </div>
                  <div>
                    raw p {gateBot.rawP == null ? "—" : gateBot.rawP.toPrecision(3)}
                    {" · "}Holm p {gateBot.holmAdjustedP == null ? "—" : gateBot.holmAdjustedP.toPrecision(3)}
                    {gateBot.holmRank == null ? "" : ` · rank ${gateBot.holmRank}/${d.familywiseGate.familySize}`}
                  </div>
                  <div>{gateBot.positiveQualifyingSessions}/{constants.sessionsNeeded} qualifying sessions positive · eval from {new Date(gateBot.evalStartMs).toLocaleString()}</div>
                </div>
              </div>
            );
          })}
        </CardContent>}
      </Card>

      {/* Filter + ranking bar */}
      <div className="space-y-1.5 rounded-md border bg-muted/20 px-3 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-muted-foreground">Stats scope:</span>
          <button onClick={() => setScopePersist("paper")} className={"rounded border px-1.5 py-0.5 " + (scope === "paper" ? "border-foreground/30 bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>Current paper</button>
          <button onClick={() => setScopePersist("forward")} className={"rounded border px-1.5 py-0.5 " + (scope === "forward" ? "border-primary bg-primary/10 font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>Gate v3 cohort</button>
          <button onClick={() => setScopePersist("history")} className={"rounded border px-1.5 py-0.5 " + (scope === "history" ? "border-warning bg-warning/10 font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>All history</button>
          <span className="text-[11px] text-muted-foreground">
            {scope === "forward"
              ? `${Date.now() < d.fromMs! ? "opens" : "authoritative · from"} ${new Date(d.fromMs!).toLocaleString()}`
              : scope === "paper"
                ? `clean paper run · familywise evidence begins ${new Date(response.familywiseGate.constants.evalStartMs).toLocaleString()}`
                : "exploration + forward · never used by the verdict gate"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-muted-foreground">Bots:</span>
          {d.bots.map((b) => (
            <button
              key={b.key}
              onClick={() => toggleBot(b.key)}
              className={"inline-flex items-center gap-1 rounded border px-1.5 py-0.5 transition-opacity " + (isVisible(b.key) ? "" : "opacity-35")}
              title={isVisible(b.key) ? "click to hide" : "click to show"}
            >
              <span className="inline-block h-1.5 w-2.5 rounded-sm" style={{ background: b.color }} />
              {b.name}
            </button>
          ))}
          <button onClick={() => setHiddenPersist(new Set())} className="rounded px-1.5 py-0.5 text-muted-foreground hover:text-foreground">all</button>
          <button onClick={() => setHiddenPersist(new Set(d.bots.map((b) => b.key)))} className="rounded px-1.5 py-0.5 text-muted-foreground hover:text-foreground">none</button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-muted-foreground">Cards:</span>
          {([["all", "All"], [5, "5m"], [15, "15m"]] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              data-testid={`card-horizon-${key}`}
              aria-pressed={cardHorizon === key}
              onClick={() => setCardHorizonPersist(key)}
              className={"rounded border px-1.5 py-0.5 transition-colors " + (cardHorizon === key ? "border-foreground/30 bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {label}
            </button>
          ))}
          <span className="ml-1 text-[11px] text-muted-foreground">
            totals, ranking, and bucket rows
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-muted-foreground">Rank by:</span>
          {METRICS.map((m) => (
            <button
              key={m.key}
              onClick={() => setMetricPersist(m.key)}
              className={"rounded border px-1.5 py-0.5 " + (metric === m.key ? "border-primary bg-primary/10 font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* One observation per condition, never multiplied by strategy rows. */}
      <PolymarketUniqueMarketTape assetTape={d.assetTape} scope={scope} />

      {/* Bot cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {ranked.map(({ bot: b, rank }) => (
          <Card key={b.key}>
            <CardHeader className="p-3 pb-1">
              <CardTitle className="flex items-center gap-2 text-sm">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: b.color }} />
                <span className="text-muted-foreground">#{rank}</span>
                <Link
                  to="/polymarket/strategy/$botKey"
                  params={{ botKey: b.key }}
                  search={cardHorizon === "all" ? { scope } : { scope, horizon: cardHorizon }}
                  className="min-w-0 hover:text-primary hover:underline"
                  title={`Open ${b.name} evidence page`}
                >
                  {b.name}
                </Link>
                <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground">paper</span>
                {cardHorizon !== "all" && (
                  <span className="rounded border px-1 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {cardHorizon}m
                  </span>
                )}
                <span className="ml-auto inline-flex items-center gap-1 rounded bg-muted/60 px-1 py-0.5 text-[10px] text-muted-foreground" title="Live execution is not built. It requires a verdict-gate PASS and a separate human decision — nothing on this page can place an order."><Lock className="h-2.5 w-2.5" />live</span>
                <button
                  type="button"
                  data-testid={`hide-card-${b.key}`}
                  onClick={() => toggleBot(b.key)}
                  aria-label={`Hide ${b.name} card`}
                  title={`Hide ${b.name} card`}
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <EyeOff className="h-3 w-3" />
                </button>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-1">
              <dl className="space-y-0.5 text-xs tabular-nums">
                <div className="flex justify-between" title="Independent runtime heartbeat from the general one-minute paper worker lane; it does not depend on whether this strategy placed a decision.">
                  <dt className="text-muted-foreground">heartbeat</dt>
                  <dd>{engineHeartbeat}</dd>
                </div>
                <PaperBotActivityRow activity={b.activity} />
                <div className="flex justify-between" title="Most recent paper decision in the selected cohort. A healthy strategy may correctly abstain for a long time.">
                  <dt className="text-muted-foreground">last decision</dt>
                  <dd>{b.lastDecisionAgoSec == null ? "none in selected scope" : ago(b.lastDecisionAgoSec)}</dd>
                </div>
                <div className="flex justify-between"><dt className="text-muted-foreground">trades today</dt><dd>{b.tradesToday} ({usd(b.pnlToday)})</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">open now</dt><dd>{b.openNow} (${b.openUsd.toFixed(0)})</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">graded</dt><dd>{b.wins}W/{b.losses}L{b.wins + b.losses > 0 && <span className="ml-1 text-muted-foreground">· {Math.round((100 * b.wins) / (b.wins + b.losses))}%</span>}</dd></div>
                {b.overlapVsFade?.agreement != null && b.overlapVsFade.shared >= 3 && b.overlapVsFade.agreement >= 0.8 && (
                  <div className="flex justify-between" title={`Same-market side agreement with Fade Tesseract. ${b.overlapVsFade.gradedShared} shared markets are graded. High overlap means correlated evidence, not an independent confirmation.`}>
                    <dt className="text-muted-foreground">overlap vs Fade</dt>
                    <dd>{Math.round(b.overlapVsFade.agreement * 100)}% · {b.overlapVsFade.shared} shared</dd>
                  </div>
                )}
                <div className="flex justify-between"><dt className="text-muted-foreground">ledger RAW</dt><dd className={b.pnlAll > 0 ? "text-success" : b.pnlAll < 0 ? "text-destructive" : ""}>{usd(b.pnlAll)}</dd></div>
              </dl>
              {b.buckets.length > 0 && (
                <PaperFloorBucketTable
                  key={`${b.key}:${metric}:${cardHorizon}`}
                  buckets={b.buckets}
                  scope={scope}
                  initialMetric={metric}
                />
              )}
            </CardContent>
          </Card>
        ))}
        {!ranked.length && (
          <div className="col-span-full rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No visible strategies are registered for the selected {cardHorizon === "all" ? "" : `${cardHorizon}m `}card scope.
          </div>
        )}
      </div>

      <PolymarketDailyRawLedger ledger={d.dailyLedger} bots={overviewBots} />

      {/* Equity curves */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <CardTitle className="text-base">Paper equity <span className="ml-1 text-xs font-normal text-muted-foreground">realized fee-adjusted RAW P&amp;L per bot</span></CardTitle>
            {equityTimes.length > 0 && (
              <button
                type="button"
                onClick={() => setEquityScrubT(null)}
                className={"rounded-md border px-2 py-1 text-[11px] transition-colors " + (equityScrubT == null ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                Live edge
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          {eq.length < 2 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No graded trades yet — the floor decides at each market's window open and grades at resolution. Check back within the hour.</p>
          ) : (
            <>
              <div data-testid="equity-chart-controls" className="mb-3 rounded-md border bg-muted/15 p-3">
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="mr-1 font-medium text-foreground">Chart series</span>
                  {chartBots.map((bot) => {
                    const selected = !equityHidden.has(bot.key);
                    return (
                      <button
                        key={bot.key}
                        type="button"
                        data-testid={`equity-series-${bot.key}`}
                        onClick={() => toggleEquityBot(bot.key)}
                        aria-pressed={selected}
                        className={"inline-flex items-center gap-1.5 rounded-md border px-2 py-1 transition-[opacity,background-color,border-color] " + (selected ? "border-foreground/20 bg-background text-foreground" : "border-transparent text-muted-foreground opacity-40 hover:opacity-75")}
                        title={selected ? `Hide ${bot.name} from the equity chart` : `Show ${bot.name} on the equity chart`}
                      >
                        <span className="h-1.5 w-2.5 rounded-sm" style={{ background: bot.color }} />
                        {bot.name}
                      </button>
                    );
                  })}
                  <button type="button" onClick={showAllChartBots} className="rounded px-1.5 py-1 text-muted-foreground hover:text-foreground">all</button>
                  <button type="button" onClick={hideAllChartBots} className="rounded px-1.5 py-1 text-muted-foreground hover:text-foreground">none</button>
                </div>
                <div className="mt-3">
                  <div className="mb-1.5 flex items-center justify-between gap-3 text-[11px] tabular-nums text-muted-foreground">
                    <span>{new Date(equityTimes[0]).toLocaleString()}</span>
                    <span className="rounded bg-background px-2 py-0.5 font-medium text-foreground">
                      {new Date(scrubT).toLocaleString()}
                    </span>
                    <span>{new Date(equityTimes[equityTimes.length - 1]).toLocaleString()}</span>
                  </div>
                  <input
                    type="range"
                    data-testid="equity-time-scrubber"
                    min={0}
                    max={Math.max(0, equityTimes.length - 1)}
                    step={1}
                    value={scrubIndex}
                    onInput={(event) => setEquityScrubT(equityTimes[Number(event.currentTarget.value)] ?? null)}
                    onChange={(event) => setEquityScrubT(equityTimes[Number(event.target.value)] ?? null)}
                    aria-label="Equity time scrubber"
                    className="h-2 w-full cursor-ew-resize accent-primary"
                  />
                </div>
              </div>
              <div className="overflow-x-auto">
                <svg data-testid="equity-chart-svg" viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 640 }}>
                  <line x1={PAD} y1={y(0)} x2={W - PAD} y2={y(0)} stroke="currentColor" className="text-border" strokeWidth={1} strokeDasharray="3 3" />
                  <text x={4} y={y(0) + 3} className="fill-muted-foreground text-[10px]">$0</text>
                  <text x={4} y={y(vMax) + 3} className="fill-muted-foreground text-[10px]">{usd(vMax)}</text>
                  {vMin < 0 && <text x={4} y={y(vMin) + 3} className="fill-muted-foreground text-[10px]">{usd(vMin)}</text>}
                  {[...byBot.entries()].map(([bot, pts]) => {
                    const lastPoint = pts[pts.length - 1];
                    // Equity is cumulative between settlements. Extend only the rendered geometry
                    // to the common chart edge so a selective strategy reads as flat/abstaining
                    // instead of looking disabled. The source series and its real timestamps remain
                    // untouched, and the scrub marker below stays on the last actual grade bucket.
                    const renderedPoints = lastPoint && lastPoint.t < t1
                      ? [...pts, { ...lastPoint, t: t1 }]
                      : pts;
                    return (
                      <g key={bot}>
                        <polyline fill="none" stroke={botColor.get(bot) ?? "#888"} strokeWidth={1.8} points={renderedPoints.map((p) => `${x(p.t)},${y(p.raw)}`).join(" ")} />
                      </g>
                    );
                  })}
                  <line x1={x(scrubT)} y1={PAD} x2={x(scrubT)} y2={H - PAD} stroke="currentColor" className="text-foreground" strokeWidth={1} strokeDasharray="2 3" strokeOpacity={0.45} />
                  {[...scrubPointByBot.entries()].map(([bot, point]) => (
                    <circle key={bot} cx={x(point.t)} cy={y(point.raw)} r={3} fill={botColor.get(bot) ?? "#888"} stroke="currentColor" className="text-card" strokeWidth={1} />
                  ))}
                  <text x={PAD} y={H - 6} className="fill-muted-foreground text-[10px]">{new Date(t0).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</text>
                  <text x={W - PAD - 34} y={H - 6} className="fill-muted-foreground text-[10px]">{new Date(t1).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</text>
                </svg>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                A flat tail means no newly graded trade. The dot marks the latest actual grade at or
                before the selected time; extending the line does not create a trade or change P&amp;L.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                {chartBots.map((bot) => {
                  const selected = !equityHidden.has(bot.key);
                  const point = scrubPointByBot.get(bot.key);
                  return (
                    <button
                      key={bot.key}
                      type="button"
                      onClick={() => toggleEquityBot(bot.key)}
                      aria-pressed={selected}
                      className={"inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-opacity hover:bg-muted/40 " + (selected ? "" : "opacity-35")}
                    >
                      <span className="inline-block h-2 w-3 rounded-sm" style={{ background: bot.color }} />
                      {bot.name}
                      <span className="text-muted-foreground">{point ? usd(point.raw) : "hidden"}</span>
                    </button>
                  );
                })}
                {!byBot.size && (
                  <span className="rounded-md border border-dashed px-3 py-2 text-muted-foreground">
                    No series selected. Choose a strategy above or select all.
                  </span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Segmentation — diagnostic, not verdict */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base">Segmentation <span className="ml-1 text-xs font-normal text-muted-foreground">graded W–L · net $ — diagnostic only; verdicts stay pooled under the gate</span></CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {(() => {
            const seg = d.segments;
            if (!seg || !seg.byPair.length) return <p className="p-6 text-center text-sm text-muted-foreground">No graded trades yet.</p>;
            const cellP = new Map(seg.byPair.map((c) => [`${c.bot}|${c.pair}`, c]));
            const cellH = new Map(seg.byHorizon.map((c) => [`${c.bot}|${c.horizonMin}`, c]));
            const segmentRows = stableSortRows(
              overviewBots.filter((b) => seg.byPair.some((c) => c.bot === b.key)),
              (bot) => segmentSort.key === "bot"
                ? bot.name
                : segmentSort.key.startsWith("pair:")
                  ? cellP.get(`${bot.key}|${segmentSort.key.slice(5)}`)?.pnl
                  : cellH.get(`${bot.key}|${segmentSort.key.slice(8)}`)?.pnl,
              segmentSort.direction,
            );
            const SegmentHeader = ({
              sortKey,
              label,
              borderLeft = false,
            }: {
              sortKey: string;
              label: ReactNode;
              borderLeft?: boolean;
            }) => {
              const active = segmentSort.key === sortKey;
              const Icon = active
                ? segmentSort.direction === "asc"
                  ? ArrowUp
                  : ArrowDown
                : ChevronsUpDown;
              return (
                <th
                  className={`p-2.5 font-medium ${borderLeft ? "border-l" : ""}`}
                  aria-sort={active ? (segmentSort.direction === "asc" ? "ascending" : "descending") : "none"}
                >
                  <span className="inline-flex items-center gap-1">
                    {label}
                    <button
                      type="button"
                      onClick={() => setSegmentSort((current) => nextSortState(current, sortKey))}
                      aria-label={`Sort by ${typeof label === "string" ? label : sortKey}`}
                      className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Icon className={`h-3 w-3 ${active ? "opacity-90" : "opacity-35"}`} />
                    </button>
                  </span>
                </th>
              );
            };
            const Cell = ({ c, borderL }: { c?: { n: number; w: number; pnl: number }; borderL?: boolean }) => {
              if (!c) return <td className={"p-2 text-center text-muted-foreground/40 " + (borderL ? "border-l" : "")}>—</td>;
              const dim = c.n < 5; // small-sample: visually muted so it can't masquerade as evidence
              const cls = c.pnl > 0 ? "text-success" : c.pnl < 0 ? "text-destructive" : "text-muted-foreground";
              return (
                <td className={"p-2 text-center tabular-nums " + (borderL ? "border-l " : "") + (dim ? "opacity-45" : "")} title={dim ? `only ${c.n} graded — too small to mean anything` : undefined}>
                  <span className="text-xs">{c.w}–{c.n - c.w}</span>
                  <span className={"ml-1 text-[11px] " + cls}>{c.pnl >= 0 ? "+" : "-"}${Math.abs(c.pnl).toFixed(0)}</span>
                </td>
              );
            };
            return (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <SegmentHeader sortKey="bot" label="Bot" />
                      {seg.pairs.map((p) => (
                        <SegmentHeader
                          key={p}
                          sortKey={`pair:${p}`}
                          label={<PolymarketAssetLink asset={p} scope={scope} />}
                        />
                      ))}
                      {seg.horizons.map((h, i) => <SegmentHeader key={h} sortKey={`horizon:${h}`} label={`${h}m`} borderLeft={i === 0} />)}
                    </tr>
                  </thead>
                  <tbody>
                    {segmentRows.map((b) => (
                      <tr key={b.key} className="border-b last:border-0">
                        <td className="p-2.5"><span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: b.color }} /><span className="text-xs font-medium">{b.name}</span></td>
                        {seg.pairs.map((p) => <Cell key={p} c={cellP.get(`${b.key}|${p}`)} />)}
                        {seg.horizons.map((h, i) => <Cell key={h} c={cellH.get(`${b.key}|${h}`)} borderL={i === 0} />)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}
          <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">Muted cells have &lt;5 graded trades — they exist to spot concentration and anomalies (e.g. thin-book fills on one coin), not to pick winners. The verdict gate only ever judges pooled, session-robust numbers.</p>
        </CardContent>
      </Card>

      {/* Combo leaderboard — every bot × asset × horizon, rankable */}
      {(() => {
        const cols: { k: string; label: string; num: (c: any) => number; fmt: (c: any) => string; right?: boolean }[] = [
          { k: "n", label: "n", num: (c) => c.n, fmt: (c) => String(c.n), right: true },
          { k: "winRate", label: "WR", num: (c) => c.winRate ?? -1, fmt: (c) => (c.winRate == null ? "—" : `${Math.round(c.winRate * 100)}%`), right: true },
          { k: "avg", label: "Net/bet", num: (c) => c.avg, fmt: (c) => usd(c.avg), right: true },
          { k: "pnl", label: "Net $", num: (c) => c.pnl, fmt: (c) => usd(c.pnl), right: true },
          { k: "openNow", label: "Open", num: (c) => c.openNow, fmt: (c) => (c.openNow ? String(c.openNow) : "—"), right: true },
        ];
        const all = (d.combos ?? []).filter((c: any) => isVisible(c.botKey));
        const qualified = all.filter((c: any) => c.n >= comboMinN);
        const belowN = all.filter((c: any) => c.n < comboMinN && c.n > 0).length;
        const rows = stableSortRows(
          qualified,
          (row: any) => comboSort.key === "bot"
            ? botName.get(row.botKey) ?? row.botKey
            : comboSort.key === "pair"
              ? row.pair
              : comboSort.key === "horizonMin"
                ? row.horizonMin
                : cols.find((column) => column.k === comboSort.key)?.num(row),
          comboSort.direction,
        );
        const sortBy = (key: string, initialDirection: "asc" | "desc" = "desc") =>
          setComboSort((current) => nextSortState(current, key, initialDirection));
        return (
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                Combo leaderboard <span className="text-xs font-normal text-muted-foreground">every bot × asset × horizon · {qualified.length} qualify</span>
                <span className="ml-auto flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                  min graded
                  <input type="number" min={1} value={comboMinN} onChange={(e) => { const v = Math.max(1, Number(e.target.value) || 1); setComboMinN(v); localStorage.setItem("floor.comboMinN", String(v)); }} className="w-14 rounded border bg-background px-1.5 py-0.5 text-right tabular-nums" />
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[28rem] overflow-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead className="sticky top-0 border-b bg-card text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="p-2.5 text-left font-medium">#</th>
                      <PolymarketSortableHeader column="bot" active={comboSort.key} direction={comboSort.direction} onSort={sortBy} initialDirection="asc" className="p-2.5 font-medium">Bot</PolymarketSortableHeader>
                      <PolymarketSortableHeader column="pair" active={comboSort.key} direction={comboSort.direction} onSort={sortBy} initialDirection="asc" className="p-2.5 font-medium">Asset</PolymarketSortableHeader>
                      <PolymarketSortableHeader column="horizonMin" active={comboSort.key} direction={comboSort.direction} onSort={sortBy} initialDirection="asc" className="p-2.5 font-medium">TF</PolymarketSortableHeader>
                      {cols.map((c) => (
                        <PolymarketSortableHeader key={c.k} column={c.k} active={comboSort.key} direction={comboSort.direction} onSort={sortBy} align="right" className="p-2.5 font-medium">{c.label}</PolymarketSortableHeader>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c: any, i: number) => (
                      <tr key={`${c.botKey}-${c.pair}-${c.horizonMin}`} className="border-b last:border-0">
                        <td className="p-2.5 text-muted-foreground">{i + 1}</td>
                        <td className="p-2.5"><span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: botColor.get(c.botKey) }} />{botName.get(c.botKey) ?? c.botKey}</td>
                        <td className="p-2.5">
                          <PolymarketAssetLink asset={c.pair} scope={scope} horizonMin={c.horizonMin} />
                        </td>
                        <td className="p-2.5 text-muted-foreground">{c.horizonMin}m</td>
                        {cols.map((col2) => {
                          const signed = col2.k === "avg" || col2.k === "pnl";
                          const v = col2.num(c);
                          return <td key={col2.k} className={"p-2.5 text-right " + (signed ? (v > 0 ? "text-success" : v < 0 ? "text-destructive" : "text-muted-foreground") : "")}>{col2.fmt(c)}</td>;
                        })}
                      </tr>
                    ))}
                    {!rows.length && <tr><td colSpan={10} className="p-6 text-center text-sm text-muted-foreground">No combos with ≥{comboMinN} graded trades yet.</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">{belowN} combo{belowN === 1 ? "" : "s"} hidden below the {comboMinN}-trade floor. Diagnostic watchlist — a top combo on a small sample is noise; the verdict gate judges pooled bots, not cherry-picked cells.</p>
            </CardContent>
          </Card>
        );
      })()}

      {/* Trade feed */}
      <Card>
        <CardHeader className="p-4 pb-2"><CardTitle className="text-base">Trade feed <span className="ml-1 text-xs font-normal text-muted-foreground">{d.total.toLocaleString()} paper trades total</span></CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="sticky top-0 border-b bg-card text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <PolymarketSortableHeader column="time" active={feedSort.key} direction={feedSort.direction} onSort={sortFeed} className="p-2.5 font-medium">time</PolymarketSortableHeader>
                  <PolymarketSortableHeader column="bot" active={feedSort.key} direction={feedSort.direction} onSort={sortFeed} initialDirection="asc" className="p-2.5 font-medium">bot</PolymarketSortableHeader>
                  <PolymarketSortableHeader column="market" active={feedSort.key} direction={feedSort.direction} onSort={sortFeed} initialDirection="asc" className="p-2.5 font-medium">mkt</PolymarketSortableHeader>
                  <PolymarketSortableHeader column="side" active={feedSort.key} direction={feedSort.direction} onSort={sortFeed} initialDirection="asc" className="p-2.5 font-medium">side</PolymarketSortableHeader>
                  <PolymarketSortableHeader column="p" active={feedSort.key} direction={feedSort.direction} onSort={sortFeed} className="p-2.5 font-medium">p</PolymarketSortableHeader>
                  <PolymarketSortableHeader column="ask" active={feedSort.key} direction={feedSort.direction} onSort={sortFeed} className="p-2.5 font-medium">ask</PolymarketSortableHeader>
                  <PolymarketSortableHeader column="edge" active={feedSort.key} direction={feedSort.direction} onSort={sortFeed} className="p-2.5 font-medium">edge</PolymarketSortableHeader>
                  <PolymarketSortableHeader column="size" active={feedSort.key} direction={feedSort.direction} onSort={sortFeed} className="p-2.5 font-medium">size $</PolymarketSortableHeader>
                  <PolymarketSortableHeader column="pnl" active={feedSort.key} direction={feedSort.direction} onSort={sortFeed} className="p-2.5 font-medium">P&amp;L $</PolymarketSortableHeader>
                  <PolymarketSortableHeader column="status" active={feedSort.key} direction={feedSort.direction} onSort={sortFeed} initialDirection="asc" className="p-2.5 font-medium">res</PolymarketSortableHeader>
                </tr>
              </thead>
              <tbody>
                {sortedFeed.map((t) => (
                  <tr key={t.id} className={"border-b last:border-0 " + (t.status === "won" ? "bg-success/5" : t.status === "lost" ? "bg-destructive/5" : "")}>
                    <td className="p-2.5 text-muted-foreground">{new Date(t.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
                    <td className="p-2.5"><span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: botColor.get(t.bot) }} />{botName.get(t.bot) ?? t.bot}</td>
                    <td className="p-2.5">
                      <PolymarketAssetLink asset={t.pair} scope={scope} horizonMin={t.horizonMin}>
                        {t.pair.replace("-USD", "")} {t.horizonMin}m
                      </PolymarketAssetLink>
                    </td>
                    <td className="p-2.5">{t.side}</td>
                    <td className="p-2.5 text-muted-foreground">{t.p == null ? "—" : t.p.toFixed(2)}</td>
                    <td className="p-2.5 text-muted-foreground">{t.ask.toFixed(2)}</td>
                    <td className="p-2.5 text-muted-foreground">{t.edge == null ? "—" : t.edge.toFixed(3)}</td>
                    <td className="p-2.5 text-muted-foreground">{t.size.toFixed(2)}</td>
                    <td className={"p-2.5 " + (t.pnl != null && t.pnl > 0 ? "text-success" : t.pnl != null && t.pnl < 0 ? "text-destructive" : "text-muted-foreground")}>{t.pnl == null ? "…" : usd(t.pnl)}</td>
                    <td className="p-2.5">{t.status === "won" ? <span className="text-success">W</span> : t.status === "lost" ? <span className="text-destructive">L</span> : t.status === "void" ? "∅" : "…"}</td>
                  </tr>
                ))}
                {!visibleFeed.length && (
                  <tr><td colSpan={10} className="p-6 text-center text-sm text-muted-foreground">No paper trades yet — the floor enters markets in the first seconds of their window when a bot's edge rule fires.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">Every row is a paper record: decision at its registered time, real $5 book-walk VWAP captured on that tick, binary payout at resolution. Nothing here places an order — the Polymarket floor exposes no execution endpoint.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function PaperFloorBucketTable({
  buckets,
  scope,
  initialMetric,
}: {
  buckets: Bucket[];
  scope: "paper" | "forward" | "history";
  initialMetric: string;
}) {
  type BucketSortKey = "bucket" | "n" | "wr" | "net" | "open";
  const [sort, setSort] = useState<SortState<BucketSortKey>>({
    key: initialMetric === "wr" ? "wr" : "net",
    direction: "desc",
  });
  const rows = stableSortRows(
    buckets,
    (bucket) => ({
      bucket: `${bucket.pair}:${bucket.horizonMin}`,
      n: bucket.n,
      wr: bucket.n ? bucket.wins / bucket.n : null,
      net: bucket.pnl,
      open: bucket.openNow,
    })[sort.key],
    sort.direction,
  );
  const onSort = (key: BucketSortKey, initialDirection: "asc" | "desc" = "desc") =>
    setSort((current) => nextSortState(current, key, initialDirection));

  return (
    <table className="mt-2 w-full border-t pt-1 text-[11px] tabular-nums">
      <thead>
        <tr className="text-left text-[10px] uppercase text-muted-foreground">
          <PolymarketSortableHeader column="bucket" active={sort.key} direction={sort.direction} onSort={onSort} initialDirection="asc" className="pt-1.5 font-medium">bucket</PolymarketSortableHeader>
          <PolymarketSortableHeader column="n" active={sort.key} direction={sort.direction} onSort={onSort} align="right" className="pt-1.5 font-medium">n</PolymarketSortableHeader>
          <PolymarketSortableHeader column="wr" active={sort.key} direction={sort.direction} onSort={onSort} align="right" className="pt-1.5 font-medium">wr</PolymarketSortableHeader>
          <PolymarketSortableHeader column="net" active={sort.key} direction={sort.direction} onSort={onSort} align="right" className="pt-1.5 font-medium">net</PolymarketSortableHeader>
          <PolymarketSortableHeader column="open" active={sort.key} direction={sort.direction} onSort={onSort} align="right" className="pt-1.5 font-medium">open</PolymarketSortableHeader>
        </tr>
      </thead>
      <tbody>
        {rows.map((bucket) => (
          <tr
            key={`${bucket.pair}-${bucket.horizonMin}`}
            className={bucket.n < 5 ? "opacity-45" : ""}
            title={bucket.n < 5 ? `only ${bucket.n} graded — too small to mean anything` : undefined}
          >
            <td className="py-0.5 font-medium">
              <PolymarketAssetLink asset={bucket.pair} scope={scope} horizonMin={bucket.horizonMin}>
                {bucket.pair.replace("-USD", "")} {bucket.horizonMin}m
              </PolymarketAssetLink>
            </td>
            <td className="py-0.5 text-right text-muted-foreground">{bucket.n}</td>
            <td className="py-0.5 text-right">{bucket.n ? `${Math.round((100 * bucket.wins) / bucket.n)}%` : "—"}</td>
            <td className={`py-0.5 text-right ${bucket.pnl > 0 ? "text-success" : bucket.pnl < 0 ? "text-destructive" : "text-muted-foreground"}`}>{usd(bucket.pnl)}</td>
            <td className="py-0.5 text-right text-muted-foreground">{bucket.openNow || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
