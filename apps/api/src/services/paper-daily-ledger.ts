/**
 * Display-only calendar contract for the Paper Floor's realized RAW ledger.
 *
 * Daily attribution uses the grade timestamp because RAW P&L becomes realized only when a market
 * resolves. The selected Paper Floor scope still controls which decision rows are eligible.
 */
export const PAPER_DAILY_LEDGER = {
  version: "updown-paper-daily-raw-ledger-v2",
  timeZone: "America/Chicago",
  attributionClock: "graded_at",
  defaultVisibleDays: 14,
  rangeOptions: [7, 14, 30] as const,
  // Two full weekly cycles are required before a manual multi-day review. Reaching this floor is
  // not a pass and cannot modify the strategy/timeframe verdict gate.
  completedDayReviewFloor: 14,
  reviewPolicy: "descriptive_only_no_gate_effect",
} as const;

/** Deterministic YYYY-MM-DD key in the ledger's registered calendar timezone. */
export function paperDailyLedgerDayKey(atMs: number): string {
  if (!Number.isFinite(atMs)) throw new Error("daily ledger timestamp must be finite");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PAPER_DAILY_LEDGER.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(atMs));
  const value = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  if (!year || !month || !day) throw new Error("daily ledger calendar conversion failed");
  return `${year}-${month}-${day}`;
}
