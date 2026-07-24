import { z } from "zod";
import { t } from "../trpc/context.ts";
import { protectedProcedure } from "../trpc/middleware.ts";
import { tesseractField, tesseractAnalyze, tesseractCommentary, tesseractScan } from "../services/tesseract.ts";
import { tesseractScoreboard, loggerStatus } from "../services/tesseract-scoreboard.ts";

/** Tesseract read-only exploration surface (the test bed). No trades, no funds. */
export const tesseractRouter = t.router({
  field: protectedProcedure.input(z.object({ pair: z.string() })).query(({ input, ctx }) => tesseractField(ctx.user.id, input.pair)),
  analyze: protectedProcedure.input(z.object({ pair: z.string() })).query(({ input, ctx }) => tesseractAnalyze(ctx.user.id, input.pair)),
  commentary: protectedProcedure.input(z.object({ pair: z.string() })).query(({ input, ctx }) => tesseractCommentary(ctx.user.id, input.pair)),
  scan: protectedProcedure
    .input(z.object({ pairs: z.array(z.string()).min(1).max(24) }))
    .query(({ input, ctx }) => tesseractScan(ctx.user.id, input.pairs)),
  // Build #1 collection health + build #2 predictiveness scoreboard over the logged dataset.
  loggerStatus: protectedProcedure.query(({ ctx }) => loggerStatus(ctx.user.id)),
  scoreboard: protectedProcedure
    .input(z.object({ pair: z.string().optional() }).optional())
    .query(({ ctx, input }) => tesseractScoreboard(ctx.user.id, input?.pair)),
});
