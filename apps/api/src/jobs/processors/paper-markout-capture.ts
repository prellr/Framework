import type { Job } from "bullmq";
import { capturePaperMarkouts } from "../../services/paper-markout.ts";

/** Prospective public-CLOB observation only; no paper decision, order, or gate mutation. */
export async function paperMarkoutCaptureProcessor(_job: Job): Promise<void> {
  try {
    const result = await capturePaperMarkouts();
    if (result.considered) {
      console.log(
        `[paper-markout] considered=${result.considered} captured=${result.captured} unavailable=${result.unavailable} stale=${result.stale}`,
      );
    }
  } catch (error) {
    console.error("[paper-markout] failed:", error instanceof Error ? error.message : error);
  }
}
