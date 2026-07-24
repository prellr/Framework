import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, jesterCredentials } from "@framework/db";
import { t } from "../trpc/context.ts";
import { protectedProcedure } from "../trpc/middleware.ts";
import { jesterCall } from "../services/jester.ts";
import { getPortfolioHistory, summarizeFills, dailyFromFills, periodsFromFills, closedTradesWithFees } from "../services/hyperliquid.ts";
import { getStoredFills } from "../services/fills-store.ts";
import { audit } from "../services/audit.ts";

/**
 * Read-only views of the user's Jester account (positions, PnL, trade history). Analysis tool —
 * these inform decisions but nothing here can place or close a position.
 */
export const accountRouter = t.router({
  /** Open positions + portfolio equity/PnL summary. */
  portfolio: protectedProcedure.query(async ({ ctx }) => {
    const [positions, pnl, cred] = await Promise.all([
      jesterCall(ctx.user.id, "GET", "/api/delegated/positions").catch(() => null),
      jesterCall(ctx.user.id, "GET", "/api/delegated/pnl/summary").catch(() => null),
      db
        .select({ hlWallet: jesterCredentials.hlWallet })
        .from(jesterCredentials)
        .where(eq(jesterCredentials.userId, ctx.user.id))
        .limit(1)
        .then((r) => r[0] ?? null),
    ]);

    // Jester's `pnl` block is always zeros (fields present, never populated), so period PnL is
    // computed from the Hyperliquid fill ledger instead — the same source the Positions page uses.
    const wallet = cred?.hlWallet ?? null;
    const fills = wallet ? await getStoredFills(wallet).catch(() => []) : [];
    const periodPnl = wallet ? periodsFromFills(fills) : null;

    return {
      periodPnl,
      positions: (positions?.positions ?? []) as any[],
      pnl: pnl
        ? {
            totalPortfolioValue: pnl.totalPortfolioValue ?? 0,
            totalUnrealizedPnL: pnl.totalUnrealizedPnL ?? 0,
            totalPositions: pnl.totalPositions ?? 0,
            byPeriod: pnl.pnl ?? null,
            exchangeBreakdown: (pnl.exchangeBreakdown ?? []) as any[],
          }
        : null,
    };
  }),

  /**
   * Recent closed trades. NOTE: the delegated jester_trade_history tool is a SUMMARY — it returns
   * a small `sample` (≈3 rows) plus the grand total, not the full history (there is no full-list
   * endpoint). So this is a recent-trades preview; `total` is the real count. Aggregate stats live
   * in `performance` below.
   */
  tradeHistory: protectedProcedure.query(async ({ ctx }) => {
    const res = await jesterCall(ctx.user.id, "POST", "/api/delegated/mcp/tool", {
      name: "jester_trade_history",
      args: { days: 90, pageSize: 25 },
    }).catch(() => null);
    const r = res?.result ?? {};
    const t = r.trades ?? r.history ?? r.rows ?? [];
    const trades = (Array.isArray(t) ? t : (t.sample ?? t.rows ?? [])) as any[];
    return { trades, total: (r.total ?? trades.length) as number, sampled: !Array.isArray(t) };
  }),

  /**
   * Aggregate trading performance over a window (default 30d): win rate, profit factor,
   * expectancy, fees, best/worst trade, long/short split (jester_pnl_analytics), plus the top
   * pairs by activity (jester_trading_stats). Read-only.
   */
  performance: protectedProcedure
    .input(z.object({ days: z.number().min(1).max(365).default(30) }).optional())
    .query(async ({ input, ctx }) => {
      const days = input?.days ?? 30;
      const [pnl, stats] = await Promise.all([
        jesterCall(ctx.user.id, "POST", "/api/delegated/mcp/tool", {
          name: "jester_pnl_analytics",
          args: { days },
        }).catch(() => null),
        jesterCall(ctx.user.id, "POST", "/api/delegated/mcp/tool", {
          name: "jester_trading_stats",
          args: { days },
        }).catch(() => null),
      ]);
      return {
        days,
        summary: (pnl?.result?.summary ?? null) as any,
        topPairs: (stats?.result?.topPairs ?? []) as any[],
      };
    }),

  /** Per-strategy live performance for the user's subscribed strategies (jester_my_live_performance). */
  livePerformance: protectedProcedure.query(async ({ ctx }) => {
    const res = await jesterCall(ctx.user.id, "POST", "/api/delegated/mcp/tool", {
      name: "jester_my_live_performance",
      args: {},
    }).catch(() => null);
    return {
      summary: (res?.result?.summary ?? null) as any,
      rows: (res?.result?.rows ?? []) as any[],
    };
  }),

  /**
   * Portfolio equity + PnL history from Hyperliquid's public info API (day/week/month/allTime).
   * Jester doesn't expose a time series, so we read it directly from Hyperliquid using the wallet
   * address stored on the credential. Returns { wallet, series } — wallet null if not set yet.
   */
  portfolioHistory: protectedProcedure.query(async ({ ctx }) => {
    const [cred] = await db
      .select({ hlWallet: jesterCredentials.hlWallet })
      .from(jesterCredentials)
      .where(eq(jesterCredentials.userId, ctx.user.id))
      .limit(1);
    const wallet = cred?.hlWallet ?? null;
    if (!wallet) return { wallet: null, series: [] };
    const series = await getPortfolioHistory(wallet).catch(() => []);
    return { wallet, series };
  }),

  /**
   * Realized-PnL-over-time from Hyperliquid closed-trade fills, scoped to a window (days). Returns a
   * cumulative realized-PnL curve (one point per closing fill) plus the window's realized total and
   * trade count — so performance can be seen as a trend, not just one aggregate number.
   */
  performanceHistory: protectedProcedure
    .input(z.object({ days: z.number().min(1).max(1000).default(30) }).optional())
    .query(async ({ input, ctx }) => {
      const days = input?.days ?? 30;
      const [cred] = await db
        .select({ hlWallet: jesterCredentials.hlWallet })
        .from(jesterCredentials)
        .where(eq(jesterCredentials.userId, ctx.user.id))
        .limit(1);
      const wallet = cred?.hlWallet ?? null;
      if (!wallet) return { wallet: null, points: [] as { t: number; v: number }[], totalRealized: 0, trades: 0 };

      const startTime = Date.now() - days * 86_400_000;
      const fills = await getStoredFills(wallet, startTime).catch(() => []);
      const closing = fills.filter((f) => f.closedPnl !== 0).sort((a, b) => a.time - b.time);
      let cum = 0;
      const points = closing.map((f) => {
        cum += f.closedPnl;
        return { t: f.time, v: cum };
      });
      return { wallet, points, totalRealized: cum, trades: closing.length };
    }),

  /**
   * Full individual trade history + comprehensive stats, computed from the raw Hyperliquid fill
   * ledger (the authoritative source — Jester's trade_history is only a small sample). Returns the
   * closing fills (realized-PnL trades, newest first, capped to `limit`) plus aggregate stats over
   * the window. `wallet` is null if the user hasn't linked their Hyperliquid address yet.
   */
  fills: protectedProcedure
    .input(z.object({ days: z.number().min(1).max(1000).default(90), limit: z.number().min(1).max(2000).default(500), tz: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const days = input?.days ?? 90;
      const limit = input?.limit ?? 500;
      const [cred] = await db
        .select({ hlWallet: jesterCredentials.hlWallet })
        .from(jesterCredentials)
        .where(eq(jesterCredentials.userId, ctx.user.id))
        .limit(1);
      const wallet = cred?.hlWallet ?? null;
      if (!wallet) return { wallet: null, trades: [] as any[], total: 0, stats: null, daily: [] as any[] };

      const startTime = Date.now() - days * 86_400_000;
      const all = await getStoredFills(wallet, startTime).catch(() => []);
      const stats = summarizeFills(all);
      // Per-trade rows carry ROUND-TRIP fees and a net figure — a closing fill's own fee is only the
      // exit side, so showing it alone understates cost and overstates profit.
      const closing = closedTradesWithFees(all).slice(0, limit);
      return { wallet, trades: closing, total: stats.trades, stats, daily: dailyFromFills(all, input?.tz) };
    }),

  /** Store the user's Hyperliquid wallet address (public, not a secret) to enable portfolio history. */
  setWallet: protectedProcedure
    .input(z.object({ wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Must be a 0x… address") }))
    .mutation(async ({ input, ctx }) => {
      const wallet = input.wallet.toLowerCase();
      await db
        .update(jesterCredentials)
        .set({ hlWallet: wallet })
        .where(eq(jesterCredentials.userId, ctx.user.id));
      await audit(ctx, "account.setWallet", { resourceType: "jester_credential", newValue: { wallet } });
      return { wallet };
    }),
});
