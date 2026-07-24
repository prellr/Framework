import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ShieldAlert, Play, Pause, Zap, Search, CheckCircle2, XCircle, Trash2, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { AssetPicker } from "@/components/ui/asset-picker";
import { StatusPill } from "@/components/ui/status-pill";
import { trpc } from "@/lib/trpc";
import { pfLabel } from "@/lib/metrics";

const usd = (v: unknown) => (typeof v === "number" ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—");
const num = (v: string | null) => (v == null ? null : parseFloat(v));
const pct = (v: string | null) => (num(v) == null ? "—" : `${num(v)!.toFixed(2)}%`);

/** Compact age since a date: "3d", "5h", "12m". */
function ageOf(d: Date): string {
  const ms = Date.now() - d.getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days}d`;
  const h = Math.floor(ms / 3_600_000);
  if (h >= 1) return `${h}h`;
  return `${Math.max(1, Math.floor(ms / 60_000))}m`;
}

/**
 * Live Trading (Phase 2 — strategy activation). Real money. Every live action is behind an explicit
 * Confirm dialog, capped to the risk percent, and audited server-side. Manager+ only; the whole page
 * is unreachable from the agent/API surface.
 */
export function TradingPage({ embedded }: { embedded?: boolean } = {}) {
  const utils = trpc.useUtils();
  const caps = trpc.trading.caps.useQuery();
  // jester_my_strategies is the authoritative live view: per-pair active param code + live PnL.
  const live = trpc.trading.myStrategies.useQuery(undefined, { refetchInterval: 60_000 });
  const cred = trpc.credentials.status.useQuery();
  const catalog = trpc.catalog.list.useQuery(undefined, { staleTime: 60_000 });

  // strategyId → tunable (my_strategies gives us the id directly, so we key by id, not name).
  const tunableById = useMemo(() => {
    const m = new Map<string, boolean | null>();
    for (const s of catalog.data ?? []) m.set(s.id, s.tunable ?? null);
    return m;
  }, [catalog.data]);

  const invalidate = () => {
    utils.trading.center.invalidate();
    utils.trading.myStrategies.invalidate();
  };
  const pauseAll = trpc.trading.pauseAll.useMutation({ onSuccess: invalidate });
  const resumeAll = trpc.trading.resumeAll.useMutation({ onSuccess: invalidate });
  const killSwitch = trpc.trading.killSwitch.useMutation({ onSuccess: invalidate });

  const [killOpen, setKillOpen] = useState(false);

  if (cred.data && !cred.data.hasKey) {
    return (
      <div className="space-y-6">
        {!embedded && <PageHeader title="Live Trading" subtitle="Activate and control strategies on your account." />}
        <Card><CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <AlertTriangle className="h-4 w-4 text-warning" />
          Connect a Jester key on the <Link to="/settings" className="text-primary hover:underline">Jester Connection</Link> page first.
        </CardContent></Card>
      </div>
    );
  }

  const L = live.data as any;
  const strategies = (L?.strategies ?? []) as LiveStrategy[];
  const activeCount = L?.stats?.activeStrategies ?? L?.stats?.totalStrategies;
  // Portfolio-relative view: the only figure that's comparable across strategies.
  const portfolioValue: number | null = typeof L?.portfolioValue === "number" ? L.portfolioValue : null;
  const combinedUsd: number | null =
    typeof L?.stats?.combinedPnLUsd === "number"
      ? L.stats.combinedPnLUsd
      : strategies.reduce((a, s) => a + (s.performance?.totalPnLUsd ?? 0), 0);
  const combinedPctOfPortfolio =
    portfolioValue && combinedUsd != null ? (combinedUsd / portfolioValue) * 100 : null;

  // Per-parameter-set attribution (active periods), keyed so each flattened row can find its own.
  const paramPerf = trpc.trading.paramPerformance.useQuery(undefined, { enabled: true, staleTime: 60_000 });
  const perfByKey = useMemo(() => {
    const m = new Map<string, any>();
    for (const p of (paramPerf.data?.periods ?? []) as any[]) {
      if (p.active) m.set(`${p.strategyId}|${p.pair}|${p.timeframe}|${p.paramHash8 ?? ""}`, p);
    }
    return m;
  }, [paramPerf.data]);

  // Open positions, keyed by coin — so a param set that's currently HOLDING (open, unrealized, no
  // closed trade yet) shows the live trade instead of a misleading "no trades yet".
  const portfolio = trpc.account.portfolio.useQuery(undefined, { staleTime: 30_000 });
  const openByCoin = useMemo(() => {
    const m = new Map<string, any>();
    for (const pos of (portfolio.data?.positions ?? []) as any[]) {
      if (pos?.pair) m.set(pos.pair.split(/[-/]/)[0].toUpperCase(), pos);
    }
    return m;
  }, [portfolio.data]);

  // One row per PARAMETER SET: a strategy running several combos appears once per combo, so each
  // param set can be compared side by side. Controls stay on the first row (they're strategy-scoped).
  const paramRows = useMemo(() => {
    const out: { strategy: LiveStrategy; pair: LiveStrategy["pairs"][number]; first: boolean }[] = [];
    for (const s of strategies) {
      (s.pairs ?? []).forEach((p, i) => out.push({ strategy: s, pair: p, first: i === 0 }));
    }
    return out;
  }, [strategies]);

  return (
    <div className="space-y-6">
      {!embedded && (
        <PageHeader
          title="Live Trading"
          subtitle="Activate strategies on your funded Hyperliquid account and control what's running. Real money — every action is confirmed and capped."
        />
      )}

      {/* Real-money warning + kill switch */}
      <Card className="border-warning/40 bg-warning/5">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-start gap-2 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>
              <span className="font-semibold">Mainnet — live funds.</span> Activations are capped to{" "}
              <span className="font-mono">{caps.data?.defaultPct ?? 0.5}%</span> of portfolio (max{" "}
              <span className="font-mono">{caps.data?.maxPct ?? 2}%</span>). Jester executes the trades; manage risk here.
            </span>
          </div>
          <Button variant="destructive" onClick={() => setKillOpen(true)}>
            <ShieldAlert className="h-4 w-4" /> Kill switch
          </Button>
        </CardContent>
      </Card>

      {/* Live automations */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span>
              Live automations {activeCount != null && <span className="font-normal text-muted-foreground">· {activeCount} active</span>}
              {combinedPctOfPortfolio != null && (
                <span className="font-normal">
                  {" · "}
                  <span className={combinedPctOfPortfolio >= 0 ? "text-success" : "text-destructive"}>
                    {combinedPctOfPortfolio >= 0 ? "+" : ""}
                    {combinedPctOfPortfolio.toFixed(2)}% of portfolio
                  </span>
                  {combinedUsd != null && <span className="text-muted-foreground"> ({usd(combinedUsd)})</span>}
                </span>
              )}
            </span>
            <span className="flex gap-2">
              <Button size="sm" variant="outline" disabled={pauseAll.isPending} onClick={() => pauseAll.mutate()}>
                <Pause className="h-3.5 w-3.5" /> Pause all
              </Button>
              <Button size="sm" variant="outline" disabled={resumeAll.isPending} onClick={() => resumeAll.mutate({ confirm: true })}>
                <Play className="h-3.5 w-3.5" /> Resume all
              </Button>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {live.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : strategies.length === 0 ? (
            <p className="text-sm text-muted-foreground">No strategies are running. Activate one below.</p>
          ) : (
            <div className="space-y-2">
              {L?.warning && (
                <p className="whitespace-pre-line rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-muted-foreground">{L.warning}</p>
              )}
              {paramRows.map(({ strategy, pair, first }, i) => (
                <ParamSetRow
                  key={`${strategy.id}|${pair.pair}|${pair.timeframe}|${pair.paramHash8 ?? i}`}
                  strategy={strategy}
                  pair={pair}
                  tunable={tunableById.get(strategy.id) ?? null}
                  portfolioValue={portfolioValue}
                  attribution={perfByKey.get(
                    `${strategy.id}|${pair.pair}|${pair.timeframe}|${pair.paramHash8 ?? ""}`,
                  )}
                  openPos={openByCoin.get(pair.pair.split(/[-/]/)[0].toUpperCase())}
                  showControls={first}
                />
              ))}
            </div>
          )}
          {(pauseAll.error || resumeAll.error) && (
            <p className="mt-2 text-sm text-destructive">{(pauseAll.error ?? resumeAll.error)?.message}</p>
          )}
        </CardContent>
      </Card>

      {/* Activate a strategy */}
      <ActivatePanel maxPct={caps.data?.maxPct ?? 2} defaultPct={caps.data?.defaultPct ?? 0.5} onActivated={invalidate} />

      {killOpen && (
        <Dialog open onClose={() => setKillOpen(false)} title={<span className="text-destructive">Kill switch</span>}>
          <div className="space-y-4">
            <p className="text-sm">
              This will <span className="font-semibold">halt all automations</span> and{" "}
              <span className="font-semibold">close every open position</span> on your live account immediately. This
              cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setKillOpen(false)}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={killSwitch.isPending}
                onClick={() => killSwitch.mutate({ confirm: true }, { onSuccess: () => setKillOpen(false) })}
              >
                <ShieldAlert className="h-4 w-4" /> {killSwitch.isPending ? "Halting…" : "Halt & flatten everything"}
              </Button>
            </div>
            {killSwitch.error && <p className="text-sm text-destructive">{killSwitch.error.message}</p>}
          </div>
        </Dialog>
      )}
    </div>
  );
}

type LiveStrategy = {
  id: string;
  name: string;
  isActive?: boolean;
  pairs: { pair: string; timeframe: string; paramHash8?: string; pnlPct?: number; started?: boolean }[];
  performance?: {
    totalTrades?: number;
    winRate?: number;
    totalPnLPct?: number;
    totalPnLUsd?: number;
  };
};

/**
 * ONE ROW PER PARAMETER SET. A strategy running several combos appears once per combo, so param sets
 * can be compared directly. Each row shows the live combo code, Jester's margin return for that pair,
 * and — where the ledger allows — the PnL actually attributed to this param set since tracking began.
 * Pause/Remove are strategy-scoped (they affect every pair), so they render only on a strategy's
 * first row and say so.
 */
/**
 * Inline per-strategy risk adjuster (manager-gated, human-clicked). Lazy-loads the current
 * riskPerTrade only when opened (no reads on list load), edits it, and requires an explicit confirm
 * click before firing the live update_config mutation. Read-modify-write server-side.
 */
function RiskControl({ strategyId }: { strategyId: string }) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  const [confirming, setConfirming] = useState(false);
  const inited = useRef(false);
  const settings = trpc.trading.riskSettings.useQuery({ strategyId }, { enabled: open, staleTime: 30_000 });
  const current = settings.data?.riskPerTrade ?? null;
  const setRisk = trpc.trading.setRisk.useMutation({
    onSuccess: () => {
      utils.trading.riskSettings.invalidate({ strategyId });
      setConfirming(false);
      setOpen(false);
      setVal("");
    },
  });

  // Pre-fill the input ONCE when the current value first loads after opening — then leave the user's
  // typing alone (so clearing the field doesn't snap back). Reset the guard when the control closes.
  useEffect(() => {
    if (!open) { inited.current = false; return; }
    if (!inited.current && current != null) { setVal(String(current)); inited.current = true; }
  }, [open, current]);

  if (!open) {
    return (
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" title="Adjust this strategy's per-trade risk (% of account)" onClick={() => setOpen(true)}>
        <SlidersHorizontal className="mr-1 h-3.5 w-3.5" /> risk
      </Button>
    );
  }
  const num = parseFloat(val);
  const invalid = !Number.isFinite(num) || num < 0.1 || num > 5;
  return (
    <span className="flex items-center gap-1">
      {settings.isLoading ? (
        <span className="px-1 text-xs text-muted-foreground">…</span>
      ) : (
        <>
          <input
            type="number"
            step="0.1"
            min="0.1"
            max="5"
            value={val}
            onChange={(e) => { setVal(e.target.value); setConfirming(false); }}
            className="h-7 w-14 rounded-md border border-input bg-background px-1.5 text-xs tabular-nums"
            title="% of account risked per trade (0.1–5)"
          />
          <span className="text-xs text-muted-foreground">%</span>
          {confirming ? (
            <Button size="sm" variant="destructive" className="h-7 px-2 text-xs" disabled={setRisk.isPending} onClick={() => setRisk.mutate({ strategyId, riskPerTrade: num, confirm: true })}>
              {setRisk.isPending ? "Setting…" : `Confirm ${num}%`}
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={invalid || num === current} onClick={() => setConfirming(true)}>
              Set
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 px-1.5 text-xs text-muted-foreground" onClick={() => { setOpen(false); setConfirming(false); setVal(""); }}>
            ×
          </Button>
        </>
      )}
      {setRisk.error && <span className="max-w-52 truncate text-xs text-destructive" title={setRisk.error.message}>{setRisk.error.message}</span>}
    </span>
  );
}

function ParamSetRow({
  strategy,
  pair,
  tunable,
  portfolioValue,
  attribution,
  openPos,
  showControls,
}: {
  strategy: LiveStrategy;
  pair: LiveStrategy["pairs"][number];
  tunable: boolean | null;
  portfolioValue: number | null;
  attribution: any | undefined;
  openPos?: any;
  showControls: boolean;
}) {
  const utils = trpc.useUtils();
  const id = strategy.id;
  const runs = trpc.results.byStrategy.useQuery({ strategyId: id }, { enabled: !!id });
  const runOne = trpc.results.runOne.useMutation({ onSuccess: () => utils.results.byStrategy.invalidate({ strategyId: id }) });
  const invalidateLive = () => utils.trading.myStrategies.invalidate();
  const toggle = trpc.trading.toggleStrategy.useMutation({ onSuccess: invalidateLive });
  const remove = trpc.trading.removeStrategy.useMutation({ onSuccess: invalidateLive });
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const pnlClass = (v?: number | null) => (v == null ? "" : v >= 0 ? "text-success" : "text-destructive");
  const hash8 = pair.paramHash8 ?? "";
  const startedAt = attribution?.startedAt ? new Date(attribution.startedAt) : null;
  const rows = (runs.data ?? []).filter((r) => r.pair === pair.pair && r.timeframe === pair.timeframe);
  const combo = hash8
    ? rows.find((r) => r.jesterParamCode && r.jesterParamCode.toLowerCase().startsWith(hash8.toLowerCase())) ?? null
    : null;
  const def = rows.find((r) => r.paramHash === "default") ?? null;

  // PnL attributed to THIS param set from the fill ledger (only since tracking started).
  const attrPct =
    attribution && portfolioValue ? (attribution.realized / portfolioValue) * 100 : null;

  return (
    <div className="rounded-md border px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/strategy/$strategyId" params={{ strategyId: id }} search={{}} className="font-medium hover:underline">
          {strategy.name}
        </Link>
        {tunable === true && (
          <span className="rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-success">tunable</span>
        )}
        {tunable === false && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">fixed</span>
        )}
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          {pair.pair} · {pair.timeframe}
        </span>
        {hash8 && <span className="font-mono text-[11px] text-muted-foreground">code {hash8}</span>}
        {startedAt && (
          <span
            className="text-[11px] text-muted-foreground"
            title={`This param set has been live since ${startedAt.toLocaleString()} — i.e. since our tracking first recorded it. Jester doesn't expose the original subscribe date, so periods that predate tracking (Jul 19) show that start.`}
          >
            · live {ageOf(startedAt)}
          </span>
        )}

        <div className="ml-auto flex items-center gap-3">
          {/* Headline = the LIVE param set's result (what matters) — NOT the strategy's whole history. */}
          {attribution && !attribution.ambiguous && attribution.trades > 0 ? (
            <span className="whitespace-nowrap text-sm font-semibold" title="Realized P&L attributed to the currently-running parameter set (since tracking began)">
              <span className={pnlClass(attribution.realized)}>
                {attribution.realized >= 0 ? "+" : ""}{usd(attribution.realized)}
              </span>
              {attrPct != null && (
                <span className={"ml-1 text-xs font-normal " + pnlClass(attrPct)}>
                  {attrPct >= 0 ? "+" : ""}{attrPct.toFixed(2)}%
                </span>
              )}
            </span>
          ) : attribution?.ambiguous ? (
            <span className="text-xs text-warning" title="Coin shared with another live strategy — the ledger can't attribute this param set's fills">shared</span>
          ) : openPos ? (
            <span className={"whitespace-nowrap text-sm font-semibold " + pnlClass(openPos.unrealizedPnl)} title="Currently holding an open position — unrealized; no closed trade yet under this param set">
              ● {openPos.unrealizedPnl >= 0 ? "+" : ""}{usd(openPos.unrealizedPnl)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">no trades yet</span>
          )}
          {showControls && (
            <div className="flex items-center gap-1">
              <RiskControl strategyId={id} />
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                disabled={toggle.isPending}
                title={
                  (strategy.isActive === false ? "Resume" : "Pause") +
                  " this strategy" +
                  ((strategy.pairs?.length ?? 0) > 1 ? " (affects all its pairs)" : "")
                }
                onClick={() => toggle.mutate({ strategyId: id })}
              >
                {strategy.isActive === false ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              </Button>
              {confirmRemove ? (
                <span className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7 px-2 text-xs"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate({ strategyId: id, confirm: true })}
                  >
                    {remove.isPending
                      ? "Removing…"
                      : (strategy.pairs?.length ?? 0) > 1
                        ? `Remove all ${strategy.pairs.length} pairs`
                        : "Confirm remove"}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setConfirmRemove(false)}>
                    Cancel
                  </Button>
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-destructive hover:text-destructive"
                  title={
                    "Remove (unsubscribe) this strategy" +
                    ((strategy.pairs?.length ?? 0) > 1 ? " — removes ALL its pairs, not just this one" : "")
                  }
                  onClick={() => setConfirmRemove(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Attributed-to-this-param-set performance + backtest for this exact combo. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {attribution ? (
          attribution.ambiguous ? (
            <span
              className="text-warning"
              title={`Also traded by ${attribution.ambiguousWith.join(", ")} on this coin — fills can't be attributed to one param set.`}
            >
              attribution unavailable (coin shared with {attribution.ambiguousWith.length} other strategy)
            </span>
          ) : attribution.trades > 0 ? (
            <span className="text-muted-foreground">
              <span className="uppercase tracking-wide">this param set</span> · {attribution.trades} tr · {attribution.winRate.toFixed(0)}% win
            </span>
          ) : openPos ? (
            <span className="text-muted-foreground">
              holding {openPos.side ?? ""} {openPos.pair} · <span className={pnlClass(openPos.unrealizedPnl)}>{openPos.unrealizedPnl >= 0 ? "+" : ""}{usd(openPos.unrealizedPnl)} unrealized</span> · no closed trade yet
            </span>
          ) : (
            <span className="text-muted-foreground">no trades yet under this param set (tracking since it went live)</span>
          )
        ) : openPos ? (
          <span className="text-muted-foreground">
            holding {openPos.side ?? ""} {openPos.pair} · <span className={pnlClass(openPos.unrealizedPnl)}>{openPos.unrealizedPnl >= 0 ? "+" : ""}{usd(openPos.unrealizedPnl)} unrealized</span>
          </span>
        ) : (
          <span className="text-muted-foreground">attribution starts once tracking records this param set</span>
        )}

        {runs.isLoading ? null : combo ? (
          <span className="text-muted-foreground">
            · combo bt {pct(combo.totalReturn)} · PF {pfLabel(num(combo.profitFactor))}
          </span>
        ) : def ? (
          <span className="text-muted-foreground">
            · default bt {pct(def.totalReturn)} · PF {pfLabel(num(def.profitFactor))}{" "}
            <span className="opacity-60">(not the live combo)</span>
          </span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            disabled={runOne.isPending}
            onClick={() => {
              setBusy(true);
              runOne.mutate({ strategyId: id, pair: pair.pair, timeframe: pair.timeframe, days: 30 }, { onSettled: () => setBusy(false) });
            }}
          >
            {busy ? "Running…" : "Backtest (default)"}
          </Button>
        )}

        {typeof pair.pnlPct === "number" && (
          <span
            className="text-muted-foreground/50"
            title="Jester's leveraged return on allocated margin over the strategy's WHOLE history — spans parameter changes, so it's context, not this param set's score."
          >
            · {pair.pnlPct.toFixed(2)}% on margin (all-time)
          </span>
        )}
      </div>
      {(runOne.error || toggle.error || remove.error) && (
        <p className="mt-1 text-xs text-destructive">{(runOne.error ?? toggle.error ?? remove.error)?.message}</p>
      )}
    </div>
  );
}


function ActivatePanel({ maxPct, defaultPct, onActivated }: { maxPct: number; defaultPct: number; onActivated: () => void }) {
  const list = trpc.catalog.list.useQuery();
  const [q, setQ] = useState("");
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [pair, setPair] = useState("BTC-USD");
  const [risk, setRisk] = useState(String(defaultPct));
  const [confirmOpen, setConfirmOpen] = useState(false);

  const strategyName = useMemo(() => list.data?.find((s) => s.id === strategyId)?.name ?? strategyId, [list.data, strategyId]);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (list.data ?? []).filter((s) => !t || s.name.toLowerCase().includes(t) || s.id.toLowerCase().includes(t)).slice(0, 8);
  }, [list.data, q]);

  const preview = trpc.trading.previewActivate.useQuery(
    { strategyId: strategyId ?? undefined, pair },
    { enabled: !!strategyId },
  );
  const activate = trpc.trading.activate.useMutation({
    onSuccess: () => {
      setConfirmOpen(false);
      onActivated();
    },
  });

  const p = preview.data as any;
  const riskNum = parseFloat(risk);
  const riskValid = Number.isFinite(riskNum) && riskNum > 0 && riskNum <= maxPct;
  const target = p?.target;
  const ready = p?.ready === true;
  const blockers: string[] = p?.blockers ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Activate a strategy</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Strategy picker */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Strategy</label>
          {strategyId ? (
            <div className="flex items-center gap-2">
              <span className="rounded-md border bg-muted/40 px-2 py-1 text-sm font-medium">{strategyName}</span>
              <button className="text-xs text-muted-foreground hover:underline" onClick={() => { setStrategyId(null); setQ(""); }}>
                change
              </button>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 rounded-md border border-input bg-background px-2">
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search strategies…" className="h-8 w-full bg-transparent text-sm outline-none" />
              </div>
              {q && (
                <div className="mt-1 max-h-48 overflow-y-auto rounded-md border">
                  {filtered.map((s) => (
                    <button key={s.id} onClick={() => { setStrategyId(s.id); setQ(""); }} className="block w-full px-2 py-1.5 text-left text-sm hover:bg-accent">
                      {s.name} <span className="font-mono text-xs text-muted-foreground">{s.id}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Asset + risk */}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Asset</label>
            <AssetPicker value={pair} onChange={setPair} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Risk (% of portfolio, max {maxPct})</label>
            <Input type="number" step="0.1" value={risk} onChange={(e) => setRisk(e.target.value)} className="w-32" />
          </div>
        </div>

        {/* Dry-run preview */}
        {strategyId && (
          <div className="rounded-md border bg-muted/20 p-3 text-sm">
            {preview.isLoading ? (
              <span className="text-muted-foreground">Previewing…</span>
            ) : preview.error ? (
              <span className="text-destructive">{preview.error.message}</span>
            ) : !p ? (
              <span className="text-muted-foreground">No preview.</span>
            ) : !target ? (
              <span className="text-warning">{p?.error ?? "No ranked parameter combo available for this strategy — can't activate."}</span>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {ready ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-destructive" />}
                  <span className="font-medium">{ready ? "Ready to activate" : "Not ready"}</span>
                  {p.alreadySubscribed && <StatusPill tone="muted">already subscribed</StatusPill>}
                </div>
                <div className="text-xs text-muted-foreground">
                  Target: <span className="font-mono">{target.pair} · {target.timeframe}</span> · param code{" "}
                  <span className="font-mono text-foreground">{target.paramHash}</span>
                  {typeof target.totalReturn === "number" && <> · backtest {target.totalReturn.toFixed(1)}%</>}
                  {target.source && <> · {target.source}</>}
                </div>
                {blockers.length > 0 && <div className="text-xs text-destructive">Blockers: {blockers.join(", ")}</div>}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {p?.accountReadiness?.totalPortfolioValue != null && riskValid && target
              ? `≈ ${usd((p.accountReadiness.totalPortfolioValue * riskNum) / 100)} exposure at ${riskNum}%`
              : ""}
          </span>
          <Button
            disabled={!strategyId || !ready || !target || !riskValid || activate.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            <Zap className="h-4 w-4" /> Activate…
          </Button>
        </div>
      </CardContent>

      {confirmOpen && target && (
        <Dialog open onClose={() => setConfirmOpen(false)} title="Confirm activation">
          <div className="space-y-4">
            <p className="text-sm">
              Activate <span className="font-semibold">{strategyName}</span> on{" "}
              <span className="font-mono">{target.pair} · {target.timeframe}</span> with param code{" "}
              <span className="font-mono">{target.paramHash}</span>, risking{" "}
              <span className="font-semibold">{riskNum}%</span> of your portfolio. Jester will start trading this live.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
              <Button
                disabled={activate.isPending}
                onClick={() =>
                  activate.mutate({
                    strategyId: target.strategyId ?? strategyId!,
                    pair: target.pair,
                    timeframe: target.timeframe,
                    paramHash: target.paramHash,
                    riskPercent: riskNum,
                    confirm: true,
                  })
                }
              >
                <Zap className="h-4 w-4" /> {activate.isPending ? "Activating…" : "Confirm & activate"}
              </Button>
            </div>
            {activate.error && <p className="text-sm text-destructive">{activate.error.message}</p>}
          </div>
        </Dialog>
      )}
    </Card>
  );
}
