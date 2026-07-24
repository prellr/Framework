/**
 * Polymarket Up/Down edge scoring (Phase 1, read-only) — does Tesseract's 5m Field predict crypto
 * direction better than the coin-flip Polymarket prices, net of the ~1¢ spread?
 *
 * Method: for each resolved six-asset Up/Down market, align our logged Tesseract snapshot at the
 * window start → a P(up); read the market's implied Up price then; compare to the resolution. If our
 * P(up) diverges from the implied by > threshold, we'd "bet" that side — score the realized P&L.
 * The Tesseract logger is the historical signal source (Tesseract itself is live-only).
 *
 * No orders, no funds — this only measures whether an edge exists. See POLYMARKET_UPDOWN_PLAN.md.
 */
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, tesseractSnapshots, polymarketUpdownScores, polymarketBookSnapshots, signalSnapshots } from "@framework/db";
import { GAUGE_SOURCE } from "./signal-gauge-logger.ts";
import {
  fetchGammaMarkets,
  fetchClobBooks,
  fetchClobMarket,
  fetchClobPriceHistory,
  bookSummary,
  isCryptoUpDown,
  updownHorizonMinutes,
  upTokenId,
  downTokenId,
  fetchCurrentCryptoUpDown,
  type GammaMarket,
} from "./polymarket.ts";

export const RETROSPECTIVE_UPDOWN_PAIRS = [
  "BTC-USD",
  "ETH-USD",
  "SOL-USD",
  "XRP-USD",
  "DOGE-USD",
  "BNB-USD",
] as const;
export type RetrospectiveUpdownPair =
  (typeof RETROSPECTIVE_UPDOWN_PAIRS)[number];
const RETROSPECTIVE_UPDOWN_PAIR_SET = new Set<string>(
  RETROSPECTIVE_UPDOWN_PAIRS,
);

/** Map a market question to the exact six-asset Jester research universe. */
export function updownPairOfQuestion(
  question: string,
): RetrospectiveUpdownPair | null {
  const q = question.toLowerCase();
  if (/bitcoin|\bbtc\b/.test(q)) return "BTC-USD";
  if (/ethereum|\beth\b/.test(q)) return "ETH-USD";
  if (/solana|\bsol\b/.test(q)) return "SOL-USD";
  if (/\bxrp\b/.test(q)) return "XRP-USD";
  if (/dogecoin|\bdoge\b/.test(q)) return "DOGE-USD";
  if (/\bbnb\b|binance coin/.test(q)) return "BNB-USD";
  return null;
}

/** Bridge v1: Tesseract gauge (0–100, 50 = neutral) → P(up). Naive linear; the backtest tells us
 * whether it's calibrated. Clamped off the 0/1 rails. Later: incorporate Field dims / other strategies. */
export const gaugeToPup = (gauge: number) => Math.max(0.02, Math.min(0.98, gauge / 100));

export interface Scored {
  pair: string;
  slug: string;
  horizonMin: number;
  windowStartMs: number;
  impliedPup: number; // what the market priced Up at, at window start (mid)
  upAsk: number | null; // real best-ask to buy Up at window start (from a captured live book; null if none)
  downAsk: number | null; // real best-ask to buy Down at window start
  tessPup: number; // Tesseract signal P(up)
  gaugePup: number | null; // Trade composite gauge P(up) at window start (bot #2; null if not logged then)
  gauge: number;
  edge: number; // tessPup − impliedPup
  resolvedUp: boolean;
  bet: "up" | "down" | null; // side we'd take (null = edge below threshold, no bet)
  profit: number | null; // realized P&L per 1 contract (mid-price; spread charged separately)
  signalAgeSec: number; // how far the aligned Tesseract snapshot was from window start
}

/** Nearest logged Trade-gauge P(up) for a pair to a timestamp, within tolerance (bot #2). Null if the
 * gauge logger wasn't running near that window (e.g. all markets scored before it started). */
