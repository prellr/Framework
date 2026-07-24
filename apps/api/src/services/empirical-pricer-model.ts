/** Pure, DB-free model for the preregistered empirical kNN pricer. */
export const EMPIRICAL_PRICER = {
  evalStartMs: 1784772314409, // 2026-07-23 02:05:14.409 UTC — KB created_at is authoritative
  zScale: 0.35,
  logTimeScale: 0.75,
  neighbors: 200,
  minDistinctMarkets: 100,
  priorAlpha: 1,
  priorBeta: 1,
} as const;

export interface EmpiricalPricerConfig {
  zScale: number;
  logTimeScale: number;
  neighbors: number;
  minDistinctMarkets: number;
  priorAlpha: number;
  priorBeta: number;
}

export interface EmpiricalTrainingRow {
  conditionId: string;
  zDistance: number;
  remainingSec: number;
  resolvedUp: boolean;
}

export interface EmpiricalEstimate {
  pup: number;
  neighbors: number;
  upWins: number;
  nearestDistance: number;
  farthestDistance: number;
}

export function empiricalKnnPup(
  rows: EmpiricalTrainingRow[],
  current: { conditionId: string; zDistance: number; remainingSec: number },
  config: EmpiricalPricerConfig = EMPIRICAL_PRICER,
): EmpiricalEstimate | null {
  if (!Number.isFinite(current.zDistance) || !(current.remainingSec > 0) || !(config.zScale > 0) || !(config.logTimeScale > 0)) return null;
  const currentLogTime = Math.log(current.remainingSec);
  const nearestByMarket = new Map<string, { distance: number; resolvedUp: boolean }>();

  for (const row of rows) {
    if (row.conditionId === current.conditionId || !Number.isFinite(row.zDistance) || !(row.remainingSec > 0)) continue;
    const dz = (row.zDistance - current.zDistance) / config.zScale;
    const dt = (Math.log(row.remainingSec) - currentLogTime) / config.logTimeScale;
    const distance = Math.hypot(dz, dt);
    const previous = nearestByMarket.get(row.conditionId);
    if (!previous || distance < previous.distance) nearestByMarket.set(row.conditionId, { distance, resolvedUp: row.resolvedUp });
  }

  const nearest = [...nearestByMarket.entries()]
    .map(([conditionId, row]) => ({ conditionId, ...row }))
    .sort((a, b) => a.distance - b.distance || a.conditionId.localeCompare(b.conditionId))
    .slice(0, config.neighbors);
  if (nearest.length < config.minDistinctMarkets) return null;
  const upWins = nearest.filter((row) => row.resolvedUp).length;
  const pup = (upWins + config.priorAlpha) / (nearest.length + config.priorAlpha + config.priorBeta);
  return {
    pup,
    neighbors: nearest.length,
    upWins,
    nearestDistance: nearest[0].distance,
    farthestDistance: nearest[nearest.length - 1].distance,
  };
}
