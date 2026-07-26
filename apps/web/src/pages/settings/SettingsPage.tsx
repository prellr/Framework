import { useState } from "react";
import { KeyRound, RadioTower, Shield } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { CredentialsPage } from "@/pages/settings/CredentialsPage";
import { AdminPage, RuntimeSettingsPanel } from "@/pages/admin/AdminPage";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

/**
 * Unified "Settings" surface (UX restructure step 5) — the Jester connection and admin controls in
 * one place, as tabs, instead of two separate nav pages. The Admin tab renders only for admins.
 */
type Tab = "connection" | "polymarket" | "admin";

function PolymarketConnectorSettings() {
  const readiness = trpc.polymarket.connectorReadiness.useQuery(undefined, {
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const status = readiness.data;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Polymarket connector</CardTitle>
              <CardDescription className="mt-2 max-w-3xl">
                Public market data is separate from account authentication and order execution.
                Saving credentials here does not enable trading.
              </CardDescription>
            </div>
            <Badge variant={status?.phase === "configured-locked" ? "success" : "secondary"}>
              {status?.phase === "configured-locked"
                ? "configured · locked"
                : status?.publicApi.reachable
                  ? "public connected · locked"
                  : "execution locked"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <div className="text-muted-foreground text-xs">Official SDK</div>
            <div className="mt-1 font-medium">
              {status?.publicApi.reachable ? "Connected" : "Unavailable"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Account prerequisites</div>
            <div className="mt-1 font-medium">
              {status?.account.configurationReady ? "Configured" : "Incomplete"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Risk limits</div>
            <div className="mt-1 font-medium">
              {status?.risk.controlsReady ? "Configured" : "Incomplete"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Order route</div>
            <div className="text-warning mt-1 font-medium">Not installed</div>
          </div>
        </CardContent>
      </Card>

      <RuntimeSettingsPanel groupIds={["polymarket"]} includeTimezone={false} />
    </div>
  );
}

export function SettingsPage() {
  const me = trpc.admin.me.useQuery(undefined, { staleTime: 60_000 });
  const isAdmin = (me.data?.role as string) === "admin";
  const [tab, setTab] = useState<Tab>("connection");

  const TABS: { key: Tab; label: string; icon: typeof KeyRound }[] = [
    { key: "connection", label: "Jester connection", icon: KeyRound },
    ...(isAdmin
      ? [{ key: "polymarket" as Tab, label: "Polymarket connector", icon: RadioTower }]
      : []),
    ...(isAdmin ? [{ key: "admin" as Tab, label: "Admin", icon: Shield }] : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        subtitle="Your Jester connection, and — for admins — users and runtime configuration."
      />

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
                  (active
                    ? "border-primary text-foreground"
                    : "text-muted-foreground hover:text-foreground border-transparent")
                }
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>
      )}

      {tab === "admin" && isAdmin ? (
        <AdminPage embedded />
      ) : tab === "polymarket" && isAdmin ? (
        <PolymarketConnectorSettings />
      ) : (
        <CredentialsPage embedded />
      )}
    </div>
  );
}
