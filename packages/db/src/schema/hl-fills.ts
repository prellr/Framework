import { bigint, bigserial, doublePrecision, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Local warehouse of the Hyperliquid fill ledger — one row per fill, per wallet.
 *
 * The live-trading analysis (portfolio PnL, per-trade history, param-set attribution) used to
 * refetch the fill ledger from Hyperliquid's public API and reduce it in JS on every request.
 * That API returns at MOST 2000 fills, so past ~2000 lifetime trades the analysis silently
 * truncated and became wrong — not slow, wrong. This table stores every fill so the analysis is a
 * SQL query over full history instead. A background job (`fills-sync`) keeps it current by pulling
 * only the tail since the last synced fill.
 *
 * Money columns are double precision, matching the existing float-based aggregation in
 * hyperliquid.ts (which parseFloats every value) — this preserves exact current behavior while
 * removing the cap. `tid` is Hyperliquid's globally-unique trade id, so (wallet, tid) dedupes
 * re-fetched overlap. Fills are immutable once booked, so sync upserts do-nothing on conflict.
 */
export const hlFills = pgTable(
  "hl_fill",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    wallet: text("wallet").notNull(), // lowercased 0x… address
    tid: bigint("tid", { mode: "number" }).notNull(), // Hyperliquid trade id (unique per fill)
    time: bigint("time", { mode: "number" }).notNull(), // epoch ms
    coin: text("coin").notNull(),
    closedPnl: doublePrecision("closed_pnl").notNull().default(0), // realized PnL booked on a close
    fee: doublePrecision("fee").notNull().default(0), // charged on every fill
    dir: text("dir").notNull().default(""), // "Open Long", "Close Short", …
    px: doublePrecision("px").notNull().default(0),
    sz: doublePrecision("sz").notNull().default(0),
    side: text("side").notNull().default(""), // "B" | "A"
    oid: bigint("oid", { mode: "number" }).notNull().default(0),
    hash: text("hash").notNull().default(""),
    syncedAt: timestamp("synced_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("hl_fill_wallet_tid_idx").on(t.wallet, t.tid),
    index("hl_fill_wallet_time_idx").on(t.wallet, t.time),
  ],
);
