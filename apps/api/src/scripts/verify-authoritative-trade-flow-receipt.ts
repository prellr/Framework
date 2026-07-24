/**
 * Independently re-verify the earliest finalized post-boundary trade-flow receipt.
 *
 * This is an outcome-blind launch proof. It selects one public market-stream row, refetches only the
 * Polygon block height and transaction receipt, reruns the frozen reconciliation contract, and
 * compares the decoded receipt fields with what the collector persisted. It never selects market
 * outcomes, paper results, fills, P&L, accounts, wallets, credentials, orders, or positions.
 */
import { db, polymarketTradeFlowEvents } from "@framework/db";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { getSetting } from "../services/config.ts";
import {
  AUTHORITATIVE_TRADE_FLOW_TAPE,
  reconcileTradeFlowReceipt,
  tradeFlowRpcMethodAllowed,
  type PolygonReceipt,
} from "../services/polymarket-trade-flow-tape.ts";

type RpcResponse<T> = {
  id?: string | number;
  result?: T;
  error?: { message?: string };
};

const boundary = new Date(AUTHORITATIVE_TRADE_FLOW_TAPE.evalStartMs);
const [row] = await db
  .select({
    id: polymarketTradeFlowEvents.id,
    conditionId: polymarketTradeFlowEvents.conditionId,
    pair: polymarketTradeFlowEvents.pair,
    horizonMin: polymarketTradeFlowEvents.horizonMin,
    windowStart: polymarketTradeFlowEvents.windowStart,
    eventAt: polymarketTradeFlowEvents.eventAt,
    tokenId: polymarketTradeFlowEvents.tokenId,
    reportedSide: polymarketTradeFlowEvents.reportedSide,
    price: polymarketTradeFlowEvents.price,
    shares: polymarketTradeFlowEvents.shares,
    transactionHash: polymarketTradeFlowEvents.transactionHash,
    chainBlockNumber: polymarketTradeFlowEvents.chainBlockNumber,
    chainConfirmations: polymarketTradeFlowEvents.chainConfirmations,
    chainExchange: polymarketTradeFlowEvents.chainExchange,
    chainSide: polymarketTradeFlowEvents.chainSide,
    chainTokenId: polymarketTradeFlowEvents.chainTokenId,
    chainMakerAmount: polymarketTradeFlowEvents.chainMakerAmount,
    chainTakerAmount: polymarketTradeFlowEvents.chainTakerAmount,
    chainPrice: polymarketTradeFlowEvents.chainPrice,
    chainShares: polymarketTradeFlowEvents.chainShares,
    verificationError: polymarketTradeFlowEvents.verificationError,
  })
  .from(polymarketTradeFlowEvents)
  .where(and(
    eq(polymarketTradeFlowEvents.version, AUTHORITATIVE_TRADE_FLOW_TAPE.version),
    eq(polymarketTradeFlowEvents.chainStatus, "verified"),
    gte(polymarketTradeFlowEvents.eventAt, boundary),
  ))
  // Recheck the hardest already-accepted case, not merely an exact-price row.
  .orderBy(
    sql`abs(${polymarketTradeFlowEvents.price} - ${polymarketTradeFlowEvents.chainPrice}) desc`,
    asc(polymarketTradeFlowEvents.eventAt),
  )
  .limit(1);

