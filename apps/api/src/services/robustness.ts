/**
 * Robustness validation (Roadmap Phase 2.1) — the honest version of walk-forward.
 *
 * True walk-forward needs arbitrary historical train/test windows. Jester's backtest API only runs
 * "last N days ending now" — endDate/endTime are verified-ignored (they return the same rolling
 * window). So instead of splitting time, we run the SAME parameter set at several HORIZONS
 * (30/60/90/180d) and ask whether the edge HOLDS as the window widens, or exists only in the recent
 * slice. That directly attacks the trap the API report flagged (finding #6): a param set that looks
 * great on a handful of recent trades but is really just the luckiest small sample.
 *
 * Signals, all API-supported:
 *  - sign consistency  — is the return positive at every horizon, or only the shortest?
 *  - PF floor          — the worst profit factor across horizons (does it ever lose money?)
 *  - sample size       — trades at the widest horizon, with shrinkage so small samples can't win
 *  - stability         — how much the return swings across horizons (fragile = big swings)
 *  - OOS proxy         — the older slice's return, derived from nested windows (informational)
 *
 * Backtests are dedup-cached in the warehouse, so re-validating is cheap and a validated cell that
 * coverage already ran at 30d only pays for the wider horizons.
 */
import { db, robustnessResults } from "@framework/db";
import { runCell, paramHashOf } from "./backtest.ts";
import { getRiskPerTrade, expectancyR as expR, accountReturnEstimate } from "./risk.ts";

const HORIZONS = [30, 60, 90, 180]; // days; Jester clamps to available history and we dedupe by span
const SHRINKAGE_K = 20; // trades needed for the sample to earn ~half its "size credit"
const MIN_TRADES = 15; // below this at the widest horizon, we won't pass judgement

const num = (v: string | null | undefined) => (v == null ? null : parseFloat(v));

export interface HorizonResult {
  requestedDays: number;
  spanDays: number;
  totalReturn: number | null;
  totalTrades: number | null;
  profitFactor: number | null;
  winRate: number | null;
  maxDrawdown: number | null;
  expectancyR: number | null; // per-trade expectancy in R at this horizon
  estAccountReturn: number | null; // est. % of account over this horizon at the risk-per-trade
  source: "cache" | "fresh";
}

export type RobustnessVerdict = "robust" | "mixed" | "fragile" | "insufficient-data";

/** Direction of travel — is the recent slice pacing better or worse than the older baseline? */
export type Trajectory = "improving" | "decaying" | "stable" | "insufficient";

/**
 * The two-axis read that pairs LONG-term durability with SHORT-term trajectory:
 *  - durable    long-term edge holds and it isn't decaying
 *  - fading     long-term edge exists but the recent slice is weakening (an EXIT signal)
 *  - recovering long-term edge unproven, but the recent slice turned positive and is improving
 *  - weak       long-term negative and not improving
 */
export type Outlook = "durable" | "fading" | "recovering" | "weak" | "unclear";

export interface ReturnSlice {
  fromDays: number; // days-ago the slice starts (0 = now)
  toDays: number; // days-ago it ends
  days: number;
  ret: number | null; // return over just this slice, %
  perDay: number | null; // ret / days, %/day — comparable across uneven slices
}

