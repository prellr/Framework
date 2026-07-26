import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { Search, Boxes, Hash, Coins, ArrowRight, CornerDownLeft, Zap } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { pfLabel } from "@/lib/metrics";
import {
  canAccessSection,
  type Role,
  type SectionAccess,
  type SectionKey,
} from "@/lib/section-access";

/** Static destinations, so ⌘K also works as a jump-to-page. */
const PAGES: { label: string; to: string; keywords: string; section: SectionKey }[] = [
  {
    label: "Overview",
    to: "/dashboard",
    keywords: "home dashboard pulse",
    section: "overview",
  },
  {
    label: "Strategies",
    to: "/catalog",
    keywords: "catalog strategies list",
    section: "strategies",
  },
  {
    label: "Analytics — Leaderboard, By Asset, Charts",
    to: "/analytics",
    keywords: "leaderboard results backtests runs by asset pairs coins charts top performers",
    section: "analytics",
  },
  {
    label: "Tesseract — market field & plan",
    to: "/tesseract",
    keywords: "tesseract field drive heat mass flow book microstructure plan",
    section: "tesseract",
  },
  {
    label: "Polymarket",
    to: "/polymarket",
    keywords: "polymarket up down scoreboard strategy lab",
    section: "polymarket",
  },
  {
    label: "Sub35 — low-ask strategy workbench",
    to: "/sub35",
    keywords: "sub35 under 35 cents polymarket low ask portfolio basket",
    section: "sub35",
  },
  {
    label: "Formula Lab",
    to: "/formula-lab",
    keywords: "formula algorithm research experiments",
    section: "formulaLab",
  },
  {
    label: "Crucible",
    to: "/crucible",
    keywords: "crucible targets discovery collections",
    section: "crucible",
  },
  {
    label: "Screens & Alerts",
    to: "/screens",
    keywords: "filters",
    section: "screens",
  },
  {
    label: "Knowledge",
    to: "/knowledge",
    keywords: "research findings notes knowledge base",
    section: "knowledge",
  },
  {
    label: "Sweeps — launch & history",
    to: "/sweeps",
    keywords: "sweep new optimize runs matrix backtest history",
    section: "sweeps",
  },
  {
    label: "Live — Subscriptions, Performance, Trades",
    to: "/live",
    keywords:
      "trading activate automations kill switch equity pnl fills ledger positions portfolio",
    section: "live",
  },
  {
    label: "Settings — connection & admin",
    to: "/settings",
    keywords: "api key credentials jester connection admin users timezone",
    section: "settings",
  },
];

interface Row {
  key: string;
  group: string;
  icon: typeof Search;
  title: string;
  sub?: string;
  go: () => void;
}

const num = (v: string | null) => (v == null ? null : parseFloat(v));

