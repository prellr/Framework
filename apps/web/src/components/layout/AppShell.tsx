import { useState } from "react";
import { Outlet, useNavigate } from "@tanstack/react-router";
import { LogOut, Menu } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function AppShell() {
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

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

      <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />

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
            onClick={(e) => {
              e.stopPropagation();
              setMobileOpen(true);
            }}
          >
            <Menu className="h-5 w-5" />
          </Button>
          {/* Spacer so sign-out stays right on desktop */}
          <div className="hidden flex-1 md:flex" />
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </Button>
          </div>
        </header>
        {/* iOS Safari gotcha: overflow-y-auto here clips position:fixed
            children — render modals/overlays with createPortal(document.body). */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
