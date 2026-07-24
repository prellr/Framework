import { z } from "zod";
import { t } from "../trpc/context.ts";
import { operatorProcedure } from "../trpc/middleware.ts";
import { evaluateRobustness } from "../services/robustness.ts";
import { audit } from "../services/audit.ts";

/**
 * Robustness validation — runs a param set at multiple horizons and scores whether the edge holds.
 * Operator-gated because it spends backtests (cheap when the warehouse already has the horizons).
 */
export const robustnessRouter = t.router({
  evaluate: operatorProcedure
    .input(
      z.object({
        strategyId: z.string(),
        pair: z.string(),
        timeframe: z.string(),
        parameters: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const report = await evaluateRobustness(input, ctx.user.id);
      await audit(ctx, "robustness.evaluate", {
        resourceType: "strategy",
        resourceId: input.strategyId,
        newValue: { pair: input.pair, timeframe: input.timeframe, verdict: report.verdict, score: report.score },
      });
      return report;
    }),
});
