/**
 * Outcome-blind opportunity tape for the macro-direction controls.
 *
 * One compact object is attached to the unconditional DOWN parent row for each newly observed
 * market. It records whether the synchronized completed-bar macro input was available at that exact
 * paper decision tick and which child, if any, should exist. It never changes a paper decision and
 * contains no outcome, fill result, grade, return, or performance field.
 */
import {
  MACRO_BREADTH_ROUTER,
  type MacroBreadthObservation,
  type MacroBreadthState,
} from "./macro-breadth-router.ts";
import { MACRO_DIRECTION_CONTROLS } from "./macro-direction-controls.ts";

export const MACRO_DIRECTION_COVERAGE = {
  version: "updown-macro-direction-coverage-v1",
  evalStartMs: Date.parse("2026-07-24T12:20:00.000Z"),
  denominatorBotKey: "drift",
  macroVersion: MACRO_BREADTH_ROUTER.version,
  controlVersion: MACRO_DIRECTION_CONTROLS.version,
} as const;

export interface MacroDirectionCoverageMetadata {
  version: typeof MACRO_DIRECTION_COVERAGE.version;
  evaluatedAtMs: number;
  windowStartMs: number;
  available: boolean;
  causalAligned: boolean;
  macroVersion: typeof MACRO_BREADTH_ROUTER.version;
  state: MacroBreadthState | null;
  completedAtMs: number | null;
  expectedChildKey:
    | typeof MACRO_DIRECTION_CONTROLS.upBotKey
    | typeof MACRO_DIRECTION_CONTROLS.downBotKey
    | null;
}

export function macroDirectionCoverageMetadata(
  observation: MacroBreadthObservation | null,
  evaluatedAtMs: number,
  windowStartMs: number,
): MacroDirectionCoverageMetadata {
  const available = observation?.version === MACRO_DIRECTION_COVERAGE.macroVersion;
  const causalAligned = available && observation.completedAtMs === windowStartMs;
  const expectedChildKey =
    causalAligned && observation.state === "up"
      ? MACRO_DIRECTION_CONTROLS.upBotKey
      : causalAligned && observation.state === "down"
        ? MACRO_DIRECTION_CONTROLS.downBotKey
        : null;
  return {
    version: MACRO_DIRECTION_COVERAGE.version,
    evaluatedAtMs,
    windowStartMs,
    available,
    causalAligned,
    macroVersion: MACRO_DIRECTION_COVERAGE.macroVersion,
    state: available ? observation.state : null,
    completedAtMs: available ? observation.completedAtMs : null,
    expectedChildKey,
  };
}
