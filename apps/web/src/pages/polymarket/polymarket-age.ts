const DAY_MS = 86_400_000;

export function elapsedDays(startMs: number | null | undefined, nowMs = Date.now()): number | null {
  if (
    startMs == null
    || !Number.isFinite(startMs)
    || !Number.isFinite(nowMs)
  ) {
    return null;
  }
  return Math.max(0, (nowMs - startMs) / DAY_MS);
}

export function formatElapsedDays(
  startMs: number | null | undefined,
  nowMs = Date.now(),
): string {
  const days = elapsedDays(startMs, nowMs);
  if (days == null) return "—";
  return `${days < 10 ? days.toFixed(2) : days.toFixed(1)}d`;
}