async function gaugeAt(pair: string, tMs: number, tolSec = 420): Promise<number | null> {
  const [row] = await db
    .select({ pup: signalSnapshots.pup })
    .from(signalSnapshots)
    .where(
      and(
        eq(signalSnapshots.source, GAUGE_SOURCE),
        eq(signalSnapshots.pair, pair),
        gte(signalSnapshots.capturedAt, new Date(tMs - tolSec * 1000)),
        lte(signalSnapshots.capturedAt, new Date(tMs + tolSec * 1000)),
      ),
    )
    .orderBy(sql`abs(extract(epoch from ${signalSnapshots.capturedAt}) - ${tMs / 1000})`)
    .limit(1);
  return row?.pup ?? null;
}

/** The captured live-book asks for a market — the earliest snapshot (closest to open) best approximates
 * the book we'd have entered at window start. Null if we never snapshotted this market. */
async function asksAtWindowStart(conditionId: string): Promise<{ upAsk: number | null; downAsk: number | null }> {
  const [row] = await db
    .select({ upAsk: polymarketBookSnapshots.upAsk, downAsk: polymarketBookSnapshots.downAsk })
    .from(polymarketBookSnapshots)
    .where(eq(polymarketBookSnapshots.conditionId, conditionId))
    .orderBy(polymarketBookSnapshots.capturedAt)
    .limit(1);
  return { upAsk: row?.upAsk ?? null, downAsk: row?.downAsk ?? null };
}

/** Nearest logged Tesseract snapshot to a timestamp for a pair, within tolerance. */
async function tesseractAt(pair: string, tMs: number, tolSec = 420) {
  const [row] = await db
    .select({ gauge: tesseractSnapshots.gaugeScore, at: tesseractSnapshots.capturedAt, dir: tesseractSnapshots.direction })
    .from(tesseractSnapshots)
    .where(
      and(
        eq(tesseractSnapshots.pair, pair),
        gte(tesseractSnapshots.capturedAt, new Date(tMs - tolSec * 1000)),
        lte(tesseractSnapshots.capturedAt, new Date(tMs + tolSec * 1000)),
        sql`${tesseractSnapshots.gaugeScore} is not null`,
      ),
    )
    .orderBy(sql`abs(extract(epoch from ${tesseractSnapshots.capturedAt}) - ${tMs / 1000})`)
    .limit(1);
  if (!row || row.gauge == null) return null;
  return { pup: gaugeToPup(row.gauge), gauge: row.gauge, ageSec: Math.abs(row.at.getTime() - tMs) / 1000 };
}

/** Score one resolved market against our logged signal. Null if not scorable (unresolved, no aligned
 * Tesseract snapshot, or missing price). Does the two CLOB calls only after the cheap Tesseract check. */
export async function scoreMarket(m: GammaMarket, edgeThresh = 0.05): Promise<Scored | null> {
  const pair = updownPairOfQuestion(m.question);
  const hz = updownHorizonMinutes(m.question);
  const endMs = m.endDate ? new Date(m.endDate).getTime() : null;
  if (!pair || !hz || !endMs) return null;
  const startMs = endMs - hz * 60_000;

  // Cheap gate first: do we even have a Tesseract signal near the window start?
  const tess = await tesseractAt(pair, startMs);
  if (!tess) return null;

  // Resolution (winner flag; fall back to Up-token last price).
  const clob = await fetchClobMarket(m.conditionId).catch(() => null);
  if (!clob || !clob.closed) return null;
  const upTok = clob.tokens.find((t) => /up/i.test(t.outcome));
  if (!upTok) return null;
  let resolvedUp: boolean;
  if (typeof upTok.winner === "boolean") resolvedUp = upTok.winner;
  else if (typeof upTok.price === "number") resolvedUp = upTok.price > 0.5;
  else return null;

  // Implied Up price at window start (what we'd have paid).
  const tokenId = upTokenId(m) ?? upTok.token_id;
  const hist = await fetchClobPriceHistory(tokenId, 1).catch(() => []);
  if (!hist.length) return null;
  const before = hist.filter((h) => h.t * 1000 <= startMs);
  const impliedPup = (before.length ? before[before.length - 1] : hist[0]).p;

  // Real entry asks captured live (null for markets we never snapshotted, e.g. all pre-capture rows).
  const { upAsk, downAsk } = await asksAtWindowStart(m.conditionId);
  // Bot #2: the Trade composite gauge P(up) aligned at window start (null until the gauge logger runs).
  const gaugePup = await gaugeAt(pair, startMs);

  const edge = tess.pup - impliedPup;
  let bet: "up" | "down" | null = null;
  let profit: number | null = null;
  if (edge > edgeThresh) { bet = "up"; profit = (resolvedUp ? 1 : 0) - impliedPup; }
  else if (edge < -edgeThresh) { bet = "down"; profit = (resolvedUp ? 0 : 1) - (1 - impliedPup); }

  return { pair, slug: m.slug, horizonMin: hz, windowStartMs: startMs, impliedPup, upAsk, downAsk, tessPup: tess.pup, gaugePup, gauge: tess.gauge, edge, resolvedUp, bet, profit, signalAgeSec: tess.ageSec };
}

