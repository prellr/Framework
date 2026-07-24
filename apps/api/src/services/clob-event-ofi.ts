/**
 * Compact, outcome-blind event-level CLOB order-flow tape.
 *
 * The authoritative public market socket already receives `book` and `price_change` frames while
 * collecting executed trades. This accumulator reuses that connection, reconstructs only the best
 * bid/ask queues in memory, and folds quote transitions into rolling OFI sums. It stores no raw
 * frames, account data, orders, outcomes, or strategy decisions.
 */
import type { TouchState } from "./polymarket-microstructure.ts";

export const CLOB_EVENT_OFI_TAPE = {
  version: "updown-clob-event-ofi-tape-v1",
  evalStartMs: Date.parse("2026-07-24T07:00:00.000Z"),
  windowsSec: [5, 30, 60] as const,
  maxSocketAgeSec: 20,
  maxTransportLagMs: 30_000,
  // Source timestamps can lead the receiving host slightly because the two clocks are independent.
  // Rolling inclusion remains keyed to local receipt time; only bounded diagnostic source age may
  // clamp to zero. A larger lead is not plausible clock jitter and fails closed.
  maxSourceClockLeadMs: 250,
  minRows: 20_000,
  minMarkets: 1_500,
  minSpanDays: 5,
  minRowsPerBucket: 100,
  minCoverage: 0.95,
} as const;

type Side = "BUY" | "SELL";
type Quote = TouchState;
type FlowEvent = {
  sourceAtMs: number;
  receivedAtMs: number;
  value: number;
  transportLagMs: number;
};
type TokenState = {
  market: string | null;
  bids: Map<number, number>;
  asks: Map<number, number>;
  bookSnapshotSeen: boolean;
  quote: Quote | null;
  events: FlowEvent[];
  lastSourceAtMs: number | null;
  lastReceivedAtMs: number | null;
};

export type ClobEventOfiObservation = {
  version: typeof CLOB_EVENT_OFI_TAPE.version;
  canonical5s: number;
  canonical30s: number;
  canonical60s: number;
  upEvents60s: number;
  downEvents60s: number;
  sourceAgeSec: number;
  receiveAgeSec: number;
  maxTransportLagMs60s: number;
};

export type ClobLiveBookSnapshot = {
  market: string;
  assetId: string;
  sourceAtMs: number;
  receivedAtMs: number;
  ageMs: number;
  bids: { price: string; size: string }[];
  asks: { price: string; size: string }[];
};

function finite(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function sourceTimeMs(value: unknown, receivedAtMs: number): number {
  const parsed = finite(value);
  if (parsed == null || parsed <= 0) return receivedAtMs;
  return parsed < 10_000_000_000 ? parsed * 1_000 : parsed;
}

function tokenId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function levels(value: unknown): Map<number, number> | null {
  if (!Array.isArray(value)) return null;
  const result = new Map<number, number>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const price = finite(row.price);
    const size = finite(row.size);
    if (price == null || size == null || price <= 0 || price >= 1 || size < 0) continue;
    if (size > 0) result.set(price, size);
  }
  return result;
}

function frame(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const root = value as Record<string, unknown>;
  if (
    root.topic === "market"
    && root.payload
    && typeof root.payload === "object"
    && !Array.isArray(root.payload)
  ) {
    return { ...root, ...(root.payload as Record<string, unknown>) };
  }
  return root;
}

function bestQuote(state: TokenState, capturedAtMs: number): Quote | null {
  let bid = Number.NEGATIVE_INFINITY;
  let ask = Number.POSITIVE_INFINITY;
  for (const price of state.bids.keys()) if (price > bid) bid = price;
  for (const price of state.asks.keys()) if (price < ask) ask = price;
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid > ask) return null;
  const bidSize = state.bids.get(bid);
  const askSize = state.asks.get(ask);
  if (bidSize == null || askSize == null || bidSize < 0 || askSize < 0) return null;
  return { capturedAtMs, bid, bidSize, ask, askSize };
}

/**
 * The registered queue-event OFI transform. Unlike the once-per-minute diagnostic helper, a live
 * socket proves that a long inter-event interval is a genuinely quiet book, so the first transition
 * after that interval remains informative instead of being discarded as a stale snapshot gap.
 */
