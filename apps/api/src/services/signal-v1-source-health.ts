/**
 * A confirmed unsubscribe suppresses source polling until the next deep subscription audit.
 * Unknown audit state deliberately keeps polling so a transient Jester timeout cannot hide a
 * legitimate subscribed signal.
 */
import { getSetting, setSetting } from "./config.ts";

export const V1_SIGNAL_SOURCE_HEALTH = {
  version: "jester-v1-source-health-v1",
  settingKey: "v1_signal_source_health_v1",
  staleAfterMs: 20 * 60_000,
  maxFutureSkewMs: 5_000,
} as const;

export type V1SignalSourceStatus =
  | "disabled"
  | "missing-credential"
  | "subscribed"
  | "unsubscribed"
  | "unknown"
  | "error";

export interface V1SignalSourceHealth {
  version: typeof V1_SIGNAL_SOURCE_HEALTH.version;
  status: V1SignalSourceStatus;
  observedAtMs: number;
  subscriptionChecked: boolean;
  notifications: "ok" | "error" | "skipped" | "unknown";
  historyChecks: number;
  historySucceeded: number;
  written: number;
  unsided: number;
}

export interface V1SignalSourceHealthView extends V1SignalSourceHealth {
  ageSec: number;
  fresh: boolean;
}

type V1IngestHealthLike = {
  written: number;
  unsided: number;
  credentialPresent: boolean;
  subscriptionChecked: boolean;
  subscribed: boolean | null;
  notificationOk: boolean;
  notificationSkipped: boolean;
  historyChecks: number;
  historySucceeded: number;
};

const finiteNonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

export function v1SignalSourceHealthFromIngest(
  input: V1IngestHealthLike,
  observedAtMs = Date.now(),
): V1SignalSourceHealth {
  const status: V1SignalSourceStatus = !input.credentialPresent
    ? "missing-credential"
    : input.subscribed === true
      ? "subscribed"
      : input.subscribed === false
        ? "unsubscribed"
        : "unknown";
  return {
    version: V1_SIGNAL_SOURCE_HEALTH.version,
    status,
    observedAtMs,
    subscriptionChecked: input.subscriptionChecked,
    notifications: input.notificationSkipped
      ? "skipped"
      : input.notificationOk
        ? "ok"
        : "error",
    historyChecks: Math.max(0, Math.floor(input.historyChecks)),
    historySucceeded: Math.max(0, Math.floor(input.historySucceeded)),
    written: Math.max(0, Math.floor(input.written)),
    unsided: Math.max(0, Math.floor(input.unsided)),
  };
}

export function parseV1SignalSourceHealth(raw: string | undefined): V1SignalSourceHealth | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<V1SignalSourceHealth>;
    if (
      value.version !== V1_SIGNAL_SOURCE_HEALTH.version
      || ![
        "disabled",
        "missing-credential",
        "subscribed",
        "unsubscribed",
        "unknown",
        "error",
      ].includes(value.status ?? "")
      || !finiteNonNegative(value.observedAtMs)
      || typeof value.subscriptionChecked !== "boolean"
      || !["ok", "error", "skipped", "unknown"].includes(value.notifications ?? "")
      || !finiteNonNegative(value.historyChecks)
      || !finiteNonNegative(value.historySucceeded)
      || !finiteNonNegative(value.written)
      || !finiteNonNegative(value.unsided)
      || value.historySucceeded > value.historyChecks
    ) return null;
    return value as V1SignalSourceHealth;
  } catch {
    return null;
  }
}

export async function recordV1SignalSourceHealth(
  health: V1SignalSourceHealth,
): Promise<void> {
  await setSetting(V1_SIGNAL_SOURCE_HEALTH.settingKey, JSON.stringify(health));
}

export async function recordV1SignalSourceStatus(
  status: Extract<V1SignalSourceStatus, "disabled" | "error">,
  observedAtMs = Date.now(),
): Promise<void> {
  await recordV1SignalSourceHealth({
    version: V1_SIGNAL_SOURCE_HEALTH.version,
    status,
    observedAtMs,
    subscriptionChecked: false,
    notifications: "unknown",
    historyChecks: 0,
    historySucceeded: 0,
    written: 0,
    unsided: 0,
  });
}

export async function readV1SignalSourceHealth(
  nowMs = Date.now(),
): Promise<V1SignalSourceHealthView | null> {
  if (!finiteNonNegative(nowMs)) return null;
  const health = parseV1SignalSourceHealth(
    await getSetting(V1_SIGNAL_SOURCE_HEALTH.settingKey),
  );
  if (
    !health
    || health.observedAtMs > nowMs + V1_SIGNAL_SOURCE_HEALTH.maxFutureSkewMs
  ) return null;
  const ageMs = Math.max(0, nowMs - health.observedAtMs);
  return {
    ...health,
    ageSec: ageMs / 1_000,
    fresh: ageMs <= V1_SIGNAL_SOURCE_HEALTH.staleAfterMs,
  };
}

export function resolveV1PollState(
  cached: boolean | null,
  audited: boolean | null,
): { subscribed: boolean | null; shouldPoll: boolean } {
  const subscribed = audited ?? cached;
  return {
    subscribed,
    shouldPoll: subscribed !== false,
  };
}
