/**
 * Reproducible outcome-blind launch/readiness audit for the Hyperliquid aggressor-flow tape.
 *
 * This script selects only version, boundary, bucket, nullability, timing, and freshness evidence.
 * It never selects flow values, market outcomes, grades, paper decisions, fills, or P&L.
 */
import { readFileSync } from "node:fs";
import { db } from "@framework/db";
import { sql } from "drizzle-orm";
import {
  assertOutcomeBlindFlowStatus,
  hyperliquidFlowTapeStatus,
} from "../services/hyperliquid-flow-report.ts";
import { HYPERLIQUID_FLOW_TAPE } from "../services/hl-rtds.ts";

const collectorSource = readFileSync(new URL("../services/hl-rtds.ts", import.meta.url), "utf8");
const captureSource = readFileSync(
  new URL("../services/polymarket-state-tape.ts", import.meta.url),
  "utf8",
);
const reportSource = readFileSync(
  new URL("../services/hyperliquid-flow-report.ts", import.meta.url),
  "utf8",
);
const schemaSource = readFileSync(
  new URL("../../../../packages/db/src/schema/polymarket-state-snapshots.ts", import.meta.url),
  "utf8",
);
const executableSource = `${collectorSource}\n${captureSource}\n${reportSource}`;
const prohibitedSourcePatterns = [
  /\bpaperTrades\b/,
  /\bresultNet\b/,
  /\bmarketResolution\b/,
  /\bresolvedOutcome\b/,
  /\bplaceOrder\b/,
  /\bsubmitOrder\b/,
  /\bcancelOrder\b/,
  /\bprivateKey\b/,
  /\bJESTER_API_KEY\b/,
  /api\.hyperliquid\.xyz\/exchange/,
  /from ["'][^"']*(?:trading|credentials|fills-store|paper-floor)["']/,
];
const sourceViolations = prohibitedSourcePatterns
  .filter((pattern) => pattern.test(executableSource))
  .map((pattern) => pattern.source);
const requiredColumns = [
  "hl_flow_version",
  "hl_flow_imbalance_5s",
  "hl_flow_imbalance_30s",
  "hl_flow_imbalance_60s",
  "hl_flow_notional_60s",
  "hl_flow_trade_count_60s",
  "hl_flow_max_trade_share_60s",
  "hl_flow_source_age_sec",
  "hl_flow_receive_age_sec",
  "hl_flow_max_transport_lag_ms_60s",
];
const boundary = new Date(HYPERLIQUID_FLOW_TAPE.evalStartMs);
const launchGraceMs = 5 * 60_000;

const [integrityResult, columnsResult, status] = await Promise.all([
  db.execute(sql`
    select
      count(*) filter (
        where hl_flow_version = ${HYPERLIQUID_FLOW_TAPE.version}
      )::int as tagged_rows,
      count(*) filter (
        where hl_flow_version = ${HYPERLIQUID_FLOW_TAPE.version}
          and captured_at < ${boundary}
      )::int as pre_boundary_rows,
      count(*) filter (
        where captured_at >= ${boundary}
          and hl_flow_version is not null
          and hl_flow_version <> ${HYPERLIQUID_FLOW_TAPE.version}
      )::int as unknown_version_rows,
      count(*) filter (
        where hl_flow_version = ${HYPERLIQUID_FLOW_TAPE.version}
          and (
            pair not in ('BTC-USD','ETH-USD','SOL-USD','XRP-USD','DOGE-USD','BNB-USD')
            or horizon_min not in (5,15)
          )
      )::int as mapping_violations,
      count(*) filter (
        where hl_flow_version = ${HYPERLIQUID_FLOW_TAPE.version}
          and (
            hl_flow_imbalance_60s is null
            or hl_flow_notional_60s is null
            or hl_flow_trade_count_60s is null
            or hl_flow_max_trade_share_60s is null
            or hl_flow_source_age_sec is null
            or hl_flow_receive_age_sec is null
            or hl_flow_max_transport_lag_ms_60s is null
          )
      )::int as tagged_rows_with_required_nulls,
      min(captured_at) filter (
        where hl_flow_version = ${HYPERLIQUID_FLOW_TAPE.version}
      ) as first_tagged_at,
      max(captured_at) filter (
        where hl_flow_version = ${HYPERLIQUID_FLOW_TAPE.version}
      ) as last_tagged_at
    from polymarket_state_snapshot
  `),
  db.execute(sql`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'polymarket_state_snapshot'
      and column_name in (
        'hl_flow_version',
        'hl_flow_imbalance_5s',
        'hl_flow_imbalance_30s',
        'hl_flow_imbalance_60s',
        'hl_flow_notional_60s',
        'hl_flow_trade_count_60s',
        'hl_flow_max_trade_share_60s',
        'hl_flow_source_age_sec',
        'hl_flow_receive_age_sec',
        'hl_flow_max_transport_lag_ms_60s'
      )
    order by column_name
  `),
  hyperliquidFlowTapeStatus(),
]);

