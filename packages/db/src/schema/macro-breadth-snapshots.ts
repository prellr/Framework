import {
  bigserial,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Outcome-blind macro classifications captured by the paper-floor worker.
 *
 * One row per completed anchor bar preserves the denominator of UP/DOWN/RANGE/NEUTRAL states even
 * when every strategy abstains. It stores no Polymarket resolution, paper result, P&L, or order data.
 */
export const macroBreadthSnapshots = pgTable(
  "macro_breadth_snapshot",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    version: text("version").notNull(),
    barStart: timestamp("bar_start").notNull(),
    barEnd: timestamp("bar_end").notNull(),
    capturedAt: timestamp("captured_at").notNull(),
    state: text("state").notNull(),
    btcCmo: doublePrecision("btc_cmo").notNull(),
    ethCmo: doublePrecision("eth_cmo").notNull(),
    solCmo: doublePrecision("sol_cmo").notNull(),
    medianCmo: doublePrecision("median_cmo").notNull(),
    medianAbsCmo: doublePrecision("median_abs_cmo").notNull(),
    sourceAgeSec: doublePrecision("source_age_sec").notNull(),
    eligibleWindows: integer("eligible_windows").notNull(),
    observedWindows: integer("observed_windows").notNull(),
    qualifiedDecisions: integer("qualified_decisions").notNull(),
    placedRows: integer("placed_rows").notNull(),
  },
  (table) => [
    uniqueIndex("macro_breadth_version_bar_idx").on(table.version, table.barStart),
    index("macro_breadth_capture_idx").on(table.capturedAt),
    index("macro_breadth_state_idx").on(table.state, table.barStart),
  ],
);
