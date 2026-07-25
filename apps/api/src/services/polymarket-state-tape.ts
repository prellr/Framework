/**
 * Forward-only market-state tape for empirical fair-value and cross-venue lead/lag research.
 *
 * This collector never decides a side and never places an order. Once per elapsed market minute it
 * records the resolution-source price/strike, an independent Hyperliquid reference, normalized
 * distance to strike, and a real $5 book-walk fill for both outcomes. After its own preregistered
 * boundary it also preserves raw touch-size/depth inputs for microprice and temporal OFI research.
 * Rows are labeled only after the CLOB reports a winner. Any model built from this tape must be
 * specified and registered separately before it begins a fresh forward evaluation window.
 */
import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db, polymarketStateSnapshots } from "@framework/db";
import { getSetting } from "./config.ts";
import { getRecentCandles } from "./hyperliquid.ts";
import { HYPERLIQUID_FLOW_TAPE, hlFlowNow } from "./hl-rtds.ts";
import { coinOf } from "./param-tracking.ts";
import {
  bookSummary,
  downTokenId,
  fetchClobBook,
  fetchClobMarket,
  fetchClobMarketInfo,
  fetchCurrentCryptoUpDown,
  updownHorizonMinutes,
  upTokenId,
  type GammaMarket,
} from "./polymarket.ts";
import { ewmaVol, logReturns, PRICER, strikeAt } from "./pricer.ts";
import { chainlinkAt, chainlinkNow, RTDS_FRESH_SEC } from "./rtds.ts";
import { normalizedDistance, surfaceSampleMinute } from "./polymarket-state-features.ts";
import {
  microstructureCaptureEnabled,
  microstructureDiagnosticReady,
  POLYMARKET_MICROSTRUCTURE_TAPE,
} from "./polymarket-microstructure.ts";
import { takerFeeDescriptor, type TakerFeeDescriptor } from "./polymarket-fees.ts";
import { STATE_TAPE_EXECUTION_V2, stateTapeBookFill } from "./state-tape-execution.ts";
import {
  multiStakeCapacityCapture,
  multiStakeCapacityReady,
  POLYMARKET_MULTI_STAKE_CAPACITY,
} from "./polymarket-multi-stake-capacity.ts";
import {
  CLOB_EVENT_OFI_TAPE,
  clobEventOfiNow,
  clobEventOfiRuntimeStatus,
} from "./clob-event-ofi.ts";

export const STATE_TAPE = {
  sizeUsd: 5,
  minRemainingSec: 60,
  maxHorizonMin: 60,
  voidAfterSec: 86_400,
  gradeBatchMarkets: 16,
} as const;

const ENABLED_KEY = "polymarket_state_tape_enabled";
const feeByCondition = new Map<string, TakerFeeDescriptor>();
let lastClobEventOfiUnavailableLogAt = 0;

function pairOf(question: string): string | null {
  const q = question.toLowerCase();
  if (/bitcoin|\bbtc\b/.test(q)) return "BTC-USD";
  if (/ethereum|\beth\b/.test(q)) return "ETH-USD";
  if (/solana|\bsol\b/.test(q)) return "SOL-USD";
  if (/\bxrp\b/.test(q)) return "XRP-USD";
  if (/dogecoin|\bdoge\b/.test(q)) return "DOGE-USD";
  if (/\bbnb\b/.test(q)) return "BNB-USD";
  return null;
}

async function enabled(): Promise<boolean> {
  const value = await getSetting(ENABLED_KEY);
  return value == null ? true : value === "true";
}

interface LiveMarket {
  market: GammaMarket;
  pair: string;
  horizonMin: number;
  startMs: number;
  endMs: number;
  remainingSec: number;
  sampleMinute: number;
}

