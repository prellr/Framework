/**
 * Verdict gate over the forward paper ledger.
 *
 * Unlike Strategy Lab's retrospective scorer, this evaluator consumes only trades that were actually
 * recorded at decision time with a real book-walk fill. Every bot result is paired to the always-down
 * control on the same market, and confidence intervals resample whole five-minute windows so six
 * simultaneous asset bets never masquerade as six independent observations.
 */

export const PAPER_GATE = {
  version: "updown-verdict-gate-v3",
  // Preregistered in KB before implementation. V3 retains v2's same-tick DOWN control and changes
  // only execution accounting: $5 is total taker outlay, including the live CLOB-v2 fee curve.
  evalStartMs: Date.UTC(2026, 6, 23, 10, 15, 0), // 2026-07-23 11:15 UK (BST)
  minMarkets: 1500,
  minSpanDays: 5,
  minBets: 200,
  minResidual: 0.015,
  clusterMs: 5 * 60_000,
  bootIters: 1000,
  sessionMinBets: 50,
  sessionsNeeded: 2,
} as const;

/** Effective start after the Gamma-pre-screen implementation defect was removed (KB alignment v2). */
export const PAPER_ENGINE_V2_START_MS = 1784773200000; // 2026-07-23 02:20:00.000 UTC

/** First authoritative fee-corrected paper cohort (KB updown-verdict-gate-v3). */
export const PAPER_ENGINE_V3_START_MS = PAPER_GATE.evalStartMs;

export interface PaperGateConfig {
  version: string;
  evalStartMs: number;
  minMarkets: number;
  minSpanDays: number;
  minBets: number;
  minResidual: number;
  clusterMs: number;
  bootIters: number;
  sessionMinBets: number;
  sessionsNeeded: number;
}

export interface PaperGateBot {
  key: string;
  name: string;
  evalStartMs: number;
  control?: boolean;
  /** Restrict both the observed-market denominator and candidate rows to the bot's registered universe. */
  eligible?: (context: { pair?: string; horizonMin: number; decidedAtMs: number }) => boolean;
}

export interface PaperGateTrade {
  id: number;
  botKey: string;
  conditionId: string;
  pair?: string;
  horizonMin: number;
  windowStartMs: number;
  decidedAtMs: number;
  side: string;
  askPaid: number;
  controlAskPaid: number | null;
  /** Optional fee-adjusted ask for the side opposite the candidate. Specialized symmetric gates
   * may use this; the immutable pooled/timeframe gates continue to use controlAskPaid only. */
  oppositeAskPaid?: number | null;
  status: string;
}

export interface PaperGateCi {
  mean: number;
  lo: number | null;
  hi: number | null;
  clusters: number;
  /** Upper-tail p-value for H0: mean residual <= 0 from a cluster-robust t statistic.
   * The legacy gates do not use it; prospective familywise gates may adjust it. */
  pOneSided: number | null;
}

export interface PaperGateBotResult {
  key: string;
  name: string;
  evalStartMs: number;
  markets: number;
  spanDays: number;
  /** Prospective candidate rows captured after this cohort's exact boundary, including open rows. */
  decisions: number;
  /** Captured rows whose same-tick comparator ask is already valid, independent of resolution. */
  pairedBookDecisions: number;
  /** Captured rows that have resolved, including rows whose comparator is unavailable. */
  resolvedDecisions: number;
  bets: number;
  pairedMarkets: number;
  residual: PaperGateCi | null;
  sessions: { key: string; label: string; bets: number; mean: number | null; qualifies: boolean }[];
  positiveQualifyingSessions: number;
  qualifyingSessions: number;
  requirements: { markets: boolean; span: boolean; bets: boolean; sessions: boolean };
  state: "waiting" | "collecting" | "passing" | "failing";
}

const SESSIONS = [
  { key: "night23-07", label: "night 23–07", includes: (hour: number) => hour >= 23 || hour < 7 },
  { key: "day07-19", label: "day 07–19", includes: (hour: number) => hour >= 7 && hour < 19 },
  { key: "eve19-23", label: "eve 19–23", includes: (hour: number) => hour >= 19 && hour < 23 },
] as const;

const ukHourFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour: "2-digit",
  hourCycle: "h23",
});

function sessionOf(t: number): string {
  const hour = Number(ukHourFormat.format(new Date(t)));
  return SESSIONS.find((session) => session.includes(hour))?.key ?? "day07-19";
}

/** Per-contract net at the recorded ask: winner receives $1, loser receives $0. */
export function contractNet(status: string, askPaid: number): number | null {
  if (!(askPaid > 0) || !(askPaid < 1)) return null;
  if (status === "won") return 1 - askPaid;
  if (status === "lost") return -askPaid;
  return null;
}

/** Net of the same-tick always-down control, inferred from the bot row's resolved outcome. */
export function contemporaneousDownNet(trade: PaperGateTrade): number | null {
  if (trade.side !== "up" && trade.side !== "down") return null;
  if (trade.status !== "won" && trade.status !== "lost") return null;
  if (trade.controlAskPaid == null) return null;
  const botWon = trade.status === "won";
  const resolvedDown = trade.side === "down" ? botWon : !botWon;
  return contractNet(resolvedDown ? "won" : "lost", trade.controlAskPaid);
}

