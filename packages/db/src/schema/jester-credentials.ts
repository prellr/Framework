import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.ts";

/**
 * Per-user Jester API credentials.
 *
 * The key is encrypted at rest (AES-256-GCM; see services/crypto.ts) — never stored
 * or returned in plaintext. `accountId` / `hyperliquidReady` are derived facts cached
 * from a whoami verification so the UI can show status without decrypting the key.
 *
 * The key is a trading-capable credential on Jester's side; this system only ever uses
 * it for analysis calls (enforced by services/jester-allowlist.ts), but it is still
 * treated as a secret: encrypted, audited, and never sent to the frontend.
 */
export const jesterCredentials = pgTable("jester_credential", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  baseUrl: text("base_url").notNull().default("https://app.jester.trade"),

  // AES-256-GCM. `encVersion` lets us rotate the master key without re-encrypting eagerly.
  encryptedKey: text("encrypted_key").notNull(), // base64(ciphertext || authTag)
  keyNonce: text("key_nonce").notNull(), // base64(iv)
  encVersion: integer("enc_version").notNull().default(1),

  // Derived from whoami — safe to show, never secret.
  accountId: text("account_id"), // Jester telegramId
  hyperliquidReady: boolean("hyperliquid_ready"),
  lastVerifiedAt: timestamp("last_verified_at"),

  // Hyperliquid wallet address (public, not secret). Jester masks it, so the user provides it;
  // used to pull portfolio history from Hyperliquid's public info API (read-only).
  hlWallet: text("hl_wallet"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
