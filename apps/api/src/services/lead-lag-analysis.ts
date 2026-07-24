/**
 * Prespecified descriptive analysis for the venue lead/lag tape (KB: LEAD-LAG-REPORT-V1).
 *
 * This module measures two directional cross-correlations on an exact one-second grid. It does not
 * map a result to a Polymarket side and is deliberately not imported by the paper engine.
 */
export interface LeadLagConfig {
  evalStartMs: number;
  lagsSec: readonly number[];
  blockMs: number;
  bootstrapIterations: number;
  minRows: number;
  minSpanDays: number;
  minBlocks: number;
}

export const LEAD_LAG_REPORT: LeadLagConfig = {
  evalStartMs: 1_784_773_289_910, // KB created 2026-07-23 02:21:29.910 UTC
  lagsSec: [1, 2, 5, 10, 30],
  blockMs: 5 * 60_000,
  bootstrapIterations: 1_000,
  minRows: 100_000,
  minSpanDays: 3,
  minBlocks: 500,
};

/** Readiness predicate shared by the report and its count-only monitoring surface. */
export function leadLagDiagnosticReady(
  rows: number,
  spanDays: number,
  blocks: number,
  config: LeadLagConfig = LEAD_LAG_REPORT,
): boolean {
  return rows >= config.minRows
    && spanDays >= config.minSpanDays
    && blocks >= config.minBlocks;
}

export interface VenuePoint {
  t: number;
  chainlink: number;
  hyperliquid: number;
}

interface SufficientStats {
  n: number;
  sx: number;
  sy: number;
  sxx: number;
  syy: number;
  sxy: number;
}

interface BlockStats {
  forward: SufficientStats;
  reverse: SufficientStats;
}

const emptyStats = (): SufficientStats => ({ n: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0 });

function add(stats: SufficientStats, x: number, y: number) {
  stats.n++;
  stats.sx += x;
  stats.sy += y;
  stats.sxx += x * x;
  stats.syy += y * y;
  stats.sxy += x * y;
}

function merge(into: SufficientStats, from: SufficientStats) {
  into.n += from.n;
  into.sx += from.sx;
  into.sy += from.sy;
  into.sxx += from.sxx;
  into.syy += from.syy;
  into.sxy += from.sxy;
}

function correlation(stats: SufficientStats): number | null {
  if (stats.n < 3) return null;
  const cov = stats.sxy - (stats.sx * stats.sy) / stats.n;
  const vx = stats.sxx - (stats.sx * stats.sx) / stats.n;
  const vy = stats.syy - (stats.sy * stats.sy) / stats.n;
  const denom = Math.sqrt(vx * vy);
  return denom > 0 ? Math.max(-1, Math.min(1, cov / denom)) : null;
}

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.floor(q * (sorted.length - 1))];
}

function summarizeBlocks(blocks: BlockStats[]) {
  const forward = emptyStats(), reverse = emptyStats();
  for (const block of blocks) {
    merge(forward, block.forward);
    merge(reverse, block.reverse);
  }
  const forwardCorrelation = correlation(forward), reverseCorrelation = correlation(reverse);
  return {
    n: Math.min(forward.n, reverse.n),
    forwardCorrelation,
    reverseCorrelation,
    difference: forwardCorrelation != null && reverseCorrelation != null ? forwardCorrelation - reverseCorrelation : null,
  };
}

