import { z } from "zod";
import { adminProcedure, protectedProcedure } from "../trpc/middleware.ts";
import { t } from "../trpc/context.ts";
import { db, users, appSettings, loginEvents } from "@framework/db";
import { count, desc, eq } from "drizzle-orm";
import type { Role } from "@framework/db";
import { auth } from "../auth.ts";
import { getSetting, isSecretSetting, setSetting } from "../services/config.ts";
import { audit } from "../services/audit.ts";
import {
  getSectionAccess,
  saveSectionAccess,
  sectionAccessView,
} from "../services/section-access.ts";

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
    keys: [
      "tesseract_logger_enabled",
      "tesseract_logger_pairs",
      "tesseract_focus_enabled",
      "tesseract_focus_pairs",
      "tesseract_logger_interval_min",
    ],
  },
  {
    id: "polymarket",
    name: "Polymarket system connector",
    description:
      "Admin-owned market-data collection, Builder identity, shared infrastructure, and platform-wide risk ceilings. User wallets and signer credentials are stored separately per user. The live arm remains inert because no order route exists.",
    keys: [
      "polymarket_book_capture_enabled",
      "signal_gauge_logger_enabled",
      "signal_gauge_pairs",
      "paper_floor_enabled",
      "v1_signal_logger_enabled",
      "v1_signal_pairs",
      "POLYMARKET_BUILDER_ADDRESS",
      "POLYMARKET_BUILDER_CODE",
      "POLYMARKET_BUILDER_API_KEY",
      "POLYMARKET_BUILDER_API_SECRET",
      "POLYMARKET_BUILDER_API_PASSPHRASE",
      "POLYGON_RPC_URL",
      "POLYMARKET_MAX_ORDER_USD",
      "POLYMARKET_MAX_OPEN_EXPOSURE_USD",
      "POLYMARKET_DAILY_LOSS_LIMIT_USD",
      "POLYMARKET_MAX_BOOK_AGE_MS",
      "POLYMARKET_LIVE_EXECUTION_ENABLED",
    ],
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

  // Durable successful-login history (admin only). Session tokens are never exposed.
  loginHistory: adminProcedure
    .input(
      z.object({
        userId: z.string().optional(),
        limit: z.number().int().min(1).max(250).default(100),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ input }) => {
      const where = input.userId ? eq(loginEvents.userId, input.userId) : undefined;
      const [events, totals] = await Promise.all([
        db
          .select({
            id: loginEvents.id,
            userId: loginEvents.userId,
            userName: loginEvents.userName,
            userEmail: loginEvents.userEmail,
            authMethod: loginEvents.authMethod,
            ipAddress: loginEvents.ipAddress,
            userAgent: loginEvents.userAgent,
            createdAt: loginEvents.createdAt,
          })
          .from(loginEvents)
          .where(where)
          .orderBy(desc(loginEvents.createdAt), desc(loginEvents.id))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ value: count() }).from(loginEvents).where(where),
      ]);
      return {
        events,
        total: totals[0]?.value ?? 0,
        limit: input.limit,
        offset: input.offset,
      };
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

  // Role-to-section visibility contract for every authenticated user. This contains no secrets.
  // Route visibility is separate from action authorization: privileged mutations retain their
  // fixed operator/manager/admin middleware even when a section is visible.
  sectionAccess: protectedProcedure.query(async () =>
    sectionAccessView(await getSectionAccess()),
  ),

  // Admin-managed page visibility by role. Hard floors are normalized server-side so Sub35 can
  // never be exposed below manager and Sweeps can never be exposed below operator.
  updateSectionAccess: adminProcedure
    .input(z.object({ access: z.record(z.string(), roleEnum) }))
    .mutation(async ({ input, ctx }) => {
      const previous = await getSectionAccess();
      const next = await saveSectionAccess(input.access);
      await audit(ctx, "admin.updateSectionAccess", {
        resourceType: "section_access",
        resourceId: "role_matrix",
        oldValue: previous,
        newValue: next,
      });
      return sectionAccessView(next);
    }),

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
      await db
        .update(users)
        .set({ timezone: input.timezone, updatedAt: new Date() })
        .where(eq(users.id, ctx.user.id));
      await audit(ctx, "admin.setTimezone", {
        resourceType: "user",
        resourceId: ctx.user.id,
        newValue: { timezone: input.timezone },
      });
      return { timezone: input.timezone };
    }),

  /**
   * Runtime settings (admin only). SECRETS ARE NEVER SENT IN PLAINTEXT: for credential-style keys we
   * return only whether one is set plus a masked tail, so the value can be identified but not read,
   * copied, or captured in a screenshot/screen-share. Writing still works — the form submits only the
   * keys an admin actually edits, so an empty (masked) field never clobbers a stored secret.
   */
  settings: adminProcedure.query(async () => {
    const groups = await Promise.all(
      SETTING_GROUPS.map(async (group) => ({
        ...group,
        vars: await Promise.all(
          group.keys.map(async (name) => {
            const value = await getSetting(name);
            const secret = isSecretSetting(name);
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
          await db
            .update(appSettings)
            .set({ updatedBy: ctx.user.id })
            .where(eq(appSettings.key, key));
        }
      }
      // Reset service singletons that cache credentials here, e.g.:
      const { resetPolymarketConnectorReadinessCache } =
        await import("../services/polymarket-connector-readiness.ts");
      resetPolymarketConnectorReadinessCache();
      return { success: true };
    }),
});
