/**
 * Outcome-free structural redundancy audit for the forward paper roster.
 *
 * This deliberately selects only bot identity, market identity, and the side chosen. It never reads
 * resolution status, fills, asks, P&L, or any other outcome-conditioned field. The report answers a
 * narrower question than the verdict gate: when two registered rules fire, are they usually making
 * the same (or exactly opposite) decision on the same markets?
 */
import { gte } from "drizzle-orm";
import { db, paperTrades } from "@framework/db";
import { PAPER_BOTS, paperBotBucketUniverse } from "./paper-floor.ts";
import {
  PAPER_TIMEFRAME_GATE,
  paperTimeframeGateKey,
} from "./paper-timeframe-gate.ts";
import { computeStrategyIndependence } from "./strategy-independence-model.ts";

export async function strategyIndependenceStatus() {
  const rows = await db
    .select({
      botKey: paperTrades.botKey,
      conditionId: paperTrades.conditionId,
      horizonMin: paperTrades.horizonMin,
      side: paperTrades.side,
    })
    .from(paperTrades)
    .where(gte(paperTrades.windowStart, new Date(PAPER_TIMEFRAME_GATE.evalStartMs)));
  const identities = PAPER_BOTS.flatMap((bot) =>
    [...new Set(
      paperBotBucketUniverse(bot)
        .map((bucket) => bucket.horizonMin)
        .filter((horizonMin): horizonMin is 5 | 15 =>
          horizonMin === 5 || horizonMin === 15
        ),
    )].map((horizonMin) => ({
      key: paperTimeframeGateKey(bot.key, horizonMin),
      name: `${bot.name} · ${horizonMin}m`,
      color: bot.color,
    }))
  );

  return {
    version: "updown-strategy-timeframe-independence-v1",
    outcomeFree: true as const,
    evalStartMs: PAPER_TIMEFRAME_GATE.evalStartMs,
    ...computeStrategyIndependence(
      rows.map((row) => ({
        botKey: paperTimeframeGateKey(row.botKey, row.horizonMin),
        conditionId: row.conditionId,
        side: row.side,
      })),
      identities,
    ),
  };
}
