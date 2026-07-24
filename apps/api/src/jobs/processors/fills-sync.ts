import type { Job } from "bullmq";
import { and, isNotNull, ne } from "drizzle-orm";
import { db, jesterCredentials } from "@framework/db";
import { connection } from "../queue.ts";
import { publishEvent } from "../../sse.ts";
import { syncWalletFills } from "../../services/fills-store.ts";

/**
 * Pull each linked wallet's new Hyperliquid fills into the warehouse (hl_fills). Resumes from a
 * per-wallet cursor, so a cold start backfills full history and steady state just grabs the tail —
 * cheap once caught up. Distinct wallets only, so two users on the same wallet don't double-sync.
 */
export async function fillsSyncProcessor(_job: Job): Promise<void> {
  const rows = await db
    .selectDistinct({ wallet: jesterCredentials.hlWallet })
    .from(jesterCredentials)
    .where(and(isNotNull(jesterCredentials.hlWallet), ne(jesterCredentials.hlWallet, "")));

  for (const { wallet } of rows) {
    if (!wallet) continue;
    try {
      const { inserted, total } = await syncWalletFills(wallet);
      if (inserted > 0) {
        console.log(`[fills-sync] ${wallet.slice(0, 8)}… +${inserted} (total ${total})`);
        await publishEvent(connection, "fills.synced", { wallet, inserted, total });
      }
    } catch (err) {
      console.error(`[fills-sync] ${wallet.slice(0, 8)}… failed:`, err instanceof Error ? err.message : err);
    }
  }
}
