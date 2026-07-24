/**
 * Read-only Hyperliquid BBO and public-trade stream for synchronized market research.
 *
 * One public WebSocket carries six BBO subscriptions plus six public trade subscriptions. The
 * exchange timestamp and local receive timestamp are both retained so later research can
 * distinguish source-clock lag from transport lag. Trades remain in a bounded in-memory buffer and
 * are exposed only as rolling aggregates; no raw-trade persistence, account, or order path exists.
 */
const HL_WS = "wss://api.hyperliquid.xyz/ws";
const PAIR_BY_COIN: Record<string, string> = {
  BTC: "BTC-USD",
  ETH: "ETH-USD",
  SOL: "SOL-USD",
  XRP: "XRP-USD",
  DOGE: "DOGE-USD",
  BNB: "BNB-USD",
};

export interface HlBboTick {
  pair: string;
  px: number;
  sourceAtMs: number;
  receivedAtMs: number;
}

const latest = new Map<string, HlBboTick>();
const FLOW_RETENTION_MS = 5 * 60_000;
let started = false;
let reconnectAttempt = 0;

export const HYPERLIQUID_FLOW_TAPE = {
  version: "updown-hyperliquid-taker-flow-tape-v2",
  evalStartMs: Date.UTC(2026, 6, 24, 2, 0, 0),
  minUsableRows: 20_000,
  minResolvedMarkets: 1_500,
  minSpanDays: 5,
  minMarketsPerBucket: 100,
  minCoverage: 0.95,
  // This is the age of the most recent public trade included in a 60s aggregate, not a socket
  // heartbeat. Quiet 5s/30s subwindows are valid sparse flow; the state-tape capture age and
  // per-trade transport lag independently fail closed on a stalled or delayed feed.
  maxLastTradeAgeSec: 60,
  maxTransportLagMs: 5_000,
  windowsMs: [5_000, 30_000, 60_000] as const,
} as const;

export interface HlTradeTick {
  pair: string;
  side: "buy" | "sell";
  px: number;
  size: number;
  notional: number;
  sourceAtMs: number;
  receivedAtMs: number;
  tid: number;
}

export interface HlFlowSnapshot {
  version: string;
  pair: string;
  capturedAtMs: number;
  imbalance5s: number | null;
  imbalance30s: number | null;
  imbalance60s: number | null;
  notional60s: number;
  tradeCount60s: number;
  maxTradeShare60s: number | null;
  sourceAgeSec: number;
  receiveAgeSec: number;
  maxTransportLagMs60s: number;
}

/** Parse only complete, positive two-sided BBO updates. Exported for deterministic tests. */
export function parseHlBbo(message: unknown, receivedAtMs: number): HlBboTick | null {
  if (!message || typeof message !== "object") return null;
  const root = message as { channel?: unknown; data?: unknown };
  if (root.channel !== "bbo" || !root.data || typeof root.data !== "object") return null;
  const data = root.data as { coin?: unknown; time?: unknown; bbo?: unknown };
  if (typeof data.coin !== "string" || !PAIR_BY_COIN[data.coin]) return null;
  if (!Number.isFinite(Number(data.time)) || !Array.isArray(data.bbo) || data.bbo.length !== 2) return null;
  const bid = data.bbo[0] as { px?: unknown } | null;
  const ask = data.bbo[1] as { px?: unknown } | null;
  const bidPx = Number(bid?.px), askPx = Number(ask?.px);
  if (!(bidPx > 0) || !(askPx > 0) || askPx < bidPx) return null;
  return {
    pair: PAIR_BY_COIN[data.coin],
    px: (bidPx + askPx) / 2,
    sourceAtMs: Number(data.time),
    receivedAtMs,
  };
}