/** Net of the exact opposite side at the candidate's decision tick.
 *
 * Binary Up/Down outcomes are mutually exclusive: when the candidate wins the opposite side loses,
 * and vice versa. The ask must come from the same fee-adjusted paired-book walk as the candidate.
 */
export function contemporaneousOppositeNet(trade: PaperGateTrade): number | null {
  if (trade.side !== "up" && trade.side !== "down") return null;
  if (trade.status !== "won" && trade.status !== "lost") return null;
  if (trade.oppositeAskPaid == null) return null;
  return contractNet(trade.status === "won" ? "lost" : "won", trade.oppositeAskPaid);
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

/** Lanczos log-gamma, used only by the Student-t tail below. */
function logGamma(value: number): number {
  const coefficients = [
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019571e-6,
    1.5056327351493116e-7,
  ];
  if (value < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  }
  const z = value - 1;
  let x = 0.9999999999998099;
  for (let i = 0; i < coefficients.length; i++) x += coefficients[i] / (z + i + 1);
  const t = z + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Continued fraction for the regularized incomplete beta function. */
function betaFraction(a: number, b: number, x: number): number {
  const maxIterations = 200;
  const epsilon = 3e-14;
  const floor = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < floor) d = floor;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= maxIterations; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < floor) d = floor;
    c = 1 + aa / c;
    if (Math.abs(c) < floor) c = floor;
    d = 1 / d;
    h *= d * c;
    aa = -((a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < floor) d = floor;
    c = 1 + aa / c;
    if (Math.abs(c) < floor) c = floor;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < epsilon) break;
  }
  return h;
}

function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (!(x > 0)) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b)
    + a * Math.log(x) + b * Math.log1p(-x),
  );
  return x < (a + 1) / (a + b + 2)
    ? front * betaFraction(a, b, x) / a
    : 1 - front * betaFraction(b, a, 1 - x) / b;
}

/** Upper-tail probability for a Student-t statistic. */
export function studentTUpperTail(t: number, degreesOfFreedom: number): number | null {
  if (!Number.isFinite(t) || !Number.isFinite(degreesOfFreedom) || degreesOfFreedom < 1) return null;
  if (t === 0) return 0.5;
  const x = degreesOfFreedom / (degreesOfFreedom + t * t);
  const halfTail = 0.5 * regularizedIncompleteBeta(x, degreesOfFreedom / 2, 0.5);
  return t > 0 ? halfTail : 1 - halfTail;
}

/**
 * One-sided cluster-robust t test for the trade-weighted mean residual.
 *
 * Each five-minute window is one independent cluster. The score contribution of a cluster is the
 * sum of its demeaned bets, so simultaneous assets never inflate precision. Small-sample correction
 * G/(G-1) and t(G-1) tails are used; prospective familywise gates add an explicit cluster floor.
 */
export function clusterRobustOneSidedP(
  values: { value: number; cluster: number }[],
): number | null {
  if (!values.length) return null;
  const grouped = new Map<number, number[]>();
  for (const item of values) {
    if (!Number.isFinite(item.value) || !Number.isFinite(item.cluster)) return null;
    const cluster = grouped.get(item.cluster) ?? [];
    cluster.push(item.value);
    grouped.set(item.cluster, cluster);
  }
  const clusters = [...grouped.values()];
  if (clusters.length < 3) return null;
  const mean = values.reduce((sum, item) => sum + item.value, 0) / values.length;
  if (!(mean > 0)) return 1;
  const scoreSquares = clusters.reduce((sum, cluster) => {
    const score = cluster.reduce((clusterSum, value) => clusterSum + value - mean, 0);
    return sum + score * score;
  }, 0);
  const variance = (clusters.length / (clusters.length - 1)) * scoreSquares / (values.length * values.length);
  if (!(variance > 0)) return 0;
  return studentTUpperTail(mean / Math.sqrt(variance), clusters.length - 1);
}

/** Deterministic cluster bootstrap so dashboard refreshes cannot move the displayed verdict. */
export function clusterBootstrap(
  values: { value: number; cluster: number }[],
  iterations: number,
  seedText: string,
): PaperGateCi | null {
  if (!values.length) return null;
  const grouped = new Map<number, number[]>();
  for (const item of values) {
    const cluster = grouped.get(item.cluster) ?? [];
    cluster.push(item.value);
    grouped.set(item.cluster, cluster);
  }
  const clusters = [...grouped.values()];
  const mean = values.reduce((sum, item) => sum + item.value, 0) / values.length;
  const pOneSided = clusterRobustOneSidedP(values);
  if (clusters.length < 3 || iterations < 1) {
    return { mean, lo: null, hi: null, clusters: clusters.length, pOneSided };
  }

  const random = mulberry32(hashSeed(seedText));
  const boot: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration++) {
    let sum = 0, n = 0;
    for (let i = 0; i < clusters.length; i++) {
      const picked = clusters[Math.floor(random() * clusters.length)];
      for (const value of picked) { sum += value; n++; }
    }
    boot.push(n ? sum / n : 0);
  }
  boot.sort((a, b) => a - b);
  const lo = boot[Math.floor(0.025 * (boot.length - 1))];
  const hi = boot[Math.floor(0.975 * (boot.length - 1))];
  return { mean, lo, hi, clusters: clusters.length, pOneSided };
}

