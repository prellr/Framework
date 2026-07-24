import type { Job } from "bullmq";
import { db, jesterCredentials } from "@framework/db";
import { labelTesseractOutcomes, loggerEnabled, snapshotTesseract } from "../../services/tesseract-logger.ts";

/**
 * Tesseract Field logger (build #1). Each tick: snapshot the live Field/plan for the configured pairs
 * (one read per pair), then label any older snapshots whose forward outcome now exists. Read-only —
 * no trades, no funds. Disarmed via the `tesseract_logger_enabled` setting → instant no-op.
 *
 * Runs for every credentialed user so the dataset is per-account (single-owner in practice).
 */
export async function tesseractLogProcessor(_job: Job): Promise<void> {
  if (!(await loggerEnabled())) return;
  const creds = await db.select({ userId: jesterCredentials.userId }).from(jesterCredentials);
  for (const { userId } of creds) {
    try {
      const snap = await snapshotTesseract(userId);
      const lab = await labelTesseractOutcomes(userId);
      if (snap.written || lab.labeled || snap.errors) {
        console.log(`[tesseract-log] user=${userId.slice(0, 8)} wrote=${snap.written} errs=${snap.errors} labeled=${lab.labeled}`);
      }
    } catch (err) {
      console.error("[tesseract-log] failed:", err instanceof Error ? err.message : err);
    }
  }
}
