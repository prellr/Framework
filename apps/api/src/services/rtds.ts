/**
 * Polymarket RTDS (Real-Time Data Service) client — the Chainlink price stream these markets actually
 * RESOLVE on. Public, unauthenticated WebSocket at wss://ws-live-data.polymarket.com, topic
 * `crypto_prices_chainlink`, ~1 Hz per symbol. The pricer bots use this as their price/strike source
 * so distance-to-strike is measured in the SAME units the market settles (Chainlink BTC/USD), not the
 * Hyperliquid mark — the basis between the two is largest near expiry, exactly the pricer's edge zone.
 *
 * Worker-resident singleton: one connection, a rolling per-pair (t, px) buffer read in-process by the
 * floor tick. Read-only market data — nothing here trades. See KB github-updown-prior-art / the market
 * description ("price according to Chainlink data stream BTC/USD, not other sources or spot markets").
 */
const RTDS_HOST = "wss://ws-live-data.polymarket.com";
const SYMS: Record<string, string> = {
  "BTC-USD": "btc/usd", "ETH-USD": "eth/usd", "SOL-USD": "sol/usd",
  "XRP-USD": "xrp/usd", "DOGE-USD": "doge/usd", "BNB-USD": "bnb/usd",
};
const REV: Record<string, string> = Object.fromEntries(Object.entries(SYMS).map(([k, v]) => [v, k]));
export const RTDS_BUFFER_MS = 65 * 60_000; // cover a 60m window's strike + headroom
const FRESH_SEC = 20; // a price older than this = treat the feed as stale, fall back to Hyperliquid
export const RTDS_STALE_RECONNECT_MS = 30_000; // an open socket with no data is a zombie; reconnect it

export type RtdsTick = { t: number; px: number; receivedAt: number };
type Tick = RtdsTick;
const buffers = new Map<string, Tick[]>();
const attempts = new Map<string, number>();
let started = false;

export interface PeakGapRetentionStats {
  currentPx: number;
  currentGapLog: number;
  peakAbsGapLog: number;
  retention: number;
  tickCount: number;
  firstAtMs: number;
  startCoverageSec: number;
  maxIntertickGapSec: number;
  peakAtMs: number;
  sourceAtMs: number;
  receivedAtMs: number;
  sourceAgeSec: number;
  receiveAgeSec: number;
}

/**
 * Merge a live update or reconnect snapshot into one source-time ordered rolling buffer.
 *
 * RTDS can deliver a history snapshot after a newer live tick. Pruning only from array position zero
 * therefore leaks stale replay rows and makes tick counts look healthier after every reconnect.
 * Rebuilding by source timestamp keeps the latest delivery, removes stale rows regardless of input
 * order, and prevents replayed history from inflating path coverage.
 */
export function mergeRtdsTickBuffer(
  existing: readonly RtdsTick[],
  incoming: readonly RtdsTick[],
  nowMs: number,
): RtdsTick[] {
  if (!Number.isFinite(nowMs)) return [];
  const cut = nowMs - RTDS_BUFFER_MS;
  const bySourceTime = new Map<number, RtdsTick>();
  for (const tick of [...existing, ...incoming]) {
    if (
      !Number.isFinite(tick.t)
      || tick.t < cut
      || !Number.isFinite(tick.px)
      || tick.px <= 0
      || !Number.isFinite(tick.receivedAt)
    ) continue;
    const previous = bySourceTime.get(tick.t);
    if (!previous || tick.receivedAt >= previous.receivedAt) {
      bySourceTime.set(tick.t, tick);
    }
  }
  return [...bySourceTime.values()].sort((a, b) => a.t - b.t);
}

function pushBatch(pair: string, values: readonly { t: number; px: number }[]) {
  const receivedAt = Date.now();
  const incoming = values
    .map(({ t, px }) => ({ t, px, receivedAt }))
    .filter((tick) =>
      Number.isFinite(tick.t)
      && tick.t >= receivedAt - RTDS_BUFFER_MS
      && Number.isFinite(tick.px)
      && tick.px > 0
    );
  if (!incoming.length) return false;
  buffers.set(pair, mergeRtdsTickBuffer(buffers.get(pair) ?? [], incoming, receivedAt));
  return true;
}

/** RTDS holds ONE subscription per connection (a second subscribe replaces the first), so we open one
 * WebSocket per symbol — the pattern the reference repos use. Each reconnects independently. */