function liveMarket(market: GammaMarket, now: number): LiveMarket | null {
  const pair = pairOf(market.question);
  const horizonMin = updownHorizonMinutes(market.question);
  const endMs = market.endDate ? new Date(market.endDate).getTime() : NaN;
  if (!pair || !horizonMin || horizonMin > STATE_TAPE.maxHorizonMin || !Number.isFinite(endMs))
    return null;
  const startMs = endMs - horizonMin * 60_000;
  const remainingSec = Math.floor((endMs - now) / 1000);
  const sampleMinute = surfaceSampleMinute(startMs, now);
  if (sampleMinute < 0 || now < startMs || remainingSec < STATE_TAPE.minRemainingSec) return null;
  return { market, pair, horizonMin, startMs, endMs, remainingSec, sampleMinute };
}

/** Capture at most one immutable row per market and elapsed minute. Public/read-only APIs only. */
export async function capturePolymarketStateTick(): Promise<{
  captured: number;
  considered: number;
}> {
  if (!(await enabled())) return { captured: 0, considered: 0 };
  const now = Date.now();
  const live = (await fetchCurrentCryptoUpDown().catch(() => []))
    .map((market) => liveMarket(market, now))
    .filter((x): x is LiveMarket => x != null);
  if (!live.length) return { captured: 0, considered: 0 };

  type CandleState = {
    candles: Awaited<ReturnType<typeof getRecentCandles>>;
    spot: number;
    strikeByStart: Map<number, number | null>;
    sigma: number | null;
    ageSec: number;
  };
  const candleCache = new Map<string, CandleState | null>();
  const candlesFor = async (pair: string): Promise<CandleState | null> => {
    if (!candleCache.has(pair)) {
      const candles = await getRecentCandles(coinOf(pair), 1, PRICER.volMaxBars + 65).catch(
        () => [],
      );
      if (candles.length < PRICER.volMinBars + 1) candleCache.set(pair, null);
      else {
        const closes = candles.map((c) => c.c);
        candleCache.set(pair, {
          candles,
          spot: closes[closes.length - 1],
          strikeByStart: new Map(),
          sigma: ewmaVol(logReturns(closes)),
          ageSec: Math.max(0, (now - candles[candles.length - 1].t) / 1000),
        });
      }
    }
    return candleCache.get(pair) ?? null;
  };

  let captured = 0;
  let clobEventOfiUsable = 0;
  for (const x of live) {
    const cd = await candlesFor(x.pair);
    if (!cd) continue;
    if (!cd.strikeByStart.has(x.startMs))
      cd.strikeByStart.set(x.startMs, strikeAt(cd.candles, x.startMs));
    const hlStrike = cd.strikeByStart.get(x.startMs) ?? null;

    const clNow = chainlinkNow(x.pair);
    const clStrike = chainlinkAt(x.pair, x.startMs);
    const chainlinkUsable = clNow != null && clNow.ageSec < RTDS_FRESH_SEC && clStrike != null;
    const referenceSource = chainlinkUsable ? "chainlink" : "hyperliquid";
    const spot = chainlinkUsable ? clNow.px : cd.spot;
    const strike = chainlinkUsable ? clStrike : hlStrike;
    if (strike == null) continue;
    const coords = normalizedDistance(spot, strike, cd.sigma, x.remainingSec);
    if (!coords) continue;

    const upToken = upTokenId(x.market),
      downToken = downTokenId(x.market);
    if (!upToken || !downToken) continue;
    // The socket accumulator advances continuously while this async tick discovers markets and
    // fetches reference data. Sample its read clock synchronously with the read itself; reusing the
    // tick-start timestamp makes fresh socket data appear to come from the future and correctly
    // trips the accumulator's negative-age guard.
    const clobEventOfi = clobEventOfiNow(upToken, downToken, Date.now());
    if (clobEventOfi) clobEventOfiUsable++;
    let fee: TakerFeeDescriptor | null = null;
    if (now >= STATE_TAPE_EXECUTION_V2.evalStartMs) {
      fee = feeByCondition.get(x.market.conditionId) ?? null;
      if (!fee) {
        fee = takerFeeDescriptor(await fetchClobMarketInfo(x.market.conditionId).catch(() => null));
        if (fee) feeByCondition.set(x.market.conditionId, fee);
      }
    }
    // Sequential on purpose: polymarket.ts applies a process-wide public-API pacing interval.
    const upBook = await fetchClobBook(upToken).catch(() => null);
    const downBook = await fetchClobBook(downToken).catch(() => null);
    if (!upBook || !downBook) continue;
    const upFill = stateTapeBookFill(upBook, now, fee);
    const downFill = stateTapeBookFill(downBook, now, fee);
    // Capacity walks reuse these exact two already-fetched books. This performs no network I/O and
    // cannot influence any strategy decision, paper trade, verdict, or execution path.
    const capacity = multiStakeCapacityCapture(upBook, downBook, now, fee);
    const up = bookSummary(upBook),
      down = bookSummary(downBook);
    const basisBps = clNow != null && clNow.px > 0 ? 10_000 * Math.log(cd.spot / clNow.px) : null;
    const hlFlow = now >= HYPERLIQUID_FLOW_TAPE.evalStartMs ? hlFlowNow(x.pair, now) : null;
    const microstructure = microstructureCaptureEnabled(now)
      ? {
          upBidSize: up.bestBidSize,
          upAskSize: up.bestAskSize,
          downBidSize: down.bestBidSize,
          downAskSize: down.bestAskSize,
          upMicroprice: up.microprice,
          downMicroprice: down.microprice,
          upTouchImbalance: up.touchImbalance,
          downTouchImbalance: down.touchImbalance,
          upBookImbalanceShares: up.bookImbalanceShares,
          downBookImbalanceShares: down.bookImbalanceShares,
          upBookImbalanceUsd: up.bookImbalanceUsd,
          downBookImbalanceUsd: down.bookImbalanceUsd,
          upDepthShares: up.bidDepthShares + up.askDepthShares,
          downDepthShares: down.bidDepthShares + down.askDepthShares,
          upDepthUsd: up.bidDepthUsd + up.askDepthUsd,
          downDepthUsd: down.bidDepthUsd + down.askDepthUsd,
        }
      : {};

    const rows = await db
      .insert(polymarketStateSnapshots)
      .values({
        conditionId: x.market.conditionId,
        slug: x.market.slug,
        pair: x.pair,
        horizonMin: x.horizonMin,
        windowStart: new Date(x.startMs),
        endDate: new Date(x.endMs),
        capturedAt: new Date(now),
        sampleMinute: x.sampleMinute,
        remainingSec: x.remainingSec,
        referenceSource,
        chainlinkSpot: clNow?.px ?? null,
        chainlinkStrike: clStrike,
        chainlinkAgeSec: clNow?.ageSec ?? null,
        hlSpot: cd.spot,
        hlStrike,
        hlAgeSec: cd.ageSec,
        basisBps,
        sigmaPerMin: cd.sigma,
        logMoneyness: coords.logMoneyness,
        zDistance: coords.zDistance,
        upBid: up.bestBid,
        upAsk: up.bestAsk,
        downBid: down.bestBid,
        downAsk: down.bestAsk,
        upFill5: upFill?.effectiveVwap ?? null,
        downFill5: downFill?.effectiveVwap ?? null,
        capacityVersion: capacity?.version ?? null,
        upFill10: capacity?.upFill10 ?? null,
        downFill10: capacity?.downFill10 ?? null,
        upFill20: capacity?.upFill20 ?? null,
        downFill20: capacity?.downFill20 ?? null,
        hlFlowVersion: hlFlow?.version ?? null,
        hlFlowImbalance5s: hlFlow?.imbalance5s ?? null,
        hlFlowImbalance30s: hlFlow?.imbalance30s ?? null,
        hlFlowImbalance60s: hlFlow?.imbalance60s ?? null,
        hlFlowNotional60s: hlFlow?.notional60s ?? null,
        hlFlowTradeCount60s: hlFlow?.tradeCount60s ?? null,
        hlFlowMaxTradeShare60s: hlFlow?.maxTradeShare60s ?? null,
        hlFlowSourceAgeSec: hlFlow?.sourceAgeSec ?? null,
        hlFlowReceiveAgeSec: hlFlow?.receiveAgeSec ?? null,
        hlFlowMaxTransportLagMs60s: hlFlow?.maxTransportLagMs60s ?? null,
        clobEventOfiVersion: clobEventOfi?.version ?? null,
        clobEventOfiCanonical5s: clobEventOfi?.canonical5s ?? null,
        clobEventOfiCanonical30s: clobEventOfi?.canonical30s ?? null,
        clobEventOfiCanonical60s: clobEventOfi?.canonical60s ?? null,
        clobEventOfiUpEvents60s: clobEventOfi?.upEvents60s ?? null,
        clobEventOfiDownEvents60s: clobEventOfi?.downEvents60s ?? null,
        clobEventOfiSourceAgeSec: clobEventOfi?.sourceAgeSec ?? null,
        clobEventOfiReceiveAgeSec: clobEventOfi?.receiveAgeSec ?? null,
        clobEventOfiMaxTransportLagMs60s: clobEventOfi?.maxTransportLagMs60s ?? null,
        ...microstructure,
      })
      .onConflictDoNothing()
      .returning({ id: polymarketStateSnapshots.id });
    captured += rows.length;
  }
  if (
    now >= CLOB_EVENT_OFI_TAPE.evalStartMs &&
    live.length > 0 &&
    clobEventOfiUsable === 0 &&
    now - lastClobEventOfiUnavailableLogAt >= 60_000
  ) {
    const status = clobEventOfiRuntimeStatus(now);
    console.warn(
      `[clob-event-ofi] unavailable considered=${live.length}` +
        ` connected=${status.connected}` +
        ` tracked=${status.trackedTokens}` +
        ` initialized=${status.initializedTokens}` +
        ` retained-events=${status.retainedEvents}` +
        ` books=${status.bookFrames}` +
        ` changes=${status.priceChangeFrames}` +
        ` market-data-age-sec=${status.lastMarketDataAgeSec?.toFixed(1) ?? "none"}`,
    );
    lastClobEventOfiUnavailableLogAt = now;
  }
  return { captured, considered: live.length };
}

