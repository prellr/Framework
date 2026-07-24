/**
 * Preregistered BTC 5m intrawindow variance profile.
 *
 * Source: RSJAL/btc-binary-option-fhs at fixed commit
 * 1e027836b6136a59ba4f01ebfa9616e53c53f02a. The repository's twenty
 * training-only 15-second variance multipliers are aggregated into five
 * consecutive one-minute means because Jester's parent BSM volatility is
 * measured per minute. No coefficient is fit from Jester outcomes.
 */

export const BSM_WINDOW_PROFILE = {
  version: "bsm-btc5m-window-profile-v1",
  evalStartMs: Date.UTC(2026, 6, 23, 11, 0, 0),
  pair: "BTC-USD",
  horizonMin: 5,
  varianceWeights: [
    1.1276404254832042,
    1.0457459081149403,
    0.9899325023105002,
    0.944148217985474,
    0.8925329461058816,
  ],
} as const;

export function bsmWindowProfileEligible(context: {
  pair?: string;
  horizonMin: number;
}): boolean {
  return context.pair === BSM_WINDOW_PROFILE.pair
    && context.horizonMin === BSM_WINDOW_PROFILE.horizonMin;
}

/**
 * Integrate the frozen piecewise-constant variance curve from "now" to expiry.
 *
 * A return value of 1 means one flat-vol minute of remaining variance. The
 * five weights sum to five, so the child equals the parent's total variance at
 * window open and differs only as the five-minute clock advances.
 */
export function bsmProfileRemainingVarianceMin(tauMin: number): number | null {
  if (!Number.isFinite(tauMin) || tauMin <= 0 || tauMin > BSM_WINDOW_PROFILE.horizonMin) return null;
  const elapsedMin = BSM_WINDOW_PROFILE.horizonMin - tauMin;
  let remainingVarianceMin = 0;
  for (let minute = 0; minute < BSM_WINDOW_PROFILE.varianceWeights.length; minute++) {
    const overlapStart = Math.max(elapsedMin, minute);
    const overlapEnd = Math.min(BSM_WINDOW_PROFILE.horizonMin, minute + 1);
    if (overlapEnd > overlapStart) {
      remainingVarianceMin +=
        (overlapEnd - overlapStart) * BSM_WINDOW_PROFILE.varianceWeights[minute];
    }
  }
  return Number.isFinite(remainingVarianceMin) && remainingVarianceMin > 0
    ? remainingVarianceMin
    : null;
}
