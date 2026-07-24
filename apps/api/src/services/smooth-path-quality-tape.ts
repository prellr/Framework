/**
 * Prospective, outcome-blind readiness contract for Smooth Path quality distributions.
 *
 * This contract governs only when unsigned feature quantiles may inform a separately registered
 * future strategy. It cannot change either frozen Smooth Path rule or create a paper decision.
 */
export const SMOOTH_PATH_QUALITY_TAPE = {
  version: "updown-smooth-path-quality-tape-v1",
  evalStartMs: Date.UTC(2026, 6, 24, 3, 0, 0),
  minMetricRowsPerVersion: 5_000,
  minMetricRowsPerPair: 800,
  minSpanDays: 3,
  minCoverage: 0.95,
} as const;

export interface SmoothPathQualityReadinessInput {
  metricRows: number;
  weakestPairMetricRows: number;
  spanDays: number;
  coverage: number;
}

export function smoothPathQualityReady(input: SmoothPathQualityReadinessInput): boolean {
  return (
    input.metricRows >= SMOOTH_PATH_QUALITY_TAPE.minMetricRowsPerVersion
    && input.weakestPairMetricRows >= SMOOTH_PATH_QUALITY_TAPE.minMetricRowsPerPair
    && input.spanDays >= SMOOTH_PATH_QUALITY_TAPE.minSpanDays
    && input.coverage >= SMOOTH_PATH_QUALITY_TAPE.minCoverage
  );
}