/** Retrospective backtest: pull resolved six-asset Up/Down markets over the window our Tesseract log
 * covers, score each. Returns every scorable record (the aggregate is computed by the caller). */
/** Resolved six-asset Up/Down markets over the last `hoursBack`. Gamma caps offset at ~2000 and
 * thousands of markets resolve per day, so page by a TIGHT end_date window (2h chunks). */
export async function findResolvedUpDownMarkets(hoursBack = 48): Promise<GammaMarket[]> {
  const now = Date.now();
  const seen = new Set<string>();
  const out: GammaMarket[] = [];
  const CHUNK_H = 2;
  for (let back = 0; back < hoursBack; back += CHUNK_H) {
    const hi = new Date(now - back * 3600_000);
    const lo = new Date(now - (back + CHUNK_H) * 3600_000);
    for (let off = 0; off <= 1900; off += 100) {
      const page = await fetchGammaMarkets({ closed: true, limit: 100, offset: off, order: "endDate", ascending: false, endDateMin: lo.toISOString(), endDateMax: hi.toISOString() });
      if (!page.length) break;
      for (const m of page) {
        const p = updownPairOfQuestion(m.question);
        if (
          isCryptoUpDown(m)
          && p != null
          && RETROSPECTIVE_UPDOWN_PAIR_SET.has(p)
          && !seen.has(m.conditionId)
        ) {
          seen.add(m.conditionId);
          out.push(m);
        }
      }
      if (page.length < 100) break;
    }
  }
  return out;
}

/** In-memory retrospective backtest (used by the pm-backfill script). */
export async function backfillRetrospective(hoursBack = 48, edgeThresh = 0.05): Promise<Scored[]> {
  const markets = await findResolvedUpDownMarkets(hoursBack);
  const scored: Scored[] = [];
  for (const m of markets) {
    const s = await scoreMarket(m, edgeThresh).catch(() => null);
    if (s) scored.push(s);
  }
  return scored;
}

/**
 * Forward descriptive collector: find resolved six-asset Up/Down markets in the recent window,
 * score the ones we
 * haven't recorded yet, and persist them. Idempotent (dedup by conditionId). The scheduled job calls
 * this with a short window; a one-time seed can pass a longer window + source="retrospective".
 */
