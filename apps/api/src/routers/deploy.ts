import { z } from "zod";
import { t } from "../trpc/context.ts";
import { operatorProcedure, tradeProcedure } from "../trpc/middleware.ts";
import { registerParamSet, deployParamSet } from "../services/deploy.ts";
import { audit } from "../services/audit.ts";

/**
 * Deploy-our-own-params path (Phase 3.1). `register` is analysis (mints + confirms a deployable
 * hash — no live effect). `deploy` is a LIVE trade (apply_params_by_hash), gated to a real manager
 * session and an explicit confirm.
 */
export const deployRouter = t.router({
  register: operatorProcedure
    .input(
      z.object({
        strategyId: z.string(),
        pair: z.string(),
        timeframe: z.string(),
        days: z.number().min(1).max(100000).optional(),
        parameters: z.record(z.string(), z.unknown()),
      }),
    )
    .mutation(({ input, ctx }) => registerParamSet(ctx.user.id, input)),

  deploy: tradeProcedure
    .input(
      z.object({
        strategyId: z.string(),
        pair: z.string(),
        timeframe: z.string(),
        paramHash: z.string().min(4).optional(), // omit → deploy at DEFAULT params (no optimize)
        riskPercent: z.number().min(0.1).max(2).optional(), // deprecated — per-trade risk is the strategy's own setting
        confirm: z.literal(true),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await audit(ctx, "deploy.paramSet", {
        resourceType: "strategy",
        resourceId: input.strategyId,
        newValue: { pair: input.pair, timeframe: input.timeframe, paramHash: input.paramHash, riskPercent: input.riskPercent },
      });
      const res = await deployParamSet(ctx.user.id, input);
      await audit(ctx, "deploy.paramSet.done", { resourceType: "strategy", resourceId: input.strategyId, newValue: { warnings: res.warnings } });
      return res;
    }),
});
