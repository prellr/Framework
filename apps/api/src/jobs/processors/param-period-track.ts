import type { Job } from "bullmq";
import { db, jesterCredentials } from "@framework/db";
import { trackParamPeriods } from "../../services/param-tracking.ts";

/**
 * Snapshot the live parameter config every few minutes so we can attribute live fills to the
 * parameter set that was actually running at the time. Cheap: one Jester read + a few upserts,
 * and a no-op when nothing changed.
 */
export async function paramPeriodTrackProcessor(_job: Job): Promise<void> {
  const [cred] = await db.select({ userId: jesterCredentials.userId }).from(jesterCredentials).limit(1);
  if (!cred) return;
  try {
    const { opened, closed } = await trackParamPeriods(cred.userId);
    if (opened || closed) console.log(`[param-track] opened=${opened} closed=${closed}`);
  } catch (err) {
    console.error("[param-track] failed:", err instanceof Error ? err.message : err);
  }
}
