/**
 * Metric helpers. Jester reports profit factor = gross profit / gross loss, and caps it at 999
 * when there are ZERO losing trades (gross loss = 0 → mathematically infinite). A PF of 999 is
 * therefore a sentinel, not a real edge — almost always a tiny sample with no losers. We render it
 * as ∞ and rank it below genuine finite edges when the sample is thin.
 */

export const PF_INFINITE = 999;

export const isInfinitePf = (pf: number | null | undefined): boolean =>
  pf != null && pf >= PF_INFINITE;

/** Display a profit factor: "—" when missing, "∞" for the no-loss sentinel, else 2 decimals. */
export const pfLabel = (pf: number | null | undefined): string =>
  pf == null ? "—" : isInfinitePf(pf) ? "∞" : pf.toFixed(2);

/**
 * Sort key for profit factor that prevents a low-sample "infinite" (no-loss) result from
 * dominating a leaderboard: an infinite PF on fewer than 20 trades ranks like a marginal edge
 * (just above 1), not at the very top. A genuinely no-loss result over a real sample keeps its
 * high rank.
 */
export const pfRank = (pf: number | null | undefined, trades: number | null | undefined): number => {
  if (pf == null) return -Infinity;
  if (isInfinitePf(pf)) return (trades ?? 0) >= 20 ? pf : 1 + (trades ?? 0) / 1000;
  return pf;
};
