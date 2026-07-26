import { useEffect, useRef, useState } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { ChevronRight, ArrowLeft, LayoutDashboard } from "lucide-react";
import { trpc } from "@/lib/trpc";

/**
 * App-wide breadcrumbs + Back, rendered once in AppShell so every page is covered without each
 * page opting in. The route tree is flat (all pages are siblings under one layout), so the trail
 * is derived from the pathname via an explicit parent map rather than from route nesting.
 */
type Crumb = { label: string; to?: string };

// path → display label + its breadcrumb parent. Home is Dashboard; anything without a parent is
// treated as top-level (trail = [Dashboard, this]). Keep labels in sync with Sidebar.tsx.
const NODES: Record<string, { label: string; parent?: string }> = {
  "/dashboard": { label: "Overview" },
  "/catalog": { label: "Strategies", parent: "/dashboard" },
  "/sweeps": { label: "Sweeps", parent: "/dashboard" },
  "/analytics": { label: "Analytics", parent: "/dashboard" },
  "/tesseract": { label: "Tesseract", parent: "/dashboard" },
  "/screens": { label: "Screens & Alerts", parent: "/dashboard" },
  "/knowledge": { label: "Knowledge", parent: "/dashboard" },
  "/polymarket": { label: "Polymarket", parent: "/dashboard" },
  "/sub35": { label: "Sub35", parent: "/dashboard" },
  "/polymarket/under-35": { label: "Sub35", parent: "/dashboard" },
  "/live": { label: "Live", parent: "/dashboard" },
  "/settings": { label: "Settings", parent: "/dashboard" },
  "/notes": { label: "Notes", parent: "/dashboard" },
};

/** Walk the parent chain from a known static path up to the root. */
function chainFrom(path: string): Crumb[] {
  const out: Crumb[] = [];
  let cur: string | undefined = path;
  const guard = new Set<string>();
  while (cur && NODES[cur] && !guard.has(cur)) {
    guard.add(cur);
    out.unshift({ label: NODES[cur].label, to: cur });
    cur = NODES[cur].parent;
  }
  return out;
}

export function Breadcrumbs() {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // In-app navigation depth: lets Back appear only when there's somewhere in-app to go back to.
  // AppShell (and this component) stays mounted across route changes, so this counter survives
  // navigations and only resets on a hard reload — where the browser's own Back still works.
  const [depth, setDepth] = useState(0);
  const prev = useRef(pathname);
  useEffect(() => {
    if (prev.current !== pathname) {
      prev.current = pathname;
      setDepth((d) => d + 1);
    }
  }, [pathname]);

  // Resolve a strategy id → its name for the leaf crumb (cached; shared with the catalog page).
  const strategyMatch = pathname.match(/^\/strategy\/(.+)$/);
  const catalog = trpc.catalog.list.useQuery(undefined, {
    staleTime: 60_000,
    enabled: !!strategyMatch,
  });

  const path = pathname === "/" ? "/dashboard" : pathname.replace(/\/+$/, "");
  let trail: Crumb[];

  if (strategyMatch) {
    const id = decodeURIComponent(strategyMatch[1]);
    const name = catalog.data?.find((s) => s.id === id)?.name ?? id;
    trail = [...chainFrom("/catalog"), { label: name }];
  } else if (/^\/sweeps\/(?!history$).+/.test(path)) {
    trail = [...chainFrom("/sweeps"), { label: "Run details" }];
  } else {
    trail = chainFrom(path);
    if (trail.length === 0) trail = [{ label: NODES["/dashboard"].label, to: "/dashboard" }];
  }

  // Nothing useful to show on the home page itself.
  const onHome = trail.length <= 1;
  if (onHome && depth === 0) return null;

  return (
    <div className="bg-card/60 flex items-center gap-2 border-b px-4 py-2 text-sm">
      {depth > 0 && (
        <button
          onClick={() => router.history.back()}
          className="border-input text-muted-foreground hover:bg-accent hover:text-foreground mr-1 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors"
          title="Back to the previous page"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>
      )}
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        {trail.map((c, i) => {
          const last = i === trail.length - 1;
          return (
            <span key={i} className="flex min-w-0 items-center gap-1.5">
              {i === 0 && (
                <LayoutDashboard className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
              )}
              {c.to && !last ? (
                <Link
                  to={c.to as string}
                  className="text-muted-foreground hover:text-foreground shrink-0 transition-colors hover:underline"
                >
                  {c.label}
                </Link>
              ) : (
                <span
                  className={
                    last ? "text-foreground truncate font-medium" : "text-muted-foreground shrink-0"
                  }
                >
                  {c.label}
                </span>
              )}
              {!last && <ChevronRight className="text-muted-foreground/50 h-3.5 w-3.5 shrink-0" />}
            </span>
          );
        })}
      </nav>
    </div>
  );
}
