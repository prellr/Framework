import { useState } from "react";
import { Rocket, History as HistoryIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { SweepLauncher } from "@/pages/sweeps/SweepLauncher";
import { SweepsHistory } from "@/pages/sweeps/SweepsHistory";

/**
 * Unified "Sweeps" surface (UX restructure step 3) — the matrix launcher and the run history in one
 * place, as tabs, instead of two separate nav pages (New Sweep / Sweep History).
 */
type Tab = "new" | "history";

export function SweepsPage() {
  const [tab, setTab] = useState<Tab>("new");
  const TABS: { key: Tab; label: string; icon: typeof Rocket }[] = [
    { key: "new", label: "New sweep", icon: Rocket },
    { key: "history", label: "History", icon: HistoryIcon },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sweeps"
        subtitle="Backtest whole matrices of strategy × asset × timeframe × window at once — launch a new one or reopen a past run. Everything lands in the warehouse."
      />

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

      {tab === "new" ? <SweepLauncher embedded /> : <SweepsHistory embedded />}
    </div>
  );
}