/** Whole-five-minute-block bootstrap, jointly resampling forward and reverse directions. */
function bootstrap(blocks: BlockStats[], iterations: number, seedText: string) {
  if (blocks.length < 3 || iterations < 1) return { forward: [null, null], reverse: [null, null], difference: [null, null] } as const;
  const random = mulberry32(hashSeed(seedText));
  const forward: number[] = [], reverse: number[] = [], difference: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration++) {
    const picked: BlockStats[] = [];
    for (let i = 0; i < blocks.length; i++) picked.push(blocks[Math.floor(random() * blocks.length)]);
    const result = summarizeBlocks(picked);
    if (result.forwardCorrelation != null && result.reverseCorrelation != null && result.difference != null) {
      forward.push(result.forwardCorrelation);
      reverse.push(result.reverseCorrelation);
      difference.push(result.difference);
    }
  }
  forward.sort((a, b) => a - b);
  reverse.sort((a, b) => a - b);
  difference.sort((a, b) => a - b);
  return {
    forward: [quantile(forward, 0.025), quantile(forward, 0.975)] as const,
    reverse: [quantile(reverse, 0.025), quantile(reverse, 0.975)] as const,
    difference: [quantile(difference, 0.025), quantile(difference, 0.975)] as const,
  };
}

export interface LeadLagResult {
  pair: string;
  lagSec: number;
  rows: number;
  spanDays: number;
  observations: number;
  blocks: number;
  ready: boolean;
  forwardCorrelation: number | null;
  forwardCi: readonly [number | null, number | null];
  reverseCorrelation: number | null;
  reverseCi: readonly [number | null, number | null];
  difference: number | null;
  differenceCi: readonly [number | null, number | null];
}

/**
 * Compare corr(r_HL(t), r_CL(t+h)) to corr(r_CL(t), r_HL(t+h)) for every fixed lag.
 * Duplicate seconds collapse to the last supplied row; gaps are not interpolated.
 */
export function analyzeLeadLag(
  points: VenuePoint[],
  pair: string,
  config: LeadLagConfig = LEAD_LAG_REPORT,
): LeadLagResult[] {
  const valid = points.filter((point) => Number.isFinite(point.t) && point.chainlink > 0 && point.hyperliquid > 0);
  const bySecond = new Map(valid.map((point) => [Math.floor(point.t / 1000) * 1000, point]));
  const times = [...bySecond.keys()].sort((a, b) => a - b);
  const spanDays = times.length >= 2 ? (times[times.length - 1] - times[0]) / 86_400_000 : 0;

  return config.lagsSec.map((lagSec) => {
    const lagMs = lagSec * 1000;
    const blockMap = new Map<number, BlockStats>();
    for (const t of times) {
      const previous = bySecond.get(t - 1000);
      const current = bySecond.get(t);
      const futurePrevious = bySecond.get(t + lagMs - 1000);
      const future = bySecond.get(t + lagMs);
      if (!previous || !current || !futurePrevious || !future) continue;
      const hlNow = Math.log(current.hyperliquid / previous.hyperliquid);
      const clNow = Math.log(current.chainlink / previous.chainlink);
      const clFuture = Math.log(future.chainlink / futurePrevious.chainlink);
      const hlFuture = Math.log(future.hyperliquid / futurePrevious.hyperliquid);
      if (![hlNow, clNow, clFuture, hlFuture].every(Number.isFinite)) continue;
      const blockKey = Math.floor(t / config.blockMs);
      const block = blockMap.get(blockKey) ?? { forward: emptyStats(), reverse: emptyStats() };
      add(block.forward, hlNow, clFuture);
      add(block.reverse, clNow, hlFuture);
      blockMap.set(blockKey, block);
    }
    const blocks = [...blockMap.values()];
    const summary = summarizeBlocks(blocks);
    const ci = bootstrap(
      blocks,
      config.bootstrapIterations,
      `${pair}|${lagSec}|${times.length}|${blocks.length}|${config.evalStartMs}`,
    );
    return {
      pair,
      lagSec,
      rows: times.length,
      spanDays,
      observations: summary.n,
      blocks: blocks.length,
      ready: leadLagDiagnosticReady(times.length, spanDays, blocks.length, config),
      forwardCorrelation: summary.forwardCorrelation,
      forwardCi: ci.forward,
      reverseCorrelation: summary.reverseCorrelation,
      reverseCi: ci.reverse,
      difference: summary.difference,
      differenceCi: ci.difference,
    };
  });
}
