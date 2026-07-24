/**
 * Cross-strategy leaderboard (Roadmap Phase 2.2).
 *
 * One composite score per (strategy, pair, timeframe, param set), ranked across the whole warehouse
 * so "what's actually best" is one query instead of manual sorting. The score is deliberately
 * PF/risk/sample-centric (not raw return, which isn't comparable across window lengths): it rewards
 * a real edge (profit factor > 1), low drawdown, and a healthy win rate, then multiplies by a
 * sample-size shrinkage factor so a lucky 3-trade cell can't top the board — the exact failure the
 * API report flagged. Where a robustness verdict has been computed (Phase 2.1) it's overlaid and
 * caps the score, so a "fragile" cell can't rank highly no matter how good its headline metrics.
 *
 * Scoring is computed in JS over the deduped warehouse (a few thousand rows). If the warehouse grows
 * past that, this is the natural place to swap in a materialized view keyed on the same signature.
 */
import { and, desc, eq, gte, ilike, sql } from "drizzle-orm";
import { db, backtestRuns, strategies, robustnessResults } from "@framework/db";
import { getRiskPerTrade, expectancyR, totalR, accountReturnEstimate } from "./risk.ts";

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const num = (v: string | null) => (v == null ? null : parseFloat(v));

export type Verdict = "robust" | "mixed" | "fragile" | "insufficient-data";

export interface LeaderboardRow {
  strategyId: string;
  strategyName: string;
  tier: string | null;
  pair: string;
  timeframe: string;
  spanDays: number;
  daysRequested: number;
  totalReturn: number | null;
  profitFactor: number | null;
  totalTrades: number | null;
  winRate: number | null;
  maxDrawdown: number | null;
  paramHash: string;
  jesterParamCode: string | null;
  score: number;
  robustnessVerdict: Verdict | null;
  robustnessScore: number | null;
  trajectory: string | null; // improving | decaying | stable | insufficient
  outlook: string | null; // durable | fading | recovering | weak | unclear
  // Risk-of-account framing at `riskPct` per trade (assumes avg loss ≈ 1R).
  expectancyR: number | null; // per-trade expectancy in R
  totalR: number | null; // R accumulated over the window
  estAccountReturn: number | null; // % of account at riskPct/trade
}

export interface LeaderboardFilters {
  minTrades?: number;
  timeframe?: string;
  pair?: string;
  q?: string; // strategy id/name search
  onlyValidated?: boolean; // only cells with a robustness verdict
  riskPct?: number; // risk per trade (% of account); defaults to the global setting
  limit?: number;
}

/** Base composite from warehouse metrics (0–100 before the robustness overlay). */
function baseScore(m: {
  profitFactor: number | null;
  maxDrawdown: number | null;
  winRate: number | null;
  totalTrades: number | null;
}): number {
  const pf = m.profitFactor;
  const pfScore = pf == null ? 0 : clamp01((pf - 1.0) / 1.0); // PF 1.0→2.0 ⇒ 0→1
  const dd = m.maxDrawdown == null ? null : Math.abs(m.maxDrawdown);
  const ddScore = dd == null ? 0.5 : clamp01(1 - dd / 30); // 0%⇒1, 30%+⇒0; unknown⇒neutral
  const win = m.winRate;
  const winScore = win == null ? 0.5 : clamp01((win - 40) / 20); // 40%→60% ⇒ 0→1
  const tr = m.totalTrades ?? 0;
  const shrinkage = tr / (tr + 20); // lucky small samples can't score high
  const base = 0.5 * pfScore + 0.3 * ddScore + 0.2 * winScore;
  return 100 * base * shrinkage;
}

/** Robustness overlay: a known verdict caps (or gently lifts) the base score. */
function applyVerdict(base: number, verdict: Verdict | null): number {
  switch (verdict) {
    case "fragile":
      return Math.min(base, 35);
    case "insufficient-data":
      return Math.min(base, 50);
    case "mixed":
      return Math.min(base, 65);
    case "robust":
      return Math.min(100, base * 1.1);
    default:
      return base; // not yet validated — no adjustment
  }
}

