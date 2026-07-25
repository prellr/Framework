/**
 * Hyperliquid PUBLIC info API client — read-only, analysis-only.
 *
 * SAFETY BOUNDARY: this module only ever POSTs to the `/info` endpoint, and only with a query
 * `type` from READ_ONLY_TYPES below. It has NO path to `/exchange` (the trading/mutate endpoint),
 * so like the Jester allowlist it cannot place, modify, or cancel an order or move funds. Do not
 * add `/exchange` here or widen the type allowlist to anything that mutates.
 *
 * Data is public (keyed by wallet address) and needs no auth — used to pull portfolio history
 * (equity + PnL time series) that Jester's delegated API doesn't expose.
 */

export const HYPERLIQUID_INFO_ENDPOINT = "https://api.hyperliquid.xyz/info";

/** The only info query types this app is allowed to make — all read-only. */
const READ_ONLY_TYPES = new Set(["portfolio", "clearinghouseState", "userFills", "userFillsByTime", "meta", "l2Book", "recentTrades", "candleSnapshot"]);
export const hyperliquidInfoTypeAllowed = (type: unknown): type is string =>
  typeof type === "string" && READ_ONLY_TYPES.has(type);

const CANDLE_INTERVALS = new Set([
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "8h",
  "12h",
  "1d",
  "3d",
  "1w",
  "1M",
]);

export interface HlCandle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** Complete public candle payload returned by Hyperliquid's read-only candleSnapshot query. */
export interface HlCandleSnapshot extends HlCandle {
  T: number;
  s: string;
  i: string;
  n: number;
}

export interface HlCandleSnapshotResult {
  candles: HlCandleSnapshot[];
  rawCandles: unknown[];
  receivedAtMs: number;
}

/**
 * Bounded historical candle snapshot. This is intentionally a single public `/info` request:
 * callers cannot supply an endpoint or query type and the client has no exchange/order path.
 */
export async function getCandleSnapshot(input: {
  coin: string;
  interval: string;
  startTime: number;
  endTime: number;
  fetcher?: typeof fetch;
}): Promise<HlCandleSnapshotResult> {
  const coin = input.coin.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(coin)) {
    throw new Error("Invalid Hyperliquid candle coin");
  }
  if (!CANDLE_INTERVALS.has(input.interval)) {
    throw new Error(`Unsupported Hyperliquid candle interval "${input.interval}"`);
  }
  if (
    !Number.isSafeInteger(input.startTime)
    || !Number.isSafeInteger(input.endTime)
    || input.startTime < 0
    || input.endTime <= input.startTime
  ) {
    throw new Error("Invalid Hyperliquid candle time range");
  }
  const raw = await hlInfo(
    {
      type: "candleSnapshot",
      req: {
        coin,
        interval: input.interval,
        startTime: input.startTime,
        endTime: input.endTime,
      },
    },
    input.fetcher,
  );
  const receivedAtMs = Date.now();
  if (!Array.isArray(raw)) {
    throw new Error("Hyperliquid candleSnapshot returned a non-array payload");
  }
  const candles = raw.map((value, index) => {
    const row = value as Record<string, unknown>;
    const candle: HlCandleSnapshot = {
      t: Number(row.t),
      T: Number(row.T),
      s: String(row.s ?? ""),
      i: String(row.i ?? ""),
      o: Number(row.o),
      h: Number(row.h),
      l: Number(row.l),
      c: Number(row.c),
      v: Number(row.v),
      n: Number(row.n),
    };
    if (
      !Number.isSafeInteger(candle.t)
      || !Number.isSafeInteger(candle.T)
      || !Number.isSafeInteger(candle.n)
      || ![candle.o, candle.h, candle.l, candle.c, candle.v].every(Number.isFinite)
    ) {
      throw new Error(`Hyperliquid candleSnapshot row ${index} is malformed`);
    }
    return candle;
  });
  return {
    candles: candles.sort((a, b) => a.t - b.t),
    rawCandles: raw,
    receivedAtMs,
  };
}

/** Recent 1m candles for a coin (read-only OHLCV) — the pricer bot's vol/strike source. */
export async function getRecentCandles(coin: string, intervalMin = 1, bars = 240): Promise<HlCandle[]> {
  const now = Date.now();
  const result = await getCandleSnapshot({
    coin,
    interval: `${intervalMin}m`,
    startTime: now - bars * intervalMin * 60_000,
    endTime: now,
  });
  return result.candles
    .map(({ t, o, h, l, c, v }) => ({ t, o, h, l, c, v }))
    .filter((k) => Number.isFinite(k.c) && k.c > 0)
    .sort((a, b) => a.t - b.t);
}

