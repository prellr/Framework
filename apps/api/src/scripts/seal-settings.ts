/**
 * One-time migration: encrypt any credential-style settings still stored as plaintext.
 * Idempotent — already-sealed rows are skipped. Never prints secret values.
 *
 *   docker compose exec -T api npx tsx src/scripts/seal-settings.ts
 */
import { db, appSettings } from "@framework/db";
import { eq } from "drizzle-orm";
import { isSecretSetting } from "../services/config.ts";
import { isSealed, sealToString, openFromString } from "../services/crypto.ts";

async function main() {
  const rows = await db.select().from(appSettings);
  let sealedCount = 0;
  let skipped = 0;

  for (const r of rows) {
    if (!r.value) continue;
    if (!isSecretSetting(r.key)) {
      console.log(`- ${r.key}: not a secret, left as-is`);
      skipped++;
      continue;
    }
    if (isSealed(r.value)) {
      console.log(`- ${r.key}: already sealed`);
      skipped++;
      continue;
    }
    const stored = await sealToString(r.value);
    // Verify the round-trip BEFORE committing, so a bad master key can't destroy the value.
    const check = await openFromString(stored);
    if (check !== r.value) throw new Error(`${r.key}: round-trip verification failed, aborting`);
    await db.update(appSettings).set({ value: stored, updatedAt: new Date() }).where(eq(appSettings.key, r.key));
    console.log(`✓ ${r.key}: sealed (${r.value.length} chars -> encrypted envelope)`);
    sealedCount++;
  }

  console.log(`\nDone. sealed=${sealedCount} skipped=${skipped}`);
  process.exit(0);
}
main().catch((e) => {
  console.error("seal-settings failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