export async function collectAndPersist(hoursBack = 2, source: "forward" | "retrospective" = "forward"): Promise<{ scored: number; skipped: number; noSignal: number }> {
  const markets = await findResolvedUpDownMarkets(hoursBack);
  if (!markets.length) return { scored: 0, skipped: 0, noSignal: 0 };
  const ids = markets.map((m) => m.conditionId);
  const existing = new Set(
    (await db.select({ c: polymarketUpdownScores.conditionId }).from(polymarketUpdownScores).where(inArray(polymarketUpdownScores.conditionId, ids))).map((r) => r.c),
  );
  let scored = 0, skipped = 0, noSignal = 0;
  for (const m of markets) {
    if (existing.has(m.conditionId)) { skipped++; continue; }
    const s = await scoreMarket(m).catch(() => null);
    if (!s) { noSignal++; continue; }
    await db.insert(polymarketUpdownScores).values({
      conditionId: m.conditionId, slug: s.slug, pair: s.pair, horizonMin: s.horizonMin,
      windowStart: new Date(s.windowStartMs), impliedPup: s.impliedPup, upAsk: s.upAsk, downAsk: s.downAsk,
      tessPup: s.tessPup, gaugePup: s.gaugePup, gauge: s.gauge, edge: s.edge, resolvedUp: s.resolvedUp, signalAgeSec: s.signalAgeSec, source,
    }).onConflictDoNothing();
    scored++;
  }
  return { scored, skipped, noSignal };
}

/**
 * Book-capture pass: snapshot the best bid/ask of currently-open six-asset Up/Down markets so we know
 * the real ask we'd pay to enter — the one thing CLOB won't give us historically. Inserts at most one
 * snapshot per market (skips any we've already captured), so it stays cheap even at a fast cadence.
 * Called by the `polymarket-book-capture` job. Read-only; no orders.
 */
export async function capturePolymarketBooks(): Promise<{ captured: number; skipped: number; markets: number }> {
  const live = (await fetchCurrentCryptoUpDown().catch(() => []))
    .filter((m) => {
      const pair = updownPairOfQuestion(m.question);
      return pair != null
        && RETROSPECTIVE_UPDOWN_PAIR_SET.has(pair)
        && updownHorizonMinutes(m.question) != null;
    });
  if (!live.length) return { captured: 0, skipped: 0, markets: 0 };
  const ids = live.map((m) => m.conditionId);
  const seen = new Set(
    (await db.select({ c: polymarketBookSnapshots.conditionId }).from(polymarketBookSnapshots).where(inArray(polymarketBookSnapshots.conditionId, ids))).map((r) => r.c),
  );
  const candidates: {
    market: GammaMarket;
    pair: RetrospectiveUpdownPair;
    horizonMin: number;
    endMs: number;
    upToken: string;
    downToken: string;
  }[] = [];
  let captured = 0, skipped = 0;
  for (const m of live) {
    if (seen.has(m.conditionId)) { skipped++; continue; }
    const pair = updownPairOfQuestion(m.question);
    const hz = updownHorizonMinutes(m.question);
    const endMs = m.endDate ? new Date(m.endDate).getTime() : null;
    if (!pair || !hz || !endMs) { skipped++; continue; }
    const upTok = upTokenId(m), downTok = downTokenId(m);
    if (!upTok || !downTok) { skipped++; continue; }
    candidates.push({
      market: m,
      pair,
      horizonMin: hz,
      endMs,
      upToken: upTok,
      downToken: downTok,
    });
  }

  // One coherent batch per pass avoids two serial public CLOB requests per unseen market.
  const books = candidates.length
    ? await fetchClobBooks(
      candidates.flatMap(({ upToken, downToken }) => [upToken, downToken]),
    ).catch(() => [])
    : [];
  const booksByToken = new Map(books.map((book) => [book.asset_id, book]));

  for (const candidate of candidates) {
    const {
      market,
      pair,
      horizonMin,
      endMs,
      upToken,
      downToken,
    } = candidate;
    const upBook = booksByToken.get(upToken);
    const downBook = booksByToken.get(downToken);
    const up = upBook ? bookSummary(upBook) : null;
    const down = downBook ? bookSummary(downBook) : null;
    const upAsk = up?.bestAsk ?? null, downAsk = down?.bestAsk ?? null;
    // Only store a COHERENT two-sided book. Fresh markets open with an empty book + dust orders (a stray
    // 1¢ sell reads as "best ask"), so require both asks in-range and summing ~>1 (you pay a little over
    // $1 to hold both sides = the spread). Degenerate books are skipped WITHOUT marking the market seen,
    // so the next 3-min tick retries once real liquidity has arrived.
    const sane = upAsk != null && downAsk != null && upAsk > 0.02 && upAsk < 0.98 && downAsk > 0.02 && downAsk < 0.98 && upAsk + downAsk > 0.9;
    if (!sane) { skipped++; continue; }
    await db.insert(polymarketBookSnapshots).values({
      conditionId: market.conditionId, slug: market.slug, pair, horizonMin,
      windowStart: new Date(endMs - horizonMin * 60_000),
      upBid: up?.bestBid ?? null, upAsk, downBid: down?.bestBid ?? null, downAsk,
    });
    captured++;
  }
  return { captured, skipped, markets: live.length };
}