function connectSym(sym: string) {
  const pair = REV[sym];
  const ws = new WebSocket(RTDS_HOST);
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let watchdogTimer: ReturnType<typeof setInterval> | null = null;
  let lastDataAt = Date.now();
  let closingStale = false;
  ws.addEventListener("open", () => {
    attempts.set(sym, 0);
    ws.send(JSON.stringify({ action: "subscribe", subscriptions: [{ topic: "crypto_prices_chainlink", type: "*", filters: `{"symbol":"${sym}"}` }] }));
    // RTDS requires an application-level PING every five seconds. Without it, quiet/restarted
    // connections can be severed even though the process itself remains healthy.
    pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send("PING");
    }, 5_000);
    // TCP/WebSocket can remain nominally open while one RTDS subscription stops delivering. A
    // per-symbol watchdog forces the normal bounded reconnect path instead of falling back forever.
    watchdogTimer = setInterval(() => {
      if (!closingStale && ws.readyState === WebSocket.OPEN && Date.now() - lastDataAt > RTDS_STALE_RECONNECT_MS) {
        closingStale = true;
        console.warn(`[rtds] ${pair} stale for >${RTDS_STALE_RECONNECT_MS / 1000}s; reconnecting`);
        ws.close();
      }
    }, 5_000);
  });
  ws.addEventListener("message", (e: MessageEvent) => {
    let d: any;
    try { d = JSON.parse(typeof e.data === "string" ? e.data : String(e.data)); } catch { return; }
    const p = d?.payload;
    if (!p) return;
    const incoming: { t: number; px: number }[] = [];
    if (p.value != null && p.timestamp != null) {
      incoming.push({ t: Number(p.timestamp), px: Number(p.value) }); // live update
    }
    if (Array.isArray(p.data) && p.data.length) {
      for (const x of p.data) {
        incoming.push({ t: Number(x.timestamp), px: Number(x.value) }); // history snapshot
      }
    }
    if (pushBatch(pair, incoming)) lastDataAt = Date.now();
  });
  ws.addEventListener("close", () => {
    if (pingTimer) clearInterval(pingTimer);
    if (watchdogTimer) clearInterval(watchdogTimer);
    const a = (attempts.get(sym) ?? 0) + 1;
    attempts.set(sym, a);
    setTimeout(() => connectSym(sym), Math.min(1000 * 2 ** a, 30_000));
  });
  ws.addEventListener("error", () => { try { ws.close(); } catch { /* → close → reconnect */ } });
}

/** Start one connection per symbol (call once, from the worker). Idempotent. */
export function startRtds() {
  if (started) return;
  started = true;
  for (const sym of Object.values(SYMS)) connectSym(sym);
  console.log(`[rtds] opening ${Object.keys(SYMS).length} per-symbol connections`);
}

/** Latest Chainlink price for a pair + its age. Null if we have no ticks yet. */
export function chainlinkNow(pair: string): { px: number; ageSec: number; sourceAtMs: number; receivedAtMs: number; receiveAgeSec: number } | null {
  const b = buffers.get(pair);
  if (!b || !b.length) return null;
  // History snapshots and live updates can be delivered in separate payloads. Resolve "latest" by
  // source time rather than array position so an older snapshot cannot temporarily replace live S.
  const last = b.reduce((latest, tick) => tick.t > latest.t ? tick : latest);
  const now = Date.now();
  return {
    px: last.px,
    ageSec: (now - last.t) / 1000,
    sourceAtMs: last.t,
    receivedAtMs: last.receivedAt,
    receiveAgeSec: (now - last.receivedAt) / 1000,
  };
}

/** Chainlink price nearest a timestamp (the strike at window start), within tolerance. Null if uncovered. */
export function chainlinkAt(pair: string, tMs: number, tolSec = 90): number | null {
  const b = buffers.get(pair);
  if (!b || !b.length) return null;
  let best: Tick | null = null, bestD = Infinity;
  for (const x of b) { const d = Math.abs(x.t - tMs); if (d < bestD) { bestD = d; best = x; } }
  return best && bestD <= tolSec * 1000 ? best.px : null;
}

export interface ChainlinkPathTick {
  sourceAtMs: number;
  price: number;
  receivedAtMs: number;
}

/**
 * Outcome-free resolution-source path for a bounded interval. Equal source timestamps keep the
 * latest delivery and the caller receives a detached, source-time-sorted copy.
 */
