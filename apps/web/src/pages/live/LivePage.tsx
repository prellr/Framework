import { useState } from "react";
import { Zap, LineChart, Receipt, Lock } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { TradingPage } from "@/pages/trading/TradingPage";
import { PortfolioPage } from "@/pages/account/PortfolioPage";
import { PositionsPage } from "@/pages/account/PositionsPage";
import { trpc } from "@/lib/trpc";

/**
 * Unified "Live" surface (UX restructure step 1) — everything about the funded account in one place,
 * as tabs, instead of three separate nav pages (Live Trading / Portfolio / Positions):
 *   Subscriptions — what's running, per param set, with age + attributed success + activation.
 *   Performance   — equity, unrealized/period PnL over time.
 *   Trades        — the fill ledger, per-trade stats, and per-param-set attribution.
 * Each tab renders the existing page in `embedded` mode (its own header suppressed).
 */
type Tab = "subscriptions" | "performance" | "trades";
const TABS: { key: Tab; label: string; icon: typeof Zap }[] = [
  { key: "subscriptions", label: "Subscriptions", icon: Zap },
  { key: "performance", label: "Performance", icon: LineChart },
  { key: "trades", label: "Trades", icon: Receipt },
];

export function LivePage() {
  const me = trpc.admin.me.useQuery(undefined, { staleTime: 60_000 });
  const canTrade = ["manager", "admin"].includes((me.data?.role as string) ?? "");
  // Subscriptions (activation/control) is manager+; account views are open to everyone.
  const [tab, setTab] = useState<Tab>(canTrade ? "subscriptions" : "performance");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Live"
        subtitle="Your funded Hyperliquid account: what's running, how it's performing, and every trade — all attributed from the fill ledger."
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
                (active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground")
              }
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "subscriptions" &&
        (canTrade ? (
          <TradingPage embedded />
        ) : (
          <div className="flex items-center gap-2 rounded-md border p-6 text-sm text-muted-foreground">
            <Lock className="h-4 w-4" /> Managing live subscriptions requires the manager role.
          </div>
        ))}
      {tab === "performance" && <PortfolioPage embedded />}
      {tab === "trades" && <PositionsPage embedded />}
    </div>
  );
}