/** Label all rows for due markets once; markets still unresolved after a day terminate as void. */
export async function gradePolymarketStateTick(): Promise<{
  markets: number;
  rows: number;
  voided: number;
}> {
  if (!(await enabled())) return { markets: 0, rows: 0, voided: 0 };
  const cutoff = new Date(Date.now() - 90_000);
  const due = await db
    .select({
      conditionId: polymarketStateSnapshots.conditionId,
      endDate: sql<Date>`min(${polymarketStateSnapshots.endDate})`,
    })
    .from(polymarketStateSnapshots)
    .where(
      and(
        eq(polymarketStateSnapshots.labelStatus, "open"),
        isNull(polymarketStateSnapshots.resolvedUp),
        lt(polymarketStateSnapshots.endDate, cutoff),
      ),
    )
    .groupBy(polymarketStateSnapshots.conditionId)
    .limit(STATE_TAPE.gradeBatchMarkets);

  let markets = 0,
    rows = 0,
    voided = 0;
  for (const item of due) {
    const clob = await fetchClobMarket(item.conditionId).catch(() => null);
    const upToken = clob?.tokens.find((token) => /up/i.test(token.outcome));
    const resolvedUp =
      clob?.closed && upToken
        ? typeof upToken.winner === "boolean"
          ? upToken.winner
          : typeof upToken.price === "number"
            ? upToken.price > 0.5
            : null
        : null;
    if (resolvedUp != null) {
      const changed = await db
        .update(polymarketStateSnapshots)
        .set({ labelStatus: "resolved", resolvedUp, labeledAt: new Date() })
        .where(
          and(
            eq(polymarketStateSnapshots.conditionId, item.conditionId),
            eq(polymarketStateSnapshots.labelStatus, "open"),
          ),
        )
        .returning({ id: polymarketStateSnapshots.id });
      markets++;
      rows += changed.length;
    } else if (Date.now() - new Date(item.endDate).getTime() > STATE_TAPE.voidAfterSec * 1000) {
      const changed = await db
        .update(polymarketStateSnapshots)
        .set({ labelStatus: "void", labeledAt: new Date() })
        .where(
          and(
            eq(polymarketStateSnapshots.conditionId, item.conditionId),
            eq(polymarketStateSnapshots.labelStatus, "open"),
          ),
        )
        .returning({ id: polymarketStateSnapshots.id });
      voided += changed.length;
    }
  }
  return { markets, rows, voided };
}