export function chainlinkPath(
  pair: string,
  startMs: number,
  endMs = Date.now(),
): ChainlinkPathTick[] {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return [];
  const b = buffers.get(pair);
  if (!b?.length) return [];
  const bySourceTime = new Map<number, Tick>();
  for (const tick of b) {
    if (tick.t < startMs || tick.t > endMs) continue;
    const previous = bySourceTime.get(tick.t);
    if (!previous || tick.receivedAt >= previous.receivedAt) bySourceTime.set(tick.t, tick);
  }
  return [...bySourceTime.values()]
    .sort((a, b) => a.t - b.t)
    .map((tick) => ({
      sourceAtMs: tick.t,
      price: tick.px,
      receivedAtMs: tick.receivedAt,
    }));
}

/**
 * Pure path transform used by the preregistered peak-gap-retention child. The current tick is the
 * greatest source timestamp within [windowStartMs, nowMs], regardless of delivery order.
 */
export function computePeakGapRetention(
  ticks: ReadonlyArray<{ t: number; px: number; receivedAt: number }>,
  strike: number,
  windowStartMs: number,
  nowMs: number,
): PeakGapRetentionStats | null {
  if (
    !Number.isFinite(strike)
    || strike <= 0
    || !Number.isFinite(windowStartMs)
    || !Number.isFinite(nowMs)
    || nowMs < windowStartMs
  ) return null;

  const bySourceTime = new Map<number, { t: number; px: number; receivedAt: number }>();
  for (const tick of ticks) {
    if (
      !Number.isFinite(tick.t)
      || !Number.isFinite(tick.px)
      || tick.px <= 0
      || !Number.isFinite(tick.receivedAt)
      || tick.t < windowStartMs
      || tick.t > nowMs
    ) continue;
    const previous = bySourceTime.get(tick.t);
    if (!previous || tick.receivedAt >= previous.receivedAt) bySourceTime.set(tick.t, tick);
  }
  const path = [...bySourceTime.values()].sort((a, b) => a.t - b.t);
  if (path.length < 2) return null;

  const current = path[path.length - 1];
  let maxIntertickGapSec = 0;
  for (let i = 1; i < path.length; i++) {
    maxIntertickGapSec = Math.max(maxIntertickGapSec, (path[i].t - path[i - 1].t) / 1_000);
  }
  let peakAbsGapLog = 0;
  let peakAtMs = windowStartMs;
  for (const tick of path) {
    const absoluteGap = Math.abs(Math.log(tick.px / strike));
    if (!Number.isFinite(absoluteGap)) return null;
    if (absoluteGap > peakAbsGapLog) {
      peakAbsGapLog = absoluteGap;
      peakAtMs = tick.t;
    }
  }
  if (!(peakAbsGapLog > 0)) return null;

  const currentGapLog = Math.log(current.px / strike);
  const retention = Math.abs(currentGapLog) / peakAbsGapLog;
  if (!Number.isFinite(currentGapLog) || !Number.isFinite(retention)) return null;
  return {
    currentPx: current.px,
    currentGapLog,
    peakAbsGapLog,
    retention,
    tickCount: path.length,
    firstAtMs: path[0].t,
    startCoverageSec: (path[0].t - windowStartMs) / 1_000,
    maxIntertickGapSec,
    peakAtMs,
    sourceAtMs: current.t,
    receivedAtMs: current.receivedAt,
    sourceAgeSec: (nowMs - current.t) / 1_000,
    receiveAgeSec: (nowMs - current.receivedAt) / 1_000,
  };
}

/** Resolution-source path statistics for one active market. Null means fail closed. */
export function chainlinkPeakGapRetention(
  pair: string,
  windowStartMs: number,
  strike: number,
  nowMs = Date.now(),
): PeakGapRetentionStats | null {
  const b = buffers.get(pair);
  return b ? computePeakGapRetention(b, strike, windowStartMs, nowMs) : null;
}

export const RTDS_FRESH_SEC = FRESH_SEC;

/** Health snapshot for logging. */
export function rtdsStatus() {
  return {
    started,
    pairs: [...buffers.entries()].map(([pair, b]) => {
      const latest = b.length ? b.reduce((best, tick) => tick.t > best.t ? tick : best) : null;
      return { pair, ticks: b.length, lastAgoSec: latest ? Math.round((Date.now() - latest.t) / 1000) : null };
    }),
  };
}
