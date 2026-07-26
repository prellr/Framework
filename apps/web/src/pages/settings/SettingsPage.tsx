import { useState } from "react";
import { KeyRound, WalletCards } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { CredentialsPage } from "@/pages/settings/CredentialsPage";
import { PolymarketAccountsPage } from "@/pages/settings/PolymarketAccountsPage";

type Tab = "connection" | "polymarket";

/**
 * User-owned connections live at the top level. Admin-only shared infrastructure
 * lives inside Admin → Settings, so wallet secrets never become runtime settings.
 */
export function SettingsPage() {
  const [tab, setTab] = useState<Tab>("connection");

  const tabs = [
    { key: "connection" as const, label: "Jester connection", icon: KeyRound },
    { key: "polymarket" as const, label: "Polymarket accounts", icon: WalletCards },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        subtitle="Your personal connections and Polymarket wallets."
      />

      <div className="flex gap-1 border-b">
        {tabs.map((item) => {
          const Icon = item.icon;
          const active = tab === item.key;
          return (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              className={
                "inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors " +
                (active
                  ? "border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground border-transparent")
              }
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </button>
          );
        })}
      </div>

      {tab === "polymarket" ? (
        <PolymarketAccountsPage />
      ) : (
        <CredentialsPage embedded />
      )}
    </div>
  );
}
