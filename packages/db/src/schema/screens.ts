import { boolean, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.ts";

/**
 * A saved screen: a threshold query over the warehouse (e.g. "PF > 1.1, ≥ 20 trades, majors").
 * Running it evaluates the query against backtest_runs and returns the surviving strategies.
 * `lastSurvivors` holds the previous survivor keys so a re-run can diff (added / dropped) — that
 * diff is the "alert". `autoRescreen` opts the screen into the daily rescreen job.
 */
export const screens = pgTable("screen", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerUserId: text("owner_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // { minPf?, minTrades?, minReturn?, maxDrawdown?, pairs?[], timeframes?[], days?[] }
  query: jsonb("query").notNull(),
  autoRescreen: boolean("auto_rescreen").notNull().default(false),
  lastSurvivors: jsonb("last_survivors"), // string[] of survivor keys from the last run
  lastAdded: jsonb("last_added"), // keys new since the previous run (the "alert")
  lastRemoved: jsonb("last_removed"), // keys dropped since the previous run
  lastRunAt: timestamp("last_run_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
