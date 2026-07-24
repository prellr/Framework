import type { Job } from "bullmq";
import { eq } from "drizzle-orm";
import { db, screens } from "@framework/db";
import { connection } from "../queue.ts";
import { publishEvent } from "../../sse.ts";
import { runScreen } from "../../services/screens.ts";

/**
 * Re-evaluate every screen opted into auto-rescreen. Each run refreshes the stored survivor
 * set and the added/removed diff (the "alert"). Screens that changed are announced over SSE so
 * an open Screens page can surface a fresh alert without a manual re-run.
 */
export async function rescreenProcessor(_job: Job): Promise<void> {
  const rows = await db
    .select({ id: screens.id, name: screens.name })
    .from(screens)
    .where(eq(screens.autoRescreen, true));

  for (const s of rows) {
    try {
      const result = await runScreen(s.id);
      if (result.added.length || result.removed.length) {
        await publishEvent(connection, "screen.alert", {
          screenId: s.id,
          name: s.name,
          added: result.added.length,
          removed: result.removed.length,
        });
      }
    } catch (err) {
      console.error(`[rescreen] screen ${s.id} failed:`, err);
    }
  }
}
