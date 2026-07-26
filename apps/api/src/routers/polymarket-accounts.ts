import { randomUUID } from "crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db, polymarketAccounts } from "@framework/db";
import { t } from "../trpc/context.ts";
import { humanProcedure } from "../trpc/middleware.ts";
import { audit } from "../services/audit.ts";
import { open, seal } from "../services/crypto.ts";
import { getSetting } from "../services/config.ts";
import {
  publicPolymarketVerificationError,
  verifyPolymarketAccount,
} from "../services/polymarket-account-verification.ts";

const evmAddress = z
  .string()
  .trim()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Enter a complete 0x wallet address.");
const signerPrivateKey = z
  .string()
  .trim()
  .regex(/^0x[0-9a-fA-F]{64}$/, "Enter a complete 0x signer private key.");
const walletType = z.enum(["deposit", "proxy", "safe", "eoa"]);
const riskInput = z.object({
  maxOrderUsd: z.number().positive().max(1_000_000),
  maxOpenExposureUsd: z.number().positive().max(10_000_000),
  dailyLossLimitUsd: z.number().positive().max(10_000_000),
  maxBookAgeMs: z.number().int().min(100).max(300_000),
});

const accountCreateInput = riskInput.extend({
  label: z.string().trim().min(1).max(80),
  walletType,
  walletAddress: evmAddress,
  signerAddress: evmAddress,
  signerPrivateKey,
  relayerApiKey: z.string().trim().min(8).max(500),
  isDefault: z.boolean().default(false),
});

const accountUpdateInput = riskInput.partial().extend({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(80).optional(),
  walletType: walletType.optional(),
  walletAddress: evmAddress.optional(),
  signerAddress: evmAddress.optional(),
  signerPrivateKey: signerPrivateKey.optional(),
  relayerApiKey: z.string().trim().min(8).max(500).optional(),
  isDefault: z.boolean().optional(),
});

const SYSTEM_RISK_KEYS = {
  maxOrderUsd: "POLYMARKET_MAX_ORDER_USD",
  maxOpenExposureUsd: "POLYMARKET_MAX_OPEN_EXPOSURE_USD",
  dailyLossLimitUsd: "POLYMARKET_DAILY_LOSS_LIMIT_USD",
  maxBookAgeMs: "POLYMARKET_MAX_BOOK_AGE_MS",
} as const;

function cents(usd: number) {
  return Math.round(usd * 100);
}

function dollars(value: number) {
  return value / 100;
}

function maskAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

async function enforceSystemCeilings(input: z.infer<typeof riskInput>) {
  const configured = await Promise.all(
    Object.values(SYSTEM_RISK_KEYS).map(async (key) => {
      const raw = await getSetting(key);
      const value = raw == null ? null : Number(raw);
      return Number.isFinite(value) && value! > 0 ? value : null;
    }),
  );
  const [maxOrder, maxExposure, dailyLoss, maxBookAge] = configured;
  if (configured.some((value) => value == null)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "An administrator must configure all four system-wide Polymarket risk ceilings before accounts can be added or changed.",
    });
  }
  const violations = [
    input.maxOrderUsd > maxOrder!
      ? `Maximum order must be at or below the system ceiling of $${maxOrder}.`
      : null,
    input.maxOpenExposureUsd > maxExposure!
      ? `Open exposure must be at or below the system ceiling of $${maxExposure}.`
      : null,
    input.dailyLossLimitUsd > dailyLoss!
      ? `Daily loss stop must be at or below the system ceiling of $${dailyLoss}.`
      : null,
    input.maxBookAgeMs > maxBookAge!
      ? `Quote age must be at or below the system ceiling of ${maxBookAge} ms.`
      : null,
  ].filter(Boolean);
  if (input.maxOpenExposureUsd < input.maxOrderUsd) {
    violations.push("Open exposure cannot be lower than the maximum single order.");
  }
  if (violations.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: violations.join(" ") });
  }
}

