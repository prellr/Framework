import { z } from "zod";
import { adminProcedure, protectedProcedure } from "../trpc/middleware.ts";
import { t } from "../trpc/context.ts";
import { db, users, appSettings } from "@framework/db";
import { eq } from "drizzle-orm";
import type { Role } from "@framework/db";
import { auth } from "../auth.ts";
import { getSetting } from "../services/config.ts";

const roleEnum = z.enum(["admin", "manager", "operator", "viewer"]);

/**
 * Settings surfaced in Admin → Settings. Add an entry per integration your
 * project uses; values are stored in app_settings and read via getSetting().
 */
const SETTING_GROUPS: { id: string; name: string; description: string; keys: string[] }[] = [
  {
    id: "agent",
    name: "Agent / MCP access",
    description: "API key for agent access via the X-API-Key header",
    keys: ["AGENT_API_KEY"],
  },
];

export const adminRouter = t.router({
  // List all users (admin only)
  listUsers: adminProcedure.query(async () => {
    return db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        banned: users.banned,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(users.createdAt);
  }),

  // Create a new user (admin only)
  createUser: adminProcedure
    .input(
      z.object({
        name: z.string().min(1),
        email: z.string().email(),
        password: z.string().min(8),
        role: roleEnum.default("viewer"),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Better Auth createUser only accepts "admin"|"user" for its own role field.
      // Create with no role, then set our custom role directly in the DB.
      const result = await auth.api.createUser({
        body: {
          name: input.name,
          email: input.email,
          password: input.password,
        },
        headers: ctx.req.headers,
      });
      if (result?.user?.id) {
        await db
          .update(users)
          .set({ role: input.role as Role, updatedAt: new Date() })
          .where(eq(users.id, result.user.id));
      }
      return result;
    }),

  // Update a user's role (admin only)
  setUserRole: adminProcedure
    .input(
      z.object({
        userId: z.string(),
        role: roleEnum,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (input.userId === ctx.user.id) {
        throw new Error("Cannot change your own role");
      }
      await db
        .update(users)
        .set({ role: input.role as Role, updatedAt: new Date() })
        .where(eq(users.id, input.userId));
      return { success: true };
    }),

  // Reset a user's password (admin only)
  resetUserPassword: adminProcedure
    .input(z.object({ userId: z.string(), newPassword: z.string().min(8) }))
    .mutation(async ({ input, ctx }) => {
      await auth.api.setUserPassword({
        body: { userId: input.userId, newPassword: input.newPassword },
        headers: ctx.req.headers,
      });
      return { success: true };
    }),

  // Remove a user (admin only)
  removeUser: adminProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      if (input.userId === ctx.user.id) {
        throw new Error("Cannot delete your own account");
      }
      await auth.api.removeUser({
        body: { userId: input.userId },
        headers: ctx.req.headers,
      });
      return { success: true };
    }),

  // Get current user's own profile (all authenticated users)
  me: protectedProcedure.query(({ ctx }) => ({
    id: ctx.user.id,
    name: ctx.user.name,
    email: ctx.user.email,
    role: (ctx.user as { role?: Role }).role ?? "viewer",
  })),

  // Runtime settings — grouped env-var-style keys with current values (admin only)
  settings: adminProcedure.query(async () => {
    const groups = await Promise.all(
      SETTING_GROUPS.map(async (group) => ({
        ...group,
        vars: await Promise.all(
          group.keys.map(async (name) => {
            const value = await getSetting(name);
            return { name, set: !!value, value: value ?? null };
          }),
        ),
      })),
    );
    return { groups };
  }),

  // Save settings (admin only)
  // Upserts keys into app_settings; empty string = delete the override (fall back to env).
  updateSettings: adminProcedure
    .input(z.object({ settings: z.record(z.string(), z.string().nullable()) }))
    .mutation(async ({ input, ctx }) => {
      for (const [key, value] of Object.entries(input.settings)) {
        if (value === null || value === "") {
          await db.delete(appSettings).where(eq(appSettings.key, key));
        } else {
          await db
            .insert(appSettings)
            .values({ key, value, updatedAt: new Date(), updatedBy: ctx.user.id })
            .onConflictDoUpdate({
              target: appSettings.key,
              set: { value, updatedAt: new Date(), updatedBy: ctx.user.id },
            });
        }
      }
      // Reset service singletons that cache credentials here, e.g.:
      // resetSomeApiClient();
      return { success: true };
    }),
});
