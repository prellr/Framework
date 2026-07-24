import assert from "node:assert/strict";
import test from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { polymarketSmoothPathFunnel } from "@framework/db";

test("Smooth Path funnel tape contains only outcome-blind coverage and rejection fields", () => {
  const config = getTableConfig(polymarketSmoothPathFunnel);
  const columns = config.columns.map((column) => column.name);

  assert.deepEqual(columns, [
    "id",
    "version",
    "bot_key",
    "condition_id",
    "pair",
    "window_start",
    "observed_at",
    "book_request_duration_ms",
    "observed",
    "path_qualified",
    "book_qualified",
    "placed",
    "rejection_reasons",
    "tick_count",
    "start_coverage_sec",
    "max_intertick_gap_sec",
    "source_age_sec",
    "receive_age_sec",
    "abs_displacement_log",
    "path_r2",
    "path_efficiency",
    "continuation_slope_per_sec",
    "continuation_fresh_log",
    "captured_at",
  ]);
  for (const prohibited of [
    "side",
    "price",
    "outcome",
    "result",
    "status",
    "grade",
    "return",
    "pnl",
    "account",
    "order",
    "wallet",
    "credential",
  ]) {
    assert.equal(columns.some((column) => column.includes(prohibited)), false);
  }
});

test("Smooth Path funnel tape has frozen uniqueness, boundary, universe, and stage checks", () => {
  const config = getTableConfig(polymarketSmoothPathFunnel);
  assert.ok(config.indexes.some((index) =>
    index.config.unique
    && index.config.name === "pm_smooth_funnel_version_market_idx"
  ));
  assert.deepEqual(
    config.checks.map((check) => check.name).sort(),
    [
      "pm_smooth_funnel_bot_chk",
      "pm_smooth_funnel_boundary_chk",
      "pm_smooth_funnel_pair_chk",
      "pm_smooth_funnel_request_duration_chk",
      "pm_smooth_funnel_stage_chk",
      "pm_smooth_funnel_tick_count_chk",
      "pm_smooth_funnel_version_chk",
    ],
  );
});
