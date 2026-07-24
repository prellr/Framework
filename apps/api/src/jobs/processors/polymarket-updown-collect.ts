import type { Job } from "bullmq";
import { collectAndPersist } from "../../services/polymarket-updown.ts";

/**
 * Score the six supported crypto Up/Down pairs that resolved recently against our Tesseract log,
 * and persist them (Phase 1 descriptive collector). Read-only — no orders. Idempotent:
 * already-scored markets are skipped, so a 2h look-back safely catches everything between 15-min
 * ticks even if one is missed.
 */
export async function polymarketUpdownCollectProcessor(_job: Job): Promise<void> {
  try {
    const r = await collectAndPersist(2, "forward");
    if (r.scored) console.log(`[pm-updown] scored=${r.scored} skipped=${r.skipped} noSignal=${r.noSignal}`);
  } catch (err) {
    console.error("[pm-updown] failed:", err instanceof Error ? err.message : err);
  }
}
