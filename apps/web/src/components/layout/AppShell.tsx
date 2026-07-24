import { useCallback, useEffect, useState } from "react";
import { Outlet, useNavigate } from "@tanstack/react-router";
import { LogOut, Menu, Search } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { ErrorBoundary } from "@/components/layout/ErrorBoundary";
import { Breadcrumbs } from "./Breadcrumbs";
import { CommandPalette } from "@/components/CommandPalette";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function AppShell() {
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("jester.sidebarCollapsed") === "true",
  );

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((current) => {
      const next = !current;
      localStorage.setItem("jester.sidebarCollapsed", String(next));
      return next;
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "b"
        || (!event.metaKey && !event.ctrlKey)
        || event.altKey
      ) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      toggleSidebar();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleSidebar]);

  const handleSignOut = async () => {
    await authClient.signOut();
    navigate({ to: "/login" });
  };

  return (
    <div className="flex h-screen bg-background">
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <Sidebar
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
        collapsed={sidebarCollapsed}
        onCollapsedToggle={toggleSidebar}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <header
          className="flex h-16 items-center justify-between border-b bg-card px-4"
          onClick={() => mobileOpen && setMobileOpen(false)}
        >
          {/* Hamburger — mobile only */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="Open navigation"
            onClick={(e) => {
              e.stopPropagation();
              setMobileOpen(true);
            }}
          >
            <Menu className="h-5 w-5" />
          </Button>
          {/* Search affordance — the palette itself is bound to ⌘K globally. */}
          <div className="flex flex-1 justify-start px-2 md:px-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
              }}
              className="flex w-full max-w-sm items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
            >
              <Search className="h-4 w-4" />
              <span className="flex-1 text-left">Search strategies, codes, assets…</span>
              <kbd className="hidden rounded border px-1.5 py-0.5 text-[10px] sm:inline">⌘K</kbd>
            </button>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </Button>
          </div>
        </header>
        <Breadcrumbs />
        {/* iOS Safari gotcha: overflow-y-auto here clips position:fixed
            children — render modals/overlays with createPortal(document.body). */}
        <main className="flex-1 overflow-y-auto p-6">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      <CommandPalette />
    </div>
  );
}
