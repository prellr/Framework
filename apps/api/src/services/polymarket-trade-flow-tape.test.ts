import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { GammaMarket } from "./polymarket.ts";
import {
  AUTHORITATIVE_TRADE_FLOW_TAPE,
  decodeOrdersMatchedLog,
  isTradeFlowMarketDataFrame,
  mergeTradeFlowMarketMetadata,
  parseTradeFlowEvent,
  reconcileTradeFlowReceipt,
  tradeFlowMarketMetadata,
  tradeFlowPairOfQuestion,
  tradeFlowRpcMethodAllowed,
  tradeFlowCurrentSnapshotsIncomplete,
  tradeFlowCurrentSnapshotsReady,
  tradeFlowSubscriptionEligible,
  tradeFlowSocketStaleness,
  tradeFlowSubscriptionFrame,
  tradeFlowVerifierLoadPerCpu,
  tradeFlowVerificationRetryDue,
  type TradeFlowMarketMeta,
} from "./polymarket-trade-flow-tape.ts";

const boundary = AUTHORITATIVE_TRADE_FLOW_TAPE.evalStartMs;
const conditionId = `0x${"a".repeat(64)}`;
const txHash = `0x${"b".repeat(64)}`;
const upToken = "12345678901234567890";
const downToken = "98765432109876543210";

function market(overrides: Partial<GammaMarket> = {}): GammaMarket {
  return {
    id: "market-1",
    question: "Bitcoin Up or Down - July 23, 3:00PM-3:05PM CT",
    slug: "bitcoin-up-or-down",
    conditionId,
    startDate: new Date(boundary).toISOString(),
    endDate: new Date(boundary + 5 * 60_000).toISOString(),
    active: true,
    closed: false,
    outcomes: JSON.stringify(["Up", "Down"]),
    clobTokenIds: JSON.stringify([upToken, downToken]),
    ...overrides,
  };
}

function metadata(): Map<string, TradeFlowMarketMeta> {
  return new Map(tradeFlowMarketMetadata(market()).map((row) => [row.tokenId, row]));
}

function word(value: bigint | number | string): string {
  const n = typeof value === "string" ? BigInt(value) : BigInt(value);
  return n.toString(16).padStart(64, "0");
}

function ordersMatchedLog(
  side: 0 | 1,
  tokenId = upToken,
  makerAmount = 3_000_000,
  takerAmount = 5_000_000,
) {
  return {
    address: AUTHORITATIVE_TRADE_FLOW_TAPE.exchangeAddresses[0],
    topics: [AUTHORITATIVE_TRADE_FLOW_TAPE.ordersMatchedTopic],
    data: `0x${word(side)}${word(tokenId)}${word(makerAmount)}${word(takerAmount)}`,
  };
}

function reported(overrides: Record<string, unknown> = {}) {
  return {
    event_type: "last_trade_price",
    market: conditionId,
    asset_id: upToken,
    price: "0.6",
    size: "5",
    side: "BUY",
    fee_rate_bps: "0",
    timestamp: String(boundary + 1_000),
    transaction_hash: txHash,
    ...overrides,
  };
}

