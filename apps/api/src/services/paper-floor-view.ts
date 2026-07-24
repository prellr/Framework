import { floorState } from "./paper-floor.ts";

export type PaperFloorScopeKey = "paper" | "forward" | "history";
export type PaperFloorViewMode = "scoreboard" | "floor" | "strategy" | "registry";

type PaperFloorState = Awaited<ReturnType<typeof floorState>>;

/**
 * Return only the selected cohort and only the large collections rendered by that view.
 *
 * This projection is deliberately downstream of the authoritative snapshot: it cannot change
 * decisions, accounting, gate membership, or evidence. Empty collections preserve one stable
 * tRPC shape while preventing hidden UI tabs from transferring multi-megabyte equity histories.
 */
export function projectPaperFloorView(
  state: PaperFloorState,
  input: { scope: PaperFloorScopeKey; view: PaperFloorViewMode },
) {
  const selected = state.scopes[input.scope];
  const includeFloorDetail = input.view === "floor";
  const includeDailyLedger = input.view !== "registry";
  const includeAssetTape = input.view === "scoreboard" || input.view === "floor";

  return {
    accounting: state.accounting,
    gate: state.gate,
    timeframeGate: state.timeframeGate,
    macroDirectionGate: state.macroDirectionGate,
    familywiseGate: state.familywiseGate,
    macroDirectionCoverage: state.macroDirectionCoverage,
    macroLeader: state.macroLeader,
    engineRuntime: state.engineRuntime,
    enabled: state.enabled,
    scope: {
      ...selected,
      equity: includeFloorDetail ? selected.equity : [],
      segments: includeFloorDetail
        ? selected.segments
        : { pairs: [], horizons: [], byPair: [], byHorizon: [] },
      combos: includeFloorDetail ? selected.combos : [],
      feed: includeFloorDetail ? selected.feed : [],
      assetTape: includeAssetTape ? selected.assetTape : [],
      dailyLedger: includeDailyLedger
        ? selected.dailyLedger
        : { ...selected.dailyLedger, rows: [] },
    },
  };
}

export async function paperFloorView(
  input: { scope: PaperFloorScopeKey; view: PaperFloorViewMode },
) {
  return projectPaperFloorView(await floorState(), input);
}
