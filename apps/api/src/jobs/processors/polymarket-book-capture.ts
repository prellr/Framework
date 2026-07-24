import type { Job } from "bullmq";
import { getSetting } from "../../services/config.ts";
import { capturePolymarketBooks } from "../../services/polymarket-updown.ts";

/**
 * Snapshot the best bid/ask of open Up/Down markets for the six supported crypto pairs so the
 * scorer can price entries at the REAL ask (CLOB has no historical book — the ask only exists while
 * a market is live). One snapshot per market. Read-only — no orders. Disable via
 * polymarket_book_capture_enabled.
 */
export async function polymarketBookCaptureProcessor(_job: Job): Promise<void> {
  const enabled = (await getSetting("polymarket_book_capture_enabled")) ?? "true";
  if (enabled === "false") return;
  try {
    const r = await capturePolymarketBooks();
    if (r.captured) console.log(`[pm-book] captured=${r.captured} skipped=${r.skipped} live=${r.markets}`);
  } catch (err) {
    console.error("[pm-book] failed:", err instanceof Error ? err.message : err);
  }
}
