import { z } from "zod";
import { db, jesterCredentials } from "@framework/db";
import { t } from "../trpc/context.ts";
import { protectedProcedure, managerProcedure } from "../trpc/middleware.ts";
import { coverageStatus, setCoverageEnabled, scanCoverage } from "../services/coverage.ts";
import { audit } from "../services/audit.ts";

/**
 * Autonomous coverage engine controls. Status is readable by anyone; arming/disarming and manual
 * scans are manager-gated because turning it on starts a standing Jester backtest spend.
 */
export const coverageRouter = t.router({
  status: protectedProcedure.query(() => coverageStatus()),

  setEnabled: managerProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      await setCoverageEnabled(input.enabled);
      await audit(ctx, "coverage.setEnabled", { resourceType: "coverage", newValue: { enabled: input.enabled } });
      return { enabled: input.enabled };
    }),

  /** Run one scan tick immediately (fills a few stale cells) — for a manual nudge without waiting for the job. */
  scanNow: managerProcedure.mutation(async ({ ctx }) => {
    const [cred] = await db.select({ userId: jesterCredentials.userId }).from(jesterCredentials).limit(1);
    if (!cred) return { ran: 0, stale: 0, target: 0 };
    const res = await scanCoverage(cred.userId);
    await audit(ctx, "coverage.scanNow", { resourceType: "coverage", newValue: res });
    return res;
  }),
});
