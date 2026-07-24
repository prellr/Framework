import type { Job } from "bullmq";
import { capturePolymarketStateTick, gradePolymarketStateTick } from "../../services/polymarket-state-tape.ts";
import { captureCrossHorizonBundleTick } from "../../services/cross-horizon-bundle.ts";
import { captureCompleteSetTakerTick } from "../../services/complete-set-taker-audit.ts";

/** Public market-data collection only; errors terminate this tick and wait for the next scheduler run. */
export async function polymarketStateTapeProcessor(_job: Job): Promise<void> {
  try {
    const completeSet = await captureCompleteSetTakerTick();
    if (completeSet.captured) {
      console.log(`[pm-complete-set] captured=${completeSet.captured}/${completeSet.considered}`);
    }
  } catch (error) {
    console.error("[pm-complete-set] failed:", error instanceof Error ? error.message : error);
  }
  try {
    // Fetch the two bundle legs back-to-back before the broader sequential state pass.
    const bundle = await captureCrossHorizonBundleTick();
    if (bundle.captured) {
      console.log(`[pm-bundle] captured=${bundle.captured}/${bundle.considered}`);
    }
  } catch (error) {
    // Bundle instrumentation is isolated: an unavailable paired book must not starve the core tape.
    console.error("[pm-bundle] failed:", error instanceof Error ? error.message : error);
  }
  try {
    // Both paths use the same politely paced public CLOB client, so keep capture and grading sequential.
    const capture = await capturePolymarketStateTick();
    const grade = await gradePolymarketStateTick();
    if (capture.captured || grade.rows || grade.voided) {
      console.log(
        `[pm-state] captured=${capture.captured}/${capture.considered} labeled=${grade.rows} markets=${grade.markets} voided=${grade.voided}`,
      );
    }
  } catch (error) {
    console.error("[pm-state] failed:", error instanceof Error ? error.message : error);
  }
}
