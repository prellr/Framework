/**
 * Local warehouse for the Hyperliquid fill ledger (schema: hl_fills).
 *
 * Why this exists: Hyperliquid's public API returns at most 2000 fills, and every live-analysis
 * surface used to reduce that capped set in JS on each request — so past ~2000 lifetime trades the
 * numbers silently went wrong. This module stores every fill and serves reads from Postgres.
 *
 *  - `syncWalletFills` pulls the tail since the last synced fill and pages back on a cold start to
 *    capture full history (the background `fills-sync` job calls this).
 *  - `getStoredFills` returns fills in the exact `Fill[]` shape the pure aggregation fns expect, so
 *    the callers (account.ts, param-tracking.ts) change one function name and nothing else. It
 *    falls back to the live API only when the wallet has never been synced, so rollout is seamless.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { db, hlFills } from "@framework/db";
import { getUserFills, type Fill } from "./hyperliquid.ts";
import { getSetting, setSetting } from "./config.ts";

const HL_FILL_PAGE = 2000; // Hyperliquid returns at most this many fills per query.
const cursorKey = (wallet: string) => `fills:cursor:${wallet.toLowerCase()}`;

type Row = typeof hlFills.$inferSelect;
const rowToFill = (r: Row): Fill => ({
  time: r.time,
  coin: r.coin,
  closedPnl: r.closedPnl,
  fee: r.fee,
  dir: r.dir,
  px: r.px,
  sz: r.sz,
  side: r.side,
  oid: r.oid,
  hash: r.hash,
  tid: r.tid,
});

async function storedCount(wallet: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(hlFills)
    .where(eq(hlFills.wallet, wallet));
  return row?.n ?? 0;
}

/** Insert fills, skipping ones already stored (immutable ledger → do-nothing on conflict). */
async function insertFills(wallet: string, fills: Fill[]): Promise<number> {
  if (fills.length === 0) return 0;
  let inserted = 0;
  // Chunk to stay well under Postgres's parameter cap (~65k; ~11 cols/row).
  for (let i = 0; i < fills.length; i += 1000) {
    const chunk = fills.slice(i, i + 1000);
    const res = await db
      .insert(hlFills)
      .values(
        chunk.map((f) => ({
          wallet,
          tid: f.tid,
          time: f.time,
          coin: f.coin,
          closedPnl: f.closedPnl,
          fee: f.fee,
          dir: f.dir,
          px: f.px,
          sz: f.sz,
          side: f.side,
          oid: f.oid,
          hash: f.hash,
        })),
      )
      .onConflictDoNothing({ target: [hlFills.wallet, hlFills.tid] })
      .returning({ id: hlFills.id });
    inserted += res.length;
  }
  return inserted;
}

/**
 * Sync one wallet's fills into the warehouse. Resumes from the stored cursor (max synced fill time),
 * re-scanning a small overlap so a fill booked exactly at the cursor isn't missed. Pages forward
 * when a full page comes back, so a cold start backfills the whole history rather than just the
 * latest 2000. Returns how many new fills landed and the wallet's total.
 */
export async function syncWalletFills(wallet: string): Promise<{ inserted: number; total: number }> {
  const w = wallet.toLowerCase();
  const cursorRaw = await getSetting(cursorKey(w));
  const cursor = cursorRaw ? Number(cursorRaw) : 0;
  // Overlap by a minute so boundary fills aren't skipped; the unique index dedupes the re-fetch.
  let startTime = cursor > 0 ? Math.max(0, cursor - 60_000) : 0;

  let inserted = 0;
  let maxTime = cursor;
  for (let page = 0; page < 100; page++) {
    const fills = await getUserFills(wallet, startTime);
    if (fills.length === 0) break;
    inserted += await insertFills(w, fills);
    const pageMax = Math.max(...fills.map((f) => f.time));
    if (pageMax > maxTime) maxTime = pageMax;
    if (fills.length < HL_FILL_PAGE) break; // short page → caught up
    if (pageMax <= startTime) break; // no forward progress → stop (guards a same-ms cluster)
    startTime = pageMax + 1; // advance past this page
  }

  if (maxTime > cursor) await setSetting(cursorKey(w), String(maxTime));
  return { inserted, total: await storedCount(w) };
}

/**
 * Fills for a wallet from the warehouse, newest first, optionally since `startTime` (epoch ms) —
 * a drop-in replacement for getUserFills that isn't 2000-capped. Falls back to the live API only
 * when the wallet has no stored rows at all (i.e. before its first sync), so nothing breaks during
 * rollout; once synced, the warehouse is authoritative.
 */
export async function getStoredFills(wallet: string, startTime?: number): Promise<Fill[]> {
  const w = wallet.toLowerCase();
  const rows = await db
    .select()
    .from(hlFills)
    .where(startTime != null ? and(eq(hlFills.wallet, w), gte(hlFills.time, startTime)) : eq(hlFills.wallet, w))
    .orderBy(sql`${hlFills.time} desc`);
  if (rows.length > 0) return rows.map(rowToFill);

  // Empty window: distinguish "wallet is synced but nothing in this window" (return []) from
  // "wallet never synced yet" (fall back to the live API so the page isn't blank on first load).
  if ((await storedCount(w)) > 0) return [];
  return getUserFills(wallet, startTime).catch(() => [] as Fill[]);
}
