/**
 * Strategy catalog mirror. Pulls Jester's strategy list and upserts it into our
 * `strategy` table so the UI and screening queries don't hit Jester on every view.
 * `cachedStats` is stored but treated as untrusted (see backtest warehouse).
 */

import { db, strategies } from "@framework/db";
import { jesterCall } from "./jester.ts";

interface JesterStrategy {
  id: string;
  name?: string;
  tier?: string;
  type?: string;
  category?: string;
  backtestData?: unknown;
  // Documentation fields — Jester's own authoritative strategy metadata.
  description?: string;
  summary?: string;
  entrySummary?: string;
  exitSummary?: string;
  indicatorSummary?: string;
  features?: unknown;
  riskSettings?: unknown;
  timeframe?: string;
}

/** Fetch Jester's catalog with the given user's key and upsert into `strategy`. */
export async function refreshCatalog(userId: string): Promise<{ count: number }> {
  const res = await jesterCall(userId, "GET", "/api/delegated/strategies/available");
  const list: JesterStrategy[] = Array.isArray(res?.strategies) ? res.strategies : [];
  if (list.length === 0) return { count: 0 };

  const now = new Date();
  const rows = list
    .filter((s) => typeof s.id === "string")
    .map((s) => ({
      id: s.id,
      name: s.name ?? s.id,
      tier: s.tier ?? null,
      category: s.category ?? s.type ?? null,
      cachedStats: s.backtestData ?? null,
      description: s.description ?? s.summary ?? null,
      entrySummary: s.entrySummary ?? null,
      exitSummary: s.exitSummary ?? null,
      indicatorSummary: s.indicatorSummary ?? null,
      features: Array.isArray(s.features) ? s.features : null,
      riskSettings: s.riskSettings ?? null,
      nativeTimeframe: s.timeframe ?? null,
      refreshedAt: now,
    }));

  // Upsert each strategy — insert new, refresh existing.
  for (const row of rows) {
    await db
      .insert(strategies)
      .values(row)
      .onConflictDoUpdate({
        target: strategies.id,
        set: {
          name: row.name,
          tier: row.tier,
          category: row.category,
          cachedStats: row.cachedStats,
          description: row.description,
          entrySummary: row.entrySummary,
          exitSummary: row.exitSummary,
          indicatorSummary: row.indicatorSummary,
          features: row.features,
          riskSettings: row.riskSettings,
          nativeTimeframe: row.nativeTimeframe,
          refreshedAt: now,
        },
      });
  }
  return { count: rows.length };
}
