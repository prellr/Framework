import { boolean, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Catalog mirror of Jester's strategies (GET /strategies/available). Refreshed
 * periodically by the catalog-refresh job. `cachedStats` is Jester's own backtestData
 * snapshot — kept for reference but treated as UNTRUSTED (recent-window stats mislead;
 * the warehouse's own full-window runs are the source of truth).
 */
export const strategies = pgTable("strategy", {
  id: text("id").primaryKey(), // Jester strategyId, e.g. "mass_index_reversal"
  name: text("name").notNull(),
  tier: text("tier"), // BASIC | STANDARD | PREMIUM
  category: text("category"),
  cachedStats: jsonb("cached_stats"),
  // Jester's parameter code (sharedResult.paramHash) for this strategy's DEFAULT params. It's a
  // pure function of the parameter set — constant across pair/timeframe/window — so it's fetched
  // once (backfill job) and reused for every default backtest of this strategy.
  defaultParamCode: text("default_param_code"),

  // Whether Jester honors parameter overrides for this strategy (so guided optimize can tune it).
  // null = not yet probed. Set by the tunability-probe job (2 async backtests, compare).
  tunable: boolean("tunable"),
  tunableCheckedAt: timestamp("tunable_checked_at"),

  // Authoritative documentation mirrored from Jester's /strategies/available entry (see
  // catalog refresh). This is Jester's own text — the grounded basis of the knowledge base.
  description: text("description"), // the concept in one line
  entrySummary: text("entry_summary"),
  exitSummary: text("exit_summary"),
  indicatorSummary: text("indicator_summary"),
  features: jsonb("features"), // string[] of concept tags
  riskSettings: jsonb("risk_settings"), // { stopLoss, takeProfit, riskPerTrade, maxDrawdown, ... }
  nativeTimeframe: text("native_timeframe"), // the timeframe Jester designed it for

  refreshedAt: timestamp("refreshed_at").notNull().defaultNow(),
});

/**
 * Authored knowledge-base entry for a strategy — the "how & why it works" deep-dive layered ON TOP
 * of Jester's mirrored metadata. Kept in a separate table so a catalog refresh (which overwrites
 * the Jester-sourced fields) never clobbers authored content. `content` is markdown; `keyParams`
 * flags the parameters that most affect this strategy's behavior.
 */
export const strategyDocs = pgTable("strategy_doc", {
  strategyId: text("strategy_id")
    .primaryKey()
    .references(() => strategies.id, { onDelete: "cascade" }),
  content: text("content").notNull(), // markdown deep-dive (how/why, regime, failure modes)
  keyParams: jsonb("key_params"), // [{ name, why }] — the parameters that matter most
  generatedBy: text("generated_by"), // model/author label
  authoredAt: timestamp("authored_at").notNull().defaultNow(),
});