function publicAccount(row: typeof polymarketAccounts.$inferSelect) {
  return {
    id: row.id,
    label: row.label,
    connectionMode: row.connectionMode,
    walletType: row.walletType,
    walletAddress: row.walletAddress,
    walletMasked: maskAddress(row.walletAddress),
    signerAddress: row.signerAddress,
    signerMasked: maskAddress(row.signerAddress),
    signerConfigured: Boolean(row.encryptedSignerKey),
    relayerApiKeyConfigured: Boolean(row.encryptedRelayerApiKey),
    isDefault: row.isDefault,
    maxOrderUsd: dollars(row.maxOrderCents),
    maxOpenExposureUsd: dollars(row.maxOpenExposureCents),
    dailyLossLimitUsd: dollars(row.dailyLossLimitCents),
    maxBookAgeMs: row.maxBookAgeMs,
    status: row.status,
    lastVerifiedAt: row.lastVerifiedAt,
    lastVerificationError: row.lastVerificationError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function accountForUser(id: string, userId: string) {
  const [account] = await db
    .select()
    .from(polymarketAccounts)
    .where(and(eq(polymarketAccounts.id, id), eq(polymarketAccounts.userId, userId)))
    .limit(1);
  if (!account) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Polymarket account not found." });
  }
  return account;
}

export const polymarketAccountsRouter = t.router({
  list: humanProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select()
      .from(polymarketAccounts)
      .where(eq(polymarketAccounts.userId, ctx.user.id))
      .orderBy(asc(polymarketAccounts.createdAt), asc(polymarketAccounts.id));
    return {
      accounts: rows.map(publicAccount),
      executionAvailable: false,
      verificationAvailable: true,
      builderManagedProvisioningAvailable: false,
    };
  }),

  create: humanProcedure.input(accountCreateInput).mutation(async ({ input, ctx }) => {
    await enforceSystemCeilings(input);
    const [signer, relayer] = await Promise.all([
      seal(input.signerPrivateKey),
      seal(input.relayerApiKey),
    ]);
    const id = randomUUID();
    const now = new Date();

    try {
      await db.transaction(async (tx) => {
        const existing = await tx
          .select({ id: polymarketAccounts.id })
          .from(polymarketAccounts)
          .where(eq(polymarketAccounts.userId, ctx.user.id))
          .limit(1);
        const makeDefault = input.isDefault || existing.length === 0;
        if (makeDefault) {
          await tx
            .update(polymarketAccounts)
            .set({ isDefault: false, updatedAt: now })
            .where(eq(polymarketAccounts.userId, ctx.user.id));
        }
        await tx.insert(polymarketAccounts).values({
          id,
          userId: ctx.user.id,
          label: input.label,
          connectionMode: "existing",
          walletType: input.walletType,
          walletAddress: input.walletAddress.toLowerCase(),
          signerAddress: input.signerAddress.toLowerCase(),
          encryptedSignerKey: signer.encryptedKey,
          signerKeyNonce: signer.keyNonce,
          encryptedRelayerApiKey: relayer.encryptedKey,
          relayerApiKeyNonce: relayer.keyNonce,
          encVersion: Math.max(signer.encVersion, relayer.encVersion),
          isDefault: makeDefault,
          maxOrderCents: cents(input.maxOrderUsd),
          maxOpenExposureCents: cents(input.maxOpenExposureUsd),
          dailyLossLimitCents: cents(input.dailyLossLimitUsd),
          maxBookAgeMs: input.maxBookAgeMs,
          status: "unverified",
          createdAt: now,
          updatedAt: now,
        });
      });
    } catch (error) {
      if (error instanceof Error && /unique|duplicate/i.test(error.message)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "That wallet is already connected to your account.",
        });
      }
      throw error;
    }

    await audit(ctx, "polymarketAccounts.create", {
      resourceType: "polymarket_account",
      resourceId: id,
      newValue: {
        label: input.label,
        walletType: input.walletType,
        walletAddress: maskAddress(input.walletAddress),
        isDefault: input.isDefault,
      },
    });
    return { id };
  }),

  update: humanProcedure.input(accountUpdateInput).mutation(async ({ input, ctx }) => {
    const current = await accountForUser(input.id, ctx.user.id);
    if (current.isDefault && input.isDefault === false) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Choose another default account before unsetting this one.",
      });
    }
    const nextRisk = {
      maxOrderUsd: input.maxOrderUsd ?? dollars(current.maxOrderCents),
      maxOpenExposureUsd: input.maxOpenExposureUsd ?? dollars(current.maxOpenExposureCents),
      dailyLossLimitUsd: input.dailyLossLimitUsd ?? dollars(current.dailyLossLimitCents),
      maxBookAgeMs: input.maxBookAgeMs ?? current.maxBookAgeMs,
    };
    await enforceSystemCeilings(nextRisk);
    const [signer, relayer] = await Promise.all([
      input.signerPrivateKey ? seal(input.signerPrivateKey) : null,
      input.relayerApiKey ? seal(input.relayerApiKey) : null,
    ]);
    const now = new Date();

    await db.transaction(async (tx) => {
      if (input.isDefault) {
        await tx
          .update(polymarketAccounts)
          .set({ isDefault: false, updatedAt: now })
          .where(
            and(eq(polymarketAccounts.userId, ctx.user.id), ne(polymarketAccounts.id, input.id)),
          );
      }
      await tx
        .update(polymarketAccounts)
        .set({
          label: input.label ?? current.label,
          walletType: input.walletType ?? current.walletType,
          walletAddress: input.walletAddress?.toLowerCase() ?? current.walletAddress,
          signerAddress: input.signerAddress?.toLowerCase() ?? current.signerAddress,
          encryptedSignerKey: signer?.encryptedKey ?? current.encryptedSignerKey,
          signerKeyNonce: signer?.keyNonce ?? current.signerKeyNonce,
          encryptedRelayerApiKey: relayer?.encryptedKey ?? current.encryptedRelayerApiKey,
          relayerApiKeyNonce: relayer?.keyNonce ?? current.relayerApiKeyNonce,
          encVersion:
            Math.max(signer?.encVersion ?? 0, relayer?.encVersion ?? 0) || current.encVersion,
          isDefault: input.isDefault ?? current.isDefault,
          maxOrderCents: cents(nextRisk.maxOrderUsd),
          maxOpenExposureCents: cents(nextRisk.maxOpenExposureUsd),
          dailyLossLimitCents: cents(nextRisk.dailyLossLimitUsd),
          maxBookAgeMs: nextRisk.maxBookAgeMs,
          status: "unverified",
          lastVerifiedAt: null,
          lastVerificationError: null,
          updatedAt: now,
        })
        .where(
          and(eq(polymarketAccounts.id, input.id), eq(polymarketAccounts.userId, ctx.user.id)),
        );
    });

    await audit(ctx, "polymarketAccounts.update", {
      resourceType: "polymarket_account",
      resourceId: input.id,
      newValue: {
        label: input.label,
        walletType: input.walletType,
        walletAddress: input.walletAddress ? maskAddress(input.walletAddress) : undefined,
        credentialsReplaced: Boolean(input.signerPrivateKey || input.relayerApiKey),
        isDefault: input.isDefault,
      },
    });
    return { success: true };
  }),

  verify: humanProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const current = await accountForUser(input.id, ctx.user.id);

      try {
        const [signerPrivateKeyValue, relayerApiKeyValue] = await Promise.all([
          open({
            encryptedKey: current.encryptedSignerKey,
            keyNonce: current.signerKeyNonce,
          }),
          open({
            encryptedKey: current.encryptedRelayerApiKey,
            keyNonce: current.relayerApiKeyNonce,
          }),
        ]);
        const checks = await verifyPolymarketAccount({
          walletType: current.walletType,
          walletAddress: current.walletAddress,
          signerAddress: current.signerAddress,
          signerPrivateKey: signerPrivateKeyValue,
          relayerApiKey: relayerApiKeyValue,
        });
        const verifiedAt = new Date();
        await db
          .update(polymarketAccounts)
          .set({
            status: "verified",
            lastVerifiedAt: verifiedAt,
            lastVerificationError: null,
            updatedAt: verifiedAt,
          })
          .where(
            and(eq(polymarketAccounts.id, input.id), eq(polymarketAccounts.userId, ctx.user.id)),
          );
        await audit(ctx, "polymarketAccounts.verify", {
          resourceType: "polymarket_account",
          resourceId: input.id,
          newValue: {
            status: "verified",
            signerMatches: checks.signerMatches,
            walletMatches: checks.walletMatches,
            walletTypeMatches: checks.walletTypeMatches,
            clobAuthentication: checks.clobAuthentication,
            relayerAuthentication: checks.relayerAuthentication,
            walletDeployed: checks.walletDeployed,
          },
        });
        return { verifiedAt, checks };
      } catch (error) {
        const publicMessage = publicPolymarketVerificationError(error);
        const failedAt = new Date();
        await db
          .update(polymarketAccounts)
          .set({
            status: "error",
            lastVerifiedAt: null,
            lastVerificationError: publicMessage,
            updatedAt: failedAt,
          })
          .where(
            and(eq(polymarketAccounts.id, input.id), eq(polymarketAccounts.userId, ctx.user.id)),
          );
        await audit(ctx, "polymarketAccounts.verifyFailed", {
          resourceType: "polymarket_account",
          resourceId: input.id,
          newValue: {
            status: "error",
            failureClass: error instanceof Error ? error.name : "UnknownError",
          },
        });
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: publicMessage,
          cause: error,
        });
      }
    }),

  setDefault: humanProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await accountForUser(input.id, ctx.user.id);
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(polymarketAccounts)
          .set({ isDefault: false, updatedAt: now })
          .where(eq(polymarketAccounts.userId, ctx.user.id));
        await tx
          .update(polymarketAccounts)
          .set({ isDefault: true, updatedAt: now })
          .where(
            and(eq(polymarketAccounts.id, input.id), eq(polymarketAccounts.userId, ctx.user.id)),
          );
      });
      await audit(ctx, "polymarketAccounts.setDefault", {
        resourceType: "polymarket_account",
        resourceId: input.id,
      });
      return { success: true };
    }),

  remove: humanProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const current = await accountForUser(input.id, ctx.user.id);
      await db.transaction(async (tx) => {
        await tx
          .delete(polymarketAccounts)
          .where(
            and(eq(polymarketAccounts.id, input.id), eq(polymarketAccounts.userId, ctx.user.id)),
          );
        if (current.isDefault) {
          const [replacement] = await tx
            .select({ id: polymarketAccounts.id })
            .from(polymarketAccounts)
            .where(eq(polymarketAccounts.userId, ctx.user.id))
            .orderBy(asc(polymarketAccounts.createdAt), asc(polymarketAccounts.id))
            .limit(1);
          if (replacement) {
            await tx
              .update(polymarketAccounts)
              .set({ isDefault: true, updatedAt: new Date() })
              .where(eq(polymarketAccounts.id, replacement.id));
          }
        }
      });
      await audit(ctx, "polymarketAccounts.remove", {
        resourceType: "polymarket_account",
        resourceId: input.id,
      });
      return { success: true };
    }),
});