if (!row?.transactionHash) {
  console.log(JSON.stringify({
    passed: false,
    available: false,
    auditedAt: new Date().toISOString(),
    version: AUTHORITATIVE_TRADE_FLOW_TAPE.version,
    boundary: boundary.toISOString(),
    reason: "no_verified_post_boundary_receipt",
  }, null, 2));
  process.exit(2);
} else {
  const methods = ["eth_blockNumber", "eth_getTransactionReceipt"] as const;
  if (!methods.every(tradeFlowRpcMethodAllowed)) {
    throw new Error("read-only Polygon RPC contract rejected");
  }

  const rpcUrl = await getSetting("POLYGON_RPC_URL")
    || AUTHORITATIVE_TRADE_FLOW_TAPE.polygonRpc;
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([
      { jsonrpc: "2.0", id: "head", method: methods[0], params: [] },
      {
        jsonrpc: "2.0",
        id: "receipt",
        method: methods[1],
        params: [row.transactionHash],
      },
    ]),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Polygon RPC ${response.status}`);
  const payload = await response.json() as RpcResponse<unknown>[];
  if (!Array.isArray(payload)) throw new Error("Polygon RPC batch response malformed");
  const byId = new Map(payload.map((item) => [String(item.id), item]));
  const headHex = byId.get("head")?.result;
  const receipt = (byId.get("receipt")?.result ?? null) as PolygonReceipt | null;
  if (typeof headHex !== "string" || !/^0x[0-9a-fA-F]+$/.test(headHex)) {
    throw new Error("Polygon RPC head missing");
  }

  const independentlyDecoded = reconcileTradeFlowReceipt(
    {
      tokenId: row.tokenId,
      reportedSide: row.reportedSide === "buy" ? "buy" : "sell",
      price: row.price,
      shares: row.shares,
    },
    receipt,
    Number(BigInt(headHex)),
    Date.now(),
  );
  const within = (left: number | null, right: number | null, tolerance: number) =>
    left != null && right != null && Math.abs(left - right) <= tolerance;
  const checks = {
    postBoundary:
      row.eventAt.getTime() >= AUTHORITATIVE_TRADE_FLOW_TAPE.evalStartMs
      && row.windowStart.getTime() >= AUTHORITATIVE_TRADE_FLOW_TAPE.evalStartMs,
    independentlyVerified: independentlyDecoded.chainStatus === "verified",
    officialExchange:
      independentlyDecoded.chainExchange != null
      && AUTHORITATIVE_TRADE_FLOW_TAPE.exchangeAddresses.includes(
        independentlyDecoded.chainExchange as typeof AUTHORITATIVE_TRADE_FLOW_TAPE.exchangeAddresses[number],
      ),
    finalized:
      (row.chainConfirmations ?? 0) >= AUTHORITATIVE_TRADE_FLOW_TAPE.minConfirmations
      && (independentlyDecoded.chainConfirmations ?? 0)
        >= AUTHORITATIVE_TRADE_FLOW_TAPE.minConfirmations,
    blockMatches: independentlyDecoded.chainBlockNumber === row.chainBlockNumber,
    exchangeMatches: independentlyDecoded.chainExchange === row.chainExchange,
    sideMatches: independentlyDecoded.chainSide === row.chainSide,
    tokenMatches: independentlyDecoded.chainTokenId === row.chainTokenId,
    makerAmountMatches: independentlyDecoded.chainMakerAmount === row.chainMakerAmount,
    takerAmountMatches: independentlyDecoded.chainTakerAmount === row.chainTakerAmount,
    priceMatches: within(
      independentlyDecoded.chainPrice,
      row.chainPrice,
      AUTHORITATIVE_TRADE_FLOW_TAPE.priceTolerance,
    ),
    sharesMatch: within(
      independentlyDecoded.chainShares,
      row.chainShares,
      AUTHORITATIVE_TRADE_FLOW_TAPE.shareTolerance,
    ),
    noVerificationError:
      independentlyDecoded.verificationError == null && row.verificationError == null,
  };
  const passed = Object.values(checks).every(Boolean);

  console.log(JSON.stringify({
    passed,
    available: true,
    auditedAt: new Date().toISOString(),
    version: AUTHORITATIVE_TRADE_FLOW_TAPE.version,
    boundary: boundary.toISOString(),
    sample: {
      rowId: row.id,
      transactionHash: row.transactionHash,
      conditionId: row.conditionId,
      pair: row.pair,
      horizonMin: row.horizonMin,
      windowStart: row.windowStart.toISOString(),
      eventAt: row.eventAt.toISOString(),
      persistedConfirmations: row.chainConfirmations,
      currentConfirmations: independentlyDecoded.chainConfirmations,
      chainBlockNumber: independentlyDecoded.chainBlockNumber,
      chainExchange: independentlyDecoded.chainExchange,
      priceDifference:
        independentlyDecoded.chainPrice == null
          ? null
          : Math.abs(independentlyDecoded.chainPrice - row.price),
      shareDifference:
        independentlyDecoded.chainShares == null
          ? null
          : Math.abs(independentlyDecoded.chainShares - row.shares),
    },
    checks,
  }, null, 2));

  process.exit(passed ? 0 : 1);
}