export interface RobustnessReport {
  strategyId: string;
  pair: string;
  timeframe: string;
  horizons: HorizonResult[];
  score: number; // 0–100, shrinkage-adjusted
  verdict: RobustnessVerdict;
  positiveHorizons: number;
  totalHorizons: number;
  minProfitFactor: number | null;
  widestTrades: number | null;
  widestReturn: number | null;
  /** Return over the OLDER slice, derived from nested windows: (1+r_wide)/(1+r_narrow)−1. Approximate. */
  oosProxyReturn: number | null;
  // Trajectory axis — independent of the durability verdict.
  slices: ReturnSlice[]; // chronological (oldest → most recent), so it reads as a trend
  recentReturn: number | null; // narrowest (most recent) window return, %
  recentPerDay: number | null; // %/day over the recent slice
  priorPerDay: number | null; // %/day over everything older than the recent slice
  trajectory: Trajectory;
  shortTermPositive: boolean | null; // recent window in the black?
  longTermPositive: boolean | null; // widest window in the black?
  outlook: Outlook;
  riskPct: number; // risk-per-trade used for the account-return estimates
  reasons: string[];
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Cache the verdict so the leaderboard can overlay it without recomputing (one row per cell+params). */
async function persist(report: RobustnessReport, paramHash: string): Promise<void> {
  await db
    .insert(robustnessResults)
    .values({
      strategyId: report.strategyId,
      pair: report.pair,
      timeframe: report.timeframe,
      paramHash,
      verdict: report.verdict,
      score: report.score,
      widestTrades: report.widestTrades,
      minProfitFactor: report.minProfitFactor,
      widestReturn: report.widestReturn,
      positiveHorizons: report.positiveHorizons,
      totalHorizons: report.totalHorizons,
      oosProxyReturn: report.oosProxyReturn,
      trajectory: report.trajectory,
      outlook: report.outlook,
      recentReturn: report.recentReturn,
      evaluatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [robustnessResults.strategyId, robustnessResults.pair, robustnessResults.timeframe, robustnessResults.paramHash],
      set: {
        verdict: report.verdict,
        score: report.score,
        widestTrades: report.widestTrades,
        minProfitFactor: report.minProfitFactor,
        widestReturn: report.widestReturn,
        positiveHorizons: report.positiveHorizons,
        totalHorizons: report.totalHorizons,
        oosProxyReturn: report.oosProxyReturn,
        trajectory: report.trajectory,
        outlook: report.outlook,
        recentReturn: report.recentReturn,
        evaluatedAt: new Date(),
      },
    });
}

export async function evaluateRobustness(
  spec: { strategyId: string; pair: string; timeframe: string; parameters?: Record<string, unknown> },
  userId: string,
): Promise<RobustnessReport> {
  const riskPct = await getRiskPerTrade();

  // Run each horizon (warehouse-dedup makes repeats cheap), then collapse by actual span so two
  // requested horizons that both clamp to the same available history don't get counted twice.
  const bySpan = new Map<number, HorizonResult>();
  for (const days of HORIZONS) {
    try {
      const { source, run } = await runCell({ ...spec, days }, { userId, mode: "fast" });
      const hWin = num(run.winRate);
      const hPf = num(run.profitFactor);
      const r: HorizonResult = {
        requestedDays: days,
        spanDays: run.spanDays,
        totalReturn: num(run.totalReturn),
        totalTrades: run.totalTrades,
        profitFactor: hPf,
        winRate: hWin,
        maxDrawdown: num(run.maxDrawdown),
        expectancyR: expR(hWin, hPf),
        estAccountReturn: accountReturnEstimate(hWin, hPf, run.totalTrades, riskPct),
        source,
      };
      const existing = bySpan.get(run.spanDays);
      // Keep the smaller requested-days label for a given span (it's the tighter description).
      if (!existing || days < existing.requestedDays) bySpan.set(run.spanDays, r);
    } catch (err) {
      // A horizon that won't backtest (transient candle gap, etc.) is simply omitted; the score is
      // computed over the horizons we did get, and reasons note the thinner evidence.
      void err;
    }
  }

  const horizons = [...bySpan.values()].sort((a, b) => a.spanDays - b.spanDays);
  const reasons: string[] = [];

  if (horizons.length === 0) {
    const report: RobustnessReport = {
      strategyId: spec.strategyId,
      pair: spec.pair,
      timeframe: spec.timeframe,
      horizons: [],
      score: 0,
      verdict: "insufficient-data",
      positiveHorizons: 0,
      totalHorizons: 0,
      minProfitFactor: null,
      widestTrades: null,
      widestReturn: null,
      oosProxyReturn: null,
      slices: [],
      recentReturn: null,
      recentPerDay: null,
      priorPerDay: null,
      trajectory: "insufficient",
      shortTermPositive: null,
      longTermPositive: null,
      outlook: "unclear",
      riskPct,
      reasons: ["No horizon backtested — could not evaluate."],
    };
    await persist(report, paramHashOf(spec.parameters));
    return report;
  }

  const widest = horizons[horizons.length - 1];
  const narrowest = horizons[0];
  const returns = horizons.map((h) => h.totalReturn).filter((v): v is number => v != null);
  const pfs = horizons.map((h) => h.profitFactor).filter((v): v is number => v != null);
  const positiveHorizons = returns.filter((r) => r > 0).length;
  const minProfitFactor = pfs.length ? Math.min(...pfs) : null;
  const widestTrades = widest.totalTrades ?? 0;

  // OOS proxy: the older slice's return, backed out of the two widest-vs-narrowest nested windows.
  let oosProxyReturn: number | null = null;
  if (narrowest.totalReturn != null && widest.totalReturn != null && horizons.length > 1) {
    oosProxyReturn = ((1 + widest.totalReturn / 100) / (1 + narrowest.totalReturn / 100) - 1) * 100;
  }

  // ── Trajectory axis: decompose the nested windows into non-overlapping SLICES (recent → old) so we
  //    can tell a strategy that WAS bad and is recovering from one that WAS good and is decaying —
  //    the durability verdict alone conflates them. Each slice's return is derived from the ratio of
  //    consecutive cumulative windows; per-day normalises the uneven 30/30/30/90 slice widths.
  const slices: ReturnSlice[] = [];
  let prevSpan = 0;
  let prevFactor = 1;
  for (const h of horizons) {
    const f = h.totalReturn != null ? 1 + h.totalReturn / 100 : null;
    const days = h.spanDays - prevSpan;
    const ret = f != null ? (f / prevFactor - 1) * 100 : null;
    slices.push({ fromDays: prevSpan, toDays: h.spanDays, days, ret, perDay: ret != null && days > 0 ? ret / days : null });
    prevSpan = h.spanDays;
    if (f != null) prevFactor = f;
  }
  slices.reverse(); // chronological: oldest slice first → most recent last, so it reads as a trend

  const recentReturn = narrowest.totalReturn;
  const recentPerDay = recentReturn != null && narrowest.spanDays > 0 ? recentReturn / narrowest.spanDays : null;
  const priorDays = widest.spanDays - narrowest.spanDays;
  const priorPerDay = oosProxyReturn != null && priorDays > 0 ? oosProxyReturn / priorDays : null;

  let trajectory: Trajectory = "insufficient";
  if (recentPerDay != null && priorPerDay != null) {
    const diff = recentPerDay - priorPerDay;
    const TH = 0.05; // %/day — below this the pace is effectively unchanged
    trajectory = diff > TH ? "improving" : diff < -TH ? "decaying" : "stable";
  }
  const shortTermPositive = recentReturn != null ? recentReturn > 0 : null;
  const longTermPositive = widest.totalReturn != null ? widest.totalReturn > 0 : null;

  let outlook: Outlook = "unclear";
  if (longTermPositive != null) {
    if (longTermPositive && trajectory !== "decaying") outlook = "durable";
    else if (longTermPositive && trajectory === "decaying") outlook = "fading";
    else if (!longTermPositive && trajectory === "improving" && shortTermPositive) outlook = "recovering";
    else outlook = "weak";
  }

  // ── Sub-scores (0–1) ──────────────────────────────────────────────────────
  const edgeScore = returns.length ? positiveHorizons / returns.length : 0; // sign consistency
  const pfScore = minProfitFactor == null ? 0 : clamp01((minProfitFactor - 0.8) / (1.5 - 0.8)); // PF 0.8→1.5
  // Stability: how tightly returns cluster around their mean, relative to their spread.
  let stabilityScore = 1;
  if (returns.length > 1) {
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const sd = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length);
    stabilityScore = clamp01(1 - sd / (Math.abs(mean) + 5)); // +5% floor so near-zero means isn't punished infinitely
  }
  const shrinkage = widestTrades / (widestTrades + SHRINKAGE_K); // small samples can't score high

