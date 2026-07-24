/** Pure feature transforms for the forward Polymarket state tape. Kept network/DB-free for tests. */
export function surfaceSampleMinute(windowStartMs: number, capturedAtMs: number): number {
  return Math.floor((capturedAtMs - windowStartMs) / 60_000);
}

export function normalizedDistance(
  spot: number,
  strike: number,
  sigmaPerMin: number | null,
  remainingSec: number,
): { logMoneyness: number; zDistance: number | null } | null {
  if (!(spot > 0) || !(strike > 0) || !(remainingSec > 0)) return null;
  const logMoneyness = Math.log(spot / strike);
  const tauMin = remainingSec / 60;
  const denom = sigmaPerMin != null ? sigmaPerMin * Math.sqrt(tauMin) : 0;
  return { logMoneyness, zDistance: denom > 0 ? logMoneyness / denom : null };
}
