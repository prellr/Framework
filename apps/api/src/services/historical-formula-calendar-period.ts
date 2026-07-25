import type {
  HistoricalFormulaTrialObservation,
} from "./historical-ohlcv-formula-replay.ts";

export type HistoricalFormulaCalendarPeriod = {
  period: string;
  startAtMs: number;
  endAtMsExclusive: number;
  trades: number;
  wins: number;
  losses: number;
  hitRate: number;
  meanGrossBps: number;
  meanNetBps: number;
  totalGrossBps: number;
  totalNetBps: number;
  fixedNotionalPnlUsd: number;
};

const mean = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const utcMonthKey = (atMs: number) => new Date(atMs).toISOString().slice(0, 7);

export function summarizeHistoricalFormulaCalendarMonths(input: {
  observations: readonly HistoricalFormulaTrialObservation[];
  fixedNotionalUsd: number;
}): HistoricalFormulaCalendarPeriod[] {
  if (!Number.isFinite(input.fixedNotionalUsd) || input.fixedNotionalUsd <= 0) {
    throw new Error("calendar-period fixed notional must be positive");
  }
  const byMonth = new Map<string, HistoricalFormulaTrialObservation[]>();
  for (const observation of input.observations) {
    const month = utcMonthKey(observation.entryAtMs);
    byMonth.set(month, [...(byMonth.get(month) ?? []), observation]);
  }
  return [...byMonth]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([period, observations]) => {
      const [year, month] = period.split("-").map(Number);
      const gross = observations.map((observation) => observation.grossBps);
      const net = observations.map((observation) => observation.netBps);
      const wins = observations.filter((observation) => observation.netBps > 0).length;
      return {
        period,
        startAtMs: Date.UTC(year!, month! - 1, 1),
        endAtMsExclusive: Date.UTC(year!, month!, 1),
        trades: observations.length,
        wins,
        losses: observations.length - wins,
        hitRate: wins / observations.length,
        meanGrossBps: mean(gross),
        meanNetBps: mean(net),
        totalGrossBps: gross.reduce((sum, value) => sum + value, 0),
        totalNetBps: net.reduce((sum, value) => sum + value, 0),
        fixedNotionalPnlUsd: observations.reduce(
          (sum, observation) =>
            sum + observation.netSimpleReturn * input.fixedNotionalUsd,
          0,
        ),
      };
    });
}
