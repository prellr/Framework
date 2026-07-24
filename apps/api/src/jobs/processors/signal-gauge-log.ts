import type { Job } from "bullmq";
import { db, jesterCredentials } from "@framework/db";
import { gaugeLoggerEnabled, snapshotTradeGauge } from "../../services/signal-gauge-logger.ts";

/**
 * Trade composite gauge logger (tournament bot #2). Each tick: one `jester_technical_gauge_scan` call
 * per credentialed user → one signal_snapshot row per pair. Read-only — no trades. Disarmed via the
 * `signal_gauge_logger_enabled` setting → instant no-op.
 */
export async function signalGaugeLogProcessor(_job: Job): Promise<void> {
  if (!(await gaugeLoggerEnabled())) return;
  const creds = await db.select({ userId: jesterCredentials.userId }).from(jesterCredentials);
  for (const { userId } of creds) {
    try {
      const r = await snapshotTradeGauge(userId);
      if (r.written) console.log(`[signal-gauge] user=${userId.slice(0, 8)} wrote=${r.written}`);
    } catch (err) {
      console.error("[signal-gauge] failed:", err instanceof Error ? err.message : err);
    }
  }
}
