import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.ts";
import { backtestRuns } from "./backtest-runs.ts";

/**
 * A sweep is a user-launched matrix {strategies × assets × timeframes × windows}.
 * run-sweep expands it into sweep_cells and fans out one backtest-cell job each;
 * each cell resolves to a shared backtest_run (cache hit or fresh). Progress streams
 * over SSE. This is backtest_harness.py, made multi-user and live.
 */
export const sweeps = pgTable("sweep", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name"),
  kind: text("kind").notNull().default("sweep"), // sweep | optimize
  matrix: jsonb("matrix").notNull(), // sweep: {strategies,assets,timeframes,windows}; optimize: {strategyId,pair,timeframe,days}
  status: text("status").notNull().default("queued"), // queued | running | done | failed | canceled
  totalCells: integer("total_cells").notNull().default(0),
  doneCells: integer("done_cells").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const sweepCells = pgTable(
  "sweep_cell",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sweepId: uuid("sweep_id")
      .notNull()
      .references(() => sweeps.id, { onDelete: "cascade" }),
    strategyId: text("strategy_id").notNull(),
    pair: text("pair").notNull(),
    timeframe: text("timeframe").notNull(),
    days: integer("days").notNull(),
    // Optimization cells carry a parameter override + a human label (e.g. combo rank / hash).
    parameters: jsonb("parameters"),
    paramLabel: text("param_label"),
    status: text("status").notNull().default("pending"), // pending | running | cache_hit | done | failed
    backtestRunId: uuid("backtest_run_id").references(() => backtestRuns.id, {
      onDelete: "set null",
    }),
    error: text("error"),
  },
  (t) => ({ bySweep: index("cell_by_sweep").on(t.sweepId) }),
);
