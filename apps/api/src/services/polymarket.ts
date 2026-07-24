/**
 * Polymarket public API client (read-only) — the foundation of the Up/Down tool. Ported/adapted from
 * HomeLab's client, focused on what crypto Up/Down needs:
 *   - Gamma  (gamma-api): market discovery — find the crypto "Up or Down" markets + their metadata.
 *   - CLOB   (clob):      order book (liquidity/spread), price history (backtest), resolution.
 * All free + unauthenticated. No order placement here — execution is a separate, human-gated Phase 2.
 *
 * Politeness: sequential calls spaced ~150ms; public endpoints, stay well under any radar.
 */
const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const SPACING_MS = 150;
let lastCall = 0;

async function getJson<T>(url: string): Promise<T> {
  const wait = lastCall + SPACING_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "jester-analytics (research)" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Polymarket ${url} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const wait = lastCall + SPACING_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCall = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "jester-analytics (research)",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Polymarket ${url} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

/** A Gamma market. `clobTokenIds`/`outcomes` come back as JSON-encoded strings — parse with the helpers. */
export interface GammaMarket {
  id: string;
  question: string;
  slug: string;
  conditionId: string;
  startDate: string | null;
  endDate: string | null;
  active: boolean;
  closed: boolean;
  volumeNum?: number;
  liquidityNum?: number;
  liquidity?: string;
  outcomes?: string; // JSON: e.g. ["Up","Down"] or ["Yes","No"]
  outcomePrices?: string; // JSON: e.g. ["0.52","0.48"]
  clobTokenIds?: string; // JSON: [yesTokenId, noTokenId]
}

const parseJsonArr = (s?: string): string[] => {
  if (!s) return [];
  try { const v = JSON.parse(s); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
};
export const marketOutcomes = (m: GammaMarket) => parseJsonArr(m.outcomes);
export const marketTokenIds = (m: GammaMarket) => parseJsonArr(m.clobTokenIds);
export const marketOutcomePrices = (m: GammaMarket) => parseJsonArr(m.outcomePrices).map(Number);

/** One page of Gamma markets. Gamma caps ~100/page; paginate with offset. */
export function fetchGammaMarkets(params: {
  closed?: boolean;
  active?: boolean;
  limit?: number;
  offset?: number; // Gamma caps offset at ~2000; use a tight end_date window instead of deep paging
  order?: string; // e.g. "endDate" | "volumeNum"
  ascending?: boolean;
  endDateMin?: string; // ISO — filter to markets resolving in a window (the key to finding fast markets)
  endDateMax?: string;
} = {}): Promise<GammaMarket[]> {
  const q = new URLSearchParams();
  if (params.closed != null) q.set("closed", String(params.closed));
  if (params.active != null) q.set("active", String(params.active));
  q.set("limit", String(params.limit ?? 100));
  if (params.offset) q.set("offset", String(params.offset));
  if (params.order) q.set("order", params.order);
  if (params.ascending != null) q.set("ascending", String(params.ascending));
  if (params.endDateMin) q.set("end_date_min", params.endDateMin);
  if (params.endDateMax) q.set("end_date_max", params.endDateMax);
  return getJson(`${GAMMA}/markets?${q.toString()}`);
}

/** Is this a crypto Up/Down market? (BTC/ETH/SOL/XRP/BNB/DOGE/HYPE "Up or Down".) */
const CRYPTO_RE = /bitcoin|btc|ethereum|eth|solana|\bsol\b|xrp|dogecoin|doge|bnb|hyperliquid|hype/i;
const UPDOWN_RE = /up or down|up\/down/i;
export const isCryptoUpDown = (m: GammaMarket) => UPDOWN_RE.test(m.question ?? "") && CRYPTO_RE.test(m.question ?? "");

/**
 * Find the LIVE crypto Up/Down markets resolving within the next `withinHours`. THIS is the correct
 * discovery path — the generic markets list sorted by volume surfaces the big long-horizon
 * price-target markets, and sorted by ascending endDate surfaces stale never-traded orphans; only the
 * **end_date window** finds the actively-trading short-horizon markets. Verified 2026-07-22: BTC/ETH
 * 5m & 15m markets, ~1¢ spreads, $18k–166k book depth, series ~$100k+/day.
 */
export async function fetchLiveCryptoUpDown(withinHours = 3): Promise<GammaMarket[]> {
  const now = new Date();
  const q = new URLSearchParams({
    closed: "false",
    limit: "100",
    order: "endDate",
    ascending: "true",
    end_date_min: now.toISOString(),
    end_date_max: new Date(now.getTime() + withinHours * 3600_000).toISOString(),
  });
  const page = await getJson<GammaMarket[]>(`${GAMMA}/markets?${q.toString()}`);
  return page.filter(isCryptoUpDown);
}

/**
 * Complete, bounded discovery for jobs that need markets trading right now.
 *
 * The generic Gamma list is capped at 100 rows before Jester applies its crypto filter, so a
 * successful first page can still omit live target markets. The official `Up or Down` tag removes
 * unrelated same-expiry sports markets before pagination; the local title/asset predicate remains a
 * second independent scope guard. A tight 15-minute end window contains every current 5m/15m
 * contract, while bounded pagination still fails closed if the tagged universe unexpectedly grows.
 * Calls within one worker are coalesced briefly so every paper/read-only collector shares the same
 * discovery snapshot.
 */
export const CURRENT_UPDOWN_DISCOVERY = {
  lookaheadMin: 15,
  tagId: 102_127,
  pageSize: 100,
  maxPages: 3,
  cacheMs: 20_000,
} as const;

let currentUpdownCache: {
  expiresAtMs: number;
  promise: Promise<GammaMarket[]>;
} | null = null;

export function currentUpdownDiscoveryNextOffset(
  pageIndex: number,
  pageRows: number,
): number | null {
  if (
    !Number.isInteger(pageIndex)
    || pageIndex < 0
    || !Number.isInteger(pageRows)
    || pageRows < 0
    || pageRows > CURRENT_UPDOWN_DISCOVERY.pageSize
  ) {
    throw new Error("invalid current Up/Down discovery page");
  }
  if (pageRows < CURRENT_UPDOWN_DISCOVERY.pageSize) return null;
  if (pageIndex + 1 >= CURRENT_UPDOWN_DISCOVERY.maxPages) {
    throw new Error("current Up/Down discovery exceeded bounded pagination");
  }
  return (pageIndex + 1) * CURRENT_UPDOWN_DISCOVERY.pageSize;
}

async function loadCurrentCryptoUpDown(): Promise<GammaMarket[]> {
  const now = new Date();
  const endDateMax = new Date(
    now.getTime() + CURRENT_UPDOWN_DISCOVERY.lookaheadMin * 60_000,
  ).toISOString();
  const rows: GammaMarket[] = [];
  let offset = 0;
  for (let pageIndex = 0; ; pageIndex++) {
    const q = new URLSearchParams({
      closed: "false",
      active: "true",
      tag_id: String(CURRENT_UPDOWN_DISCOVERY.tagId),
      limit: String(CURRENT_UPDOWN_DISCOVERY.pageSize),
      offset: String(offset),
      order: "endDate",
      ascending: "true",
      end_date_min: now.toISOString(),
      end_date_max: endDateMax,
    });
    const page = await getJson<GammaMarket[]>(`${GAMMA}/markets?${q.toString()}`);
    rows.push(...page);
    const nextOffset = currentUpdownDiscoveryNextOffset(pageIndex, page.length);
    if (nextOffset == null) break;
    offset = nextOffset;
  }
  return [
    ...new Map(
      rows
        .filter(isCryptoUpDown)
        .map((market) => [market.conditionId || market.id, market] as const),
    ).values(),
  ];
}

export function fetchCurrentCryptoUpDown(): Promise<GammaMarket[]> {
  const nowMs = Date.now();
  if (currentUpdownCache && nowMs < currentUpdownCache.expiresAtMs) {
    return currentUpdownCache.promise;
  }
  const promise = loadCurrentCryptoUpDown();
  const entry = {
    expiresAtMs: nowMs + CURRENT_UPDOWN_DISCOVERY.cacheMs,
    promise,
  };
  currentUpdownCache = entry;
  void promise.catch(() => {
    if (currentUpdownCache === entry) currentUpdownCache = null;
  });
  return promise;
}

/** Resolution horizon of an Up/Down market in minutes, parsed from its title's time window. */
export function updownHorizonMinutes(question: string): number | null {
  const m = question.match(/(\d{1,2}):(\d{2})(AM|PM)\s*-\s*(\d{1,2}):(\d{2})(AM|PM)/i);
  if (!m) return /\b(\d{1,2})(AM|PM)\s*-\s*(\d{1,2})(AM|PM)\b/i.test(question) ? 60 : null;
  let d = (parseInt(m[4]) * 60 + parseInt(m[5])) - (parseInt(m[1]) * 60 + parseInt(m[2]));
  if (d < 0) d += 720;
  return d;
}

/** The token id for the "Up" outcome of an Up/Down market. */
export function upTokenId(m: GammaMarket): string | null {
  const outs = marketOutcomes(m), toks = marketTokenIds(m);
  const i = outs.findIndex((o) => /up/i.test(o));
  return toks[i >= 0 ? i : 0] ?? null;
}

/** The token id for the "Down" outcome (the non-Up token). */
export function downTokenId(m: GammaMarket): string | null {
  const outs = marketOutcomes(m), toks = marketTokenIds(m);
  const iUp = outs.findIndex((o) => /up/i.test(o));
  const iDown = outs.findIndex((o, k) => k !== iUp && /down/i.test(o));
  return toks[iDown >= 0 ? iDown : iUp === 0 ? 1 : 0] ?? null;
}

/** CLOB order book for one outcome token — the liquidity/spread signal. */
export interface ClobBook {
  market: string;
  asset_id: string;
  bids: { price: string; size: string }[];
  asks: { price: string; size: string }[];
}
export function fetchClobBook(tokenId: string): Promise<ClobBook> {
  return getJson(`${CLOB}/book?token_id=${tokenId}`);
}

/** Public batch-book endpoint: one HTTP response for a coherent multi-token observation. */
export function fetchClobBooks(tokenIds: readonly string[]): Promise<ClobBook[]> {
  const ids = [...new Set(tokenIds.filter(Boolean))];
  if (!ids.length) return Promise.resolve([]);
  return postJson(`${CLOB}/books`, ids.map((tokenId) => ({ token_id: tokenId })));
}

/** Best-bid/ask + spread + top-of-book depth from a book (all in [0,1] price / contract size). */
export function bookSummary(b: ClobBook) {
  const validLevel = (x: { p: number; s: number }) =>
    Number.isFinite(x.p) && x.p >= 0 && x.p <= 1 && Number.isFinite(x.s) && x.s >= 0;
  const bids = (b.bids ?? []).map((x) => ({ p: parseFloat(x.price), s: parseFloat(x.size) })).filter(validLevel);
  const asks = (b.asks ?? []).map((x) => ({ p: parseFloat(x.price), s: parseFloat(x.size) })).filter(validLevel);
  const bestBidLevel = bids.reduce<{ p: number; s: number } | null>((best, level) => !best || level.p > best.p ? level : best, null);
  const bestAskLevel = asks.reduce<{ p: number; s: number } | null>((best, level) => !best || level.p < best.p ? level : best, null);
  const bestBid = bestBidLevel?.p ?? null;
  const bestAsk = bestAskLevel?.p ?? null;
  const spread = bestBid != null && bestAsk != null ? bestAsk - bestBid : null;
  const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null;
  const bidDepthShares = bids.reduce((a, x) => a + x.s, 0);
  const askDepthShares = asks.reduce((a, x) => a + x.s, 0);
  const bidDepthUsd = bids.reduce((a, x) => a + x.p * x.s, 0);
  const askDepthUsd = asks.reduce((a, x) => a + x.p * x.s, 0);
  const shareDepth = bidDepthShares + askDepthShares;
  const usdDepth = bidDepthUsd + askDepthUsd;
  const touchDepth = (bestBidLevel?.s ?? 0) + (bestAskLevel?.s ?? 0);
  // Touch microprice weights each price by liquidity on the opposite side. A bid-heavy touch pulls
  // fair value toward the ask. Collected prospectively as metadata only (GitHub microstructure mine);
  // it is not a paper decision input.
  const microprice = bestBidLevel && bestAskLevel
    ? touchDepth > 0
      ? (bestBidLevel.p * bestAskLevel.s + bestAskLevel.p * bestBidLevel.s) / touchDepth
      : mid
    : null;
  return {
    bestBid,
    bestAsk,
    bestBidSize: bestBidLevel?.s ?? null,
    bestAskSize: bestAskLevel?.s ?? null,
    spread,
    mid,
    microprice,
    touchImbalance: touchDepth > 0 ? ((bestBidLevel?.s ?? 0) - (bestAskLevel?.s ?? 0)) / touchDepth : null,
    bookImbalanceShares: shareDepth > 0 ? (bidDepthShares - askDepthShares) / shareDepth : null,
    bookImbalanceUsd: usdDepth > 0 ? (bidDepthUsd - askDepthUsd) / usdDepth : null,
    bidDepthShares,
    askDepthShares,
    bidDepthUsd,
    askDepthUsd,
    bidLevels: bids.length,
    askLevels: asks.length,
  };
}

/**
 * Realistic taker fill: the size-weighted average ask to BUY `sizeUsd` of notional, walking the ask
 * side of the book. A cheap best-ask with no depth behind it no longer flatters P&L — a $5 order that
 * eats a thin top level pays the VWAP across the levels it needs. Returns null if total ask depth can't
 * fill the order (the taker wouldn't get filled → the bot should skip). Prices in [0,1], size in contracts.
 */
export function fillAskUsd(b: ClobBook, sizeUsd: number): number | null {
  const asks = (b.asks ?? [])
    .map((x) => ({ p: parseFloat(x.price), s: parseFloat(x.size) }))
    .filter((x) => Number.isFinite(x.p) && x.p > 0 && x.p < 1 && x.s > 0)
    .sort((a, c) => a.p - c.p);
  if (!asks.length) return null;
  let dollars = 0, shares = 0;
  for (const lvl of asks) {
    const need = sizeUsd - dollars;
    const lvlUsd = lvl.p * lvl.s;
    if (lvlUsd >= need) { shares += need / lvl.p; dollars = sizeUsd; break; }
    dollars += lvlUsd; shares += lvl.s;
  }
  if (dollars < sizeUsd - 1e-9 || shares <= 0) return null; // book too thin to fill the order
  return dollars / shares;
}

/** Minute-resolution price path for one token (the market's implied-probability history) — for backtest. */
export interface PricePoint { t: number; p: number }
export async function fetchClobPriceHistory(tokenId: string, fidelity = 1): Promise<PricePoint[]> {
  const res = await getJson<{ history?: PricePoint[] }>(`${CLOB}/prices-history?market=${tokenId}&fidelity=${fidelity}&interval=max`);
  return res.history ?? [];
}

/** Resolution/metadata for one market (tokens carry the winner flag once resolved). */
export interface ClobMarket {
  condition_id: string;
  question: string;
  market_slug: string;
  end_date_iso: string | null;
  active: boolean;
  closed: boolean;
  tokens: { token_id: string; outcome: string; price?: number; winner?: boolean }[];
}
export function fetchClobMarket(conditionId: string): Promise<ClobMarket> {
  return getJson(`${CLOB}/markets/${conditionId}`);
}

/**
 * Current CLOB-v2 market parameters. The compact field names are the public API's wire format.
 * `fd` is the protocol fee curve used at match time: rate × (p × (1-p))^exponent.
 */
export interface ClobMarketInfo {
  t?: { t: string; o: string }[];
  mos?: number;
  mts?: number;
  mbf?: number;
  tbf?: number;
  fd?: { r: number; e: number; to: boolean };
}
export function fetchClobMarketInfo(conditionId: string): Promise<ClobMarketInfo> {
  return getJson(`${CLOB}/clob-markets/${conditionId}`);
}
