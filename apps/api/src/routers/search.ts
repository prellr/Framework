import { z } from "zod";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db, strategies, backtestRuns, strategyParamPeriods } from "@framework/db";
import { t } from "../trpc/context.ts";
import { protectedProcedure } from "../trpc/middleware.ts";

/**
 * Global search behind the ⌘K palette.
 *
 * Everything in this system is addressed by one of a few keys — a strategy id, a Jester parameter
 * code, or an asset — and they're scattered across pages. This resolves any of them in one query so
 * a code pasted from a Telegram alert or a live automation row lands on the right screen.
 *
 * Param codes are matched by PREFIX because they surface at different lengths: Jester reports 8-char
 * codes on live subscriptions (`paramHash8`) and 12-char codes on backtests, for the same set.
 */
export const searchRouter = t.router({
  global: protectedProcedure
    .input(z.object({ q: z.string().min(1).max(64) }))
    .query(async ({ input }) => {
      const q = input.q.trim();
      const contains = `%${q}%`;
      const prefix = `${q}%`;

      // Live codes are stored 8-char (`paramHash8`) while backtest codes are 12-char, for the SAME
      // parameter set. Match in BOTH directions so pasting either length finds the other:
      //   stored LIKE 'q%'   (query is a prefix of the stored code)
      //   'q' LIKE stored%   (stored code is a prefix of the query)
      const livePrefix = or(
        ilike(strategyParamPeriods.paramHash8, prefix),
        sql`${q} ILIKE ${strategyParamPeriods.paramHash8} || '%'`,
      );

      const [strategyHits, codeHits, defaultCodeHits, pairRows, liveHits] = await Promise.all([
        db
          .select({
            id: strategies.id,
            name: strategies.name,
            tier: strategies.tier,
            tunable: strategies.tunable,
          })
          .from(strategies)
          .where(or(ilike(strategies.id, contains), ilike(strategies.name, contains)))
          .limit(8),

        // A parameter code seen on a backtest row → the exact cell it was run on.
        db
          .selectDistinctOn([backtestRuns.jesterParamCode, backtestRuns.strategyId, backtestRuns.pair], {
            code: backtestRuns.jesterParamCode,
            strategyId: backtestRuns.strategyId,
            pair: backtestRuns.pair,
            timeframe: backtestRuns.timeframe,
            days: backtestRuns.daysRequested,
            totalReturn: backtestRuns.totalReturn,
            totalTrades: backtestRuns.totalTrades,
            profitFactor: backtestRuns.profitFactor,
          })
          .from(backtestRuns)
          .where(and(ilike(backtestRuns.jesterParamCode, prefix)))
          .orderBy(backtestRuns.jesterParamCode, backtestRuns.strategyId, backtestRuns.pair, desc(backtestRuns.ranAt))
          .limit(8),

        // A strategy's default parameter code.
        db
          .select({ id: strategies.id, name: strategies.name, code: strategies.defaultParamCode })
          .from(strategies)
          .where(ilike(strategies.defaultParamCode, prefix))
          .limit(5),

        db
          .selectDistinct({ pair: backtestRuns.pair })
          .from(backtestRuns)
          .where(ilike(backtestRuns.pair, contains))
          .limit(8),

        // Parameter sets that are (or were) live — the codes that appear in Telegram alerts and on
        // the Live Trading rows. These often have no backtest row, so they'd otherwise be unfindable.
        db
          .select({
            code: strategyParamPeriods.paramHash8,
            strategyId: strategyParamPeriods.strategyId,
            pair: strategyParamPeriods.pair,
            timeframe: strategyParamPeriods.timeframe,
            startedAt: strategyParamPeriods.startedAt,
            endedAt: strategyParamPeriods.endedAt,
          })
          .from(strategyParamPeriods)
          .where(livePrefix)
          .orderBy(desc(strategyParamPeriods.startedAt))
          .limit(6),
      ]);

      return {
        strategies: strategyHits,
        codes: codeHits.filter((c) => c.code),
        defaultCodes: defaultCodeHits.filter((c) => c.code),
        pairs: pairRows.map((p) => p.pair),
        live: liveHits.filter((l) => l.code),
      };
    }),

  /** Everything we know about one parameter code — for pasting a code straight into the palette. */
  byCode: protectedProcedure
    .input(z.object({ code: z.string().min(4).max(64) }))
    .query(async ({ input }) => {
      const prefix = `${input.code}%`;
      const runs = await db
        .select()
        .from(backtestRuns)
        .where(ilike(backtestRuns.jesterParamCode, prefix))
        .orderBy(desc(backtestRuns.ranAt))
        .limit(25);
      const [defaultOf] = await db
        .select({ id: strategies.id, name: strategies.name })
        .from(strategies)
        .where(ilike(strategies.defaultParamCode, prefix))
        .limit(1);
      return { runs, defaultOf: defaultOf ?? null };
    }),
});
