/**
 * Tiny per-user cache for the live strategy snapshot (jester_my_strategies + pnl/summary).
 *
 * That snapshot is read constantly — liveStatus (30s poll), myStrategies (30s poll),
 * paramPerformance, and the param-track job — so hitting Jester every time is the app's single
 * biggest source of API chatter, and my_strategies intermittently HANGS on Jester's side. This
 * caches it briefly so repeated reads collapse to one Jester call per TTL, and serves the last-good
 * snapshot when a refresh fails (resilient to the hang). Trade mutations bust it so an activation
 * shows up immediately rather than after the TTL.
 *
 * In-memory, per API process (the worker has its own copy; its jobs run on their own cadence). A
 * separate lightweight module so both trading.ts and jester.ts can use it without a circular import.
 */
const TTL_MS = 45_000;

interface Entry {
  data: any;
  at: number;
}
const cache = new Map<string, Entry>();

export function getLiveCache(userId: string): { fresh: any | null; stale: any | null } {
  const e = cache.get(userId);
  if (!e) return { fresh: null, stale: null };
  return Date.now() - e.at < TTL_MS ? { fresh: e.data, stale: e.data } : { fresh: null, stale: e.data };
}

export function setLiveCache(userId: string, data: any): void {
  cache.set(userId, { data, at: Date.now() });
}

/** Invalidate after a trade mutation so the next read reflects it immediately. */
export function bustLiveCache(userId: string): void {
  cache.delete(userId);
}
