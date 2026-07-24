import { useMemo, useState } from "react";
import {
  Bell,
  ChevronRight,
  Filter,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Radar,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { trpc } from "@/lib/trpc";
import type { RouterOutput } from "@framework/api/router";

type Screen = RouterOutput["screens"]["list"][number];
type ScreenQuery = {
  minPf?: number;
  minTrades?: number;
  minReturn?: number;
  maxDrawdown?: number;
  pairs?: string[];
  timeframes?: string[];
  days?: number[];
};

const PRESET_ASSETS = ["BTC-USD", "ETH-USD", "SOL-USD", "AVAX-USD", "LINK-USD", "DOGE-USD"];
const TIMEFRAMES = ["5m", "15m", "1h", "4h"];

const dec = (v: number | null) => (v == null ? "—" : v.toFixed(2));
const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(2)}%`);

function relTime(d: string | Date | null): string {
  if (!d) return "never";
  const ms = Date.now() - new Date(d).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Human summary of a screen's thresholds — the badges shown on each card. */
function queryBadges(q: ScreenQuery): string[] {
  const b: string[] = [];
  if (q.minPf != null) b.push(`PF ≥ ${q.minPf}`);
  if (q.minTrades != null) b.push(`≥ ${q.minTrades} trades`);
  if (q.minReturn != null) b.push(`return ≥ ${q.minReturn}%`);
  if (q.maxDrawdown != null) b.push(`DD ≤ ${q.maxDrawdown}%`);
  if (q.pairs?.length) b.push(q.pairs.join(", "));
  if (q.timeframes?.length) b.push(q.timeframes.join(", "));
  if (!b.length) b.push("all rows");
  return b;
}

export function ScreensPage() {
  const list = trpc.screens.list.useQuery();
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Screens & Alerts"
        subtitle="Save a threshold query over the warehouse (e.g. “PF ≥ 1.1, ≥ 20 trades on the majors”) and re-run it any time. Each run diffs against the last, so you see which strategy/asset pairs newly qualified or dropped out. Turn on auto-rescreen and the daily job keeps the alert fresh."
        actions={
          <Button onClick={() => setCreating(true)} className="transition-spring">
            <Plus className="h-4 w-4" /> New screen
          </Button>
        }
      />

      {list.data && list.data.length === 0 && (
        <EmptyState
          icon={Radar}
          title="No screens yet"
          description="Create a screen to track the strategies that clear your bar — and get alerted when the survivor set changes."
          action={
            <Button onClick={() => setCreating(true)} size="sm">
              <Plus className="h-4 w-4" /> New screen
            </Button>
          }
        />
      )}

      <div className="space-y-3">
        {list.data?.map((s) => (
          <ScreenCard key={s.id} screen={s} />
        ))}
      </div>

      {creating && <NewScreenDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function ScreenCard({ screen }: { screen: Screen }) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const q = screen.query as ScreenQuery;
  const added = (screen.lastAdded as string[] | null) ?? [];
  const removed = (screen.lastRemoved as string[] | null) ?? [];
  const survivorCount = (screen.lastSurvivors as string[] | null)?.length ?? 0;

  // Current survivors — fetched on expand (a fresh read, doesn't mutate the baseline).
  const preview = trpc.screens.preview.useQuery(q, { enabled: open });

  const run = trpc.screens.run.useMutation({
    onSuccess: () => {
      utils.screens.list.invalidate();
      if (open) preview.refetch();
    },
  });
  const update = trpc.screens.update.useMutation({
    onSuccess: () => utils.screens.list.invalidate(),
  });
  const del = trpc.screens.delete.useMutation({
    onSuccess: () => utils.screens.list.invalidate(),
  });

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <ChevronRight
              className={"h-4 w-4 shrink-0 text-muted-foreground transition-transform " + (open ? "rotate-90" : "")}
            />
            <Radar className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-semibold">{screen.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {survivorCount} survivor{survivorCount === 1 ? "" : "s"}
            </span>
          </button>

          {(added.length > 0 || removed.length > 0) && (
            <StatusPill tone={added.length ? "success" : "warning"}>
              <Bell className="h-3 w-3" />
              {added.length > 0 && `+${added.length} new`}
              {added.length > 0 && removed.length > 0 && " · "}
              {removed.length > 0 && `−${removed.length} dropped`}
            </StatusPill>
          )}

          <span className="shrink-0 text-xs text-muted-foreground">ran {relTime(screen.lastRunAt)}</span>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => update.mutate({ id: screen.id, autoRescreen: !screen.autoRescreen })}
              title={screen.autoRescreen ? "Auto-rescreen ON (daily) — click to disable" : "Auto-rescreen OFF — click to enable daily"}
              className={
                "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors " +
                (screen.autoRescreen
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-input text-muted-foreground hover:bg-accent")
              }
            >
              <RefreshCw className="h-3 w-3" /> auto
            </button>
            <Button size="sm" variant="outline" onClick={() => run.mutate({ id: screen.id })} disabled={run.isPending}>
              <Play className="h-3.5 w-3.5" /> {run.isPending ? "Running…" : "Run"}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={() => {
                if (confirm(`Delete screen “${screen.name}”?`)) del.mutate({ id: screen.id });
              }}
              title="Delete screen"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex w-full flex-wrap gap-1.5">
            {queryBadges(q).map((b, i) => (
              <span key={i} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {b}
              </span>
            ))}
          </div>
        </div>

        {open && (
          <div className="overflow-x-auto border-t">
            {preview.isLoading ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">Evaluating…</p>
            ) : (preview.data?.length ?? 0) === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                No warehouse rows clear this screen yet.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Strategy</th>
                    <th className="px-3 py-2">Asset</th>
                    <th className="px-3 py-2">TF</th>
                    <th className="px-3 py-2 text-right">Return</th>
                    <th className="px-3 py-2 text-right">Trades</th>
                    <th className="px-3 py-2 text-right">PF</th>
                    <th className="px-3 py-2 text-right">Max DD</th>
                    <th className="px-3 py-2 text-right">Span</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.data!.map((r) => {
                    const isNew = added.includes(r.key);
                    return (
                      <tr key={r.key} className={"border-t last:border-0 " + (isNew ? "bg-success/5" : "")}>
                        <td className="max-w-56 truncate px-4 py-2 font-medium">
                          {isNew && <span className="mr-1 text-success" title="New since last run">●</span>}
                          {r.strategyName ?? r.strategyId}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{r.pair}</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.timeframe}</td>
                        <td className={"px-3 py-2 text-right tabular-nums " + (r.totalReturn != null ? (r.totalReturn >= 0 ? "text-success" : "text-destructive") : "")}>
                          {pct(r.totalReturn)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.totalTrades ?? "—"}</td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">{dec(r.profitFactor)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{pct(r.maxDrawdown)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.spanDays}d</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NewScreenDialog({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [minPf, setMinPf] = useState("1.1");
  const [minTrades, setMinTrades] = useState("20");
  const [minReturn, setMinReturn] = useState("");
  const [maxDrawdown, setMaxDrawdown] = useState("");
  const [pairs, setPairs] = useState<Set<string>>(new Set());
  const [tfs, setTfs] = useState<Set<string>>(new Set());
  const [auto, setAuto] = useState(true);

  const query: ScreenQuery = useMemo(() => {
    const numOr = (s: string) => (s.trim() === "" ? undefined : Number(s));
    return {
      minPf: numOr(minPf),
      minTrades: numOr(minTrades),
      minReturn: numOr(minReturn),
      maxDrawdown: numOr(maxDrawdown),
      pairs: pairs.size ? [...pairs] : undefined,
      timeframes: tfs.size ? [...tfs] : undefined,
    };
  }, [minPf, minTrades, minReturn, maxDrawdown, pairs, tfs]);

  const preview = trpc.screens.preview.useQuery(query);
  const create = trpc.screens.create.useMutation({
    onSuccess: () => {
      utils.screens.list.invalidate();
      onClose();
    },
  });

  const toggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, v: string) =>
    setter((prev) => {
      const next = new Set(prev);
      next.has(v) ? next.delete(v) : next.add(v);
      return next;
    });

  return (
    <Dialog open onClose={onClose} title="New screen">
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Majors momentum survivors" autoFocus />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <NumField label="Min profit factor" value={minPf} onChange={setMinPf} placeholder="1.1" step="0.1" />
          <NumField label="Min trades" value={minTrades} onChange={setMinTrades} placeholder="20" step="1" />
          <NumField label="Min return %" value={minReturn} onChange={setMinReturn} placeholder="any" step="1" />
          <NumField label="Max drawdown %" value={maxDrawdown} onChange={setMaxDrawdown} placeholder="any" step="1" />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Assets <span className="font-normal">(none = any)</span>
          </label>
          <div className="flex flex-wrap gap-1.5">
            {PRESET_ASSETS.map((a) => (
              <MiniChip key={a} on={pairs.has(a)} onClick={() => toggle(setPairs, a)}>{a}</MiniChip>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Timeframes <span className="font-normal">(none = any)</span>
          </label>
          <div className="flex flex-wrap gap-1.5">
            {TIMEFRAMES.map((tf) => (
              <MiniChip key={tf} on={tfs.has(tf)} onClick={() => toggle(setTfs, tf)}>{tf}</MiniChip>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="h-4 w-4" />
          Auto-rescreen daily (keeps the alert diff fresh)
        </label>

        <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Matches right now</span>
          <span className="font-semibold tabular-nums">
            {preview.isLoading ? "…" : `${preview.data?.length ?? 0} survivor${preview.data?.length === 1 ? "" : "s"}`}
          </span>
        </div>

        {create.error && <p className="text-sm text-destructive">{create.error.message}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => create.mutate({ name: name.trim() || "Untitled screen", query, autoRescreen: auto })}
            disabled={create.isPending}
          >
            <Filter className="h-4 w-4" /> {create.isPending ? "Saving…" : "Save screen"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function NumField({
  label,
  value,
  onChange,
  placeholder,
  step,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  step?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      <Input type="number" step={step} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function MiniChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        "transition-spring rounded-md border px-2.5 py-1 text-xs font-medium " +
        (on ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background text-muted-foreground hover:bg-accent")
      }
    >
      {children}
    </button>
  );
}