/** Time-ordered scored records (minimal fields) — the frontend Strategy Lab computes each strategy's
 * equity curve + calibration from these, so new strategy definitions need no backend change. */
export async function scoreSeries() {
  const rows = await db
    .select({
      windowStart: polymarketUpdownScores.windowStart,
      pair: polymarketUpdownScores.pair,
      horizonMin: polymarketUpdownScores.horizonMin,
      tessPup: polymarketUpdownScores.tessPup,
      gaugePup: polymarketUpdownScores.gaugePup,
      impliedPup: polymarketUpdownScores.impliedPup,
      upAsk: polymarketUpdownScores.upAsk,
      downAsk: polymarketUpdownScores.downAsk,
      signalAgeSec: polymarketUpdownScores.signalAgeSec,
      resolvedUp: polymarketUpdownScores.resolvedUp,
    })
    .from(polymarketUpdownScores)
    .orderBy(sql`${polymarketUpdownScores.windowStart} asc`);
  return rows.map((r) => ({
    t: r.windowStart.getTime(),
    pair: r.pair,
    horizonMin: r.horizonMin,
    tessPup: r.tessPup ?? 0.5,
    gaugePup: r.gaugePup, // Trade-gauge P(up), null until the gauge logger covered that window (bot #2)
    impliedPup: r.impliedPup ?? 0.5,
    upAsk: r.upAsk, // real entry ask (null pre-capture → the Lab models it as mid + half-spread)
    downAsk: r.downAsk,
    signalAgeSec: r.signalAgeSec ?? null, // Tesseract snapshot distance from window start (freshness gate)
    resolvedUp: r.resolvedUp,
  }));
}

/** Load persisted scores → the aggregate (follow vs fade vs drift), for the scoreboard. */
export async function scoreboard() {
  const rows = await db.select().from(polymarketUpdownScores);
  const scored: Scored[] = rows.map((r) => {
    const edge = r.edge ?? 0, implied = r.impliedPup ?? 0.5;
    const bet = edge > 0.05 ? "up" : edge < -0.05 ? "down" : null;
    const profit = bet ? betProfit(bet, implied, r.resolvedUp) : null;
    return { pair: r.pair, slug: r.slug ?? "", horizonMin: r.horizonMin, windowStartMs: r.windowStart.getTime(), impliedPup: implied, upAsk: r.upAsk ?? null, downAsk: r.downAsk ?? null, tessPup: r.tessPup ?? 0.5, gaugePup: r.gaugePup ?? null, gauge: r.gauge ?? 50, edge, resolvedUp: r.resolvedUp, bet, profit, signalAgeSec: r.signalAgeSec ?? 0 };
  });
  const times = rows.map((r) => r.windowStart.getTime());
  return {
    ...summarize(scored),
    firstAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
    lastAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
    total: rows.length,
  };
}

/** P&L of an arbitrary directional bet at a market's implied Up price, given the resolution. */
function betProfit(side: "up" | "down", impliedPup: number, resolvedUp: boolean): number {
  return side === "up" ? (resolvedUp ? 1 : 0) - impliedPup : (resolvedUp ? 0 : 1) - (1 - impliedPup);
}

