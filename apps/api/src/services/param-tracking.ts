import { and, desc, eq, isNull } from "drizzle-orm";
import { db, strategyParamPeriods, jesterCredentials } from "@framework/db";
import { liveStrategies } from "./trading.ts";
import { jesterCall } from "./jester.ts";
import { type Fill } from "./hyperliquid.ts";
import { getStoredFills } from "./fills-store.ts";
import { getRiskPerTrade } from "./risk.ts";

/** "SOL-USD" -> "SOL" (Hyperliquid fills use bare coin symbols). */
export const coinOf = (pair: string) => pair.split(/[-/]/)[0].toUpperCase();

interface LiveConfig {
  strategyId: string;
  pair: string;
  timeframe: string;
  paramHash8: string | null;
}

const keyOf = (c: LiveConfig) => `${c.strategyId}|${c.pair}|${c.timeframe}|${c.paramHash8 ?? ""}`;

/**
 * Snapshot the current live config and reconcile it with the open periods:
 *  - configs that disappeared or changed  -> close the period (endedAt = now)
 *  - configs that are new                 -> open a period (startedAt = now)
 *  - configs unchanged                    -> bump lastSeenAt
 *
 * Run on a schedule; each call is cheap (one Jester read + a few upserts).
 */
export async function trackParamPeriods(userId: string): Promise<{ opened: number; closed: number }> {
  const live = await liveStrategies(userId);
  const current: LiveConfig[] = [];
  for (const s of (live?.strategies ?? []) as any[]) {
    for (const p of s.pairs ?? []) {
      if (!s.id || !p?.pair || !p?.timeframe) continue;
      current.push({
        strategyId: s.id,
        pair: p.pair,
        timeframe: p.timeframe,
        paramHash8: p.paramHash8 ?? null,
      });
    }
  }
  // A Jester read failure shouldn't be treated as "everything stopped" — bail without closing.
  if (current.length === 0 && !live) return { opened: 0, closed: 0 };

  const open = await db.select().from(strategyParamPeriods).where(isNull(strategyParamPeriods.endedAt));
  const currentKeys = new Set(current.map(keyOf));
  const openByKey = new Map(
    open.map((r) => [
      keyOf({ strategyId: r.strategyId, pair: r.pair, timeframe: r.timeframe, paramHash8: r.paramHash8 }),
      r,
    ]),
  );

  const now = new Date();
  let closed = 0;
  for (const [k, row] of openByKey) {
    if (!currentKeys.has(k)) {
      await db.update(strategyParamPeriods).set({ endedAt: now }).where(eq(strategyParamPeriods.id, row.id));
      closed++;
    }
  }
  let opened = 0;
  for (const c of current) {
    const existing = openByKey.get(keyOf(c));
    if (existing) {
      await db.update(strategyParamPeriods).set({ lastSeenAt: now }).where(eq(strategyParamPeriods.id, existing.id));
    } else {
      await db.insert(strategyParamPeriods).values({
        strategyId: c.strategyId,
        pair: c.pair,
        timeframe: c.timeframe,
        paramHash8: c.paramHash8,
        startedAt: now,
        lastSeenAt: now,
      });
      opened++;
    }
  }
  return { opened, closed };
}

export interface AttributedTrade {
  time: number;
  coin: string;
  dir: string;
  side: "long" | "short" | null;
  px: number;
  sz: number;
  closedPnl: number;
  fee: number;
  hash: string;
  /** Another strategy was also live on this coin at this instant — the ledger can't say which traded. */
  contested: boolean;
  candidates: string[];
}

/**
 * The individual live trades attributed to ONE parameter period. A fill belongs to a period when it
 * is on that period's coin inside its live window. Where another strategy was live on the same coin
 * at that moment the trade is flagged `contested` (with the rival strategy ids) rather than silently
 * credited — the fill ledger carries no strategy tag, so guessing would fabricate attribution.
 */
