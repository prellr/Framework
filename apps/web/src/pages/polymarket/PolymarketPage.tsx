import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PolymarketStrategyLab } from "./PolymarketStrategyLab";
import { PolymarketPaperFloor } from "./PolymarketPaperFloor";
import { PolymarketScoreboard } from "./PolymarketScoreboard";
import { PolymarketFindings } from "./PolymarketFindings";
import { PolymarketExecutionCapital } from "./PolymarketExecutionCapital";

export function PolymarketPage() {
  const [tab, setTab] = useState<"scoreboard" | "lab" | "execution" | "floor" | "findings">("scoreboard");
  return (
    <div className="space-y-5">
      <PageHeader
        title="Polymarket Up/Down"
        subtitle="Forward-validating registered crypto Up/Down strategies against executable Polymarket asks. Scoreboard ranks the paper ledger, Execution & Capital measures quote costs and overlap, Strategy Lab tracks frozen hypotheses, and Paper Floor shows every decision. No live execution path exists."
      />

      <div className="flex gap-1 border-b">
        {([["scoreboard", "Scoreboard"], ["lab", "Strategy Lab"], ["execution", "Execution & Capital"], ["floor", "Paper Floor"], ["findings", "Findings"]] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={"border-b-2 px-3 py-2 text-sm font-medium transition-colors " + (tab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "findings" ? (
        <PolymarketFindings />
      ) : tab === "floor" ? (
        <PolymarketPaperFloor />
      ) : tab === "execution" ? (
        <PolymarketExecutionCapital />
      ) : tab === "lab" ? (
        <PolymarketStrategyLab />
      ) : (
        <PolymarketScoreboard />
      )}
    </div>
  );
}