/** The same rows scored as if we FADE Tesseract (signal = 1 − tessPup) — tests the contrarian read. */
function summarizeSide(rows: Scored[], fade: boolean, edgeThresh = 0.05) {
  let bets = 0, wins = 0, sum = 0;
  for (const r of rows) {
    const pup = fade ? 1 - r.tessPup : r.tessPup;
    const edge = pup - r.impliedPup;
    const side = edge > edgeThresh ? "up" : edge < -edgeThresh ? "down" : null;
    if (!side) continue;
    const p = betProfit(side, r.impliedPup, r.resolvedUp);
    bets++; sum += p; if ((side === "up") === r.resolvedUp) wins++;
  }
  return { bets, winRate: bets ? wins / bets : null, grossAvg: bets ? sum / bets : null, netAvg: bets ? sum / bets - 0.005 : null };
}

/** Aggregate scored records into the edge verdict. */
export function summarize(rows: Scored[]) {
  const bets = rows.filter((r) => r.bet && r.profit != null);
  const profits = bets.map((r) => r.profit!);
  const wins = bets.filter((r) => (r.bet === "up") === r.resolvedUp).length;
  // Signal calibration: when tessPup>0.5 (Tesseract says up), how often did it resolve up?
  const saysUp = rows.filter((r) => r.tessPup > 0.5);
  const saysUpHit = saysUp.filter((r) => r.resolvedUp).length;
  const baseUpRate = rows.length ? rows.filter((r) => r.resolvedUp).length / rows.length : 0;
  const spreadCost = 0.005; // ~half of a 1¢ spread per side, as a rough net adjustment
  return {
    scored: rows.length,
    bets: bets.length,
    betWinRate: bets.length ? wins / bets.length : null,
    grossAvgProfit: profits.length ? profits.reduce((a, b) => a + b, 0) / profits.length : null,
    netAvgProfit: profits.length ? profits.reduce((a, b) => a + b, 0) / profits.length - spreadCost : null,
    tesseractDirectionalAccuracy: saysUp.length ? saysUpHit / saysUp.length : null, // vs base up-rate
    baseUpRate,
    byHorizon: [15, 5].map((h) => {
      const hb = bets.filter((r) => Math.abs(r.horizonMin - h) <= (h === 5 ? 2 : 5));
      const p = hb.map((r) => r.profit!);
      return { horizon: h, bets: hb.length, avgProfit: p.length ? p.reduce((a, b) => a + b, 0) / p.length : null };
    }),
    // The two directions of the signal, head to head:
    followTesseract: summarizeSide(rows, false),
    fadeTesseract: summarizeSide(rows, true),
    // Drift controls — the fade must beat "just bet the drift". alwaysDown wins whenever the period
    // fell; the fade only has real inverse-signal to the extent it beats this.
    baselineAlwaysDown: (() => { let w = 0, s = 0; for (const r of rows) { s += betProfit("down", r.impliedPup, r.resolvedUp); if (!r.resolvedUp) w++; } return { winRate: rows.length ? w / rows.length : null, grossAvg: rows.length ? s / rows.length : null }; })(),
    fadeEdgeBeyondDrift: (() => {
      const fade = summarizeSide(rows, true); let ds = 0; for (const r of rows) ds += betProfit("down", r.impliedPup, r.resolvedUp);
      const driftAvg = rows.length ? ds / rows.length : 0;
      return { fadeGross: fade.grossAvg, driftGross: driftAvg, residualEdge: (fade.grossAvg ?? 0) - driftAvg };
    })(),
    fadeByCoin: RETROSPECTIVE_UPDOWN_PAIRS.map((coin) => ({
      coin,
      ...summarizeSide(rows.filter((row) => row.pair === coin), true),
    })),
    fadeByHorizon: [5, 15].map((h) => ({ horizon: h, ...summarizeSide(rows.filter((r) => Math.abs(r.horizonMin - h) <= (h === 5 ? 2 : 5)), true) })),
  };
}