export function computePaperGate(
  trades: PaperGateTrade[],
  bots: PaperGateBot[],
  nowMs = Date.now(),
  config: PaperGateConfig = PAPER_GATE,
  controlNet: (trade: PaperGateTrade) => number | null = contemporaneousDownNet,
  pairReady: (trade: PaperGateTrade) => boolean = (trade) =>
    trade.askPaid > 0
    && trade.askPaid < 1
    && trade.controlAskPaid != null
    && trade.controlAskPaid > 0
    && trade.controlAskPaid < 1,
) {
  const driftAll = trades.filter((trade) => trade.botKey === "drift");
  const results: PaperGateBotResult[] = [];

  for (const bot of bots.filter((candidate) => !candidate.control && candidate.key !== "drift")) {
    const evalStartMs = Math.max(config.evalStartMs, bot.evalStartMs);
    const eligible = (trade: PaperGateTrade) =>
      trade.windowStartMs >= evalStartMs
      && (bot.eligible?.({ pair: trade.pair, horizonMin: trade.horizonMin, decidedAtMs: trade.decidedAtMs }) ?? true);
    // Coverage must use the same preregistered opportunity universe as the bot. Counting every
    // control market would overstate sample coverage for horizon/session-filtered child hypotheses.
    const marketRows = driftAll.filter(eligible);
    const marketTimes = [...new Map(marketRows.map((trade) => [trade.conditionId, trade.windowStartMs])).values()].sort((a, b) => a - b);
    const markets = marketTimes.length;
    const spanDays = marketTimes.length >= 2 ? (marketTimes[marketTimes.length - 1] - marketTimes[0]) / 86_400_000 : 0;

    // The ledger uniqueness constraint should already guarantee one row per bot × market. Keep the
    // evaluator defensive so duplicated imports cannot inflate either collection or verdict counts.
    const candidateRows = [...new Map(
      trades
        .filter((trade) => trade.botKey === bot.key && eligible(trade))
        .map((trade) => [trade.conditionId, trade] as const),
    ).values()];
    const decisions = candidateRows.length;
    const pairedBookDecisions = candidateRows.filter(pairReady).length;
    const resolvedDecisions = candidateRows.filter(
      (trade) => trade.status === "won" || trade.status === "lost",
    ).length;
    const paired = candidateRows
      .flatMap((trade) => {
        const botNet = contractNet(trade.status, trade.askPaid);
        const driftNet = controlNet(trade);
        if (botNet == null || driftNet == null) return [];
        return [{
          id: trade.id,
          conditionId: trade.conditionId,
          t: trade.windowStartMs,
          residual: botNet - driftNet,
          cluster: Math.floor(trade.windowStartMs / config.clusterMs),
          session: sessionOf(trade.decidedAtMs),
        }];
      });
    const residual = clusterBootstrap(
      paired.map((row) => ({ value: row.residual, cluster: row.cluster })),
      config.bootIters,
      `${config.version}|${bot.key}|${paired.length}|${paired.at(-1)?.id ?? 0}`,
    );
    const sessions = SESSIONS.map((session) => {
      const values = paired.filter((row) => row.session === session.key).map((row) => row.residual);
      const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
      return { key: session.key, label: session.label, bets: values.length, mean, qualifies: values.length >= config.sessionMinBets };
    });
    const qualifyingSessions = sessions.filter((session) => session.qualifies).length;
    const positiveQualifyingSessions = sessions.filter((session) => session.qualifies && (session.mean ?? 0) > 0).length;
    const requirements = {
      markets: markets >= config.minMarkets,
      span: spanDays >= config.minSpanDays,
      bets: paired.length >= config.minBets,
      sessions: qualifyingSessions >= config.sessionsNeeded,
    };
    const sampleReady = requirements.markets && requirements.span && requirements.bets && requirements.sessions;
    const passes = sampleReady && residual != null && residual.lo != null && residual.mean >= config.minResidual && residual.lo > 0 && positiveQualifyingSessions >= config.sessionsNeeded;
    const state: PaperGateBotResult["state"] = nowMs < evalStartMs
      ? "waiting"
      : !sampleReady
        ? "collecting"
        : passes
          ? "passing"
          : "failing";

    results.push({
      key: bot.key,
      name: bot.name,
      evalStartMs,
      markets,
      spanDays,
      decisions,
      pairedBookDecisions,
      resolvedDecisions,
      bets: paired.length,
      pairedMarkets: new Set(paired.map((row) => row.conditionId)).size,
      residual,
      sessions,
      positiveQualifyingSessions,
      qualifyingSessions,
      requirements,
      state,
    });
  }
  return { version: config.version, constants: config, bots: results };
}
