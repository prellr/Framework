import type { Job } from "bullmq";
import { connection } from "../queue.ts";
import { paperDecideTick, paperGradeTick, paperFloorEnabled } from "../../services/paper-floor.ts";
import {
  recordPaperFloorRuntimeHeartbeat,
} from "../../services/paper-floor-runtime-heartbeat.ts";
import { rtdsStatus } from "../../services/rtds.ts";

export const PEAK_RETENTION_BOT_KEY = "pricerBSMPeakRetention";
export const PEAK_RETENTION_JOB_NAME = "peak-retention";

/**
 * Paper Floor tick: decide (paper bets at window open, real ask recorded) then grade (resolved
 * markets → W/L + P&L). PAPER ONLY — no orders, no funds. Disarm via paper_floor_enabled=false.
 *
 * Peak retention has a separately frozen 60–90s-remaining decision band. A minute scheduler can
 * skip a 30s band entirely depending on phase, so its 15s job is isolated here. The general lane
 * excludes that bot; no other strategy's observation cadence changes.
 */
export async function paperFloorTickProcessor(job: Job): Promise<void> {
  const peakLane = job.name === PEAK_RETENTION_JOB_NAME;
  const startedAtMs = Date.now();
  const recordRuntime = async (status: "running" | "ok" | "error" | "disabled") => {
    if (peakLane) return;
    try {
      await recordPaperFloorRuntimeHeartbeat(connection, {
        status,
        startedAtMs,
        observedAtMs: Date.now(),
      });
    } catch {
      // Operational telemetry must never block or alter the paper collector.
    }
  };
  if (!(await paperFloorEnabled())) {
    await recordRuntime("disabled");
    return;
  }
  await recordRuntime("running");
  try {
    const d = await paperDecideTick(peakLane
      ? { onlyBotKeys: [PEAK_RETENTION_BOT_KEY] }
      : { excludeBotKeys: [PEAK_RETENTION_BOT_KEY] });
    const g = peakLane ? { graded: 0 } : await paperGradeTick();
    if (d.placed || g.graded) {
      console.log(`[paper-floor${peakLane ? ":peak-retention" : ""}] placed=${d.placed} (of ${d.considered} mkts) graded=${g.graded}`);
    }
    // Periodic RTDS health (every ~10 min) so a silently-dead feed is visible.
    if (!peakLane) {
      const st = rtdsStatus();
      if (Date.now() % 600_000 < 60_000) console.log(`[rtds] ${st.pairs.map((p) => `${p.pair.replace("-USD", "")}:${p.ticks}t/${p.lastAgoSec ?? "—"}s`).join(" ")}`);
    }
    await recordRuntime("ok");
  } catch (err) {
    await recordRuntime("error");
    console.error(`[paper-floor${job.name === PEAK_RETENTION_JOB_NAME ? ":peak-retention" : ""}] failed:`, err instanceof Error ? err.message : err);
  }
}
