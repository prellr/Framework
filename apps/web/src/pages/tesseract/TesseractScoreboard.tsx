import { useState } from "react";
import { Database, TrendingUp, Scale, GitCompareArrows } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

const PAIR_CHOICES = ["all", "BTC-USD", "ETH-USD", "SOL-USD", "DOGE-USD", "AVAX-USD", "XRP-USD", "SUI-USD", "LINK-USD", "ARB-USD", "BNB-USD"];

const pct = (v: number | null | undefined, d = 2) =>
  v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
const rate = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(0)}%`);
const relTime = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

const signCls = (v: number | null | undefined) =>
  v == null ? "text-muted-foreground" : v > 0 ? "text-success" : v < 0 ? "text-destructive" : "text-muted-foreground";

type Horizon = { horizon: number; n: number; winRate: number | null; avg: number | null; median: number | null };

/** One segment card: win rate + avg directional return across the three horizons. */
function SegmentBlock({ label, n, horizons, muted }: { label: string; n: number; horizons: Horizon[]; muted?: boolean }) {
  return (
    <div className={"rounded-lg border p-3 " + (muted ? "opacity-70" : "")}>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className="font-mono text-xs text-muted-foreground">{n} plans</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {horizons.map((h) => (
          <div key={h.horizon} className="rounded-md bg-muted/50 p-2 text-center">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">+{h.horizon}m</div>
            <div className={"font-mono text-sm font-semibold tabular-nums " + signCls(h.avg)}>{pct(h.avg)}</div>
            <div className="text-[10px] text-muted-foreground">win {rate(h.winRate)} · n{h.n}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TesseractScoreboard() {
  const [pair, setPair] = useState("all");
  const sb = trpc.tesseract.scoreboard.useQuery({ pair }, { staleTime: 60_000 });
  const d = sb.data;

  const pairPicker = (
    <select
      value={pair}
      onChange={(e) => setPair(e.target.value)}
      className="rounded-md border bg-background px-2 py-1 text-sm"
    >
      {PAIR_CHOICES.map((p) => (
        <option key={p} value={p}>{p === "all" ? "All pairs" : p}</option>
      ))}
    </select>
  );

  if (sb.isLoading) return <div className="space-y-3"><div className="flex justify-end">{pairPicker}</div><p className="text-sm text-muted-foreground">Scoring the dataset…</p></div>;
  if (sb.error) return <p className="text-sm text-destructive">{sb.error.message}</p>;
  if (!d) return null;

  const empty = d.coverage.labeled === 0;
  // Which dimension carries the most signal = largest |spread| between its high and low tercile.
  const ranked = [...d.byDimension].sort((a, b) => Math.abs(b.spread ?? 0) - Math.abs(a.spread ?? 0));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Forward test: does the logged Field predict the move that follows? {pair !== "all" && <span className="font-medium text-foreground">Scoped to {pair}.</span>}
        </p>
        {pairPicker}
      </div>

      {/* ── Collection health (build #1) ─────────────────────────────── */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4 text-muted-foreground" /> Collection
            {d.coverage.maturing && !empty && (
              <span className="ml-auto rounded bg-warning/15 px-1.5 py-0.5 text-[11px] font-medium text-warning">
                maturing — {d.overall.horizons.find((h) => h.horizon === 60)?.n ?? 0}/30 scored
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {empty ? (
            <p className="text-sm text-muted-foreground">
              The logger is collecting. Nothing to score yet — snapshots need to age past their forward horizon (~1h)
              before they can be labeled. Check back after the logger has run for a while.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
              <div><div className="text-[11px] uppercase text-muted-foreground">Snapshots</div><span className="font-mono">{d.coverage.total.toLocaleString()}</span></div>
              <div><div className="text-[11px] uppercase text-muted-foreground">Labeled</div><span className="font-mono">{d.coverage.labeled.toLocaleString()}</span></div>
              <div><div className="text-[11px] uppercase text-muted-foreground">Scorable</div><span className="font-mono">{d.coverage.scorable.toLocaleString()}</span></div>
              <div><div className="text-[11px] uppercase text-muted-foreground">Pairs</div><span className="font-mono">{d.coverage.pairs}</span></div>
              <div><div className="text-[11px] uppercase text-muted-foreground">Window</div><span className="text-xs">{relTime(d.coverage.firstAt)} → {relTime(d.coverage.lastAt)}</span></div>
            </div>
          )}
        </CardContent>
      </Card>

      {!empty && (
        <>
          {/* ── Headline: does following the plan pay? ─────────────────── */}
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-4 w-4 text-muted-foreground" /> If you'd taken every plan
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <SegmentBlock label={d.overall.label} n={d.overall.n} horizons={d.overall.horizons} />
              <p className="mt-2 text-[11px] text-muted-foreground">
                Directional return = the plan's own side (long profits when price rises, short when it falls). Positive
                avg + win rate above 50% is the minimum bar for an edge.
              </p>
            </CardContent>
          </Card>

          {/* ── The hypothesis: edge lives where gauge & Field agree ───── */}
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <GitCompareArrows className="h-4 w-4 text-muted-foreground" /> Agreement vs conflict
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 p-4 pt-0 sm:grid-cols-2">
              <SegmentBlock label={d.bySideConflict.agree.label} n={d.bySideConflict.agree.n} horizons={d.bySideConflict.agree.horizons} />
              <SegmentBlock label={d.bySideConflict.conflict.label} n={d.bySideConflict.conflict.n} horizons={d.bySideConflict.conflict.horizons} muted />
              <p className="text-[11px] text-muted-foreground sm:col-span-2">
                The hypothesis is that Tesseract's edge — if any — is concentrated in the left card, where the technical
                gauge and the microstructure Field point the same way. If the left consistently beats the right, that's the
                filter worth using. If they're indistinguishable, the agreement signal isn't real.
              </p>
            </CardContent>
          </Card>

          {/* ── Which dimension carries the signal ─────────────────────── */}
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Scale className="h-4 w-4 text-muted-foreground" /> Which dimension carries the signal
                <span className="ml-auto text-xs text-muted-foreground">avg +60m return by tercile</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="p-3 font-medium">Dimension</th>
                      <th className="p-3 font-medium">Low third</th>
                      <th className="p-3 font-medium">Mid</th>
                      <th className="p-3 font-medium">High third</th>
                      <th className="p-3 font-medium">Spread</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.map((dim) => {
                      const b = (label: string) => dim.buckets.find((x) => x.label === label);
                      return (
                        <tr key={dim.dimension} className="border-b last:border-0">
                          <td className="p-3 font-medium capitalize">{dim.dimension}</td>
                          <td className={"p-3 " + signCls(b("low")?.avg60)}>{pct(b("low")?.avg60)}<span className="ml-1 text-[10px] text-muted-foreground">n{b("low")?.n ?? 0}</span></td>
                          <td className={"p-3 " + signCls(b("mid")?.avg60)}>{pct(b("mid")?.avg60)}</td>
                          <td className={"p-3 " + signCls(b("high")?.avg60)}>{pct(b("high")?.avg60)}<span className="ml-1 text-[10px] text-muted-foreground">n{b("high")?.n ?? 0}</span></td>
                          <td className={"p-3 font-semibold " + signCls(dim.spread)}>{dim.spread == null ? "—" : pct(dim.spread)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
                Each dimension's snapshots are split into thirds by its z-score; the cells show the average +60m
                directional return in each. A large <span className="font-medium">spread</span> (high third minus low
                third) means that dimension separates winners from losers — the ones at the top of this list are where any
                predictive signal actually lives.
              </p>
            </CardContent>
          </Card>

          {/* ── By pair ─────────────────────────────────────────────────── */}
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base">By pair</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="p-3 font-medium">Pair</th>
                      <th className="p-3 font-medium">Plans</th>
                      <th className="p-3 font-medium">Avg +60m</th>
                      <th className="p-3 font-medium">Win rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.byPair.map((p) => (
                      <tr key={p.pair} className="border-b last:border-0">
                        <td className="p-3 font-medium">{p.pair}</td>
                        <td className="p-3 text-muted-foreground">{p.n}</td>
                        <td className={"p-3 " + signCls(p.avg60)}>{pct(p.avg60)}</td>
                        <td className="p-3 text-muted-foreground">{rate(p.winRate60)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