test("frozen collector constants preserve the prospective boundary, universe, and readiness floor", () => {
  assert.equal(
    AUTHORITATIVE_TRADE_FLOW_TAPE.version,
    "polymarket-authoritative-taker-flow-tape-v1",
  );
  assert.equal(boundary, Date.UTC(2026, 6, 23, 20, 0, 0));
  assert.deepEqual(AUTHORITATIVE_TRADE_FLOW_TAPE.targetPairs, [
    "BTC-USD",
    "ETH-USD",
    "SOL-USD",
    "XRP-USD",
    "DOGE-USD",
    "BNB-USD",
  ]);
  assert.deepEqual(AUTHORITATIVE_TRADE_FLOW_TAPE.targetHorizonsMin, [5, 15]);
  // Polymarket/ctf-exchange-v2, src/exchange/mixins/Events.sol:
  // keccak256("OrdersMatched(bytes32,address,uint8,uint256,uint256,uint256)").
  assert.equal(
    AUTHORITATIVE_TRADE_FLOW_TAPE.ordersMatchedTopic,
    "0x174b3811690657c217184f89418266767c87e4805d09680c39fc9c031c0cab7c",
  );
  assert.deepEqual(AUTHORITATIVE_TRADE_FLOW_TAPE.exchangeAddresses, [
    "0xe111180000d2663c0091e4f400237545b87b996b",
    "0xe2222d279d744050d28e00520010520000310f59",
  ]);
  assert.equal(AUTHORITATIVE_TRADE_FLOW_TAPE.minConfirmations, 20);
  assert.equal(AUTHORITATIVE_TRADE_FLOW_TAPE.priceTolerance, 0.005000001);
  assert.equal(AUTHORITATIVE_TRADE_FLOW_TAPE.verifyMs, 10_000);
  assert.equal(AUTHORITATIVE_TRADE_FLOW_TAPE.verifyBatch, 200);
  assert.equal(AUTHORITATIVE_TRADE_FLOW_TAPE.verifyRetryMs, 60_000);
  assert.equal(AUTHORITATIVE_TRADE_FLOW_TAPE.verifyMaxLoadPerCpu, 0.75);
  assert.equal(AUTHORITATIVE_TRADE_FLOW_TAPE.verifyTelemetryMs, 5 * 60_000);
  assert.equal(AUTHORITATIVE_TRADE_FLOW_TAPE.staleMarketDataMs, 90_000);
  assert.equal(AUTHORITATIVE_TRADE_FLOW_TAPE.currentBookInitGraceMs, 15_000);
  assert.equal(AUTHORITATIVE_TRADE_FLOW_TAPE.reconnectStableMs, 60_000);
  assert.equal(AUTHORITATIVE_TRADE_FLOW_TAPE.subscriptionLeadMs, 60_000);
  assert.equal(AUTHORITATIVE_TRADE_FLOW_TAPE.minRawEvents, 10_000);
  assert.equal(AUTHORITATIVE_TRADE_FLOW_TAPE.minVerifiedEvents, 5_000);
  assert.equal(AUTHORITATIVE_TRADE_FLOW_TAPE.minMarkets, 500);
  assert.equal(AUTHORITATIVE_TRADE_FLOW_TAPE.minSpanDays, 7);
});

test("receipt verifier load guard normalizes host pressure and fails closed on invalid telemetry", () => {
  assert.equal(tradeFlowVerifierLoadPerCpu(1.5, 10), 0.15);
  assert.equal(tradeFlowVerifierLoadPerCpu(7.5, 10), 0.75);
  assert.equal(tradeFlowVerifierLoadPerCpu(2, 3.9), 2 / 3);
  assert.equal(tradeFlowVerifierLoadPerCpu(Number.NaN, 10), Number.POSITIVE_INFINITY);
  assert.equal(tradeFlowVerifierLoadPerCpu(1, 0), Number.POSITIVE_INFINITY);
});

test("receipt retry clock admits new rows immediately and durably backs off attempted rows", () => {
  const now = Date.UTC(2026, 6, 25, 7, 0, 0);
  assert.equal(tradeFlowVerificationRetryDue(null, now), true);
  assert.equal(
    tradeFlowVerificationRetryDue(new Date(now - 59_999), now),
    false,
  );
  assert.equal(
    tradeFlowVerificationRetryDue(new Date(now - 60_000).toISOString(), now),
    true,
  );
  assert.equal(tradeFlowVerificationRetryDue("not-a-date", now), false);
  assert.equal(tradeFlowVerificationRetryDue(null, Number.NaN), false);
});

test("market stream subscribes to standard trade events without unused custom traffic", () => {
  assert.deepEqual(tradeFlowSubscriptionFrame([upToken, downToken]), {
    assets_ids: [upToken, downToken],
    type: "market",
  });
  assert.deepEqual(tradeFlowSubscriptionFrame([upToken], "subscribe"), {
    assets_ids: [upToken],
    operation: "subscribe",
  });
  assert.deepEqual(tradeFlowSubscriptionFrame([downToken], "unsubscribe"), {
    assets_ids: [downToken],
    operation: "unsubscribe",
  });
  assert.equal("custom_feature_enabled" in tradeFlowSubscriptionFrame([upToken]), false);
});

