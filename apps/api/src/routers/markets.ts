import { z } from "zod";
import { t } from "../trpc/context.ts";
import { protectedProcedure } from "../trpc/middleware.ts";
import { jesterCall } from "../services/jester.ts";
import { getPerpUniverse } from "../services/hyperliquid.ts";

/**
 * Market reference data from Jester (read-only): the tradable-pair universe and per-pair market
 * snapshots (price, funding, open interest, volume). Feeds the By-Asset view so assets carry live
 * context, not just backtest history.
 */
export const marketsRouter = t.router({
  /**
   * The FULL tradable universe, returned in one call for client-side search/filter. Crypto comes
   * from Hyperliquid's perp meta (~230 coins — Jester's own tradable-pairs tool only surfaces ~5),
   * merged with Jester's equities/commodities. Deduped; crypto first. No server-side pagination.
   */
  pairs: protectedProcedure
    .input(z.object({ query: z.string().optional() }).optional())
    .query(async ({ ctx }) => {
      const [jester, coins] = await Promise.all([
        jesterCall(ctx.user.id, "POST", "/api/delegated/mcp/tool", {
          name: "jester_tradable_pairs",
          args: { limit: 80 },
        }).catch(() => null),
        getPerpUniverse().catch(() => [] as string[]),
      ]);
      const jPairs = (jester?.result?.pairs ?? []) as { pair: string; symbol: string; displayName: string }[];

      const seen = new Set<string>();
      const out: { pair: string; symbol: string; displayName: string }[] = [];
      // Hyperliquid crypto perps first — the full crypto set (COIN → COIN-USD).
      for (const name of coins) {
        const pair = `${name}-USD`;
        if (seen.has(pair)) continue;
        seen.add(pair);
        out.push({ pair, symbol: name, displayName: `${name}/USD` });
      }
      // Jester's list adds equities/commodities (and any crypto HL didn't list).
      for (const p of jPairs) {
        if (seen.has(p.pair)) continue;
        seen.add(p.pair);
        out.push(p);
      }
      return { pairs: out, count: out.length };
    }),

  /** Market snapshot for one pair: mark price, funding, open interest, 24h volume. */
  snapshot: protectedProcedure
    .input(z.object({ pair: z.string() }))
    .query(async ({ input, ctx }) => {
      const res = await jesterCall(ctx.user.id, "POST", "/api/delegated/mcp/tool", {
        name: "jester_pair_snapshot",
        args: { pair: input.pair },
      }).catch(() => null);
      const r = res?.result;
      if (!r?.ok) return null;
      return {
        pair: r.pair as string,
        markPx: (r.markPx ?? null) as number | null,
        fundingRate: (r.fundingRate ?? null) as number | null,
        fundingPercentile: (r.fundingPercentile ?? null) as number | null,
        openInterestUsd: (r.openInterestUsd ?? null) as number | null,
        dayVolumeUsd: (r.dayVolumeUsd ?? null) as number | null,
        premium: (r.premium ?? null) as number | null,
      };
    }),
});