function normalizedEventOfi(previous: Quote, current: Quote): number | null {
  if (
    current.capturedAtMs <= previous.capturedAtMs
    || !Number.isFinite(previous.bid)
    || !Number.isFinite(previous.ask)
    || !Number.isFinite(previous.bidSize)
    || !Number.isFinite(previous.askSize)
    || !Number.isFinite(current.bid)
    || !Number.isFinite(current.ask)
    || !Number.isFinite(current.bidSize)
    || !Number.isFinite(current.askSize)
    || previous.bid > previous.ask
    || current.bid > current.ask
    || previous.bidSize < 0
    || previous.askSize < 0
    || current.bidSize < 0
    || current.askSize < 0
  ) return null;
  const bidFlow =
    (current.bid >= previous.bid ? current.bidSize : 0)
    - (current.bid <= previous.bid ? previous.bidSize : 0);
  const askFlow =
    -(current.ask <= previous.ask ? current.askSize : 0)
    + (current.ask >= previous.ask ? previous.askSize : 0);
  const averageTouchDepth =
    (previous.bidSize + previous.askSize + current.bidSize + current.askSize) / 2;
  return averageTouchDepth > 0 ? (bidFlow + askFlow) / averageTouchDepth : null;
}

function emptyToken(): TokenState {
  return {
    market: null,
    bids: new Map(),
    asks: new Map(),
    bookSnapshotSeen: false,
    quote: null,
    events: [],
    lastSourceAtMs: null,
    lastReceivedAtMs: null,
  };
}

export class ClobEventOfiAccumulator {
  private readonly tokens = new Map<string, TokenState>();
  private connected = false;
  private lastSocketAtMs: number | null = null;
  private bookFrames = 0;
  private priceChangeFrames = 0;

  setConnected(connected: boolean, observedAtMs = Date.now()): void {
    if (!connected && this.connected) {
      // A reconnect gap is not a quiet book. Discard both the rolling events and the old queue
      // baseline so the next full `book` frame initializes state instead of manufacturing OFI
      // from changes that may have happened while the socket was unavailable.
      for (const state of this.tokens.values()) {
        state.bids.clear();
        state.asks.clear();
        state.bookSnapshotSeen = false;
        state.quote = null;
        state.events.length = 0;
        state.lastSourceAtMs = null;
        state.lastReceivedAtMs = null;
      }
      this.lastSocketAtMs = null;
    }
    this.connected = connected;
    if (connected && Number.isFinite(observedAtMs)) this.lastSocketAtMs = observedAtMs;
  }

  heartbeat(observedAtMs: number): void {
    if (this.connected && Number.isFinite(observedAtMs)) {
      this.lastSocketAtMs = Math.max(this.lastSocketAtMs ?? observedAtMs, observedAtMs);
    }
  }

  retainTokens(ids: ReadonlySet<string>): void {
    for (const id of this.tokens.keys()) {
      if (!ids.has(id)) this.tokens.delete(id);
    }
  }

  runtimeStats(observedAtMs = Date.now()) {
    return {
      connected: this.connected,
      trackedTokens: this.tokens.size,
      bookSnapshotTokens: [...this.tokens.values()].filter(
        (state) => state.bookSnapshotSeen,
      ).length,
      initializedTokens: [...this.tokens.values()].filter((state) => state.quote != null).length,
      retainedEvents: [...this.tokens.values()].reduce(
        (total, state) => total + state.events.length,
        0,
      ),
      bookFrames: this.bookFrames,
      priceChangeFrames: this.priceChangeFrames,
      lastMarketDataAgeSec:
        this.lastSocketAtMs == null || !Number.isFinite(observedAtMs)
          ? null
          : Math.max(0, (observedAtMs - this.lastSocketAtMs) / 1_000),
    };
  }

  /**
   * Outcome-blind subscription health for a caller-selected token set. Counts only whether a full
   * queue baseline exists; it exposes no quote, flow, side, or directional value.
   */
  initializationStats(ids: Iterable<string>): {
    expectedTokens: number;
    bookSnapshotTokens: number;
    initializedTokens: number;
  } {
    const unique = new Set(ids);
    let bookSnapshotTokens = 0;
    let initializedTokens = 0;
    for (const id of unique) {
      const state = this.tokens.get(id);
      if (state?.bookSnapshotSeen) bookSnapshotTokens++;
      if (state?.quote != null) initializedTokens++;
    }
    return { expectedTokens: unique.size, bookSnapshotTokens, initializedTokens };
  }

