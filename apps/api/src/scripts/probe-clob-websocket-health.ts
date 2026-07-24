/**
 * Bounded, outcome-blind probe for the public Polymarket CLOB market socket.
 *
 * It subscribes to one live horizon only, counts transport events and initialization latency, then
 * exits. It never reads quote values, outcomes, paper rows, credentials, or strategy decisions and
 * writes nothing. The probe is operational evidence only; it cannot alter collector readiness.
 */
import {
  fetchCurrentCryptoUpDown,
  downTokenId,
  updownHorizonMinutes,
  upTokenId,
} from "../services/polymarket.ts";

const MIN_DURATION_SEC = 30;
const MAX_DURATION_SEC = 300;
const DEFAULT_DURATION_SEC = 300;
const DEFAULT_HORIZON = "5";
const MARKET_WS = "wss://ws-subscriptions-clob.polymarket.com/ws/market";
const HEARTBEAT_MS = 10_000;
const TARGET_PAIRS = new Set([
  "BTC-USD",
  "ETH-USD",
  "SOL-USD",
  "XRP-USD",
  "DOGE-USD",
  "BNB-USD",
]);

function subscriptionFrame(assetIds: readonly string[]): {
  assets_ids: string[];
  type: "market";
} {
  return {
    assets_ids: [...assetIds],
    type: "market",
  };
}

function targetPair(question: string): string | null {
  const normalized = question.toLowerCase();
  if (/bitcoin|\bbtc\b/.test(normalized)) return "BTC-USD";
  if (/ethereum|\beth\b/.test(normalized)) return "ETH-USD";
  if (/solana|\bsol\b/.test(normalized)) return "SOL-USD";
  if (/\bxrp\b/.test(normalized)) return "XRP-USD";
  if (/dogecoin|\bdoge\b/.test(normalized)) return "DOGE-USD";
  if (/\bbnb\b/.test(normalized)) return "BNB-USD";
  return null;
}

