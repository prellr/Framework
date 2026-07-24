export interface CrucibleProgramInput {
  id: string;
  name: string;
  tier: string | null;
  category: string | null;
  nativeTimeframe: string | null;
  description: string | null;
  refreshedAt: Date;
}

export interface CrucibleRunInput {
  id: string;
  strategyId: string;
  pair: string;
  timeframe: string;
  daysRequested: number;
  actualStart: string | null;
  actualEnd: string | null;
  spanDays: number;
  totalReturn: string | null;
  totalTrades: number | null;
  winRate: string | null;
  maxDrawdown: string | null;
  sharpe: string | null;
  profitFactor: string | null;
  paramHash: string;
  jesterParamCode: string | null;
  ranAt: Date;
  variants: number;
}

const numeric = (value: string | null): number | null => {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[midpoint]!
    : (sorted[midpoint - 1]! + sorted[midpoint]!) / 2;
}

function parseProgramName(name: string) {
  const match = name.match(/^Discovery Target\s+(.+?)\s+(LONG|SHORT)\s+\(([^)]+)\)$/i);
  return {
    target: match?.[1]?.trim() ?? "Unknown",
    direction: match?.[2]?.toUpperCase() ?? "Unknown",
    lifecycle: match?.[3]?.trim().toLowerCase() ?? "unknown",
  };
}

export function buildCrucibleObservatory(
  programs: CrucibleProgramInput[],
  runs: CrucibleRunInput[],
) {
  const programById = new Map(programs.map((program) => [program.id, program]));
  const cleanRuns = runs.map((run) => {
    const program = programById.get(run.strategyId);
    return {
      id: run.id,
      strategyId: run.strategyId,
      strategyName: program?.name ?? run.strategyId,
      target: parseProgramName(program?.name ?? run.strategyId).target,
      pair: run.pair,
      timeframe: run.timeframe,
      daysRequested: run.daysRequested,
      actualStart: run.actualStart,
      actualEnd: run.actualEnd,
      spanDays: run.spanDays,
      totalReturn: numeric(run.totalReturn),
      totalTrades: run.totalTrades,
      winRate: numeric(run.winRate),
      maxDrawdown: numeric(run.maxDrawdown),
      sharpe: numeric(run.sharpe),
      profitFactor: numeric(run.profitFactor),
      paramHash: run.paramHash,
      jesterParamCode: run.jesterParamCode,
      ranAt: run.ranAt,
      variants: run.variants,
    };
  });
  const runsByProgram = new Map<string, typeof cleanRuns>();
  for (const run of cleanRuns) {
    const collection = runsByProgram.get(run.strategyId) ?? [];
    collection.push(run);
    runsByProgram.set(run.strategyId, collection);
  }

  const collections = programs.map((program) => {
    const collectionRuns = runsByProgram.get(program.id) ?? [];
    const parsed = parseProgramName(program.name);
    const profitFactors = collectionRuns
      .map((run) => run.profitFactor)
      .filter((value): value is number => value != null);
    const returns = collectionRuns
      .map((run) => run.totalReturn)
      .filter((value): value is number => value != null);
    const drawdowns = collectionRuns
      .map((run) => run.maxDrawdown)
      .filter((value): value is number => value != null);
    const latestRunAt = collectionRuns.length
      ? Math.max(...collectionRuns.map((run) => run.ranAt.getTime()))
      : null;
    return {
      strategyId: program.id,
      name: program.name,
      target: parsed.target,
      direction: parsed.direction,
      lifecycle: parsed.lifecycle,
      tier: program.tier,
      category: program.category,
      nativeTimeframe: program.nativeTimeframe,
      description: program.description,
      refreshedAt: program.refreshedAt,
      results: collectionRuns.length,
      assets: new Set(collectionRuns.map((run) => run.pair)).size,
      timeframes: new Set(collectionRuns.map((run) => run.timeframe)).size,
      positiveReturnCells: collectionRuns.filter((run) => (run.totalReturn ?? -Infinity) > 0).length,
      sufficientSampleCells: collectionRuns.filter((run) => (run.totalTrades ?? 0) >= 20).length,
      bestProfitFactor: profitFactors.length ? Math.max(...profitFactors) : null,
      medianProfitFactor: median(profitFactors),
      bestReturn: returns.length ? Math.max(...returns) : null,
      worstDrawdown: drawdowns.length ? Math.min(...drawdowns) : null,
      latestRunAt: latestRunAt == null ? null : new Date(latestRunAt),
    };
  });

  const allLatestTimes = cleanRuns.map((run) => run.ranAt.getTime());
  const catalogTimes = programs.map((program) => program.refreshedAt.getTime());
  return {
    version: "crucible-observatory-v1",
    generatedAt: new Date(),
    summary: {
      programs: programs.length,
      results: cleanRuns.length,
      assets: new Set(cleanRuns.map((run) => run.pair)).size,
      timeframes: new Set(cleanRuns.map((run) => run.timeframe)).size,
      latestRunAt: allLatestTimes.length ? new Date(Math.max(...allLatestTimes)) : null,
      catalogRefreshedAt: catalogTimes.length ? new Date(Math.max(...catalogTimes)) : null,
    },
    sources: {
      catalogMirror: true,
      warehouseBacktests: true,
      liveCrucibleStatus: false,
      liveTargetCollections: false,
    },
    safety: {
      readOnly: true,
      canStart: false,
      canReplay: false,
      canCancel: false,
      canValidate: false,
      canPromote: false,
      canActivate: false,
      canRunCycle: false,
    },
    collections,
    results: cleanRuns,
  };
}
