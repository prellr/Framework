import type { V1SignalSourceHealthView } from "./signal-v1-source-health.ts";

export const PAPER_BOT_ACTIVITY = {
  version: "paper-bot-activity-v1",
  smoothPathCaptureStaleAfterMs: 12 * 60_000,
} as const;

export type JesterV1PaperBotActivity = {
  kind: "jester-v1-source";
  status:
    | "disabled"
    | "missing-credential"
    | "subscribed"
    | "unsubscribed"
    | "unknown"
    | "error"
    | "stale";
  fresh: boolean;
  checkedAgoSec: number | null;
  signalRows: number;
  lastSignalAgoSec: number | null;
};

export type SmoothPathPaperBotActivity = {
  kind: "smooth-path-funnel";
  status:
    | "awaiting-observation"
    | "evaluating"
    | "path-qualified"
    | "book-qualified"
    | "placed"
    | "stale";
  fresh: boolean;
  capturedAgoSec: number | null;
  eligibleRows: number;
  observedRows: number;
  pathQualifiedRows: number;
  bookQualifiedRows: number;
  placedRows: number;
};

export type PaperBotActivity =
  | JesterV1PaperBotActivity
  | SmoothPathPaperBotActivity;

const count = (value: number | string | null | undefined) =>
  Math.max(0, Math.floor(Number(value) || 0));

const ageSec = (nowMs: number, atMs: number | null | undefined) =>
  atMs == null || !Number.isFinite(atMs)
    ? null
    : Math.max(0, Math.round((nowMs - atMs) / 1_000));

export function buildJesterV1PaperBotActivity(
  health: V1SignalSourceHealthView | null,
  signals: { rows: number | string | null; lastSignalAtMs: number | null },
  nowMs = Date.now(),
): JesterV1PaperBotActivity {
  return {
    kind: "jester-v1-source",
    status: health == null
      ? "unknown"
      : health.fresh
        ? health.status
        : "stale",
    fresh: health?.fresh ?? false,
    checkedAgoSec: health ? ageSec(nowMs, health.observedAtMs) : null,
    signalRows: count(signals.rows),
    lastSignalAgoSec: ageSec(nowMs, signals.lastSignalAtMs),
  };
}

export function buildSmoothPathPaperBotActivity(
  row: {
    eligibleRows: number | string | null;
    observedRows: number | string | null;
    pathQualifiedRows: number | string | null;
    bookQualifiedRows: number | string | null;
    placedRows: number | string | null;
    lastCapturedAtMs: number | null;
  } | undefined,
  nowMs = Date.now(),
): SmoothPathPaperBotActivity {
  const eligibleRows = count(row?.eligibleRows);
  const observedRows = count(row?.observedRows);
  const pathQualifiedRows = count(row?.pathQualifiedRows);
  const bookQualifiedRows = count(row?.bookQualifiedRows);
  const placedRows = count(row?.placedRows);
  const capturedAgoSec = ageSec(nowMs, row?.lastCapturedAtMs);
  const fresh = capturedAgoSec != null
    && capturedAgoSec * 1_000 <= PAPER_BOT_ACTIVITY.smoothPathCaptureStaleAfterMs;
  const status: SmoothPathPaperBotActivity["status"] = !fresh && eligibleRows > 0
    ? "stale"
    : placedRows > 0
      ? "placed"
      : bookQualifiedRows > 0
        ? "book-qualified"
        : pathQualifiedRows > 0
          ? "path-qualified"
          : observedRows > 0
            ? "evaluating"
            : "awaiting-observation";
  return {
    kind: "smooth-path-funnel",
    status,
    fresh,
    capturedAgoSec,
    eligibleRows,
    observedRows,
    pathQualifiedRows,
    bookQualifiedRows,
    placedRows,
  };
}
