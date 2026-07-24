import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, Check } from "lucide-react";
import { trpc } from "@/lib/trpc";

type Category = "all" | "crypto" | "other";

// Heuristic: -USD pairs are crypto perps; -USDC/-USDH/-USDT0 are tokenized equities/commodities.
const isCrypto = (pair: string) => pair.endsWith("-USD");

/**
 * Searchable, filterable single-select asset picker over the full tradable universe. Typing searches
 * Jester's whole pair list (server-side by symbol), category chips filter crypto vs. equities/
 * commodities, and clicking selects. A free-typed exact symbol is always accepted too.
 */
export function AssetPicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (pair: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [cat, setCat] = useState<Category>("all");
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // When it opens, reset the search and reveal the asset it was last on (scroll it into view).
  useEffect(() => {
    if (open) {
      setTerm("");
      setCat("all");
      const id = setTimeout(() => selectedRef.current?.scrollIntoView({ block: "center" }), 0);
      return () => clearTimeout(id);
    }
  }, [open]);

  // The full universe (~300 pairs) is returned in one call, so search/filter is instant client-side.
  const q = trpc.markets.pairs.useQuery(undefined, { staleTime: 5 * 60_000 });
  const trimmed = term.trim().toUpperCase();

  const list = useMemo(() => {
    const pairs = q.data?.pairs ?? [];
    return pairs
      .filter((p) => cat === "all" || (cat === "crypto" ? isCrypto(p.pair) : !isCrypto(p.pair)))
      .filter((p) => !trimmed || p.pair.toUpperCase().includes(trimmed) || p.symbol.toUpperCase().includes(trimmed))
      .slice(0, 300);
  }, [q.data, cat, trimmed]);

  return (
    <div ref={rootRef} className={"relative " + (className ?? "")}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-40 items-center justify-between gap-1 rounded-md border border-input bg-background px-2 font-mono text-sm outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className="truncate">{value || "Pick asset…"}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-72 rounded-md border bg-card p-2 shadow-xl">
          <div className="mb-2 flex items-center gap-2 rounded-md border border-input bg-background px-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search 150+ assets…"
              className="h-8 w-full bg-transparent text-sm outline-none"
            />
          </div>

          <div className="mb-2 flex gap-1">
            {([
              { k: "all", label: "All" },
              { k: "crypto", label: "Crypto" },
              { k: "other", label: "Stocks/Cmdty" },
            ] as { k: Category; label: string }[]).map((c) => (
              <button
                key={c.k}
                onClick={() => setCat(c.k)}
                className={
                  "rounded-md border px-2 py-0.5 text-[11px] font-medium " +
                  (cat === c.k
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-background text-muted-foreground hover:bg-accent")
                }
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="max-h-64 overflow-y-auto">
            {q.isLoading ? (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">Loading…</p>
            ) : list.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                {trimmed ? `No match — use exact below.` : "No assets."}
              </p>
            ) : (
              list.map((p) => (
                <button
                  key={p.pair}
                  ref={p.pair === value ? selectedRef : undefined}
                  onClick={() => {
                    onChange(p.pair);
                    setOpen(false);
                    setTerm("");
                  }}
                  className={
                    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent " +
                    (p.pair === value ? "bg-accent/60" : "")
                  }
                >
                  {p.pair === value ? <Check className="h-3.5 w-3.5 text-primary" /> : <span className="w-3.5" />}
                  <span className="font-mono">{p.pair}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{p.symbol}</span>
                </button>
              ))
            )}
          </div>

          {/* Accept a free-typed exact symbol not in the (capped) list. */}
          {trimmed && (
            <button
              onClick={() => {
                onChange(trimmed);
                setOpen(false);
                setTerm("");
              }}
              className="mt-1 w-full rounded border-t px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
            >
              Use exact: <span className="font-mono text-foreground">{trimmed}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
