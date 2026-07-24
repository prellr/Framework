import { z } from "zod";
import { eq } from "drizzle-orm";
import { t } from "../trpc/context.ts";
import { protectedProcedure } from "../trpc/middleware.ts";
import { db, jesterCredentials } from "@framework/db";
import { audit } from "../services/audit.ts";
import { seal, open } from "../services/crypto.ts";
import { verifyKey } from "../services/jester.ts";

const DEFAULT_BASE_URL = "https://app.jester.trade";

/**
 * Per-user Jester credential management. A user manages only their own credential
 * (keyed by ctx.user.id) — there is no cross-user access here. The API key is verified
 * against Jester, encrypted, and stored; it is never returned to the client.
 */
export const credentialsRouter = t.router({
  /** Non-secret status for the current user's credential. */
  status: protectedProcedure.query(async ({ ctx }) => {
    const [cred] = await db
      .select({
        baseUrl: jesterCredentials.baseUrl,
        accountId: jesterCredentials.accountId,
        hyperliquidReady: jesterCredentials.hyperliquidReady,
        lastVerifiedAt: jesterCredentials.lastVerifiedAt,
      })
      .from(jesterCredentials)
      .where(eq(jesterCredentials.userId, ctx.user.id))
      .limit(1);
    return {
      hasKey: !!cred,
      baseUrl: cred?.baseUrl ?? DEFAULT_BASE_URL,
      accountId: cred?.accountId ?? null,
      hyperliquidReady: cred?.hyperliquidReady ?? null,
      lastVerifiedAt: cred?.lastVerifiedAt ?? null,
    };
  }),

  /**
   * Store (or replace) the current user's Jester key. Verifies it against Jester's whoami
   * first — an invalid key is rejected before anything is persisted.
   */
  save: protectedProcedure
    .input(
      z.object({
        apiKey: z.string().min(10),
        baseUrl: z.string().url().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const baseUrl = input.baseUrl ?? DEFAULT_BASE_URL;

      // Verify BEFORE persisting — surfaces a bad key immediately, and confirms it's usable.
      const status = await verifyKey(baseUrl, input.apiKey);

      const sealed = await seal(input.apiKey);
      const now = new Date();
      await db
        .insert(jesterCredentials)
        .values({
          userId: ctx.user.id,
          baseUrl,
          encryptedKey: sealed.encryptedKey,
          keyNonce: sealed.keyNonce,
          encVersion: sealed.encVersion,
          accountId: status.accountId,
          hyperliquidReady: status.hyperliquidReady,
          lastVerifiedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: jesterCredentials.userId,
          set: {
            baseUrl,
            encryptedKey: sealed.encryptedKey,
            keyNonce: sealed.keyNonce,
            encVersion: sealed.encVersion,
            accountId: status.accountId,
            hyperliquidReady: status.hyperliquidReady,
            lastVerifiedAt: now,
            updatedAt: now,
          },
        });

      // Audit the fact of a credential change — never the key material.
      await audit(ctx, "credentials.save", {
        resourceType: "jester_credential",
        resourceId: ctx.user.id,
        newValue: { baseUrl, accountId: status.accountId, hyperliquidReady: status.hyperliquidReady },
      });

      return { hasKey: true, baseUrl, ...status, lastVerifiedAt: now };
    }),

  /** Re-verify the stored key against Jester and refresh derived status. */
  reverify: protectedProcedure.mutation(async ({ ctx }) => {
    const [cred] = await db
      .select()
      .from(jesterCredentials)
      .where(eq(jesterCredentials.userId, ctx.user.id))
      .limit(1);
    if (!cred) return { hasKey: false as const };
    const apiKey = await open({ encryptedKey: cred.encryptedKey, keyNonce: cred.keyNonce });
    const status = await verifyKey(cred.baseUrl, apiKey);
    const now = new Date();
    await db
      .update(jesterCredentials)
      .set({ ...status, lastVerifiedAt: now, updatedAt: now })
      .where(eq(jesterCredentials.userId, ctx.user.id));
    return { hasKey: true as const, baseUrl: cred.baseUrl, ...status, lastVerifiedAt: now };
  }),

  /** Delete the current user's credential. */
  remove: protectedProcedure.mutation(async ({ ctx }) => {
    await db.delete(jesterCredentials).where(eq(jesterCredentials.userId, ctx.user.id));
    await audit(ctx, "credentials.remove", {
      resourceType: "jester_credential",
      resourceId: ctx.user.id,
    });
    return { success: true };
  }),
});