test("market-data liveness excludes heartbeats, empty snapshots, and error envelopes", () => {
  for (const eventType of [
    "book",
    "price_change",
    "last_trade_price",
    "tick_size_change",
    "best_bid_ask",
    "new_market",
    "market_resolved",
  ]) {
    assert.equal(isTradeFlowMarketDataFrame({ event_type: eventType }), true, eventType);
  }
  assert.equal(
    isTradeFlowMarketDataFrame({
      topic: "market",
      payload: { event_type: "price_change" },
    }),
    true,
  );
  assert.equal(isTradeFlowMarketDataFrame("PONG"), false);
  assert.equal(isTradeFlowMarketDataFrame([]), false);
  assert.equal(isTradeFlowMarketDataFrame({}), false);
  assert.equal(isTradeFlowMarketDataFrame({ error: "subscription unavailable" }), false);
});

test("socket watchdog catches silent market-data freezes even while PONG remains fresh", () => {
  const now = boundary + 5 * 60_000;
  assert.equal(tradeFlowSocketStaleness(now, now - 1_000, now - 1_000), null);
  assert.equal(
    tradeFlowSocketStaleness(
      now,
      now - 1_000,
      now - AUTHORITATIVE_TRADE_FLOW_TAPE.staleMarketDataMs - 1,
    ),
    "market_data",
  );
  assert.equal(
    tradeFlowSocketStaleness(
      now,
      now - AUTHORITATIVE_TRADE_FLOW_TAPE.staleSocketMs - 1,
      now - 1_000,
    ),
    "transport",
  );
  assert.equal(tradeFlowSocketStaleness(now, Number.NaN, now), "transport");
});

test("current-snapshot watchdog rejects partial subscriptions only after the bounded grace period", () => {
  const openedAt = boundary + 1_000;
  assert.equal(tradeFlowCurrentSnapshotsIncomplete(openedAt + 14_999, openedAt, 24, 1), false);
  assert.equal(tradeFlowCurrentSnapshotsIncomplete(openedAt + 15_000, openedAt, 24, 1), true);
  assert.equal(tradeFlowCurrentSnapshotsIncomplete(openedAt + 60_000, openedAt, 24, 24), false);
  assert.equal(tradeFlowCurrentSnapshotsIncomplete(openedAt + 60_000, openedAt, 0, 0), false);
  assert.equal(tradeFlowCurrentSnapshotsIncomplete(openedAt - 1, openedAt, 24, 1), true);
  assert.equal(tradeFlowCurrentSnapshotsIncomplete(openedAt + 60_000, openedAt, 24, 25), true);
  assert.equal(
    tradeFlowCurrentSnapshotsIncomplete(openedAt + 60_000, openedAt, Number.NaN, 0),
    true,
  );
});

test("complete current snapshots reset reconnect debt without trusting transport-only health", () => {
  assert.equal(tradeFlowCurrentSnapshotsReady(24, 24), true);
  assert.equal(tradeFlowCurrentSnapshotsReady(12, 12), true);
  assert.equal(tradeFlowCurrentSnapshotsReady(24, 23), false);
  assert.equal(tradeFlowCurrentSnapshotsReady(24, 0), false);
  assert.equal(tradeFlowCurrentSnapshotsReady(0, 0), false);
  assert.equal(tradeFlowCurrentSnapshotsReady(Number.NaN, 0), false);
  assert.equal(tradeFlowCurrentSnapshotsReady(24, 25), false);
});

test("the message path confirms complete-snapshot recovery before the watchdog tick", () => {
  const source = readFileSync(
    new URL("./polymarket-trade-flow-tape.ts", import.meta.url),
    "utf8",
  );
  const messageStart = source.indexOf('ws.addEventListener("message"');
  const closeStart = source.indexOf('ws.addEventListener("close"', messageStart);
  assert.ok(messageStart >= 0 && closeStart > messageStart);
  const messagePath = source.slice(messageStart, closeStart);
  assert.match(messagePath, /!snapshotRecoveryConfirmed/);
  assert.match(messagePath, /clobEventOfiInitializationStats/);
  assert.match(messagePath, /tradeFlowCurrentSnapshotsReady/);
  assert.match(messagePath, /reconnectAttempt = 0/);
  assert.match(messagePath, /snapshotRecoveryConfirmed = true/);
});