  /**
   * Read-only full-book view for the paper-safe shadow connector.
   *
   * This returns a defensive copy of the public market-channel state. It deliberately exposes no
   * user channel, credentials, signer, order method, or network fallback. A missing baseline,
   * disconnected socket, mismatched condition, or stale token update fails closed.
   */
  bookSnapshot(
    id: string,
    conditionId: string,
    observedAtMs: number,
    maxAgeMs: number,
  ): ClobLiveBookSnapshot | null {
    if (
      !this.connected
      || !id
      || !conditionId
      || !Number.isFinite(observedAtMs)
      || !Number.isFinite(maxAgeMs)
      || maxAgeMs < 0
    ) return null;
    const state = this.tokens.get(id);
    if (
      !state?.bookSnapshotSeen
      || state.lastSourceAtMs == null
      || state.lastReceivedAtMs == null
      || state.market !== conditionId
    ) return null;
    const ageMs = observedAtMs - state.lastReceivedAtMs;
    if (ageMs < 0 || ageMs > maxAgeMs) return null;
    return {
      market: conditionId,
      assetId: id,
      sourceAtMs: state.lastSourceAtMs,
      receivedAtMs: state.lastReceivedAtMs,
      ageMs,
      bids: [...state.bids]
        .sort(([left], [right]) => right - left)
        .map(([price, size]) => ({ price: String(price), size: String(size) })),
      asks: [...state.asks]
        .sort(([left], [right]) => left - right)
        .map(([price, size]) => ({ price: String(price), size: String(size) })),
    };
  }

  observe(value: unknown, receivedAtMs: number): boolean {
    if (!Number.isFinite(receivedAtMs) || receivedAtMs <= 0) return false;
    const root = frame(value);
    if (!root) return false;
    const eventType = root.event_type ?? root.type;
    if (eventType === "book") {
      const observed = this.observeBook(root, receivedAtMs);
      if (observed) {
        this.heartbeat(receivedAtMs);
        this.bookFrames++;
      }
      return observed;
    }
    if (eventType === "price_change") {
      const observed = this.observePriceChanges(root, receivedAtMs);
      if (observed) {
        this.heartbeat(receivedAtMs);
        this.priceChangeFrames++;
      }
      return observed;
    }
    return false;
  }

  now(upTokenId: string, downTokenId: string, observedAtMs: number): ClobEventOfiObservation | null {
    if (!this.connected || observedAtMs < CLOB_EVENT_OFI_TAPE.evalStartMs) return null;
    const up = this.tokens.get(upTokenId);
    const down = this.tokens.get(downTokenId);
    if (!up?.quote || !down?.quote) return null;
    if (
      up.lastSourceAtMs == null
      || down.lastSourceAtMs == null
      || up.lastReceivedAtMs == null
      || down.lastReceivedAtMs == null
    ) return null;
    const socketAgeSec =
      this.lastSocketAtMs == null
        ? Number.POSITIVE_INFINITY
        : (observedAtMs - this.lastSocketAtMs) / 1_000;
    if (
      socketAgeSec < 0
      || socketAgeSec > CLOB_EVENT_OFI_TAPE.maxSocketAgeSec
    ) return null;

    this.prune(up, observedAtMs);
    this.prune(down, observedAtMs);
    const sourceClockLeadMs = Math.max(
      up.lastSourceAtMs - observedAtMs,
      down.lastSourceAtMs - observedAtMs,
    );
    if (sourceClockLeadMs > CLOB_EVENT_OFI_TAPE.maxSourceClockLeadMs) return null;
    const sourceAgeSec = Math.max(
      0,
      Math.max(observedAtMs - up.lastSourceAtMs, observedAtMs - down.lastSourceAtMs) / 1_000,
    );
    const receiveAgeSec = socketAgeSec;

    const sum = (state: TokenState, windowSec: number) =>
      state.events
        .filter((event) => event.receivedAtMs >= observedAtMs - windowSec * 1_000)
        .reduce((total, event) => total + event.value, 0);
    const canonical = (windowSec: number) => (sum(up, windowSec) - sum(down, windowSec)) / 2;
    const upEvents60 = up.events.filter(
      (event) => event.receivedAtMs >= observedAtMs - 60_000,
    );
    const downEvents60 = down.events.filter(
      (event) => event.receivedAtMs >= observedAtMs - 60_000,
    );
    const maxTransportLagMs60s = Math.max(
      0,
      ...upEvents60.map((event) => event.transportLagMs),
      ...downEvents60.map((event) => event.transportLagMs),
    );
    if (maxTransportLagMs60s > CLOB_EVENT_OFI_TAPE.maxTransportLagMs) return null;
    return {
      version: CLOB_EVENT_OFI_TAPE.version,
      canonical5s: canonical(5),
      canonical30s: canonical(30),
      canonical60s: canonical(60),
      upEvents60s: upEvents60.length,
      downEvents60s: downEvents60.length,
      sourceAgeSec,
      receiveAgeSec,
      maxTransportLagMs60s,
    };
  }

