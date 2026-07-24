import type { PeakGapRetentionStats } from "./rtds.ts";

/** KB updown-bsm-peak-retention-v1 — preregistered before implementation. */
export const BSM_PEAK_RETENTION = {
  evalStartMs: 1_784_797_200_000, // 2026-07-23 09:00:00 UTC
  horizonMin: 5,
  minRemainingSec: 60,
  maxRemainingSec: 90,
  minRetention: 0.75,
  maxTickAgeSec: 20,
  maxPathGapSec: 20,
} as const;

export function peakRetentionEligibleHorizon(horizonMin: number): boolean {
  return horizonMin === BSM_PEAK_RETENTION.horizonMin;
}

/** Frozen fail-closed path/time gate. Direction and fair value remain the parent BSM model's job. */
export function peakRetentionEligible(
  path: PeakGapRetentionStats | null,
  remainingSec: number,
): path is PeakGapRetentionStats {
  return path != null
    && Number.isFinite(remainingSec)
    && remainingSec >= BSM_PEAK_RETENTION.minRemainingSec
    && remainingSec <= BSM_PEAK_RETENTION.maxRemainingSec
    && Number.isFinite(path.currentPx)
    && path.currentPx > 0
    && Number.isFinite(path.currentGapLog)
    && Number.isFinite(path.peakAbsGapLog)
    && Number.isFinite(path.retention)
    && path.retention <= 1 + 1e-12
    && path.sourceAgeSec >= 0
    && path.sourceAgeSec < BSM_PEAK_RETENTION.maxTickAgeSec
    && path.receiveAgeSec >= 0
    && path.receiveAgeSec < BSM_PEAK_RETENTION.maxTickAgeSec
    && path.tickCount >= 2
    && Number.isFinite(path.startCoverageSec)
    && path.startCoverageSec >= 0
    && path.startCoverageSec < BSM_PEAK_RETENTION.maxPathGapSec
    && Number.isFinite(path.maxIntertickGapSec)
    && path.maxIntertickGapSec >= 0
    && path.maxIntertickGapSec < BSM_PEAK_RETENTION.maxPathGapSec
    && path.peakAbsGapLog > 0
    && path.retention >= BSM_PEAK_RETENTION.minRetention;
}
