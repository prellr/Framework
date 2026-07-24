import { useState } from "react";
import { RefreshCw, Activity, Gauge, Layers, Zap } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AssetPicker } from "@/components/ui/asset-picker";
import { trpc } from "@/lib/trpc";
import { TesseractScoreboard } from "./TesseractScoreboard";

const SCAN_PAIRS = ["BTC-USD", "ETH-USD", "SOL-USD", "DOGE-USD", "AVAX-USD", "XRP-USD", "SUI-USD", "LINK-USD", "ARB-USD", "BNB-USD"];

const n1 = (v: unknown) => (typeof v === "number" ? v.toFixed(1) : "—");
const n2 = (v: unknown) => (typeof v === "number" ? v.toFixed(2) : "—");
const usd = (v: unknown) => (typeof v === "number" ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—");
const sideCls = (d?: string | null) => (d === "long" ? "text-success" : d === "short" ? "text-destructive" : "text-muted-foreground");

/** A Field pillar: a z-score centered at 0 (rolling baseline), shown as a diverging bar. */
function Pillar({ label, z, sub, hint }: { label: string; z: number | null | undefined; sub?: string; hint?: string }) {
  const v = typeof z === "number" ? z : null;
  const pctFromZero = v == null ? 0 : Math.max(-1, Math.min(1, v / 3)) * 50; // ±3σ → ±50%
  const pos = v != null && v >= 0;
  return (
    <div className="rounded-md border p-2.5" title={hint}>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className={"font-mono text-sm tabular-nums " + (v == null ? "text-muted-foreground" : pos ? "text-success" : "text-destructive")}>
          {v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}σ`}
        </span>
      </div>
      {/* diverging bar around a center line */}
      <div className="relative mt-2 h-1.5 w-full rounded-full bg-muted">
        <div className="absolute left-1/2 top-0 h-full w-px bg-border" />
        {v != null && (
          <div
            className={"absolute top-0 h-full rounded-full " + (pos ? "bg-success" : "bg-destructive")}
            style={pos ? { left: "50%", width: `${pctFromZero}%` } : { right: "50%", width: `${-pctFromZero}%` }}
          />
        )}
      </div>
      {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function TesseractPage() {
  const [tab, setTab] = useState<"live" | "scoreboard">("live");
  const [pair, setPair] = useState("BTC-USD");
  const live = tab === "live"; // gate the live Jester reads to the live tab (rate-limit hygiene)
  const field = trpc.tesseract.field.useQuery({ pair }, { staleTime: 30_000, enabled: live });
  const analyze = trpc.tesseract.analyze.useQuery({ pair }, { staleTime: 30_000, enabled: live });
  const commentary = trpc.tesseract.commentary.useQuery({ pair }, { staleTime: 60_000, enabled: live });
  const scan = trpc.tesseract.scan.useQuery({ pairs: SCAN_PAIRS }, { staleTime: 30_000, enabled: live });

  const refreshAll = () => {
    field.refetch();
    analyze.refetch();
    commentary.refetch();
  };

  const L = (field.data as any)?.field?.latest;
  const plan = (analyze.data as any)?.plan;
  const fs = plan?.fieldScores;
  const reg = plan?.regime;
  const commentaryBullets: string[] = (commentary.data as any)?.bullets ?? (commentary.data as any)?.commentary ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tesseract"
        subtitle="Jester's live market-microstructure planner — a test bed. The Field scores five dimensions of 5m price action as z-scores vs a rolling baseline (0 = normal), and Analyze turns that into an ATR-sized trade plan. Read-only; nothing here trades."
        actions={
          live ? (
            <div className="flex items-center gap-2">
              <div className="w-52"><AssetPicker value={pair} onChange={setPair} /></div>
              <Button variant="outline" size="sm" onClick={refreshAll} disabled={field.isFetching || analyze.isFetching}>
                <RefreshCw className={"h-4 w-4 " + (field.isFetching || analyze.isFetching ? "animate-spin" : "")} />
              </Button>
            </div>
          ) : undefined
        }
      />

      {/* Tabs: the live study surface vs the forward-collected predictiveness scoreboard. */}
      <div className="flex gap-1 border-b">
        {([
          ["live", "Live Field"],
          ["scoreboard", "Scoreboard"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={
              "border-b-2 px-3 py-2 text-sm font-medium transition-colors " +
              (tab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "scoreboard" ? (
        <TesseractScoreboard />
      ) : (
      <>
      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Market Field ─────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-4 w-4 text-muted-foreground" /> Market Field
              <span className="ml-auto font-mono text-xs text-muted-foreground">{pair} · 5m</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {field.isLoading ? (
              <p className="text-sm text-muted-foreground">Reading the field…</p>
            ) : field.error ? (
              <p className="text-sm text-destructive">{field.error.message}</p>
            ) : !L ? (
              <p className="text-sm text-muted-foreground">No field data.</p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Pillar label="Drive" z={L.volumeZ} sub={`vol ${n1(L.volumePct)}%ile`} hint="Volume / participation vs baseline" />
                  <Pillar label="Heat" z={L.volatilityZ} sub={`${L.heatPhase ?? "—"} · ${n1(L.volatilityPct)}%ile`} hint="Volatility vs baseline" />
                  <Pillar label="Mass" z={L.acceptanceZ} sub={`${L.acceptanceDirection ?? "—"} · ${n1(L.acceptancePct)}%ile`} hint="Price acceptance / value" />
                  <Pillar label="Flow" z={L.tradeDeltaZ} sub={L.tradeDeltaZ == null ? "unavailable" : "trade delta"} hint="Aggressive order flow (trade delta)" />
                  <Pillar label="Book" z={L.liquidityPressureZ} sub="liquidity" hint="Order-book liquidity pressure" />
                  <Pillar label="Structure" z={L.structureScore} sub="0–1" hint="Structural coherence" />
                </div>
                {/* derived scores */}
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  {[
                    ["pulse", L.pulseScore], ["absorption", L.absorptionScore], ["breakout", L.breakoutPressure],
                    ["trap risk", L.trapRisk], ["activity", L.activityScore], ["alignment", L.directionalAlignment],
                  ].map(([k, v]) => (
                    <span key={k as string} className="rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">
                      {k as string} {n2(v)}
                    </span>
                  ))}
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">state {L.state}</span>
                </div>
                {L.summary && <p className="border-t pt-2 text-xs text-muted-foreground">{L.summary}</p>}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Trade Plan ───────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="h-4 w-4 text-muted-foreground" /> Analyze — trade plan
              {plan?.gaugeLabel && (
                <span className={"ml-auto rounded px-1.5 py-0.5 text-xs font-semibold " + sideCls(plan.direction) + " bg-muted"}>
                  {plan.gaugeLabel} ({plan.gaugeScore})
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {analyze.isLoading ? (
              <p className="text-sm text-muted-foreground">Building the plan…</p>
            ) : analyze.error ? (
              <p className="text-sm text-destructive">{analyze.error.message}</p>
            ) : !plan ? (
              <p className="text-sm text-muted-foreground">No plan.</p>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className={"text-lg font-bold uppercase " + sideCls(plan.direction)}>{plan.direction}</span>
                  <span className="text-muted-foreground">RR <span className="font-semibold text-foreground">{n2(plan.rr)}</span></span>
                  <span className="text-muted-foreground">size {usd(plan.sizeUsd)} · {plan.leverage}x</span>
                  <span className="text-muted-foreground">risk {usd(plan.riskAmount)}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums sm:grid-cols-4">
                  <div><div className="text-[11px] uppercase text-muted-foreground">Entry</div>{usd(plan.entry)}</div>
                  <div><div className="text-[11px] uppercase text-destructive">Stop</div>{usd(plan.sl)}</div>
                  <div><div className="text-[11px] uppercase text-success">TP1</div>{usd(plan.tp1)}</div>
                  <div><div className="text-[11px] uppercase text-success">TP2</div>{usd(plan.tp2)}</div>
                </div>
                {fs && (
                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono">Drive {n1(fs.drive)}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono">Heat {n1(fs.heat)}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono">Mass {n1(fs.mass)}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{fs.acceptanceDirection}</span>
                  </div>
                )}
                {reg && (
                  <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                    <span className="rounded border px-1.5 py-0.5">{reg.trend}</span>
                    <span className="rounded border px-1.5 py-0.5">vol {reg.volatility}</span>
                    <span className="rounded border px-1.5 py-0.5">volume {reg.volume}</span>
                    {reg.inSqueeze && <span className="rounded border border-warning/40 px-1.5 py-0.5 text-warning">squeeze</span>}
                    {reg.isChoppy && <span className="rounded border border-warning/40 px-1.5 py-0.5 text-warning">choppy</span>}
                  </div>
                )}
                {(plan.support || plan.resistance) && (
                  <div className="text-xs text-muted-foreground">
                    S/R: <span className="text-success">{usd(plan.support?.price)}</span> (str {plan.support?.strength}) ·{" "}
                    <span className="text-destructive">{usd(plan.resistance?.price)}</span> (str {plan.resistance?.strength})
                  </div>
                )}
                {(plan.recommendations?.length ?? 0) > 0 && (
                  <ul className="space-y-1 border-t pt-2 text-xs text-muted-foreground">
                    {plan.recommendations.map((r: string, i: number) => (
                      <li key={i} className="flex gap-1.5"><span className="text-muted-foreground/50">•</span>{r}</li>
                    ))}
                  </ul>
                )}
                {commentaryBullets.length > 0 && (
                  <ul className="space-y-1 border-t pt-2 text-xs">
                    {commentaryBullets.map((b, i) => (
                      <li key={i} className="flex gap-1.5"><Zap className="mt-0.5 h-3 w-3 shrink-0 text-primary" />{b}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Scan across pairs ──────────────────────────────────────────── */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-muted-foreground" /> Scan — strongest setups
            <span className="ml-auto text-xs text-muted-foreground">{scan.isFetching ? "scanning…" : `${SCAN_PAIRS.length} pairs`}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="p-3 font-medium">Pair</th>
                  <th className="p-3 font-medium">Gauge</th>
                  <th className="p-3 font-medium">Dir</th>
                  <th className="p-3 font-medium">RR</th>
                  <th className="p-3 font-medium">Drive</th>
                  <th className="p-3 font-medium">Heat</th>
                  <th className="p-3 font-medium">Mass</th>
                  <th className="p-3 font-medium">Regime</th>
                </tr>
              </thead>
              <tbody>
                {[...(scan.data ?? [])]
                  .sort((a, b) => Math.abs((b.gaugeScore ?? 50) - 50) - Math.abs((a.gaugeScore ?? 50) - 50))
                  .map((r) => (
                    <tr
                      key={r.pair}
                      className="cursor-pointer border-b last:border-0 hover:bg-accent/40"
                      onClick={() => setPair(r.pair)}
                    >
                      <td className="p-3 font-medium">{r.pair}</td>
                      <td className="p-3">
                        {r.gaugeScore == null ? "—" : <span className={sideCls(r.direction)}>{r.gaugeLabel} ({r.gaugeScore})</span>}
                      </td>
                      <td className={"p-3 uppercase " + sideCls(r.direction)}>{r.direction ?? "—"}</td>
                      <td className="p-3">{n2(r.rr)}</td>
                      <td className={"p-3 " + (r.drive != null && r.drive < 0 ? "text-destructive" : "text-success")}>{n1(r.drive)}</td>
                      <td className="p-3 text-muted-foreground">{n1(r.heat)}</td>
                      <td className={"p-3 " + (r.mass != null && r.mass < 0 ? "text-destructive" : "text-success")}>{n1(r.mass)}</td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {r.error ? <span className="text-destructive">err</span> : `${r.trend ?? "—"}${r.inSqueeze ? " · squeeze" : ""}${r.isChoppy ? " · choppy" : ""}`}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
            Sorted by gauge conviction (distance from neutral 50). Click a row to load it above. Everything is a live 5m read —
            this is a study surface, not a signal to trade.
          </p>
        </CardContent>
      </Card>
      </>
      )}
    </div>
  );
}