test("socket subscription keeps live markets and one bounded handoff without narrowing discovery", () => {
  const now = boundary + 10 * 60_000;
  const row: TradeFlowMarketMeta = {
    conditionId,
    tokenId: upToken,
    pair: "BTC-USD",
    horizonMin: 5,
    windowStartMs: now - 4 * 60_000,
    endDateMs: now + 60_000,
    outcomeSide: "up",
  };
  assert.equal(tradeFlowSubscriptionEligible(row, now), true);
  assert.equal(
    tradeFlowSubscriptionEligible(
      { ...row, windowStartMs: now + AUTHORITATIVE_TRADE_FLOW_TAPE.subscriptionLeadMs },
      now,
    ),
    true,
  );
  assert.equal(
    tradeFlowSubscriptionEligible(
      { ...row, windowStartMs: now + AUTHORITATIVE_TRADE_FLOW_TAPE.subscriptionLeadMs + 1 },
      now,
    ),
    false,
  );
  assert.equal(
    tradeFlowSubscriptionEligible({ ...row, endDateMs: now }, now),
    false,
  );
  assert.equal(
    tradeFlowSubscriptionEligible(row, Number.NaN),
    false,
  );
});

test("partial discovery retains unexpired metadata and prunes only immutable expiries", () => {
  const now = boundary + 10 * 60_000;
  const retained: TradeFlowMarketMeta = {
    conditionId,
    tokenId: upToken,
    pair: "BTC-USD",
    horizonMin: 5,
    windowStartMs: now - 4 * 60_000,
    endDateMs: now + 60_000,
    outcomeSide: "up",
  };
  const expired: TradeFlowMarketMeta = {
    ...retained,
    tokenId: "expired-token",
    endDateMs: now,
  };
  const discovered: TradeFlowMarketMeta = {
    ...retained,
    tokenId: downToken,
    outcomeSide: "down",
  };
  const previous = new Map([
    [retained.tokenId, retained],
    [expired.tokenId, expired],
  ]);
  const merged = mergeTradeFlowMarketMetadata(previous, [discovered], now);
  assert.deepEqual([...merged.keys()].sort(), [downToken, upToken].sort());
  assert.equal(merged.get(upToken), retained);
  assert.equal(merged.get(downToken), discovered);
  assert.equal(previous.size, 2);
  assert.equal(mergeTradeFlowMarketMetadata(previous, [], Number.NaN).size, 0);
});

test("question and Gamma mapping admit only the frozen six-asset 5m/15m prospective universe", () => {
  assert.equal(tradeFlowPairOfQuestion("Ethereum Up or Down"), "ETH-USD");
  assert.equal(tradeFlowPairOfQuestion("Solana Up or Down"), "SOL-USD");
  assert.equal(tradeFlowPairOfQuestion("ADA Up or Down"), null);
  const rows = tradeFlowMarketMetadata(market());
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => [row.tokenId, row.outcomeSide]),
    [
      [upToken, "up"],
      [downToken, "down"],
    ],
  );
  assert.equal(rows[0]?.windowStartMs, boundary);
  assert.equal(
    tradeFlowMarketMetadata(
      market({
        endDate: new Date(boundary).toISOString(),
      }),
    ).length,
    0,
  );
  assert.equal(
    tradeFlowMarketMetadata(
      market({
        question: "Bitcoin Up or Down - July 23, 3PM-4PM CT",
        endDate: new Date(boundary + 60 * 60_000).toISOString(),
      }),
    ).length,
    0,
  );
  assert.equal(
    tradeFlowMarketMetadata(
      market({
        clobTokenIds: JSON.stringify([upToken, upToken]),
      }),
    ).length,
    0,
  );
});

test("public market events parse in legacy and normalized forms and fail closed", () => {
  const receivedAt = boundary + 1_050;
  const parsed = parseTradeFlowEvent(reported(), receivedAt, metadata());
  assert.ok(parsed);
  assert.equal(parsed.conditionId, conditionId);
  assert.equal(parsed.reportedSide, "buy");
  assert.equal(parsed.price, 0.6);
  assert.equal(parsed.shares, 5);
  assert.equal(parsed.notionalUsd, 3);
  assert.equal(parsed.ingestionLatencyMs, 50);
  assert.equal(parsed.chainStatus, "pending");

  const normalized = parseTradeFlowEvent(
    {
      topic: "market",
      type: "last_trade_price",
      payload: {
        market: conditionId,
        tokenId: upToken,
        price: 0.6,
        size: 5,
        side: "BUY",
        feeRateBps: 0,
        timestamp: boundary + 1_000,
        transactionHash: txHash,
      },
    },
    receivedAt,
    metadata(),
  );
  assert.deepEqual(normalized, parsed);

  assert.equal(
    parseTradeFlowEvent(reported({ timestamp: boundary - 1 }), receivedAt, metadata()),
    null,
  );
  assert.equal(
    parseTradeFlowEvent(reported({ market: `0x${"c".repeat(64)}` }), receivedAt, metadata()),
    null,
  );
  assert.equal(
    parseTradeFlowEvent(reported({ asset_id: "unknown" }), receivedAt, metadata()),
    null,
  );
  assert.equal(parseTradeFlowEvent(reported({ side: "UNKNOWN" }), receivedAt, metadata()), null);
  assert.equal(parseTradeFlowEvent(reported({ price: 1 }), receivedAt, metadata()), null);
  assert.equal(parseTradeFlowEvent(reported({ size: 0 }), receivedAt, metadata()), null);
  assert.equal(
    parseTradeFlowEvent(reported({ transaction_hash: "missing" }), receivedAt, metadata())
      ?.chainStatus,
    "missing_hash",
  );
});