async function hlInfo(
  body: Record<string, unknown>,
  fetcher: typeof fetch = fetch,
): Promise<any> {
  const type = body.type;
  if (!hyperliquidInfoTypeAllowed(type)) {
    throw new Error(`Hyperliquid info type "${String(type)}" is not allowed (read-only only)`);
  }
  const res = await fetcher(HYPERLIQUID_INFO_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Hyperliquid info ${type} failed: ${res.status}`);
  return res.json();
}

/**
 * Point-in-time microstructure for a coin, straight from Hyperliquid's public feeds — the two
 * dimensions Jester's Tesseract leaves null (it computes from candles, which can't carry these):
 *   - bookImbalance: (bidDepth − askDepth)/(bidDepth + askDepth) over the top-N book levels, [-1,1].
 *   - flowImbalance: (buyVol − sellVol)/(buyVol + sellVol) over the last handful of trades, [-1,1].
 *     "Flow-lite" — recentTrades only returns ~10 trades, so the window is seconds on liquid pairs
 *     and minutes on quiet ones; `spanSec`/`tradeCount` expose that fidelity. A true rolling CVD would
 *     need a WS counter; this is the zero-persistent-process version (one poll per snapshot).
 * Both HL calls run concurrently and fail soft (null), so a hiccup never breaks a snapshot.
 */
export interface Microstructure {
  bookImbalance: number | null;
  flowImbalance: number | null;
  bidDepth: number;
  askDepth: number;
  buyVol: number;
  sellVol: number;
  tradeCount: number;
  spanSec: number;
}

export async function hlMicrostructure(coin: string, depth = 10): Promise<Microstructure> {
  const [book, trades] = await Promise.all([
    hlInfo({ type: "l2Book", coin }).catch(() => null),
    hlInfo({ type: "recentTrades", coin }).catch(() => null),
  ]);

  let bidDepth = 0, askDepth = 0, bookImbalance: number | null = null;
  const levels = book?.levels;
  if (Array.isArray(levels) && levels.length >= 2) {
    const sum = (side: any[]) => (Array.isArray(side) ? side.slice(0, depth).reduce((s, l) => s + (parseFloat(l?.sz) || 0), 0) : 0);
    bidDepth = sum(levels[0]);
    askDepth = sum(levels[1]);
    if (bidDepth + askDepth > 0) bookImbalance = (bidDepth - askDepth) / (bidDepth + askDepth);
  }

  let buyVol = 0, sellVol = 0, tradeCount = 0, spanSec = 0, flowImbalance: number | null = null;
  if (Array.isArray(trades) && trades.length) {
    const times: number[] = [];
    for (const t of trades) {
      const sz = parseFloat(t?.sz);
      if (!Number.isFinite(sz)) continue;
      if (typeof t?.time === "number") times.push(t.time);
      if (t?.side === "B") buyVol += sz; else sellVol += sz;
      tradeCount += 1;
    }
    if (buyVol + sellVol > 0) flowImbalance = (buyVol - sellVol) / (buyVol + sellVol);
    if (times.length >= 2) spanSec = (Math.max(...times) - Math.min(...times)) / 1000;
  }

  return { bookImbalance, flowImbalance, bidDepth, askDepth, buyVol, sellVol, tradeCount, spanSec };
}

export interface EquityPoint {
  t: number; // epoch ms
  v: number; // value
}
export interface PortfolioSeries {
  period: string; // day | week | month | allTime
  accountValue: EquityPoint[];
  pnl: EquityPoint[];
}

const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);

const toPoints = (raw: unknown): EquityPoint[] =>
  Array.isArray(raw)
    ? raw
        .map((p) => ({ t: Number(p?.[0]), v: parseFloat(p?.[1]) }))
        .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
    : [];

/**
 * Portfolio history for a wallet: account-value and PnL series over day / week / month / allTime.
 * Hyperliquid returns pairs of [periodName, {accountValueHistory, pnlHistory, vlm}]; we keep the
 * combined-account periods (perp-only variants are dropped).
 */
export async function getPortfolioHistory(wallet: string): Promise<PortfolioSeries[]> {
  if (!isAddress(wallet)) throw new Error("Invalid wallet address");
  const raw = await hlInfo({ type: "portfolio", user: wallet });
  if (!Array.isArray(raw)) return [];
  const wanted = ["day", "week", "month", "allTime"];
  const out: PortfolioSeries[] = [];
  for (const [period, data] of raw as [string, any][]) {
    if (!wanted.includes(period)) continue;
    out.push({
      period,
      accountValue: toPoints(data?.accountValueHistory),
      pnl: toPoints(data?.pnlHistory),
    });
  }
  return out;
}

/**
 * The full Hyperliquid perpetual universe — every listed crypto coin (~230), the ground truth for
 * tradable crypto (Jester's own tradable-pairs tool only surfaces a handful). Global data, no
 * wallet needed. Delisted coins are dropped.
 */
export async function getPerpUniverse(): Promise<string[]> {
  const raw = await hlInfo({ type: "meta" });
  const universe = raw?.universe;
  if (!Array.isArray(universe)) return [];
  return universe
    .filter((c) => c && typeof c.name === "string" && !c.isDelisted)
    .map((c) => c.name as string);
}

export interface Fill {
  time: number;
  coin: string;
  closedPnl: number;
  fee: number;
  dir: string; // e.g. "Open Long", "Close Short", "Buy"
  px: number; // fill price
  sz: number; // fill size (base units)
  side: string; // "B" | "A" (buy/sell)
  oid: number; // order id
  hash: string; // tx hash
  tid: number; // Hyperliquid trade id — globally unique per fill (dedup key for the warehouse)
}

/**
 * Individual fills for a wallet, optionally since `startTime` (epoch ms). Each fill's `closedPnl` is
 * the realized PnL booked when a position (or part of it) closes; `fee` is charged on every fill.
 * This is the raw trade ledger — the ground truth for both the realized-PnL curve and the per-trade
 * history. Hyperliquid returns at most 2000 fills.
 */
export async function getUserFills(wallet: string, startTime?: number): Promise<Fill[]> {
  if (!isAddress(wallet)) throw new Error("Invalid wallet address");
  const body =
    startTime != null
      ? { type: "userFillsByTime", user: wallet, startTime }
      : { type: "userFills", user: wallet };
  const raw = await hlInfo(body);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((f) => ({
      time: Number(f?.time),
      coin: String(f?.coin ?? ""),
      closedPnl: parseFloat(f?.closedPnl ?? "0"),
      fee: parseFloat(f?.fee ?? "0"),
      dir: String(f?.dir ?? ""),
      px: parseFloat(f?.px ?? "0"),
      sz: parseFloat(f?.sz ?? "0"),
      side: String(f?.side ?? ""),
      oid: Number(f?.oid ?? 0),
      hash: String(f?.hash ?? ""),
      tid: Number(f?.tid ?? 0),
    }))
    .filter((f) => Number.isFinite(f.time));
}

export interface FillStats {
  trades: number; // closing fills (realized events)
  fills: number; // all fills (opens + closes)
  realized: number; // sum of closedPnl
  fees: number; // sum of fee across all fills
  net: number; // realized - fees
  volumeUsd: number; // sum of |px*sz| across all fills
  wins: number;
  losses: number;
  winRate: number; // %
  grossProfit: number;
  grossLoss: number; // negative
  profitFactor: number | null;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  expectancy: number; // realized / trades
  bySide: { long: SideStat; short: SideStat };
  byCoin: CoinStat[]; // sorted by trade count desc
  firstTradeAt: number | null;
  lastTradeAt: number | null;
}
interface SideStat {
  trades: number;
  realized: number; // gross
  fees: number; // fees on fills of this side (opens + closes)
  net: number; // realized - fees
  wins: number;
  winRate: number;
}
interface CoinStat {
  coin: string;
  trades: number;
  realized: number; // gross
  fees: number; // every fill's fee for this coin
  net: number; // realized - fees  <- the number that matters
  winRate: number;
}

export interface ClosedTrade {
  time: number;
  coin: string;
  dir: string;
  side: "long" | "short" | null;
  px: number;
  sz: number;
  closedPnl: number; // gross, as Hyperliquid reports it on the closing fill
  exitFee: number; // fee on the closing fill only
  entryFee: number; // share of the opening fill fees attributed to this close
  fee: number; // round-trip: entryFee + exitFee
  net: number; // closedPnl - fee  <- what you actually made
  hash: string;
}

/**
 * Closed trades with ROUND-TRIP fees attributed.
 *
 * Hyperliquid bills every fill separately, so a closing fill only carries the exit fee — showing that
 * alone understates the cost of a trade by roughly half and makes gross PnL look like profit. We walk
 * each coin's fills chronologically, pool the fees paid opening/adding to a position, and attribute a
 * size-proportional share of that pool when a close books realized PnL. `net` is then directly
 * comparable to what Jester reports as "PnL (net)".
 */
export function closedTradesWithFees(all: Fill[]): ClosedTrade[] {
  const byCoin = new Map<string, Fill[]>();
  for (const f of all) {
    const arr = byCoin.get(f.coin) ?? [];
    arr.push(f);
    byCoin.set(f.coin, arr);
  }

  const out: ClosedTrade[] = [];
  for (const [coin, fills] of byCoin) {
    let openFeePool = 0;
    let openSize = 0;
    for (const f of [...fills].sort((a, b) => a.time - b.time)) {
      const size = Math.abs(f.sz);
      if (f.closedPnl === 0) {
        // Opening or adding — bank the fee until a close consumes it.
        openFeePool += f.fee;
        openSize += size;
        continue;
      }
      const consumed = openSize > 0 ? Math.min(size, openSize) : 0;
      const share = openSize > 0 ? consumed / openSize : 0;
      const entryFee = openFeePool * share;
      openFeePool -= entryFee;
      openSize -= consumed;
      const fee = entryFee + f.fee;
      out.push({
        time: f.time,
        coin,
        dir: f.dir,
        side: /long/i.test(f.dir) ? "long" : /short/i.test(f.dir) ? "short" : null,
        px: f.px,
        sz: f.sz,
        closedPnl: f.closedPnl,
        exitFee: f.fee,
        entryFee,
        fee,
        net: f.closedPnl - fee,
        hash: f.hash,
      });
    }
  }
  return out.sort((a, b) => b.time - a.time);
}

export interface PeriodPnl {
  realized: number;
  fees: number;
  net: number;
  trades: number;
}

/**
 * Realized PnL over ROLLING windows, computed from the fill ledger.
 *
 * Two reasons this isn't calendar-based: Jester's /pnl/summary returns
 * `pnl: {total:0, today:0, week:0, month:0}` (fields present, never populated), and calendar periods
 * against a UTC server mislead — at 04:00 UTC Monday, "today" is 4 hours old and "this week" is ~28
 * hours, which reads as a collapse in activity when nothing changed. Rolling windows are
 * timezone-independent, always a full period, and match the rest of the app's 7D/30D/90D selectors.
 * `net` is realized minus fees.
 */
export function periodsFromFills(all: Fill[]): {
  day: PeriodPnl;
  week: PeriodPnl;
  month: PeriodPnl;
  allTime: PeriodPnl;
} {
  const now = Date.now();
  const since = (from: number): PeriodPnl => {
    const f = all.filter((x) => x.time >= from);
    const realized = f.reduce((a, x) => a + x.closedPnl, 0);
    const fees = f.reduce((a, x) => a + x.fee, 0);
    return { realized, fees, net: realized - fees, trades: f.filter((x) => x.closedPnl !== 0).length };
  };
  return {
    day: since(now - 86_400_000),
    week: since(now - 7 * 86_400_000),
    month: since(now - 30 * 86_400_000),
    allTime: since(0),
  };
}

export interface DailyStat {
  date: string; // YYYY-MM-DD in the requested timeZone (UTC if none given)
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  realized: number;
  fees: number;
  net: number;
  cumulative: number; // running net across the series
}

/**
 * Per-day roll-up of the fill ledger: how many trades closed, how many won, and the money. This is
 * what makes "is it working?" answerable over time rather than as one blended average.
 */
export function dailyFromFills(all: Fill[], timeZone?: string): DailyStat[] {
  // Bucket by the VIEWER's calendar day, not the server's. The API container runs in UTC, so
  // UTC-bucketing splits a US evening's trading across two "days" and makes the current day look
  // empty — the same class of bug that made the calendar PnL tiles read $0.
  const dayKey = (t: number) => {
    if (!timeZone) return new Date(t).toISOString().slice(0, 10);
    try {
      // en-CA formats as YYYY-MM-DD, which sorts lexicographically.
      return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
        new Date(t),
      );
    } catch {
      return new Date(t).toISOString().slice(0, 10); // unknown zone — fall back to UTC
    }
  };
  const map = new Map<string, { trades: number; wins: number; realized: number; fees: number }>();
  for (const f of all) {
    const date = dayKey(f.time);
    const e = map.get(date) ?? { trades: 0, wins: 0, realized: 0, fees: 0 };
    e.fees += f.fee;
    if (f.closedPnl !== 0) {
      e.trades++;
      e.realized += f.closedPnl;
      if (f.closedPnl > 0) e.wins++;
    }
    map.set(date, e);
  }
  let cum = 0;
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, e]) => {
      const net = e.realized - e.fees;
      cum += net;
      return {
        date,
        trades: e.trades,
        wins: e.wins,
        losses: e.trades - e.wins,
        winRate: e.trades ? (e.wins / e.trades) * 100 : 0,
        realized: e.realized,
        fees: e.fees,
        net,
        cumulative: cum,
      };
    });
}

const sideOf = (dir: string): "long" | "short" | null =>
  /long/i.test(dir) ? "long" : /short/i.test(dir) ? "short" : null;

/**
 * Comprehensive stats over a set of fills — computed from the raw Hyperliquid ledger, so it's the
 * authoritative view (not Jester's summary). "Trades" = closing fills (the ones that book realized
 * PnL); fees and volume span every fill.
 */
export function summarizeFills(all: Fill[]): FillStats {
  const closing = all.filter((f) => f.closedPnl !== 0);
  const wins = closing.filter((f) => f.closedPnl > 0);
  const losses = closing.filter((f) => f.closedPnl < 0);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const realized = sum(closing.map((f) => f.closedPnl));
  const fees = sum(all.map((f) => f.fee));
  const grossProfit = sum(wins.map((f) => f.closedPnl));
  const grossLoss = sum(losses.map((f) => f.closedPnl)); // ≤ 0
  const times = closing.map((f) => f.time);

  const sideStat = (side: "long" | "short"): SideStat => {
    const rows = closing.filter((f) => sideOf(f.dir) === side);
    const w = rows.filter((f) => f.closedPnl > 0).length;
    const realized = sum(rows.map((f) => f.closedPnl));
    // Fees are charged per fill, so attribute every fill (opens included) by its own direction.
    const sideFees = sum(all.filter((f) => sideOf(f.dir) === side).map((f) => f.fee));
    return {
      trades: rows.length,
      realized,
      fees: sideFees,
      net: realized - sideFees,
      wins: w,
      winRate: rows.length ? (w / rows.length) * 100 : 0,
    };
  };

  const coinMap = new Map<string, Fill[]>();
  for (const f of closing) {
    const arr = coinMap.get(f.coin) ?? [];
    arr.push(f);
    coinMap.set(f.coin, arr);
  }
  const feeByCoin = new Map<string, number>();
  for (const f of all) feeByCoin.set(f.coin, (feeByCoin.get(f.coin) ?? 0) + f.fee);
  const byCoin: CoinStat[] = [...coinMap.entries()]
    .map(([coin, rows]) => {
      const realized = sum(rows.map((f) => f.closedPnl));
      const fees = feeByCoin.get(coin) ?? 0;
      return {
        coin,
        trades: rows.length,
        realized,
        fees,
        net: realized - fees,
        winRate: rows.length ? (rows.filter((f) => f.closedPnl > 0).length / rows.length) * 100 : 0,
      };
    })
    .sort((a, b) => b.trades - a.trades);

  return {
    trades: closing.length,
    fills: all.length,
    realized,
    fees,
    net: realized - fees,
    volumeUsd: sum(all.map((f) => Math.abs(f.px * f.sz))),
    wins: wins.length,
    losses: losses.length,
    winRate: closing.length ? (wins.length / closing.length) * 100 : 0,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss !== 0 ? grossProfit / Math.abs(grossLoss) : null,
    avgWin: wins.length ? grossProfit / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
    largestWin: wins.length ? Math.max(...wins.map((f) => f.closedPnl)) : 0,
    largestLoss: losses.length ? Math.min(...losses.map((f) => f.closedPnl)) : 0,
    expectancy: closing.length ? realized / closing.length : 0,
    bySide: { long: sideStat("long"), short: sideStat("short") },
    byCoin,
    firstTradeAt: times.length ? Math.min(...times) : null,
    lastTradeAt: times.length ? Math.max(...times) : null,
  };
}
