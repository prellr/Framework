import { z } from "zod";
import { t } from "../trpc/context.ts";
import { protectedProcedure } from "../trpc/middleware.ts";
import { leaderboard, leaderboardStats } from "../services/leaderboard.ts";

/** Cross-strategy leaderboard — ranked composite scores over the warehouse. Read-only. */
export const leaderboardRouter = t.router({
  top: protectedProcedure
    .input(
      z
        .object({
          minTrades: z.number().min(0).max(10000).optional(),
          timeframe: z.string().optional(),
          pair: z.string().optional(),
          q: z.string().optional(),
          onlyValidated: z.boolean().optional(),
          riskPct: z.number().min(0.1).max(100).optional(),
          limit: z.number().min(1).max(500).optional(),
        })
        .optional(),
    )
    .query(({ input }) => leaderboard(input ?? {})),

  stats: protectedProcedure.query(() => leaderboardStats()),
});