  private token(id: string): TokenState {
    const current = this.tokens.get(id);
    if (current) return current;
    const created = emptyToken();
    this.tokens.set(id, created);
    return created;
  }

  private observeBook(root: Record<string, unknown>, receivedAtMs: number): boolean {
    const id = tokenId(root.asset_id ?? root.assetId);
    const market = tokenId(root.market);
    const bids = levels(root.bids);
    const asks = levels(root.asks);
    if (!id || !bids || !asks) return false;
    const sourceAtMs = sourceTimeMs(root.timestamp, receivedAtMs);
    const state = this.token(id);
    if (market) state.market = market;
    state.bids = bids;
    state.asks = asks;
    state.bookSnapshotSeen = true;
    this.commitQuote(state, sourceAtMs, receivedAtMs);
    return true;
  }

  private observePriceChanges(root: Record<string, unknown>, receivedAtMs: number): boolean {
    if (!Array.isArray(root.price_changes)) return false;
    const sourceAtMs = sourceTimeMs(root.timestamp, receivedAtMs);
    const changed = new Set<string>();
    for (const raw of root.price_changes) {
      if (!raw || typeof raw !== "object") continue;
      const change = raw as Record<string, unknown>;
      const id = tokenId(change.asset_id ?? change.assetId ?? root.asset_id ?? root.assetId);
      const market = tokenId(change.market ?? root.market);
      const price = finite(change.price);
      const size = finite(change.size);
      const rawSide = typeof change.side === "string" ? change.side.toUpperCase() : "";
      const side = rawSide === "BUY" || rawSide === "SELL" ? rawSide as Side : null;
      if (!id || price == null || size == null || !side || price <= 0 || price >= 1 || size < 0) {
        continue;
      }
      const state = this.token(id);
      if (market) state.market = market;
      const bookSide = side === "BUY" ? state.bids : state.asks;
      if (size === 0) bookSide.delete(price);
      else bookSide.set(price, size);
      changed.add(id);
    }
    for (const id of changed) this.commitQuote(this.token(id), sourceAtMs, receivedAtMs);
    return changed.size > 0;
  }

  private commitQuote(state: TokenState, sourceAtMs: number, receivedAtMs: number): void {
    const next = bestQuote(state, sourceAtMs);
    state.lastSourceAtMs = Math.max(state.lastSourceAtMs ?? sourceAtMs, sourceAtMs);
    state.lastReceivedAtMs = Math.max(state.lastReceivedAtMs ?? receivedAtMs, receivedAtMs);
    if (!next) {
      state.quote = null;
      return;
    }
    const previous = state.quote;
    state.quote = next;
    if (!previous || next.capturedAtMs <= previous.capturedAtMs) return;
    const value = normalizedEventOfi(previous, next);
    if (value == null || !Number.isFinite(value)) return;
    state.events.push({
      sourceAtMs,
      receivedAtMs,
      value,
      transportLagMs: Math.max(0, receivedAtMs - sourceAtMs),
    });
    this.prune(state, receivedAtMs);
  }

  private prune(state: TokenState, nowMs: number): void {
    const cutoff = nowMs - 60_000;
    while (state.events.length && state.events[0].receivedAtMs < cutoff) {
      state.events.shift();
    }
  }
}

const liveAccumulator = new ClobEventOfiAccumulator();

export const observeClobEventOfi = (value: unknown, receivedAtMs: number) =>
  liveAccumulator.observe(value, receivedAtMs);
export const setClobEventOfiConnected = (connected: boolean) =>
  liveAccumulator.setConnected(connected);
export const clobEventOfiRuntimeStatus = (observedAtMs = Date.now()) =>
  liveAccumulator.runtimeStats(observedAtMs);
export const clobEventOfiInitializationStats = (ids: Iterable<string>) =>
  liveAccumulator.initializationStats(ids);
export const retainClobEventOfiTokens = (ids: ReadonlySet<string>) =>
  liveAccumulator.retainTokens(ids);
export const clobEventOfiNow = (upTokenId: string, downTokenId: string, observedAtMs: number) =>
  liveAccumulator.now(upTokenId, downTokenId, observedAtMs);
export const clobLiveBookSnapshot = (
  tokenId: string,
  conditionId: string,
  observedAtMs = Date.now(),
  maxAgeMs = 20_000,
) => liveAccumulator.bookSnapshot(tokenId, conditionId, observedAtMs, maxAgeMs);
