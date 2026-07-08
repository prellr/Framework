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

export async function getSetting(key: string): Promise<string | undefined> {
  try {
    const rows = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, key))
      .limit(1);
    if (rows[0]?.value) return rows[0].value;
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
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });
}