/** Read-only readiness/status for agents. It deliberately returns no outcome-conditioned alpha. */
export async function polymarketMicrostructureTapeStatus() {
  const boundary = new Date(POLYMARKET_MICROSTRUCTURE_TAPE.evalStartMs);
  const [aggregate] = await db
    .select({
      rows: sql<number>`count(*)::int`,
      markets: sql<number>`count(distinct ${polymarketStateSnapshots.conditionId})::int`,
      resolvedMarkets: sql<number>`count(distinct ${polymarketStateSnapshots.conditionId})
        filter (where ${polymarketStateSnapshots.labelStatus} = 'resolved')::int`,
      usableRows: sql<number>`count(*) filter (where
        ${polymarketStateSnapshots.upBidSize} is not null
        and ${polymarketStateSnapshots.upAskSize} is not null
        and ${polymarketStateSnapshots.downBidSize} is not null
        and ${polymarketStateSnapshots.downAskSize} is not null
        and ${polymarketStateSnapshots.upMicroprice} is not null
        and ${polymarketStateSnapshots.downMicroprice} is not null
        and ${polymarketStateSnapshots.upTouchImbalance} is not null
        and ${polymarketStateSnapshots.downTouchImbalance} is not null
        and ${polymarketStateSnapshots.upBookImbalanceShares} is not null
        and ${polymarketStateSnapshots.downBookImbalanceShares} is not null
        and ${polymarketStateSnapshots.upBookImbalanceUsd} is not null
        and ${polymarketStateSnapshots.downBookImbalanceUsd} is not null
        and ${polymarketStateSnapshots.upDepthShares} is not null
        and ${polymarketStateSnapshots.downDepthShares} is not null
        and ${polymarketStateSnapshots.upDepthUsd} is not null
        and ${polymarketStateSnapshots.downDepthUsd} is not null
      )::int`,
      firstCapturedAt: sql<Date | null>`min(${polymarketStateSnapshots.capturedAt})`,
      lastCapturedAt: sql<Date | null>`max(${polymarketStateSnapshots.capturedAt})`,
    })
    .from(polymarketStateSnapshots)
    .where(gte(polymarketStateSnapshots.capturedAt, boundary));
  const firstMs = aggregate?.firstCapturedAt ? new Date(aggregate.firstCapturedAt).getTime() : null;
  const lastMs = aggregate?.lastCapturedAt ? new Date(aggregate.lastCapturedAt).getTime() : null;
  const spanDays = firstMs != null && lastMs != null ? (lastMs - firstMs) / 86_400_000 : 0;
  const resolvedMarkets = Number(aggregate?.resolvedMarkets ?? 0);
  return {
    version: POLYMARKET_MICROSTRUCTURE_TAPE.version,
    evalStartMs: POLYMARKET_MICROSTRUCTURE_TAPE.evalStartMs,
    minResolvedMarkets: POLYMARKET_MICROSTRUCTURE_TAPE.minResolvedMarkets,
    minSpanDays: POLYMARKET_MICROSTRUCTURE_TAPE.minSpanDays,
    rows: Number(aggregate?.rows ?? 0),
    usableRows: Number(aggregate?.usableRows ?? 0),
    markets: Number(aggregate?.markets ?? 0),
    resolvedMarkets,
    spanDays,
    firstCapturedAtMs: firstMs,
    lastCapturedAtMs: lastMs,
    readyForFrozenDiagnostic: microstructureDiagnosticReady(resolvedMarkets, spanDays),
  };
}

