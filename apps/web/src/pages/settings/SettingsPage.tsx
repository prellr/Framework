import { useState } from "react";
import { KeyRound, Shield } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { CredentialsPage } from "@/pages/settings/CredentialsPage";
import { AdminPage } from "@/pages/admin/AdminPage";
import { trpc } from "@/lib/trpc";

/**
 * Unified "Settings" surface (UX restructure step 5) — the Jester connection and admin controls in
 * one place, as tabs, instead of two separate nav pages. The Admin tab renders only for admins.
 */
type Tab = "connection" | "admin";

export function SettingsPage() {
  const me = trpc.admin.me.useQuery(undefined, { staleTime: 60_000 });
  const isAdmin = (me.data?.role as string) === "admin";
  const [tab, setTab] = useState<Tab>("connection");

  const TABS: { key: Tab; label: string; icon: typeof KeyRound }[] = [
    { key: "connection", label: "Connection", icon: KeyRound },
    ...(isAdmin ? [{ key: "admin" as Tab, label: "Admin", icon: Shield }] : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" subtitle="Your Jester connection, and — for admins — users and runtime configuration." />

      {TABS.length > 1 && (
        <div className="flex gap-1 border-b">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={
                  "inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors " +
                  (active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")
                }
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>
      )}

      {tab === "admin" && isAdmin ? <AdminPage embedded /> : <CredentialsPage embedded />}
    </div>
  );
}
