import { useState } from "react";
import { Trophy, Coins, BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { LeaderboardPage } from "@/pages/leaderboard/LeaderboardPage";
import { AssetsPage } from "@/pages/assets/AssetsPage";
import { ChartsPage } from "@/pages/charts/ChartsPage";

/**
 * Unified "Analytics" surface (UX restructure step 2) — the one place to find the edge, replacing
 * four separate nav pages (Leaderboard / Results / By Asset / Charts). The raw Results table is
 * dropped (the ranked leaderboard + filters + CSV export cover it); each remaining view renders its
 * page in `embedded` mode.
 */
type Tab = "leaderboard" | "assets" | "charts";
const TABS: { key: Tab; label: string; icon: typeof Trophy }[] = [
  { key: "leaderboard", label: "Leaderboard", icon: Trophy },
  { key: "assets", label: "By Asset", icon: Coins },
  { key: "charts", label: "Charts", icon: BarChart3 },
];

export function AnalyticsPage() {
  const [tab, setTab] = useState<Tab>("leaderboard");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Analytics"
        subtitle="Everything the warehouse knows — strategies ranked by a validated, risk-of-account score, grouped by asset, and visualized. One place to find the edge."
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

      {tab === "leaderboard" && <LeaderboardPage embedded />}
      {tab === "assets" && <AssetsPage embedded />}
      {tab === "charts" && <ChartsPage embedded />}
    </div>
  );
}