/**
 * Read-only collection readiness for the prospective $5/$10/$20 capacity tape.
 *
 * This query intentionally selects no resolution label, outcome, strategy, decision, trade, or P&L.
 * It exposes only collection coverage and asset × timeframe market counts.
 */
export async function polymarketMultiStakeCapacityStatus() {
  const boundary = new Date(POLYMARKET_MULTI_STAKE_CAPACITY.evalStartMs);
  const registeredRows = and(
    gte(polymarketStateSnapshots.capturedAt, boundary),
    inArray(polymarketStateSnapshots.horizonMin, [5, 15]),
  );
  const usablePredicate = sql`
    ${polymarketStateSnapshots.capacityVersion} = ${POLYMARKET_MULTI_STAKE_CAPACITY.version}
    and ${polymarketStateSnapshots.upFill10} is not null
    and ${polymarketStateSnapshots.downFill10} is not null
    and ${polymarketStateSnapshots.upFill20} is not null
    and ${polymarketStateSnapshots.downFill20} is not null
  `;
  const [aggregateRows, buckets] = await Promise.all([
    db
      .select({
        rows: sql<number>`count(*)::int`,
        usableRows: sql<number>`count(*) filter (where ${usablePredicate})::int`,
        markets: sql<number>`count(distinct ${polymarketStateSnapshots.conditionId})::int`,
        firstCapturedAt: sql<Date | null>`min(${polymarketStateSnapshots.capturedAt})`,
        lastCapturedAt: sql<Date | null>`max(${polymarketStateSnapshots.capturedAt})`,
      })
      .from(polymarketStateSnapshots)
      .where(registeredRows),
    db
      .select({
        pair: polymarketStateSnapshots.pair,
        horizonMin: polymarketStateSnapshots.horizonMin,
        rows: sql<number>`count(*)::int`,
        usableRows: sql<number>`count(*) filter (where ${usablePredicate})::int`,
        markets: sql<number>`count(distinct ${polymarketStateSnapshots.conditionId})::int`,
      })
      .from(polymarketStateSnapshots)
      .where(registeredRows)
      .groupBy(polymarketStateSnapshots.pair, polymarketStateSnapshots.horizonMin),
  ]);

  const aggregate = aggregateRows[0];
  const rows = Number(aggregate?.rows ?? 0);
  const usableRows = Number(aggregate?.usableRows ?? 0);
  const markets = Number(aggregate?.markets ?? 0);
  const firstMs = aggregate?.firstCapturedAt ? new Date(aggregate.firstCapturedAt).getTime() : null;
  const lastMs = aggregate?.lastCapturedAt ? new Date(aggregate.lastCapturedAt).getTime() : null;
  const spanDays = firstMs != null && lastMs != null ? (lastMs - firstMs) / 86_400_000 : 0;
  const coverage = rows > 0 ? usableRows / rows : 0;
  const bucketRows = buckets.map((bucket) => ({
    pair: bucket.pair,
    horizonMin: bucket.horizonMin,
    rows: Number(bucket.rows),
    usableRows: Number(bucket.usableRows),
    markets: Number(bucket.markets),
  }));
  const minBucketMarkets =
    bucketRows.length === 12 ? Math.min(...bucketRows.map((bucket) => bucket.markets)) : 0;

  return {
    version: POLYMARKET_MULTI_STAKE_CAPACITY.version,
    evalStartMs: POLYMARKET_MULTI_STAKE_CAPACITY.evalStartMs,
    modeledStakeUsd: [...POLYMARKET_MULTI_STAKE_CAPACITY.modeledStakeUsd],
    minMarkets: POLYMARKET_MULTI_STAKE_CAPACITY.minMarkets,
    minSpanDays: POLYMARKET_MULTI_STAKE_CAPACITY.minSpanDays,
    minMarketsPerAssetTimeframe: POLYMARKET_MULTI_STAKE_CAPACITY.minMarketsPerAssetTimeframe,
    minCoverage: POLYMARKET_MULTI_STAKE_CAPACITY.minCoverage,
    rows,
    usableRows,
    markets,
    spanDays,
    coverage,
    minBucketMarkets,
    firstCapturedAtMs: firstMs,
    lastCapturedAtMs: lastMs,
    buckets: bucketRows,
    readyForCapacityDistribution: multiStakeCapacityReady({
      markets,
      spanDays,
      coverage,
      minBucketMarkets,
    }),
    addsExternalRequests: false,
    strategyCoupling: false,
    verdictCoupling: false,
    executionCapability: false,
  };
}
