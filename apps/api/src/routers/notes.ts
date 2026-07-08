import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { t } from "../trpc/context.ts";
import { protectedProcedure, operatorProcedure } from "../trpc/middleware.ts";
import { db, notes } from "@framework/db";
import { audit } from "../services/audit.ts";

/**
 * Example CRUD router. Delete alongside packages/db/src/schema/notes.ts and
 * the Notes page once your project has real domain routers — it exists to
 * demonstrate the router pattern: zod inputs, role-gated procedures, and
 * audit logging on mutations.
 */
export const notesRouter = t.router({
  list: protectedProcedure.query(async () => {
    return db.select().from(notes).orderBy(desc(notes.createdAt));
  }),

  get: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const rows = await db.select().from(notes).where(eq(notes.id, input.id)).limit(1);
    return rows[0] ?? null;
  }),

  create: operatorProcedure
    .input(z.object({ title: z.string().min(1), body: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const [note] = await db
        .insert(notes)
        .values({ title: input.title, body: input.body ?? null, createdBy: ctx.user.id })
        .returning();
      await audit(ctx, "notes.create", {
        resourceType: "note",
        resourceId: String(note.id),
        newValue: note,
      });
      return note;
    }),

  update: operatorProcedure
    .input(z.object({ id: z.number(), title: z.string().min(1), body: z.string().nullable() }))
    .mutation(async ({ input, ctx }) => {
      const [old] = await db.select().from(notes).where(eq(notes.id, input.id)).limit(1);
      const [note] = await db
        .update(notes)
        .set({ title: input.title, body: input.body, updatedAt: new Date() })
        .where(eq(notes.id, input.id))
        .returning();
      await audit(ctx, "notes.update", {
        resourceType: "note",
        resourceId: String(input.id),
        oldValue: old,
        newValue: note,
      });
      return note;
    }),

  remove: operatorProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const [old] = await db.select().from(notes).where(eq(notes.id, input.id)).limit(1);
      await db.delete(notes).where(eq(notes.id, input.id));
      await audit(ctx, "notes.delete", {
        resourceType: "note",
        resourceId: String(input.id),
        oldValue: old,
      });
      return { success: true };
    }),
});
