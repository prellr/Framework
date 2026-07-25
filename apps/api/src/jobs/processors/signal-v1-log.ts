import type { Job } from "bullmq";
import { ingestV1Signals, v1LoggerEnabled } from "../../services/signal-v1-logger.ts";

/**
 * Jester V1 entry logger (tournament bot #5 feed). The deep tick audits subscription state before
 * signals_history; a confirmed unsubscribe suppresses interim source calls. Read-only. Disarm via
 * v1_signal_logger_enabled=false.
 */
let tickCount = 0;
export async function signalV1LogProcessor(_job: Job): Promise<void> {
  if (!(await v1LoggerEnabled())) return;
  tickCount++;
  const deep = tickCount % 3 === 0;
  try {
    const r = await ingestV1Signals(deep);
    // Deep reads happen every ~15 minutes. Emit one payload-free health line at that cadence even
    // when the legitimate result is empty, so zero forward activity cannot hide a dead source.
    if (deep || r.written || r.unsided) {
      const history = r.historyChecks
        ? `${r.historySucceeded}/${r.historyChecks}`
        : "not-polled";
      const subscription = r.subscribed == null
        ? "unknown"
        : r.subscribed
          ? "subscribed"
          : "unsubscribed";
      const notifications = r.notificationSkipped
        ? "skipped"
        : r.notificationOk
          ? "ok"
          : "error";
      console.log(
        `[v1-log] credential=${r.credentialPresent ? "ok" : "missing"}`
        + ` subscription=${subscription}`
        + ` subscription_checked=${r.subscriptionChecked}`
        + ` notifications=${notifications}`
        + ` history=${history}`
        + ` written=${r.written} unsided=${r.unsided}`,
      );
    }
  } catch (err) {
    console.error("[v1-log] failed:", err instanceof Error ? err.message : err);
  }
}