/** Parse public aggressor-side trades. Hyperliquid documents B as buy and A as sell/ask. */
export function parseHlTrades(message: unknown, receivedAtMs: number): HlTradeTick[] {
  if (!message || typeof message !== "object") return [];
  const root = message as { channel?: unknown; data?: unknown };
  if (root.channel !== "trades" || !Array.isArray(root.data)) return [];
  const ticks: HlTradeTick[] = [];
  for (const item of root.data) {
    if (!item || typeof item !== "object") continue;
    const trade = item as {
      coin?: unknown;
      side?: unknown;
      px?: unknown;
      sz?: unknown;
      time?: unknown;
      tid?: unknown;
    };
    if (typeof trade.coin !== "string" || !PAIR_BY_COIN[trade.coin]) continue;
    if (trade.side !== "B" && trade.side !== "A") continue;
    const px = Number(trade.px);
    const size = Number(trade.sz);
    const sourceAtMs = Number(trade.time);
    const tid = Number(trade.tid);
    if (!(px > 0) || !(size > 0) || !Number.isFinite(sourceAtMs) || !Number.isSafeInteger(tid)) continue;
    ticks.push({
      pair: PAIR_BY_COIN[trade.coin],
      side: trade.side === "B" ? "buy" : "sell",
      px,
      size,
      notional: px * size,
      sourceAtMs,
      receivedAtMs,
      tid,
    });
  }
  return ticks;
}

type FlowWindow = {
  imbalance: number | null;
  notional: number;
  trades: number;
  maxTradeShare: number | null;
  maxTransportLagMs: number;
};

const summarizeFlowWindow = (
  ticks: readonly HlTradeTick[],
  capturedAtMs: number,
  windowMs: number,
): FlowWindow => {
  let buy = 0;
  let sell = 0;
  let maxNotional = 0;
  let maxTransportLagMs = 0;
  let trades = 0;
  const startMs = capturedAtMs - windowMs;
  for (const tick of ticks) {
    // Both clocks must place the event in-window. This prevents a reconnect backfill from becoming
    // a false "fresh" impulse merely because it was delivered recently.
    if (
      tick.receivedAtMs <= startMs
      || tick.receivedAtMs > capturedAtMs
      || tick.sourceAtMs <= startMs
      || tick.sourceAtMs > capturedAtMs + 5_000
    ) continue;
    if (tick.side === "buy") buy += tick.notional;
    else sell += tick.notional;
    maxNotional = Math.max(maxNotional, tick.notional);
    maxTransportLagMs = Math.max(maxTransportLagMs, Math.max(0, tick.receivedAtMs - tick.sourceAtMs));
    trades++;
  }
  const notional = buy + sell;
  return {
    imbalance: notional > 0 ? (buy - sell) / notional : null,
    notional,
    trades,
    maxTradeShare: notional > 0 ? maxNotional / notional : null,
    maxTransportLagMs,
  };
};

export function createHlFlowAccumulator(retentionMs = FLOW_RETENTION_MS) {
  const buffers = new Map<string, HlTradeTick[]>();
  const seen = new Map<string, number>();

  const ingest = (ticks: readonly HlTradeTick[]) => {
    for (const tick of ticks) {
      const key = `${tick.pair}:${tick.sourceAtMs}:${tick.tid}`;
      if (seen.has(key)) continue;
      seen.set(key, tick.receivedAtMs);
      const buffer = buffers.get(tick.pair) ?? [];
      buffer.push(tick);
      buffers.set(tick.pair, buffer);
      const cutoff = tick.receivedAtMs - retentionMs;
      while (buffer.length && buffer[0].receivedAtMs < cutoff) {
        const expired = buffer.shift();
        if (expired) seen.delete(`${expired.pair}:${expired.sourceAtMs}:${expired.tid}`);
      }
    }
  };

  const snapshot = (pair: string, capturedAtMs = Date.now()): HlFlowSnapshot | null => {
    const ticks = buffers.get(pair) ?? [];
    const sixty = summarizeFlowWindow(ticks, capturedAtMs, 60_000);
    if (!sixty.trades) return null;
    const five = summarizeFlowWindow(ticks, capturedAtMs, 5_000);
    const thirty = summarizeFlowWindow(ticks, capturedAtMs, 30_000);
    const latestTick = ticks
      .filter((tick) => tick.receivedAtMs <= capturedAtMs && tick.sourceAtMs <= capturedAtMs + 5_000)
      .reduce<HlTradeTick | null>(
        (latestTick, tick) => !latestTick || tick.receivedAtMs > latestTick.receivedAtMs ? tick : latestTick,
        null,
      );
    if (!latestTick) return null;
    return {
      version: HYPERLIQUID_FLOW_TAPE.version,
      pair,
      capturedAtMs,
      imbalance5s: five.imbalance,
      imbalance30s: thirty.imbalance,
      imbalance60s: sixty.imbalance,
      notional60s: sixty.notional,
      tradeCount60s: sixty.trades,
      maxTradeShare60s: sixty.maxTradeShare,
      sourceAgeSec: (capturedAtMs - latestTick.sourceAtMs) / 1000,
      receiveAgeSec: (capturedAtMs - latestTick.receivedAtMs) / 1000,
      maxTransportLagMs60s: sixty.maxTransportLagMs,
    };
  };

  return { ingest, snapshot };
}

