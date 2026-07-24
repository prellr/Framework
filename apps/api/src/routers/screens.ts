import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { t } from "../trpc/context.ts";
import { protectedProcedure } from "../trpc/middleware.ts";
import { db, screens } from "@framework/db";
import { audit } from "../services/audit.ts";
import { evaluateScreen, runScreen, type ScreenQuery } from "../services/screens.ts";

const screenQuery = z.object({
  minPf: z.number().optional(),
  minTrades: z.number().int().optional(),
  minReturn: z.number().optional(),
  maxDrawdown: z.number().optional(),
  pairs: z.array(z.string()).optional(),
  timeframes: z.array(z.string()).optional(),
  days: z.array(z.number().int()).optional(),
});

/**
 * Saved screens: threshold queries over the warehouse. Each user owns their own screens.
 * Reads/writes are all analysis-only (never touch Jester), so any authenticated user may
 * create and run them. The diff between consecutive runs is the "alert".
 */
export const screensRouter = t.router({
  /** List the current user's saved screens (newest first). */
  list: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select()
      .from(screens)
      .where(eq(screens.ownerUserId, ctx.user.id))
      .orderBy(desc(screens.createdAt));
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const [row] = await db
        .select()
        .from(screens)
        .where(and(eq(screens.id, input.id), eq(screens.ownerUserId, ctx.user.id)))
        .limit(1);
      return row ?? null;
    }),

  /** Evaluate a query WITHOUT saving — powers the live preview in the create form. */
  preview: protectedProcedure
    .input(screenQuery)
    .query(async ({ input }) => {
      return evaluateScreen(input as ScreenQuery);
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(120),
        query: screenQuery,
        autoRescreen: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const [row] = await db
        .insert(screens)
        .values({
          ownerUserId: ctx.user.id,
          name: input.name,
          query: input.query,
          autoRescreen: input.autoRescreen,
        })
        .returning();
      await audit(ctx, "screens.create", {
        resourceType: "screen",
        resourceId: row.id,
        newValue: input,
      });
      // Establish the baseline immediately so the first alert-diff is meaningful.
      await runScreen(row.id);
      return row;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(120).optional(),
        query: screenQuery.optional(),
        autoRescreen: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const patch: Record<string, unknown> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.query !== undefined) patch.query = input.query;
      if (input.autoRescreen !== undefined) patch.autoRescreen = input.autoRescreen;
      const [row] = await db
        .update(screens)
        .set(patch)
        .where(and(eq(screens.id, input.id), eq(screens.ownerUserId, ctx.user.id)))
        .returning();
      await audit(ctx, "screens.update", {
        resourceType: "screen",
        resourceId: input.id,
        newValue: input,
      });
      return row ?? null;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await db
        .delete(screens)
        .where(and(eq(screens.id, input.id), eq(screens.ownerUserId, ctx.user.id)));
      await audit(ctx, "screens.delete", { resourceType: "screen", resourceId: input.id });
      return { ok: true };
    }),

  /** Run a screen now: evaluate, diff vs baseline, persist, and return survivors + the diff. */
  run: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      // Ownership check before running (runScreen doesn't scope by user).
      const [row] = await db
        .select({ id: screens.id })
        .from(screens)
        .where(and(eq(screens.id, input.id), eq(screens.ownerUserId, ctx.user.id)))
        .limit(1);
      if (!row) throw new Error("Screen not found");
      return runScreen(input.id);
    }),
});
