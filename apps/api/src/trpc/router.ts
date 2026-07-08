import type { inferRouterOutputs } from "@trpc/server";
import { t } from "./context.ts";
import { adminRouter } from "../routers/admin.ts";
import { notesRouter } from "../routers/notes.ts";
import { publicProcedure } from "./middleware.ts";

export const appRouter = t.router({
  health: publicProcedure.query(() => ({ status: "ok", timestamp: new Date().toISOString() })),
  admin: adminRouter,
  notes: notesRouter,
});

export type AppRouter = typeof appRouter;

/** Inferred output types for all tRPC procedures — import in the web package */
export type RouterOutput = inferRouterOutputs<AppRouter>;