const flowAccumulator = createHlFlowAccumulator();

function connect() {
  const ws = new WebSocket(HL_WS);
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  ws.addEventListener("open", () => {
    reconnectAttempt = 0;
    for (const coin of Object.keys(PAIR_BY_COIN)) {
      ws.send(JSON.stringify({ method: "subscribe", subscription: { type: "bbo", coin } }));
      ws.send(JSON.stringify({ method: "subscribe", subscription: { type: "trades", coin } }));
    }
    // Hyperliquid closes quiet clients after 60s without a client message.
    pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ method: "ping" }));
    }, 30_000);
  });
  ws.addEventListener("message", (event: MessageEvent) => {
    let decoded: unknown;
    try { decoded = JSON.parse(typeof event.data === "string" ? event.data : String(event.data)); }
    catch { return; }
    const receivedAtMs = Date.now();
    const tick = parseHlBbo(decoded, receivedAtMs);
    if (tick) latest.set(tick.pair, tick);
    flowAccumulator.ingest(parseHlTrades(decoded, receivedAtMs));
  });
  ws.addEventListener("close", () => {
    if (pingTimer) clearInterval(pingTimer);
    reconnectAttempt++;
    setTimeout(connect, Math.min(1000 * 2 ** reconnectAttempt, 30_000));
  });
  ws.addEventListener("error", () => { try { ws.close(); } catch { /* close handler reconnects */ } });
}

export function startHlRtds() {
  if (started) return;
  started = true;
  connect();
  console.log(`[hl-rtds] opening BBO + public-trade stream for ${Object.keys(PAIR_BY_COIN).length} symbols`);
}

export function hlBboNow(pair: string): (HlBboTick & { sourceAgeSec: number; receiveAgeSec: number }) | null {
  const tick = latest.get(pair);
  if (!tick) return null;
  const now = Date.now();
  return {
    ...tick,
    sourceAgeSec: (now - tick.sourceAtMs) / 1000,
    receiveAgeSec: (now - tick.receivedAtMs) / 1000,
  };
}

/** Rolling public-trade aggregate available at a causal local capture time. */
export function hlFlowNow(pair: string, capturedAtMs = Date.now()): HlFlowSnapshot | null {
  return flowAccumulator.snapshot(pair, capturedAtMs);
}

export const HL_RTDS_PAIRS = Object.values(PAIR_BY_COIN);

export function hlRtdsStatus() {
  const now = Date.now();
  return {
    started,
    pairs: [...latest.values()].map((tick) => {
      const flow = hlFlowNow(tick.pair, now);
      return {
        pair: tick.pair,
        sourceAgoSec: (now - tick.sourceAtMs) / 1000,
        receivedAgoSec: (now - tick.receivedAtMs) / 1000,
        flow: flow ? { trades60s: flow.tradeCount60s, receiveAgoSec: flow.receiveAgeSec } : null,
      };
    }),
  };
}
