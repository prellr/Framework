/**
 * Reproducible outcome-blind launch/readiness audit for the authoritative taker-flow tape.
 *
 * This script reads only collector status, table metadata, source text, and integrity counts. It
 * never selects trade direction distributions, market outcomes, paper results, fills, or P&L.
 */
import { readFileSync } from "node:fs";
import { db } from "@framework/db";
import { sql } from "drizzle-orm";
import { authoritativeTradeFlowTapeStatus } from "../services/polymarket-trade-flow-report.ts";
import {
  AUTHORITATIVE_TRADE_FLOW_TAPE,
  tradeFlowRpcMethodAllowed,
} from "../services/polymarket-trade-flow-tape.ts";

const serviceSource = readFileSync(
  new URL("../services/polymarket-trade-flow-tape.ts", import.meta.url),
  "utf8",
);
const reportSource = readFileSync(
  new URL("../services/polymarket-trade-flow-report.ts", import.meta.url),
  "utf8",
);
const receiptAuditSource = readFileSync(
  new URL("./verify-authoritative-trade-flow-receipt.ts", import.meta.url),
  "utf8",
);
const schemaSource = readFileSync(
  new URL("../../../../packages/db/src/schema/polymarket-trade-flow-events.ts", import.meta.url),
  "utf8",
);
const executableSource = `${serviceSource}\n${reportSource}\n${receiptAuditSource}`;

const prohibitedSourcePatterns = [
  /\bpaperTrades\b/,
  /\bpolymarketUpdownScore\b/,
  /\bresultNet\b/,
  /\bmarketResolution\b/,
  /\bresolvedOutcome\b/,
  /\bplaceOrder\b/,
  /\bsubmitOrder\b/,
  /\bcancelOrder\b/,
  /\beth_sendRawTransaction\b/,
  /\beth_sendTransaction\b/,
  /\bprivateKey\b/,
  /\bJESTER_API_KEY\b/,
  /from ["'][^"']*(?:trading|credentials|fills-store|paper-floor)["']/,
];
const sourceViolations = prohibitedSourcePatterns
  .filter((pattern) => pattern.test(executableSource))
  .map((pattern) => pattern.source);

const columnsResult = await db.execute(sql`
  select column_name
  from information_schema.columns
  where table_schema = 'public' and table_name = 'polymarket_trade_flow_event'
  order by ordinal_position
`);
const columnNames = columnsResult.rows.map((row) => String(row.column_name));
const prohibitedColumnNames = [
  "resolved",
  "resolution",
  "winner",
  "won",
  "pnl",
  "profit",
  "loss",
  "wallet",
  "credential",
  "account_id",
  "user_id",
  "order_id",
  "position",
];
const prohibitedColumnsPresent = columnNames.filter((column) => prohibitedColumnNames.includes(column));

const [integrity] = (await db.execute(sql`
  select
    count(*)::int as total_rows,
    count(*) filter (
      where event_at < timestamp '2026-07-23 20:00:00'
         or window_start < timestamp '2026-07-23 20:00:00'
    )::int as pre_boundary_rows,
    count(*) filter (
      where pair not in ('BTC-USD','ETH-USD','SOL-USD','XRP-USD','DOGE-USD','BNB-USD')
         or horizon_min not in (5,15)
         or outcome_side not in ('up','down')
         or reported_side not in ('buy','sell')
         or end_date <> window_start + (horizon_min * interval '1 minute')
    )::int as mapping_violations
  from polymarket_trade_flow_event
`)).rows;

const status = await authoritativeTradeFlowTapeStatus();
const readOnlyRpcContract =
  tradeFlowRpcMethodAllowed("eth_blockNumber")
  && tradeFlowRpcMethodAllowed("eth_getTransactionReceipt")
  && !tradeFlowRpcMethodAllowed("eth_sendTransaction")
  && !tradeFlowRpcMethodAllowed("eth_sendRawTransaction");
const checks = {
  exactBoundary: status.evalStartMs === AUTHORITATIVE_TRADE_FLOW_TAPE.evalStartMs,
  paperOnly: status.paperOnly === true,
  outcomeBlind: status.outcomeBlind === true,
  noDirectionalRule: status.directionalRuleRegistered === false,
  noPreBoundaryRows: Number(integrity?.pre_boundary_rows ?? -1) === 0,
  noMappingViolations:
    Number(integrity?.mapping_violations ?? -1) === 0 && status.mappingViolations === 0,
  noProhibitedColumns: prohibitedColumnsPresent.length === 0,
  noProhibitedSourceReads: sourceViolations.length === 0,
  readOnlyRpcContract,
  schemaDeclaresChecks:
    schemaSource.includes("pm_trade_flow_boundary_chk")
    && schemaSource.includes("pm_trade_flow_chain_status_chk"),
};
const passed = Object.values(checks).every(Boolean);

console.log(JSON.stringify({
  passed,
  auditedAt: new Date().toISOString(),
  version: status.version,
  boundary: new Date(status.evalStartMs).toISOString(),
  checks,
  evidence: {
    totalRows: Number(integrity?.total_rows ?? 0),
    preBoundaryRows: Number(integrity?.pre_boundary_rows ?? 0),
    mappingViolations: Number(integrity?.mapping_violations ?? 0),
    tableColumns: columnNames.length,
    prohibitedColumnsPresent,
    sourceViolations,
    rawEvents: status.rawEvents,
    verifiedEvents: status.verifiedEvents,
    distinctMarkets: status.distinctMarkets,
  },
}, null, 2));

process.exit(passed ? 0 : 1);
