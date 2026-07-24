import { z } from "zod";
import { adminProcedure, protectedProcedure } from "../trpc/middleware.ts";
import { t } from "../trpc/context.ts";
import { db, users, appSettings } from "@framework/db";
import { eq } from "drizzle-orm";
import type { Role } from "@framework/db";
import { auth } from "../auth.ts";
import { getSetting, setSetting } from "../services/config.ts";
import { audit } from "../services/audit.ts";

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
  {
    id: "tesseract",
    name: "Tesseract Field logger",
    description:
      "Read-only research collection of the live Tesseract Field. enabled: master arm 'true'/'false'. pairs: broad 10m set (blank = default). focus_enabled/focus_pairs: the tighter 5m set (default BTC-USD) sampled at the strategy's resolution; broad set excludes these. interval_min: informational.",
    keys: ["tesseract_logger_enabled", "tesseract_logger_pairs", "tesseract_focus_enabled", "tesseract_focus_pairs", "tesseract_logger_interval_min"],
  },
  {
    id: "polymarket",
    name: "Polymarket Up/Down",
    description:
      "Read-only descriptive research. book_capture_enabled: master arm ('true'/'false') for the 3-min job that snapshots open BTC, ETH, SOL, XRP, DOGE, and BNB Up/Down books so scoring prices entries at the real ask instead of the mid. signal_gauge_logger_enabled: master arm for the 5-min Trade-composite-gauge logger (tournament bot #2; one scan call/tick). signal_gauge_pairs: blank = default coin set. Light; no orders anywhere in this system.",
    keys: ["polymarket_book_capture_enabled", "signal_gauge_logger_enabled", "signal_gauge_pairs", "paper_floor_enabled", "v1_signal_logger_enabled", "v1_signal_pairs"],
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
    timezone: (ctx.user as { timezone?: string | null }).timezone ?? null,
  })),

  /**
   * Set the caller's display timezone (IANA name). Calendar-day bucketing happens server-side in
   * UTC, so this is what makes per-day views line up with the user's actual days.
   */
  setTimezone: protectedProcedure
    .input(z.object({ timezone: z.string().min(1).max(64) }))
    .mutation(async ({ input, ctx }) => {
      // Validate against the runtime's tz database rather than a hardcoded list.
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: input.timezone });
      } catch {
        throw new Error(`Unknown timezone "${input.timezone}"`);
      }
      await db.update(users).set({ timezone: input.timezone, updatedAt: new Date() }).where(eq(users.id, ctx.user.id));
      await audit(ctx, "admin.setTimezone", { resourceType: "user", resourceId: ctx.user.id, newValue: { timezone: input.timezone } });
      return { timezone: input.timezone };
    }),

  /**
   * Runtime settings (admin only). SECRETS ARE NEVER SENT IN PLAINTEXT: for credential-style keys we
   * return only whether one is set plus a masked tail, so the value can be identified but not read,
   * copied, or captured in a screenshot/screen-share. Writing still works — the form submits only the
   * keys an admin actually edits, so an empty (masked) field never clobbers a stored secret.
   */
  settings: adminProcedure.query(async () => {
    const isSecret = (name: string) => /KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/i.test(name);
    const groups = await Promise.all(
      SETTING_GROUPS.map(async (group) => ({
        ...group,
        vars: await Promise.all(
          group.keys.map(async (name) => {
            const value = await getSetting(name);
            const secret = isSecret(name);
            return {
              name,
              set: !!value,
              secret,
              // Enough to tell WHICH key is installed, not enough to use it.
              preview: value && secret ? `••••••••${value.slice(-4)}` : null,
              value: secret ? null : (value ?? null),
            };
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
          // MUST go through setSetting — it seals credential-style keys before they hit the DB.
          // Writing to appSettings directly here previously stored API keys in plaintext.
          await setSetting(key, value);
          await db.update(appSettings).set({ updatedBy: ctx.user.id }).where(eq(appSettings.key, key));
        }
      }
      // Reset service singletons that cache credentials here, e.g.:
      // resetSomeApiClient();
      return { success: true };
    }),
});