export async function paramPeriodTrades(
  userId: string,
  periodId: number,
): Promise<{ period: any | null; trades: AttributedTrade[] }> {
  const [p] = await db.select().from(strategyParamPeriods).where(eq(strategyParamPeriods.id, periodId)).limit(1);
  if (!p) return { period: null, trades: [] };

  const [cred] = await db
    .select({ hlWallet: jesterCredentials.hlWallet })
    .from(jesterCredentials)
    .where(eq(jesterCredentials.userId, userId))
    .limit(1);
  const wallet = cred?.hlWallet ?? null;
  if (!wallet) return { period: p, trades: [] };

  const coin = coinOf(p.pair);
  const from = p.startedAt.getTime();
  const to = (p.endedAt ?? new Date()).getTime();
  const fills = await getStoredFills(wallet, from).catch(() => [] as Fill[]);
  const all = await db.select().from(strategyParamPeriods);

  const trades = fills
    .filter((f) => f.coin.toUpperCase() === coin && f.time >= from && f.time <= to && f.closedPnl !== 0)
    .sort((a, b) => b.time - a.time)
    .map((f) => {
      const rivals = [
        ...new Set(
          all
            .filter(
              (o) =>
                coinOf(o.pair) === coin &&
                o.strategyId !== p.strategyId &&
                o.startedAt.getTime() <= f.time &&
                (o.endedAt?.getTime() ?? Date.now()) >= f.time,
            )
            .map((o) => o.strategyId),
        ),
      ];
      return {
        time: f.time,
        coin: f.coin,
        dir: f.dir,
        side: /long/i.test(f.dir) ? ("long" as const) : /short/i.test(f.dir) ? ("short" as const) : null,
        px: f.px,
        sz: f.sz,
        closedPnl: f.closedPnl,
        fee: f.fee,
        hash: f.hash,
        contested: rivals.length > 0,
        candidates: rivals,
      };
    });

  return { period: p, trades };
}

/**
 * How much of the live trade ledger we can actually attribute to a parameter set. Every realized
 * fill since tracking began falls into exactly one bucket: uniquely attributed, contested (two+
 * strategies live on that coin), or untracked (no period covers it — e.g. traded before tracking
 * started, or a coin no tracked strategy runs).
 */
export async function attributionCoverage(userId: string): Promise<{
  attributed: number;
  contested: number;
  untracked: number;
  total: number;
  since: Date | null;
}> {
  const [cred] = await db
    .select({ hlWallet: jesterCredentials.hlWallet })
    .from(jesterCredentials)
    .where(eq(jesterCredentials.userId, userId))
    .limit(1);
  const wallet = cred?.hlWallet ?? null;
  const all = await db.select().from(strategyParamPeriods);
  if (!wallet || all.length === 0) {
    return { attributed: 0, contested: 0, untracked: 0, total: 0, since: null };
  }

  const since = new Date(Math.min(...all.map((r) => r.startedAt.getTime())));
  const fills = await getStoredFills(wallet, since.getTime()).catch(() => [] as Fill[]);
  const closing = fills.filter((f) => f.closedPnl !== 0);

  let attributed = 0;
  let contested = 0;
  let untracked = 0;
  for (const f of closing) {
    const coin = f.coin.toUpperCase();
    const owners = [
      ...new Set(
        all
          .filter(
            (o) =>
              coinOf(o.pair) === coin &&
              o.startedAt.getTime() <= f.time &&
              (o.endedAt?.getTime() ?? Date.now()) >= f.time,
          )
          .map((o) => o.strategyId),
      ),
    ];
    if (owners.length === 1) attributed++;
    else if (owners.length > 1) contested++;
    else untracked++;
  }
  return { attributed, contested, untracked, total: closing.length, since };
}

export interface ParamPeriodPerf {
  id: number;
  strategyId: string;
  pair: string;
  timeframe: string;
  paramHash8: string | null;
  startedAt: Date;
  endedAt: Date | null;
  active: boolean;
  trades: number;
  realized: number;
  fees: number;
  net: number; // realized − fees — the number that hits the account
  wins: number;
  winRate: number;
  /** Risk-of-account framing — DIRECTLY MEASURED from the ledger (no 1R assumption, unlike backtest). */
  accountPct: number | null; // net as % of current portfolio value
  rMultiple: number | null; // net in R units (net / (riskPct% × portfolio))
  liveExpectancyR: number | null; // rMultiple / trades — comparable to backtest E[R]
  /** Last-24h slice of the same window — "is it working right now?" vs lifetime. */
  trades24: number;
  realized24: number;
  winRate24: number;
  /** Another strategy traded the same coin during this window — fills can't be uniquely attributed. */
  ambiguous: boolean;
  ambiguousWith: string[];
}

/**
 * Per-parameter-set live performance: attribute Hyperliquid fills to the param period that was
 * active on that coin at that moment. `ambiguous` marks periods that overlap another strategy on the
 * same coin, where attribution is genuinely undecidable from the ledger.
 */