test("official OrdersMatched logs decode BUY and SELL amount orientation exactly", () => {
  assert.deepEqual(decodeOrdersMatchedLog(ordersMatchedLog(0)), {
    exchange: AUTHORITATIVE_TRADE_FLOW_TAPE.exchangeAddresses[0],
    side: "buy",
    tokenId: upToken,
    makerAmount: "3000000",
    takerAmount: "5000000",
    price: 0.6,
    shares: 5,
  });
  assert.deepEqual(decodeOrdersMatchedLog(ordersMatchedLog(1, upToken, 5_000_000, 3_000_000)), {
    exchange: AUTHORITATIVE_TRADE_FLOW_TAPE.exchangeAddresses[0],
    side: "sell",
    tokenId: upToken,
    makerAmount: "5000000",
    takerAmount: "3000000",
    price: 0.6,
    shares: 5,
  });
  assert.equal(
    decodeOrdersMatchedLog({ ...ordersMatchedLog(0), address: `0x${"1".repeat(40)}` }),
    null,
  );
  assert.equal(
    decodeOrdersMatchedLog({
      ...ordersMatchedLog(0),
      topics: [`0x${"2".repeat(64)}`],
    }),
    null,
  );
  assert.equal(decodeOrdersMatchedLog(ordersMatchedLog(0, upToken, 0, 5_000_000)), null);
  assert.equal(
    decodeOrdersMatchedLog({
      ...ordersMatchedLog(0),
      data: `0x${word(2)}${word(upToken)}${word(3_000_000)}${word(5_000_000)}`,
    }),
    null,
  );
});

test("receipt reconciliation enforces success, finality, token, side, size, and price", () => {
  const row = { tokenId: upToken, reportedSide: "buy" as const, price: 0.6, shares: 5 };
  const receipt = {
    status: "0x1",
    blockNumber: "0x64",
    logs: [ordersMatchedLog(0)],
  };
  const verified = reconcileTradeFlowReceipt(row, receipt, 119, boundary + 100_000);
  assert.equal(verified.chainStatus, "verified");
  assert.equal(verified.chainConfirmations, 20);
  assert.equal(verified.chainTokenId, upToken);
  assert.equal(verified.verificationError, null);

  assert.equal(reconcileTradeFlowReceipt(row, receipt, 118, boundary).chainStatus, "pending");
  assert.equal(reconcileTradeFlowReceipt(row, null, 119, boundary).chainStatus, "pending");
  assert.equal(
    reconcileTradeFlowReceipt(row, { ...receipt, status: "0x0" }, 119, boundary).chainStatus,
    "reverted",
  );
  assert.equal(
    reconcileTradeFlowReceipt(
      row,
      { ...receipt, logs: [ordersMatchedLog(0, downToken)] },
      119,
      boundary,
    ).verificationError,
    "token_not_found",
  );
  assert.equal(
    reconcileTradeFlowReceipt(
      row,
      {
        ...receipt,
        logs: [ordersMatchedLog(1, upToken, 5_000_000, 3_000_000)],
      },
      119,
      boundary,
    ).verificationError,
    "side_mismatch",
  );
  assert.equal(
    reconcileTradeFlowReceipt(
      row,
      {
        ...receipt,
        logs: [ordersMatchedLog(0, upToken, 3_000_000, 4_000_000)],
      },
      119,
      boundary,
    ).verificationError,
    "share_mismatch",
  );
  assert.equal(
    reconcileTradeFlowReceipt(
      row,
      {
        ...receipt,
        logs: [ordersMatchedLog(0, upToken, 3_100_000, 5_000_000)],
      },
      119,
      boundary,
    ).verificationError,
    "price_mismatch",
  );
});