assertOutcomeBlindFlowStatus(status);
const integrity = integrityResult.rows[0];
const presentColumns = new Set(columnsResult.rows.map((row) => String(row.column_name)));
const missingColumns = requiredColumns.filter((column) => !presentColumns.has(column));
const taggedRows = Number(integrity?.tagged_rows ?? 0);
const firstTaggedAt = integrity?.first_tagged_at
  ? new Date(String(integrity.first_tagged_at))
  : null;
const afterGrace = Date.now() >= HYPERLIQUID_FLOW_TAPE.evalStartMs + launchGraceMs;
const checks = {
  exactBoundary: status.evalStartMs === HYPERLIQUID_FLOW_TAPE.evalStartMs,
  exactVersion: status.version === HYPERLIQUID_FLOW_TAPE.version,
  twelveBuckets: status.buckets.length === 12,
  noPreBoundaryRows: Number(integrity?.pre_boundary_rows ?? -1) === 0,
  noUnknownVersionRows: Number(integrity?.unknown_version_rows ?? -1) === 0,
  noMappingViolations: Number(integrity?.mapping_violations ?? -1) === 0,
  noMissingRequiredFields: Number(integrity?.tagged_rows_with_required_nulls ?? -1) === 0,
  noMissingColumns: missingColumns.length === 0,
  noProhibitedSourceReads: sourceViolations.length === 0,
  publicWebSocketOnly:
    collectorSource.includes('const HL_WS = "wss://api.hyperliquid.xyz/ws"') &&
    !collectorSource.includes("api.hyperliquid.xyz/exchange"),
  firstRowAtOrAfterBoundary:
    firstTaggedAt == null || firstTaggedAt.getTime() >= HYPERLIQUID_FLOW_TAPE.evalStartMs,
  postBoundaryCollection:
    !afterGrace || (taggedRows > 0 && status.usableRows > 0 && status.operationalHealth.healthy),
};
const passed = Object.values(checks).every(Boolean);

console.log(
  JSON.stringify(
    {
      passed,
      auditedAt: new Date().toISOString(),
      scheduled: Date.now() < HYPERLIQUID_FLOW_TAPE.evalStartMs,
      boundary: boundary.toISOString(),
      checks,
      evidence: {
        taggedRows,
        preBoundaryRows: Number(integrity?.pre_boundary_rows ?? 0),
        unknownVersionRows: Number(integrity?.unknown_version_rows ?? 0),
        mappingViolations: Number(integrity?.mapping_violations ?? 0),
        taggedRowsWithRequiredNulls: Number(integrity?.tagged_rows_with_required_nulls ?? 0),
        firstTaggedAt: firstTaggedAt?.toISOString() ?? null,
        lastTaggedAt: integrity?.last_tagged_at
          ? new Date(String(integrity.last_tagged_at)).toISOString()
          : null,
        eligibleRows: status.eligibleRows,
        usableRows: status.usableRows,
        coverage: status.coverage,
        weakestBucketMarkets: status.weakestBucketMarkets,
        operationalHealth: status.operationalHealth,
        missingColumns,
        sourceViolations,
      },
    },
    null,
    2,
  ),
);

process.exit(passed ? 0 : 1);
