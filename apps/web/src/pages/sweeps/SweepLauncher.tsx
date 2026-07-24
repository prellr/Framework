import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Rocket, Search, X } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

const PRESET_ASSETS = ["BTC-USD", "ETH-USD", "SOL-USD", "AVAX-USD", "LINK-USD", "DOGE-USD"];
const TIMEFRAMES = ["5m", "15m", "1h", "4h"];
const WINDOWS: (number | "max")[] = [30, 60, 90, "max"];

export function SweepLauncher({ embedded }: { embedded?: boolean } = {}) {
  const navigate = useNavigate();
  const catalog = trpc.catalog.list.useQuery();

  const [selStrategies, setSelStrategies] = useState<Set<string>>(new Set());
  const [selAssets, setSelAssets] = useState<Set<string>>(new Set(["BTC-USD", "ETH-USD", "SOL-USD"]));
  const [selTfs, setSelTfs] = useState<Set<string>>(new Set(["15m"]));
  const [selWindows, setSelWindows] = useState<Set<number | "max">>(new Set([30, "max"]));
  const [q, setQ] = useState("");

  const create = trpc.sweeps.create.useMutation({
    onSuccess: (sweep) => navigate({ to: "/sweeps/$sweepId", params: { sweepId: sweep.id } }),
  });

  const strategiesFiltered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (catalog.data ?? []).filter(
      (s) => !term || s.name.toLowerCase().includes(term) || s.id.toLowerCase().includes(term),
    );
  }, [catalog.data, q]);

  const cellCount = selStrategies.size * selAssets.size * selTfs.size * selWindows.size;
  const canLaunch = cellCount > 0 && !create.isPending;

  const launch = () =>
    create.mutate({
      strategies: [...selStrategies],
      assets: [...selAssets],
      timeframes: [...selTfs],
      windows: [...selWindows],
    });

  return (
    <div className="space-y-6">
      {embedded ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Backtest a whole matrix at once — pick strategies, assets, timeframes and windows; every combination runs. Cache hits are free.
          </p>
          <Button onClick={launch} disabled={!canLaunch} className="shrink-0 transition-spring">
            <Rocket className="h-4 w-4" />
            {create.isPending ? "Launching…" : `Launch ${cellCount || ""} cell${cellCount === 1 ? "" : "s"}`}
          </Button>
        </div>
      ) : (
        <PageHeader
          title="New Sweep"
          subtitle="Backtest a whole matrix at once: pick strategies, assets, timeframes and windows below — every combination runs. Hit Launch and results stream in live and land in Results. Cache hits (already-run cells) cost nothing."
          actions={
            <Button onClick={launch} disabled={!canLaunch} className="transition-spring">
              <Rocket className="h-4 w-4" />
              {create.isPending ? "Launching…" : `Launch ${cellCount || ""} cell${cellCount === 1 ? "" : "s"}`}
            </Button>
          }
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Strategies */}
        <Card className="lg:row-span-2">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              Strategies
              <span className="text-xs font-normal text-muted-foreground">{selStrategies.size} selected</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter…"
                className="h-9 w-full bg-transparent text-sm outline-none"
              />
            </div>
            {selStrategies.size > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {[...selStrategies].map((id) => (
                  <button
                    key={id}
                    onClick={() => toggle(setSelStrategies, id)}
                    className="animate-spring-pop inline-flex items-center gap-1 rounded-md bg-primary px-2 py-0.5 text-xs text-primary-foreground"
                  >
                    {id} <X className="h-3 w-3" />
                  </button>
                ))}
              </div>
            )}
            <div className="max-h-72 space-y-0.5 overflow-y-auto">
              {catalog.data?.length === 0 && (
                <p className="text-sm text-muted-foreground">Refresh the catalog first (Strategy Catalog page).</p>
              )}
              {strategiesFiltered.map((s) => {
                const on = selStrategies.has(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => toggle(setSelStrategies, s.id)}
                    className={
                      "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors " +
                      (on ? "bg-accent" : "hover:bg-accent/60")
                    }
                  >
                    <span
                      className={
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border " +
                        (on ? "border-primary bg-primary text-primary-foreground" : "border-input")
                      }
                    >
                      {on && "✓"}
                    </span>
                    <span className="truncate">{s.name}</span>
                    {s.tier && <span className="ml-auto text-[10px] text-muted-foreground">{s.tier}</span>}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Assets */}
        <ChipCard title="Assets" count={selAssets.size}>
          {PRESET_ASSETS.map((a) => (
            <Chip key={a} on={selAssets.has(a)} onClick={() => toggle(setSelAssets, a)}>
              {a}
            </Chip>
          ))}
        </ChipCard>

        {/* Timeframes + Windows */}
        <ChipCard title="Timeframes" count={selTfs.size}>
          {TIMEFRAMES.map((tf) => (
            <Chip key={tf} on={selTfs.has(tf)} onClick={() => toggle(setSelTfs, tf)}>
              {tf}
            </Chip>
          ))}
        </ChipCard>
        <ChipCard title="Windows (days)" count={selWindows.size}>
          {WINDOWS.map((w) => (
            <Chip key={String(w)} on={selWindows.has(w)} onClick={() => toggle(setSelWindows, w)}>
              {w === "max" ? "max" : `${w}d`}
            </Chip>
          ))}
        </ChipCard>
      </div>

      {create.error && <p className="text-sm text-destructive">{create.error.message}</p>}
    </div>
  );
}

function toggle<T>(setter: React.Dispatch<React.SetStateAction<Set<T>>>, value: T) {
  setter((prev) => {
    const next = new Set(prev);
    next.has(value) ? next.delete(value) : next.add(value);
    return next;
  });
}

function ChipCard({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          {title}
          <span className="text-xs font-normal text-muted-foreground">{count} selected</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-1.5">{children}</CardContent>
    </Card>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        "transition-spring rounded-md border px-3 py-1.5 text-sm font-medium " +
        (on
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background text-muted-foreground hover:bg-accent")
      }
    >
      {children}
    </button>
  );
}
