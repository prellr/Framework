import type { Job } from "bullmq";
import { db, jesterCredentials } from "@framework/db";
import { focusEnabled, focusPairs, labelTesseractOutcomes, loggerEnabled, snapshotTesseract } from "../../services/tesseract-logger.ts";

/**
 * Tesseract 5m FOCUS logger — the faster sibling of the 10m broad logger. Snapshots only the focus
 * pairs (default BTC-USD, where a live 5m strategy runs) every 5 minutes so the Field is sampled at
 * the strategy's own resolution, then labels matured rows. Read-only. Gated by both the master
 * `tesseract_logger_enabled` and `tesseract_focus_enabled` settings.
 */
export async function tesseractLogFocusProcessor(_job: Job): Promise<void> {
  if (!(await loggerEnabled()) || !(await focusEnabled())) return;
  const pairs = await focusPairs();
  if (!pairs.length) return;
  const creds = await db.select({ userId: jesterCredentials.userId }).from(jesterCredentials);
  for (const { userId } of creds) {
    try {
      const snap = await snapshotTesseract(userId, pairs);
      const lab = await labelTesseractOutcomes(userId);
      if (snap.written || lab.labeled || snap.errors) {
        console.log(`[tesseract-focus] user=${userId.slice(0, 8)} pairs=${pairs.join(",")} wrote=${snap.written} errs=${snap.errors} labeled=${lab.labeled}`);
      }
    } catch (err) {
      console.error("[tesseract-focus] failed:", err instanceof Error ? err.message : err);
    }
  }
}