function integerArg(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const raw = process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
  if (raw == null) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be an integer`);
  return parsed;
}

function stringArg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

const durationSec = integerArg("duration-sec", DEFAULT_DURATION_SEC);
const horizon = stringArg("horizon", DEFAULT_HORIZON);
if (durationSec < MIN_DURATION_SEC || durationSec > MAX_DURATION_SEC) {
  throw new Error(`duration-sec must be ${MIN_DURATION_SEC}..${MAX_DURATION_SEC}`);
}
if (horizon !== "5" && horizon !== "15" && horizon !== "both") {
  throw new Error("horizon must be 5, 15, or both");
}
const targetHorizons = new Set<number>(
  horizon === "both" ? [5, 15] : [Number(horizon)],
);
const expectedTokens = targetHorizons.size * 12;

const discoveredAtMs = Date.now();
const markets = (await fetchCurrentCryptoUpDown())
  .filter((market) => {
    const horizon = updownHorizonMinutes(market.question);
    const pair = targetPair(market.question);
    const endMs = market.endDate ? new Date(market.endDate).getTime() : Number.NaN;
    const startMs = Number.isFinite(endMs) && horizon ? endMs - horizon * 60_000 : Number.NaN;
    return (
      pair != null
      && TARGET_PAIRS.has(pair)
      && horizon != null
      && targetHorizons.has(horizon)
      && Number.isFinite(startMs)
      && startMs <= discoveredAtMs
      && discoveredAtMs < endMs
    );
  });
const tokenIds = [...new Set(markets.flatMap((market) => {
  const up = upTokenId(market);
  const down = downTokenId(market);
  return up && down ? [up, down] : [];
}))];
if (tokenIds.length !== expectedTokens) {
  throw new Error(
    `expected ${expectedTokens} current ${horizon} horizon tokens; discovered ${tokenIds.length}`,
  );
}

const startedAtMs = Date.now();
const stopAtMs = startedAtMs + durationSec * 1_000;
let socket: WebSocket | null = null;
let ending = false;
let connections = 0;
let closes = 0;
let errors = 0;
let messages = 0;
let emptyArrays = 0;
let bookFrames = 0;
let priceChangeFrames = 0;
let pings = 0;
let pongs = 0;
let uptimeMs = 0;
let openedAtMs: number | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
const closeCodes: Record<string, number> = {};
const initializationLatenciesMs: number[] = [];

function eventType(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  return root.event_type ?? root.type;
}

function token(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = (value as Record<string, unknown>).asset_id;
  return typeof id === "string" && id ? id : null;
}

function clearConnectionTimers(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function closeSocket(target: WebSocket | null): void {
  try {
    target?.close();
  } catch {
    // The bounded result remains valid if the probe socket is already gone.
  }
}

function connect(): void {
  if (ending || Date.now() >= stopAtMs || socket) return;
  const ws = new WebSocket(MARKET_WS);
  socket = ws;
  const bookTokens = new Set<string>();
  let initialized = false;

  ws.addEventListener("open", () => {
    if (socket !== ws) return;
    connections++;
    openedAtMs = Date.now();
    ws.send(JSON.stringify(subscriptionFrame(tokenIds)));
    heartbeatTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send("PING");
        pings++;
      }
    }, HEARTBEAT_MS);
  });
  ws.addEventListener("message", (event: MessageEvent) => {
    if (event.data === "PONG") {
      pongs++;
      return;
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
    } catch {
      return;
    }
    if (Array.isArray(decoded) && decoded.length === 0) emptyArrays++;
    const frames = Array.isArray(decoded) ? decoded : [decoded];
    for (const frame of frames) {
      messages++;
      const type = eventType(frame);
      if (type === "book") {
        bookFrames++;
        const id = token(frame);
        if (id && tokenIds.includes(id)) bookTokens.add(id);
        if (!initialized && bookTokens.size === tokenIds.length && openedAtMs != null) {
          initialized = true;
          initializationLatenciesMs.push(Date.now() - openedAtMs);
        }
      } else if (type === "price_change") {
        priceChangeFrames++;
      }
    }
  });
  ws.addEventListener("close", (event) => {
    const nowMs = Date.now();
    const close = event as Event & { code?: unknown };
    const code = typeof close.code === "number" ? String(close.code) : "unknown";
    if (!ending) {
      closes++;
      closeCodes[code] = (closeCodes[code] ?? 0) + 1;
    }
    if (openedAtMs != null) uptimeMs += Math.max(0, nowMs - openedAtMs);
    openedAtMs = null;
    clearConnectionTimers();
    if (socket === ws) socket = null;
    if (!ending && nowMs < stopAtMs) {
      reconnectTimer = setTimeout(connect, 2_000);
    }
  });
  ws.addEventListener("error", () => {
    errors++;
    try {
      ws.close();
    } catch {
      // The close handler owns bounded reconnection.
    }
  });
}

connect();
await new Promise((resolve) => setTimeout(resolve, durationSec * 1_000));
ending = true;
if (reconnectTimer) clearTimeout(reconnectTimer);
clearConnectionTimers();
const finishedAtMs = Date.now();
if (openedAtMs != null) uptimeMs += Math.max(0, finishedAtMs - openedAtMs);
closeSocket(socket);
initializationLatenciesMs.sort((left, right) => left - right);
const p50InitializationMs = initializationLatenciesMs.length
  ? initializationLatenciesMs[Math.floor((initializationLatenciesMs.length - 1) / 2)]
  : null;

console.log(JSON.stringify({
  outcomeBlind: true,
  writesData: false,
  horizon,
  tokens: tokenIds.length,
  durationSec,
  connections,
  closes,
  closeCodes,
  errors,
  messages,
  emptyArrays,
  bookFrames,
  priceChangeFrames,
  pings,
  pongs,
  fullyInitializedConnections: initializationLatenciesMs.length,
  p50InitializationMs,
  uptimeRatio: Math.min(1, uptimeMs / Math.max(1, finishedAtMs - startedAtMs)),
}, null, 2));
process.exit(0);
