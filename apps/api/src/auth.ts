import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { db, users, sessions, accounts, verifications } from "@framework/db";
import { recordSuccessfulLogin } from "./services/login-history.ts";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
    },
  }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
  basePath: "/api/auth",
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    // Wire this to your notification channel (email, Telegram, chat webhook).
    // Until then the reset link only appears in the API log.
    sendResetPassword: async ({
      user,
      url,
    }: {
      user: { name: string; email: string };
      url: string;
    }) => {
      console.log(`[auth] Password reset for ${user.name} (${user.email}): ${url}`);
    },
  },
  // Trust the canonical URL plus any extra origins (comma-separated TRUSTED_ORIGINS) —
  // e.g. the public domain AND the LAN IP, so the app works both ways.
  trustedOrigins: [
    "http://localhost:5173",
    "http://localhost:5174",
    process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
    ...(process.env.TRUSTED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? []),
  ],
  databaseHooks: {
    session: {
      create: {
        after: async (session, context) => {
          await recordSuccessfulLogin({
            session: {
              id: session.id,
              userId: session.userId,
              ipAddress: session.ipAddress,
              userAgent: session.userAgent,
              impersonatedBy:
                typeof session.impersonatedBy === "string"
                  ? session.impersonatedBy
                  : null,
            },
            authPath: context?.path ?? null,
          });
        },
      },
    },
  },
  plugins: [
    admin({
      defaultRole: "viewer",
      adminRole: "admin",
    }),
  ],
});
