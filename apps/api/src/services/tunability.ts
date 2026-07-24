import { and, desc, eq } from "drizzle-orm";
import { db, strategies, backtestRuns } from "@framework/db";
import { getStrategyParams, probeHasEffect } from "./optimize.ts";

/**
 * Determine whether Jester honors parameter overrides for a strategy (i.e. whether guided optimize
 * can tune it), and store the verdict on the strategy row. Probes on a cell where the strategy
 * actually trades (its highest-trade default backtest) so a no-trade cell doesn't false-negative;
 * flips the top tunable param and checks the async backtest actually changes. Uses the async path
 * (not rate-limited). Returns the verdict, or null if it couldn't be determined.
 */
export async function probeAndStoreTunability(
  userId: string,
  strategyId: string,
): Promise<boolean | null> {
  // Prefer a cell where the strategy trades (max trades, default params).
  const [cellRow] = await db
    .select({
      pair: backtestRuns.pair,
      timeframe: backtestRuns.timeframe,
      days: backtestRuns.daysRequested,
      trades: backtestRuns.totalTrades,
    })
    .from(backtestRuns)
    .where(and(eq(backtestRuns.strategyId, strategyId), eq(backtestRuns.paramHash, "default")))
    .orderBy(desc(backtestRuns.totalTrades))
    .limit(1);
  const cell = cellRow ?? { pair: "BTC-USD", timeframe: "15m", days: 30, trades: null };

  const { numeric } = await getStrategyParams(userId, strategyId, cell.pair, cell.timeframe);
  if (numeric.length === 0) {
    // No tunable numeric params — nothing to optimize.
    await db.update(strategies).set({ tunable: false, tunableCheckedAt: new Date() }).where(eq(strategies.id, strategyId));
    return false;
  }

  const top = numeric[0];
  const eff = await probeHasEffect(userId, strategyId, cell.pair, cell.timeframe, cell.days ?? 30, top.name, top.value);
  await db
    .update(strategies)
    .set({ tunable: eff, tunableCheckedAt: new Date() })
    .where(eq(strategies.id, strategyId));
  return eff;
}
