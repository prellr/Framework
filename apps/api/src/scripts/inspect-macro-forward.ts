/**
 * Outcome-blind launch/integrity audit for updown-macro-breadth-router-v1.
 *
 * Intentionally does not select paper_trade.status, pnl_usd, graded_at, market outcomes, residuals,
 * rankings, or any other performance field. It exits nonzero only for a mechanical cohort,
 * freshness, routing, fill, or metadata violation.
 */
import { db } from "@framework/db";
import { sql } from "drizzle-orm";
import { MACRO_BREADTH_ROUTER } from "../services/macro-breadth-router.ts";

type CountRow = Record<string, number | string | Date | null>;

const evalStart = new Date(MACRO_BREADTH_ROUTER.evalStartMs);
const version = MACRO_BREADTH_ROUTER.version;
const macroBotKeys = ["macroTrendSleeve", "macroRangeFade", "macroRegimeRouter"] as const;
const allBotKeys = ["alwaysUp", ...macroBotKeys] as const;

async function main() {
  const snapshotResult = await db.execute(sql`
    select
      count(*)::int as snapshots,
      min(bar_end) as first_bar_end,
      max(bar_end) as last_bar_end,
      count(*) filter (where state = 'up')::int as state_up,
      count(*) filter (where state = 'down')::int as state_down,
      count(*) filter (where state = 'range')::int as state_range,
      count(*) filter (where state = 'neutral')::int as state_neutral,
      count(*) filter (where bar_end < ${evalStart})::int as boundary_violations,
      count(*) filter (
        where mod((extract(epoch from bar_start) * 1000)::bigint, ${MACRO_BREADTH_ROUTER.barMs}) <> 0
          or bar_end <> bar_start + interval '5 minutes'
      )::int as alignment_violations,
      count(*) filter (
        where source_age_sec < 0
          or source_age_sec > ${MACRO_BREADTH_ROUTER.maxCompletedBarAgeSec}
          or captured_at < bar_end
          or abs(extract(epoch from (captured_at - bar_end)) - source_age_sec) > 1
      )::int as freshness_violations,
      count(*) filter (
        where state not in ('up', 'down', 'range', 'neutral')
          or eligible_windows <= 0
          or observed_windows <> eligible_windows
          or qualified_decisions < 0
          or placed_rows < 0
          or placed_rows > qualified_decisions
      )::int as coverage_violations
    from macro_breadth_snapshot
    where version = ${version}
  `);

  const paperResult = await db.execute(sql`
    select
      count(*)::int as paper_rows,
      min(window_start) as first_window_start,
      max(window_start) as last_window_start,
      count(*) filter (where window_start < ${evalStart})::int as boundary_violations,
      count(*) filter (
        where pair not in ('BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'DOGE-USD', 'BNB-USD')
          or horizon_min not in (5, 15)
      )::int as universe_violations,
      count(*) filter (
        where decided_at < window_start
          or decided_at > window_start + interval '150 seconds'
      )::int as timing_violations,
      count(*) filter (
        where side not in ('up', 'down')
          or ask_paid <= ${MACRO_BREADTH_ROUTER.minFill}
          or ask_paid >= ${MACRO_BREADTH_ROUTER.maxFill}
          or control_ask_paid is null
          or control_ask_paid <= ${MACRO_BREADTH_ROUTER.minFill}
          or control_ask_paid >= ${MACRO_BREADTH_ROUTER.maxFill}
          or model_meta->'bookExecution'->'up'->>'effectiveVwap' is null
          or model_meta->'bookExecution'->'down'->>'effectiveVwap' is null
          or abs(
            control_ask_paid
            - (model_meta->'bookExecution'->'down'->>'effectiveVwap')::double precision
          ) > 1e-9
          or abs(
            ask_paid
            - case side
                when 'up' then (model_meta->'bookExecution'->'up'->>'effectiveVwap')::double precision
                else (model_meta->'bookExecution'->'down'->>'effectiveVwap')::double precision
              end
          ) > 1e-9
      )::int as fill_violations,
      count(*) filter (
        where bot_key = 'alwaysUp'
          and (
            side <> 'up'
            or p_signal is not null
            or edge_ask is not null
            or model_meta->>'source' is not null
          )
      )::int as benchmark_violations,
      count(*) filter (
        where bot_key in ('macroTrendSleeve', 'macroRangeFade', 'macroRegimeRouter')
          and (
            p_signal is null
            or least(abs(p_signal - 0.65), abs(p_signal - 0.35)) > 1e-9
            or signal_age_sec is null
            or signal_age_sec < 0
            or signal_age_sec > ${MACRO_BREADTH_ROUTER.maxCompletedBarAgeSec}
            or ask_paid >= 0.60
            or edge_ask is null
            or edge_ask <= ${MACRO_BREADTH_ROUTER.askEdge}
            or abs(
              edge_ask
              - (case side when 'up' then p_signal else 1 - p_signal end - ask_paid)
            ) > 1e-9
            or model_meta->'macroBreadth'->>'version' is distinct from ${version}
          )
      )::int as macro_contract_violations,
      count(*) filter (
        where bot_key = 'macroTrendSleeve'
          and (
            model_meta->>'macroSleeve' is distinct from 'trend'
            or model_meta->>'source' is distinct from 'macroTrend'
            or model_meta->'macroBreadth'->>'state' not in ('up', 'down')
            or side <> case model_meta->'macroBreadth'->>'state' when 'up' then 'up' else 'down' end
          )
      )::int as trend_routing_violations,
      count(*) filter (
        where bot_key = 'macroRangeFade'
          and (
            model_meta->>'macroSleeve' is distinct from 'range'
            or model_meta->>'source' is distinct from 'macroRange'
            or model_meta->'macroBreadth'->>'state' is distinct from 'range'
            or model_meta->'technicalRegime'->>'cmo' is null
            or abs((model_meta->'technicalRegime'->>'cmo')::double precision) < ${MACRO_BREADTH_ROUTER.rangeLocalAbsCmo}
            or side <> case
                when (model_meta->'technicalRegime'->>'cmo')::double precision < 0 then 'up'
                else 'down'
              end
          )
      )::int as range_routing_violations,
      count(*) filter (
        where bot_key = 'macroRegimeRouter'
          and (
            model_meta->>'macroSleeve' is distinct from 'router'
            or model_meta->>'source' is distinct from 'macroRouter'
            or model_meta->'macroBreadth'->>'state' not in ('up', 'down', 'range')
            or side <> case
                when model_meta->'macroBreadth'->>'state' = 'up' then 'up'
                when model_meta->'macroBreadth'->>'state' = 'down' then 'down'
                when (model_meta->'technicalRegime'->>'cmo')::double precision < 0 then 'up'
                else 'down'
              end
            or (
              model_meta->'macroBreadth'->>'state' = 'range'
              and (
                model_meta->'technicalRegime'->>'cmo' is null
                or abs((model_meta->'technicalRegime'->>'cmo')::double precision) < ${MACRO_BREADTH_ROUTER.rangeLocalAbsCmo}
              )
            )
          )
      )::int as router_routing_violations
    from paper_trade
    where bot_key in (${sql.join(allBotKeys.map((key) => sql`${key}`), sql`, `)})
  `);

  const snapshots = snapshotResult.rows[0] as CountRow;
  const paper = paperResult.rows[0] as CountRow;
  const violationKeys = [
    "boundary_violations",
    "alignment_violations",
    "freshness_violations",
    "coverage_violations",
    "universe_violations",
    "timing_violations",
    "fill_violations",
    "benchmark_violations",
    "macro_contract_violations",
    "trend_routing_violations",
    "range_routing_violations",
    "router_routing_violations",
  ];
  const violationTotal = [snapshots, paper].reduce(
    (total, row) => total + violationKeys.reduce((sum, key) => sum + Number(row[key] ?? 0), 0),
    0,
  );
  console.log(JSON.stringify({
    version,
    evalStartMs: MACRO_BREADTH_ROUTER.evalStartMs,
    outcomeFieldsRead: false,
    performanceFieldsRead: false,
    snapshots,
    paper,
    violationTotal,
    passed: violationTotal === 0,
  }, null, 2));
  process.exit(violationTotal === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
