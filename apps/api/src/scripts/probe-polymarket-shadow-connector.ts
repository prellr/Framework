/**
 * Read-only live probe for the paper-safe connector.
 *
 * It fetches public Gamma/CLOB data, prepares shadow FOK BUY simulations for both outcome tokens,
 * and reports local CPU preparation time. It has no authentication, signer, wallet, or order call.
 */
import {
  downTokenId,
  fetchClobBooks,
  fetchClobMarketInfo,
  fetchCurrentCryptoUpDown,
  upTokenId,
} from "../services/polymarket.ts";
import { takerFeeDescriptor } from "../services/polymarket-fees.ts";
import {
  POLYMARKET_SHADOW_CONNECTOR,
  prepareShadowMarketBuy,
} from "../services/polymarket-shadow-connector.ts";

const percentile = (values: number[], quantile: number): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * quantile)] ?? null;
};

const markets = (await fetchCurrentCryptoUpDown()).slice(0, 12);
const rows: Array<{
  conditionId: string;
  tokenId: string;
  outcomeSide: "up" | "down";
  accepted: boolean;
  reason: string | null;
  marketDataAgeMs: number | null;
  preparationMicros: number;
  effectiveVwap: number | null;
  worstPrice: number | null;
}> = [];

for (const market of markets) {
  const up = upTokenId(market);
  const down = downTokenId(market);
  if (!up || !down || up === down) continue;
  const [info, books] = await Promise.all([
    fetchClobMarketInfo(market.conditionId).catch(() => null),
    fetchClobBooks([up, down]).catch(() => []),
  ]);
  const fee = takerFeeDescriptor(info);
  if (!info || !fee) continue;
  const tickSize = Number(info.mts);
  const minOrderShares = Number(info.mos);
  const receivedAtMs = Date.now();
  const byToken = new Map(books.map((book) => [String(book.asset_id), book]));
  for (const [outcomeSide, tokenId] of [["up", up], ["down", down]] as const) {
    const book = byToken.get(tokenId);
    if (!book) continue;
    const prepared = prepareShadowMarketBuy(
      {
        conditionId: market.conditionId,
        tokenId,
        totalBudgetUsd: 5,
        tickSize,
        minOrderShares,
      },
      {
        book,
        sourceAtMs: receivedAtMs,
        receivedAtMs,
        observedAtMs: Date.now(),
      },
      fee,
    );
    rows.push({
      conditionId: market.conditionId,
      tokenId,
      outcomeSide,
      accepted: prepared.accepted,
      reason: prepared.accepted ? null : prepared.reason,
      marketDataAgeMs: prepared.accepted
        ? prepared.plan.marketDataAgeMs
        : prepared.marketDataAgeMs,
      preparationMicros: prepared.accepted
        ? prepared.plan.preparationMicros
        : prepared.preparationMicros,
      effectiveVwap: prepared.accepted ? prepared.plan.quote.effectiveVwap : null,
      worstPrice: prepared.accepted ? prepared.plan.worstPrice : null,
    });
  }
}

const times = rows.map((row) => row.preparationMicros);
console.log(JSON.stringify({
  connector: POLYMARKET_SHADOW_CONNECTOR,
  publicMarketsInspected: markets.length,
  shadowPlans: rows.length,
  accepted: rows.filter((row) => row.accepted).length,
  rejected: rows.filter((row) => !row.accepted).length,
  preparationMicros: {
    p50: percentile(times, 0.5),
    p95: percentile(times, 0.95),
    max: times.length ? Math.max(...times) : null,
  },
  rows,
}, null, 2));
process.exit(0);