export async function paramPeriodPerformance(
  userId: string,
  strategyId?: string,
): Promise<{ wallet: string | null; periods: ParamPeriodPerf[] }> {
  const [cred] = await db
    .select({ hlWallet: jesterCredentials.hlWallet })
    .from(jesterCredentials)
    .where(eq(jesterCredentials.userId, userId))
    .limit(1);
  const wallet = cred?.hlWallet ?? null;

  const rows = await db
    .select()
    .from(strategyParamPeriods)
    .where(strategyId ? eq(strategyParamPeriods.strategyId, strategyId) : undefined)
    .orderBy(desc(strategyParamPeriods.startedAt));
  if (rows.length === 0) return { wallet, periods: [] };
  if (!wallet) {
    return {
      wallet: null,
      periods: rows.map((r) => ({
        id: r.id, strategyId: r.strategyId, pair: r.pair, timeframe: r.timeframe, paramHash8: r.paramHash8,
        startedAt: r.startedAt, endedAt: r.endedAt, active: r.endedAt == null,
        trades: 0, realized: 0, fees: 0, net: 0, wins: 0, winRate: 0,
        accountPct: null, rMultiple: null, liveExpectancyR: null,
        trades24: 0, realized24: 0, winRate24: 0, ambiguous: false, ambiguousWith: [],
      })),
    };
  }

  // Portfolio value + risk-per-trade to express live results on a risk-of-account basis. Uses the
  // CURRENT portfolio value as the base (an approximation — the account grew/shrank over the period),
  // but this is directly measured PnL, so no 1R assumption is needed the way the backtest estimate is.
  const [pnl, riskPct] = await Promise.all([
    jesterCall(userId, "GET", "/api/delegated/pnl/summary").catch(() => null),
    getRiskPerTrade(),
  ]);
  const pv: number | null = pnl?.totalPortfolioValue != null ? Number(pnl.totalPortfolioValue) : null;
  const riskUnit = pv != null && pv > 0 && riskPct > 0 ? pv * (riskPct / 100) : null; // $ risked per trade

  // Pull fills once from the earliest tracked period onward.
  const earliest = Math.min(...rows.map((r) => r.startedAt.getTime()));
  const fills: Fill[] = await getStoredFills(wallet, earliest).catch(() => []);

  // All periods (not just this strategy's) are needed to detect same-coin overlap.
  const allPeriods = await db.select().from(strategyParamPeriods);

  const periods = rows.map((r) => {
    const coin = coinOf(r.pair);
    const from = r.startedAt.getTime();
    const to = (r.endedAt ?? new Date()).getTime();
    const inWindow = fills.filter((f) => f.coin.toUpperCase() === coin && f.time >= from && f.time <= to);
    const closing = inWindow.filter((f) => f.closedPnl !== 0);
    const wins = closing.filter((f) => f.closedPnl > 0).length;
    const dayAgo = Date.now() - 86_400_000;
    const closing24 = closing.filter((f) => f.time >= dayAgo);
    const wins24 = closing24.filter((f) => f.closedPnl > 0).length;
    const overlapping = allPeriods.filter(
      (o) =>
        o.id !== r.id &&
        coinOf(o.pair) === coin &&
        o.strategyId !== r.strategyId &&
        o.startedAt.getTime() <= to &&
        (o.endedAt?.getTime() ?? Date.now()) >= from,
    );
    const realized = closing.reduce((a, f) => a + f.closedPnl, 0);
    const fees = inWindow.reduce((a, f) => a + f.fee, 0);
    const net = realized - fees;
    const accountPct = pv != null && pv > 0 ? (net / pv) * 100 : null;
    const rMultiple = riskUnit != null ? net / riskUnit : null;
    const liveExpectancyR = rMultiple != null && closing.length > 0 ? rMultiple / closing.length : null;
    return {
      id: r.id,
      strategyId: r.strategyId,
      pair: r.pair,
      timeframe: r.timeframe,
      paramHash8: r.paramHash8,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      active: r.endedAt == null,
      trades: closing.length,
      realized,
      fees,
      net,
      wins,
      winRate: closing.length ? (wins / closing.length) * 100 : 0,
      accountPct,
      rMultiple,
      liveExpectancyR,
      trades24: closing24.length,
      realized24: closing24.reduce((a, f) => a + f.closedPnl, 0),
      winRate24: closing24.length ? (wins24 / closing24.length) * 100 : 0,
      ambiguous: overlapping.length > 0,
      ambiguousWith: [...new Set(overlapping.map((o) => o.strategyId))],
    };
  });

  return { wallet, periods };
}