export async function leaderboard(filters: LeaderboardFilters = {}): Promise<LeaderboardRow[]> {
  const minTrades = filters.minTrades ?? 20;
  const limit = filters.limit ?? 100;
  const riskPct = filters.riskPct ?? (await getRiskPerTrade());

  const conds = [gte(backtestRuns.totalTrades, minTrades)];
  if (filters.timeframe) conds.push(eq(backtestRuns.timeframe, filters.timeframe));
  if (filters.pair) conds.push(ilike(backtestRuns.pair, `%${filters.pair}%`));

  // Fetch every matching run, then collapse in JS to ONE row per (strategy, pair, timeframe): the
  // best-scoring config for that cell. This dissolves two kinds of duplicate at once — grid runs
  // against a param-ignoring strategy (identical metrics, different hashes) and multiple spans/param
  // sets of the same cell — so a single result can't occupy several leaderboard slots.
  const runs = await db
    .select({
      strategyId: backtestRuns.strategyId,
      pair: backtestRuns.pair,
      timeframe: backtestRuns.timeframe,
      spanDays: backtestRuns.spanDays,
      daysRequested: backtestRuns.daysRequested,
      totalReturn: backtestRuns.totalReturn,
      profitFactor: backtestRuns.profitFactor,
      totalTrades: backtestRuns.totalTrades,
      winRate: backtestRuns.winRate,
      maxDrawdown: backtestRuns.maxDrawdown,
      paramHash: backtestRuns.paramHash,
      jesterParamCode: backtestRuns.jesterParamCode,
    })
    .from(backtestRuns)
    .where(and(...conds))
    .orderBy(desc(backtestRuns.ranAt))
    .limit(20000);

  const [strats, verdicts] = await Promise.all([
    db.select({ id: strategies.id, name: strategies.name, tier: strategies.tier }).from(strategies),
    db.select().from(robustnessResults),
  ]);
  const nameById = new Map(strats.map((s) => [s.id, s]));
  const verdictByCell = new Map(
    verdicts.map((v) => [`${v.strategyId}|${v.pair}|${v.timeframe}|${v.paramHash}`, v]),
  );

  const bestByCell = new Map<string, LeaderboardRow>();
  for (const r of runs) {
    const metrics = {
      profitFactor: num(r.profitFactor),
      maxDrawdown: num(r.maxDrawdown),
      winRate: num(r.winRate),
      totalTrades: r.totalTrades,
    };
    const v = verdictByCell.get(`${r.strategyId}|${r.pair}|${r.timeframe}|${r.paramHash}`) ?? null;
    const verdict = (v?.verdict as Verdict | undefined) ?? null;
    const score = Math.round(applyVerdict(baseScore(metrics), verdict));
    const strat = nameById.get(r.strategyId);
    const row: LeaderboardRow = {
      strategyId: r.strategyId,
      strategyName: strat?.name ?? r.strategyId,
      tier: strat?.tier ?? null,
      pair: r.pair,
      timeframe: r.timeframe,
      spanDays: r.spanDays,
      daysRequested: r.daysRequested,
      totalReturn: num(r.totalReturn),
      profitFactor: metrics.profitFactor,
      totalTrades: r.totalTrades,
      winRate: metrics.winRate,
      maxDrawdown: metrics.maxDrawdown,
      paramHash: r.paramHash,
      jesterParamCode: r.jesterParamCode,
      score,
      robustnessVerdict: verdict,
      robustnessScore: v?.score ?? null,
      trajectory: v?.trajectory ?? null,
      outlook: v?.outlook ?? null,
      expectancyR: expectancyR(metrics.winRate, metrics.profitFactor),
      totalR: totalR(metrics.winRate, metrics.profitFactor, r.totalTrades),
      estAccountReturn: accountReturnEstimate(metrics.winRate, metrics.profitFactor, r.totalTrades, riskPct),
    };
    const cellK = `${r.strategyId}|${r.pair}|${r.timeframe}`;
    const cur = bestByCell.get(cellK);
    if (!cur || row.score > cur.score) bestByCell.set(cellK, row);
  }

  let out: LeaderboardRow[] = [...bestByCell.values()];

  if (filters.q) {
    const term = filters.q.toLowerCase();
    out = out.filter((r) => r.strategyId.toLowerCase().includes(term) || r.strategyName.toLowerCase().includes(term));
  }
  if (filters.onlyValidated) out = out.filter((r) => r.robustnessVerdict != null);

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

/** Coverage of robustness validation across the leaderboard universe — how much is actually vetted. */
export async function leaderboardStats(): Promise<{ validated: number }> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(robustnessResults);
  return { validated: row?.n ?? 0 };
}
