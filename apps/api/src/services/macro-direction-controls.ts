/**
 * Prospective pure-direction controls for the causal macro-breadth state.
 *
 * These are intentionally simpler than the existing macro trend sleeve: they apply no probability
 * bridge and no edge threshold. They condition the unconditional side benchmarks on the matching
 * live macro state, preserving the original Always UP / Always DOWN controls unchanged.
 */
import {
  MACRO_BREADTH_ROUTER,
  type MacroBreadthObservation,
} from "./macro-breadth-router.ts";

export const MACRO_DIRECTION_CONTROLS = {
  version: "updown-macro-direction-controls-v1",
  evalStartMs: Date.parse("2026-07-24T06:00:00.000Z"),
  macroVersion: MACRO_BREADTH_ROUTER.version,
  upBotKey: "macroUpOnly",
  downBotKey: "macroDownOnly",
  pairs: [...MACRO_BREADTH_ROUTER.targetPairs],
  horizonsMin: [...MACRO_BREADTH_ROUTER.eligibleHorizonsMin],
} as const;

export type MacroDirectionControl = "up" | "down";

export function macroDirectionControlSide(
  control: MacroDirectionControl,
  observation: MacroBreadthObservation | null,
): MacroDirectionControl | null {
  if (
    !observation
    || observation.version !== MACRO_DIRECTION_CONTROLS.macroVersion
  ) return null;
  return observation.state === control ? control : null;
}