/**
 * ⌘K command palette — one entry point for the things this app is addressed by: strategies,
 * parameter codes, assets, and pages. Pasting a param code from a Telegram alert or a live
 * automation row resolves it to the exact strategy + cell it belongs to.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { data: me } = trpc.admin.me.useQuery(undefined, { staleTime: 60_000 });
  const { data: sectionAccess } = trpc.admin.sectionAccess.useQuery(undefined, {
    staleTime: 60_000,
  });
  const role = (me?.role as Role) ?? "viewer";
  const access = sectionAccess?.access as SectionAccess | undefined;

  // Global hotkey: ⌘K / Ctrl-K to open, Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const term = q.trim();
  const search = trpc.search.global.useQuery({ q: term }, { enabled: open && term.length > 0 });

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    const close = () => setOpen(false);
    const t = term.toLowerCase();

    // Live parameter sets first: a code pasted from an alert is almost always one of these, and it
    // may have no backtest row at all (Jester reports 8-char live codes, we store 12-char on runs).
    for (const l of (search.data as any)?.live ?? []) {
      const active = !l.endedAt;
      const when = new Date(l.startedAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      out.push({
        key: `l:${l.code}:${l.strategyId}:${l.pair}`,
        group: "Live parameter sets",
        icon: Zap,
        title: `${l.code} — ${l.strategyId}${active ? "  ● live" : ""}`,
        sub: `${l.pair} · ${l.timeframe} · ${active ? `live since ${when}` : `ran ${when} – ${new Date(l.endedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}`,
        go: () => {
          close();
          navigate({
            to: "/strategy/$strategyId",
            params: { strategyId: l.strategyId },
            search: { pair: l.pair, tf: l.timeframe, days: 30 },
          });
        },
      });
    }

    for (const s of search.data?.strategies ?? []) {
      out.push({
        key: `s:${s.id}`,
        group: "Strategies",
        icon: Boxes,
        title: s.name,
        sub: `${s.id}${s.tier ? ` · ${s.tier}` : ""}${s.tunable === true ? " · tunable" : s.tunable === false ? " · fixed" : ""}`,
        go: () => {
          close();
          navigate({ to: "/strategy/$strategyId", params: { strategyId: s.id }, search: {} });
        },
      });
    }

    for (const c of search.data?.codes ?? []) {
      const ret = num(c.totalReturn);
      out.push({
        key: `c:${c.code}:${c.strategyId}:${c.pair}`,
        group: "Parameter codes",
        icon: Hash,
        title: `${c.code} — ${c.strategyId}`,
        sub: `${c.pair} · ${c.timeframe} · ${ret != null ? `${ret.toFixed(2)}%` : "—"} · ${c.totalTrades ?? "—"} trades · PF ${pfLabel(num(c.profitFactor))}`,
        go: () => {
          close();
          navigate({
            to: "/strategy/$strategyId",
            params: { strategyId: c.strategyId },
            search: { pair: c.pair, tf: c.timeframe, days: c.days },
          });
        },
      });
    }

    for (const d of search.data?.defaultCodes ?? []) {
      out.push({
        key: `d:${d.id}`,
        group: "Parameter codes",
        icon: Hash,
        title: `${d.code} — ${d.name}`,
        sub: "default parameters for this strategy",
        go: () => {
          close();
          navigate({ to: "/strategy/$strategyId", params: { strategyId: d.id }, search: {} });
        },
      });
    }

    for (const p of search.data?.pairs ?? []) {
      out.push({
        key: `p:${p}`,
        group: "Assets",
        icon: Coins,
        title: p,
        sub: "open the asset leaderboard",
        go: () => {
          close();
          navigate({ to: "/analytics" });
        },
      });
    }

    for (const pg of PAGES) {
      if (
        canAccessSection(role, pg.section, access) &&
        (!t || pg.label.toLowerCase().includes(t) || pg.keywords.includes(t))
      ) {
        out.push({
          key: `pg:${pg.to}`,
          group: "Go to",
          icon: ArrowRight,
          title: pg.label,
          sub: pg.to,
          go: () => {
            close();
            navigate({ to: pg.to as any });
          },
        });
      }
    }
    return out;
  }, [search.data, term, navigate, role, access]);

  useEffect(() => setActive(0), [rows.length]);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      rows[active]?.go();
    }
  };

  let lastGroup = "";

  // Portal to body: <main> is overflow-y-auto, which clips fixed children (iOS Safari especially).
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-card w-full max-w-2xl overflow-hidden rounded-xl border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="text-muted-foreground h-4 w-4 shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search strategies, parameter codes, assets…"
            className="placeholder:text-muted-foreground h-12 w-full bg-transparent text-sm outline-none"
          />
          {search.isFetching && <span className="text-muted-foreground text-xs">…</span>}
          <kbd className="text-muted-foreground rounded border px-1.5 py-0.5 text-[10px]">esc</kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1">
          {rows.length === 0 ? (
            <p className="text-muted-foreground px-4 py-6 text-center text-sm">
              {term ? `No matches for “${term}”.` : "Type to search — or paste a parameter code."}
            </p>
          ) : (
            rows.map((r, i) => {
              const header = r.group !== lastGroup ? ((lastGroup = r.group), r.group) : null;
              const Icon = r.icon;
              return (
                <div key={r.key}>
                  {header && (
                    <div className="text-muted-foreground px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide">
                      {header}
                    </div>
                  )}
                  <button
                    data-idx={i}
                    onMouseEnter={() => setActive(i)}
                    onClick={r.go}
                    className={
                      "flex w-full items-center gap-3 px-3 py-2 text-left " +
                      (i === active ? "bg-accent" : "hover:bg-accent/50")
                    }
                  >
                    <Icon className="text-muted-foreground h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{r.title}</span>
                      {r.sub && (
                        <span className="text-muted-foreground block truncate font-mono text-[11px]">
                          {r.sub}
                        </span>
                      )}
                    </span>
                    {i === active && (
                      <CornerDownLeft className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="text-muted-foreground flex items-center gap-3 border-t px-3 py-1.5 text-[10px]">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span className="ml-auto">Paste a param code to jump to its exact cell</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
