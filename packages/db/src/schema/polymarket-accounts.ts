import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./users.ts";

export type PolymarketWalletType = "proxy" | "safe" | "eoa" | "deposit";
export type PolymarketConnectionMode = "existing" | "builder-managed";
export type PolymarketAccountStatus = "unverified" | "verified" | "error";

/**
 * Per-user Polymarket accounts.
 *
 * One user may connect several independently funded wallets. Signer and Relayer
 * credentials are AES-256-GCM sealed by the API before they reach Postgres and
 * are never selected into a browser response. Builder credentials intentionally
 * do not live here: those belong to the admin-owned system connector.
 */
export const polymarketAccounts = pgTable(
  "polymarket_account",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    connectionMode: text("connection_mode")
      .$type<PolymarketConnectionMode>()
      .notNull()
      .default("existing"),
    walletType: text("wallet_type").$type<PolymarketWalletType>().notNull().default("deposit"),
    walletAddress: text("wallet_address").notNull(),
    signerAddress: text("signer_address").notNull(),

    encryptedSignerKey: text("encrypted_signer_key").notNull(),
    signerKeyNonce: text("signer_key_nonce").notNull(),
    encryptedRelayerApiKey: text("encrypted_relayer_api_key").notNull(),
    relayerApiKeyNonce: text("relayer_api_key_nonce").notNull(),
    encVersion: integer("enc_version").notNull().default(1),

    isDefault: boolean("is_default").notNull().default(false),
    maxOrderCents: integer("max_order_cents").notNull().default(500),
    maxOpenExposureCents: integer("max_open_exposure_cents").notNull().default(2500),
    dailyLossLimitCents: integer("daily_loss_limit_cents").notNull().default(2000),
    maxBookAgeMs: integer("max_book_age_ms").notNull().default(2000),

    status: text("status").$type<PolymarketAccountStatus>().notNull().default("unverified"),
    lastVerifiedAt: timestamp("last_verified_at"),
    lastVerificationError: text("last_verification_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("polymarket_account_user_idx").on(table.userId),
    uniqueIndex("polymarket_account_user_wallet_uidx").on(table.userId, table.walletAddress),
  ],
);
