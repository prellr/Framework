import { TRPCError } from "@trpc/server";
import { t } from "./context.ts";
import type { Role } from "@framework/db";

const ROLE_RANK: Record<Role, number> = {
  viewer: 0,
  operator: 1,
  manager: 2,
  admin: 3,
};

// Requires a valid session
export const authedMiddleware = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "You must be logged in" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

// Requires a minimum role level
export const requireRole = (minRole: Role) =>
  authedMiddleware.unstable_pipe(({ ctx, next }) => {
    const userRole = (ctx.user.role as Role) ?? "viewer";
    if (ROLE_RANK[userRole] < ROLE_RANK[minRole]) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Requires ${minRole} role or higher`,
      });
    }
    return next({ ctx });
  });

export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(authedMiddleware);
export const operatorProcedure = t.procedure.use(requireRole("operator"));
export const managerProcedure = t.procedure.use(requireRole("manager"));
export const adminProcedure = t.procedure.use(requireRole("admin"));
