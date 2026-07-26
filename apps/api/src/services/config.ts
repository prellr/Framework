/**
 * Runtime configuration helper.
 *
 * getSetting(key) resolves a setting in priority order:
 *   1. app_settings table in the database (set by admins at runtime)
 *   2. process.env (set at deploy time via .env / docker-compose)
 *   3. undefined
 *
 * This allows admins to update API keys, passwords, etc. without restarting
 * or SSH-ing into the server. Services that cache clients built from these
 * values should expose a reset function and register it in
 * routers/admin.ts updateSettings.
 */

import { db, appSettings } from "@framework/db";
import { eq } from "drizzle-orm";
import { isSealed, openFromString, sealToString } from "./crypto.ts";

/**
 * Credential-style settings are ENCRYPTED AT REST in app_settings (AES-256-GCM). JESTER_MASTER_KEY
 * is excluded by definition — it's the key that protects the others, so it lives in the environment
 * only and must never be written to the table it secures.
 */
const SECRET_RE = /KEY|SECRET|TOKEN|PASSWORD|PASSPHRASE|CREDENTIAL|RPC_URL/i;
const PUBLIC_IDENTIFIER_RE = /(?:ADDRESS|PUBLIC_KEY)$/i;
export const isSecretSetting = (key: string) =>
  key !== "JESTER_MASTER_KEY" && !PUBLIC_IDENTIFIER_RE.test(key) && SECRET_RE.test(key);

export async function getSetting(key: string): Promise<string | undefined> {
  try {
    const rows = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, key))
      .limit(1);
    const raw = rows[0]?.value;
    // Legacy plaintext rows still resolve, so this is backward compatible until they're re-sealed.
    if (raw) return isSealed(raw) ? await openFromString(raw) : raw;
  } catch {
    // DB unavailable during startup or migration — fall through to env
  }
  return process.env[key] ?? undefined;
}

/**
 * Persist a setting to the app_settings table. Used for runtime state such as
 * sync cursors that jobs read and write between runs.
 */
export async function setSetting(key: string, value: string): Promise<void> {
  // Secrets are sealed before they ever touch the database.
  const stored = isSecretSetting(key) ? await sealToString(value) : value;
  await db
    .insert(appSettings)
    .values({ key, value: stored })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: stored, updatedAt: new Date() },
    });
}
