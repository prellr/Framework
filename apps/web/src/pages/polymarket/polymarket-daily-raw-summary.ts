export type DailyRawPoint = {
  day: string;
  n: number;
  raw: number;
};

export type DailyRawSummary = {
  observedDays: number;
  completedDays: number;
  positiveCompletedDays: number;
  negativeCompletedDays: number;
  flatCompletedDays: number;
  medianCompletedRaw: number | null;
  bestCompleted: DailyRawPoint | null;
  worstCompleted: DailyRawPoint | null;
  current: DailyRawPoint | null;
};

/**
 * Descriptive-only daily evidence.
 *
 * Rows are first coalesced by calendar key. The current Chicago day is intentionally excluded
 * from completed-day sign, median, best, and worst statistics because it is still accumulating.
 * These values are presentation diagnostics and never participate in a strategy verdict.
 */
export function summarizeDailyRawRows(
  rows: readonly DailyRawPoint[],
  currentDay: string,
): DailyRawSummary {
  const byDay = new Map<string, DailyRawPoint>();
  for (const row of rows) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(row.day)
      || !Number.isFinite(row.n)
      || row.n <= 0
      || !Number.isFinite(row.raw)
    ) {
      continue;
    }
    const existing = byDay.get(row.day) ?? { day: row.day, n: 0, raw: 0 };
    existing.n += row.n;
    existing.raw += row.raw;
    byDay.set(row.day, existing);
  }

  const observed = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  const completed = observed.filter((row) => row.day < currentDay);
  const orderedRaw = completed.map((row) => row.raw).sort((a, b) => a - b);
  const middle = Math.floor(orderedRaw.length / 2);
  const medianCompletedRaw = orderedRaw.length === 0
    ? null
    : orderedRaw.length % 2 === 1
      ? orderedRaw[middle]!
      : (orderedRaw[middle - 1]! + orderedRaw[middle]!) / 2;

  const ranked = [...completed].sort((a, b) => a.raw - b.raw || a.day.localeCompare(b.day));

  return {
    observedDays: observed.length,
    completedDays: completed.length,
    positiveCompletedDays: completed.filter((row) => row.raw > 0).length,
    negativeCompletedDays: completed.filter((row) => row.raw < 0).length,
    flatCompletedDays: completed.filter((row) => row.raw === 0).length,
    medianCompletedRaw,
    bestCompleted: ranked.at(-1) ?? null,
    worstCompleted: ranked[0] ?? null,
    current: byDay.get(currentDay) ?? null,
  };
}
