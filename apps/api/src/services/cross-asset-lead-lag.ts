/**
 * Frozen BTC→alt diagnostic registered as updown-btc-alt-lead-lag-tape-v1.
 *
 * This module only gives research names to the generic two-direction lead/lag calculation. It does
 * not map a correlation to a Polymarket side and is not imported by the paper engine.
 */
import {
  analyzeLeadLag,
  leadLagDiagnosticReady,
  type LeadLagConfig,
  type LeadLagResult,
} from "./lead-lag-analysis.ts";

export const CROSS_ASSET_LEAD_LAG_REPORT: LeadLagConfig = {
  evalStartMs: Date.parse("2026-07-23T08:00:00.000Z"),
  lagsSec: [1, 2, 5, 10, 30],
  blockMs: 5 * 60_000,
  bootstrapIterations: 1_000,
  minRows: 100_000,
  minSpanDays: 3,
  minBlocks: 500,
};

export const CROSS_ASSET_ALT_PAIRS = [
  "ETH-USD",
  "SOL-USD",
  "XRP-USD",
  "DOGE-USD",
  "BNB-USD",
] as const;

export type CrossAssetAltPair = (typeof CROSS_ASSET_ALT_PAIRS)[number];

export interface CrossAssetPoint {
  t: number;
  btc: number;
  alt: number;
}

export interface CrossAssetLeadLagResult {
  altPair: string;
  lagSec: number;
  matchedRows: number;
  spanDays: number;
  observations: number;
  blocks: number;
  ready: boolean;
  btcLeadCorrelation: number | null;
  btcLeadCi: readonly [number | null, number | null];
  altLeadCorrelation: number | null;
  altLeadCi: readonly [number | null, number | null];
  difference: number | null;
  differenceCi: readonly [number | null, number | null];
}

export function crossAssetDiagnosticReady(rows: number, spanDays: number, blocks: number): boolean {
  return leadLagDiagnosticReady(rows, spanDays, blocks, CROSS_ASSET_LEAD_LAG_REPORT);
}

function renameResult(result: LeadLagResult, altPair: string): CrossAssetLeadLagResult {
  return {
    altPair,
    lagSec: result.lagSec,
    matchedRows: result.rows,
    spanDays: result.spanDays,
    observations: result.observations,
    blocks: result.blocks,
    ready: result.ready,
    btcLeadCorrelation: result.forwardCorrelation,
    btcLeadCi: result.forwardCi,
    altLeadCorrelation: result.reverseCorrelation,
    altLeadCi: result.reverseCi,
    difference: result.difference,
    differenceCi: result.differenceCi,
  };
}

/**
 * Compare corr(r_BTC(t), r_ALT(t+h)) with corr(r_ALT(t), r_BTC(t+h)) on the frozen exact-second grid.
 */
export function analyzeCrossAssetLeadLag(
  points: CrossAssetPoint[],
  altPair: string,
): CrossAssetLeadLagResult[] {
  return analyzeLeadLag(
    points.map((point) => ({
      t: point.t,
      hyperliquid: point.btc,
      chainlink: point.alt,
    })),
    `BTC-USD→${altPair}`,
    CROSS_ASSET_LEAD_LAG_REPORT,
  ).map((result) => renameResult(result, altPair));
}