test("multi-fill receipts select the exact matching OrdersMatched event", () => {
  const row = { tokenId: upToken, reportedSide: "buy" as const, price: 0.6, shares: 5 };
  const result = reconcileTradeFlowReceipt(
    row,
    {
      status: "0x1",
      blockNumber: "0x64",
      logs: [
        ordersMatchedLog(0, upToken, 4_000_000, 5_000_000),
        ordersMatchedLog(0, upToken, 3_000_000, 5_000_000),
      ],
    },
    119,
    boundary,
  );
  assert.equal(result.chainStatus, "verified");
  assert.equal(result.chainPrice, 0.6);
});

test("receipt reconciliation accepts only the half-tick stream quantization bound", () => {
  const rounded = {
    tokenId: upToken,
    reportedSide: "buy" as const,
    price: 0.5,
    shares: 1,
  };
  assert.equal(
    reconcileTradeFlowReceipt(
      rounded,
      {
        status: "0x1",
        blockNumber: "0x64",
        logs: [ordersMatchedLog(0, upToken, 505_000, 1_000_000)],
      },
      119,
      boundary,
    ).chainStatus,
    "verified",
  );
  assert.equal(
    reconcileTradeFlowReceipt(
      rounded,
      {
        status: "0x1",
        blockNumber: "0x64",
        logs: [ordersMatchedLog(0, upToken, 505_002, 1_000_000)],
      },
      119,
      boundary,
    ).verificationError,
    "price_mismatch",
  );
});

test("Polygon RPC guard admits only public read-only receipt methods", () => {
  for (const method of ["eth_blockNumber", "eth_getTransactionReceipt"]) {
    assert.equal(tradeFlowRpcMethodAllowed(method), true);
  }
  for (const method of [
    "eth_sendTransaction",
    "eth_sendRawTransaction",
    "eth_sign",
    "personal_sign",
    "eth_call",
    "placeOrder",
    "",
  ]) {
    assert.equal(tradeFlowRpcMethodAllowed(method), false);
  }
});

test("collector source has no outcome ledger, Jester client, order, signing, or fund dependency", () => {
  const source = readFileSync(new URL("./polymarket-trade-flow-tape.ts", import.meta.url), "utf8");
  assert.match(source, /verificationAttemptedAt/);
  assert.match(source, /verificationAttempts/);
  assert.match(source, /verifyRetryMs/);
  for (const prohibited of [
    /\bpaperTrades\b/,
    /\bpolymarketUpdownScore\b/,
    /\bmarketResolution\b/,
    /\bresolvedOutcome\b/,
    /\bplaceOrder\b/,
    /\bsubmitOrder\b/,
    /\bcancelOrder\b/,
    /\beth_sendRawTransaction\b/,
    /\beth_sendTransaction\b/,
    /\bprivateKey\b/,
    /\bJESTER_API_KEY\b/,
    /from ["'][^"']*(?:jester|trading|credentials|fills-store|paper-floor)["']/,
  ]) {
    assert.doesNotMatch(source, prohibited);
  }
  const importSources = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
  assert.deepEqual(importSources.sort(), [
    "./clob-event-ofi.ts",
    "./config.ts",
    "./polymarket.ts",
    "@framework/db",
    "drizzle-orm",
    "node:crypto",
    "node:os",
  ]);
});

test("external trade-flow methodology provenance is evidence-blind and non-executable", () => {
  const source = readFileSync(
    new URL(
      "../scripts/record-authoritative-trade-flow-research-provenance.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /arxiv\.org\/abs\/2604\.24366/);
  assert.match(source, /github\.com\/philippdubach\/polymarket-microstructure/);
  for (const prohibited of [
    /\bpolymarketTradeFlowEvents\b/,
    /\bpaperTrades\b/,
    /\bpolymarketUpdownScore\b/,
    /\bauthoritativeTradeFlowTapeStatus\b/,
    /\bplaceOrder\b/,
    /\bsubmitOrder\b/,
    /\bcancelOrder\b/,
    /\bprivateKey\b/,
  ]) {
    assert.doesNotMatch(source, prohibited);
  }
});