  const raw = 0.4 * edgeScore + 0.4 * pfScore + 0.2 * stabilityScore;
  const score = Math.round(100 * raw * shrinkage);

  // ── Verdict (interpretable, not just a threshold on the score) ────────────
  let verdict: RobustnessVerdict;
  if (widestTrades < MIN_TRADES) {
    verdict = "insufficient-data";
    reasons.push(`Only ${widestTrades} trades at the widest horizon (${widest.spanDays}d) — too few to trust (min ${MIN_TRADES}).`);
  } else if (positiveHorizons < returns.length) {
    verdict = "fragile";
    reasons.push(`Return is negative at ${returns.length - positiveHorizons} of ${returns.length} horizons — the edge doesn't hold across windows.`);
  } else if (minProfitFactor != null && minProfitFactor < 1) {
    verdict = "fragile";
    reasons.push(`Worst-horizon profit factor is ${minProfitFactor.toFixed(2)} (<1) — it loses money over some window.`);
  } else if (score >= 55) {
    verdict = "robust";
    reasons.push(`Positive at all ${returns.length} horizons, worst PF ${minProfitFactor?.toFixed(2)}, ${widestTrades} trades — the edge holds as the window widens.`);
  } else {
    verdict = "mixed";
    reasons.push(`Edge is positive across horizons but weak or unstable (score ${score}) — treat with caution.`);
  }
  if (oosProxyReturn != null) {
    reasons.push(`Older-slice return (derived) ≈ ${oosProxyReturn.toFixed(1)}% vs recent ${narrowest.totalReturn?.toFixed(1)}% — approximate out-of-sample check.`);
  }
  if (trajectory !== "insufficient" && recentPerDay != null && priorPerDay != null) {
    const OUTLOOK_WHY: Record<Outlook, string> = {
      durable: "durable — long-term edge holds and it isn't fading.",
      fading: "fading — the long-term edge is weakening lately; watch for an exit.",
      recovering: "recovering — long-term edge unproven, but the recent window turned up. Speculative.",
      weak: "weak — negative long-term and not improving.",
      unclear: "unclear.",
    };
    reasons.push(`Trajectory ${trajectory}: recent ${recentPerDay.toFixed(3)}%/day vs prior ${priorPerDay.toFixed(3)}%/day.`);
    reasons.push(`Outlook ${OUTLOOK_WHY[outlook]}`);
  }
  if (horizons.length < HORIZONS.length) {
    reasons.push(`Only ${horizons.length} distinct horizon(s) available (limited history or backtest gaps).`);
  }

  const report: RobustnessReport = {
    strategyId: spec.strategyId,
    pair: spec.pair,
    timeframe: spec.timeframe,
    horizons,
    score,
    verdict,
    positiveHorizons,
    totalHorizons: returns.length,
    minProfitFactor,
    widestTrades,
    widestReturn: widest.totalReturn,
    oosProxyReturn,
    slices,
    recentReturn,
    recentPerDay,
    priorPerDay,
    trajectory,
    shortTermPositive,
    longTermPositive,
    outlook,
    riskPct,
    reasons,
  };
  await persist(report, paramHashOf(spec.parameters));
  return report;
}
