import { useEffect, useMemo, useState } from "react";
import type { RouterOutput } from "@framework/api/router";
import { TimeSeriesChart } from "@/components/ui/time-series-chart";
import { trpc } from "@/lib/trpc";
import {
  nextSortState,
  PolymarketSortableHeader,
  stableSortRows,
  type SortState,
  type SortValue,
} from "@/pages/polymarket/PolymarketSortableHeader";

type FormulaLab = RouterOutput["formulaLab"]["status"];
type VenuePreview = RouterOutput["formulaLab"]["venuePreview"];
type CalendarData = RouterOutput["formulaLab"]["calendarPeriods"];
type CalendarExperiment = CalendarData["experiments"][number];
type CalendarTrial = CalendarExperiment["trials"][number];
type CalendarPeriod = CalendarTrial["periods"][number];
type HistoricalCapitalSimulation =
  RouterOutput["formulaLab"]["historicalCapitalSimulation"];

type UnifiedResult = {
  key: string;
  experiment: string;
  source: string;
  chart: "1m" | "5m" | "1h";
  asset: string;
  exitMinutes: number;
  trial: string;
  formula: string;
  trades: number;
  hitRate: number | null;
  meanGrossBps: number | null;
  meanNetBps: number | null;
  positiveFolds: number;
  totalFolds: number;
  worstFoldMeanNetBps: number | null;
  finalEquityUsd: number | null;
  sampleComplete: boolean;
  sampleNote: string | null;
  chartIntervalMinutes: 5 | 60 | null;
  trialId: string;
  hasTradeLedger: boolean;
};

type UnifiedSortKey =
  | "experiment"
  | "chart"
  | "asset"
  | "exit"
  | "trial"
  | "trades"
  | "hitRate"
  | "gross"
  | "net"
  | "folds"
  | "worst"
  | "equity"
  | "sample";

type PeriodSortKey =
  | "period"
  | "trades"
  | "wins"
  | "losses"
  | "hitRate"
  | "gross"
  | "net"
  | "totalNet"
  | "pnl";

const formatBps = (value: number | null) =>
  value == null ? "n/a" : `${value >= 0 ? "+" : ""}${value.toFixed(2)} bps`;

const formatPercent = (value: number | null) =>
  value == null ? "n/a" : `${(value * 100).toFixed(1)}%`;

const formatUsd = (value: number | null) =>
  value == null
    ? "n/a"
    : `${value < 0 ? "-" : "+"}$${Math.abs(value).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

const horizonLabel = (minutes: number) =>
  minutes < 60 ? `${minutes}m` : `${minutes / 60}h`;

const trialLabel = (id: string) => {
  if (id === "always-short-control") return "Always short control";
  const match = id.match(/albert-short-(high|low):z([0-9.]+)/);
  if (!match) return id;
  return `Albert ${match[1]} tail, z ${match[2]}`;
};

function resultValue(row: UnifiedResult, key: UnifiedSortKey): SortValue {
  switch (key) {
    case "experiment": return row.experiment;
    case "chart": return row.chart === "1m" ? 1 : row.chart === "5m" ? 5 : 60;
    case "asset": return row.asset;
    case "exit": return row.exitMinutes;
    case "trial": return row.trial;
    case "trades": return row.trades;
    case "hitRate": return row.hitRate;
    case "gross": return row.meanGrossBps;
    case "net": return row.meanNetBps;
    case "folds": return row.positiveFolds;
    case "worst": return row.worstFoldMeanNetBps;
    case "equity": return row.finalEquityUsd;
    case "sample": return row.sampleComplete ? 1 : 0;
  }
}

function periodValue(row: CalendarPeriod, key: PeriodSortKey): SortValue {
  switch (key) {
    case "period": return row.period;
    case "trades": return row.trades;
    case "wins": return row.wins;
    case "losses": return row.losses;
    case "hitRate": return row.hitRate;
    case "gross": return row.meanGrossBps;
    case "net": return row.meanNetBps;
    case "totalNet": return row.totalNetBps;
    case "pnl": return row.fixedNotionalPnlUsd;
  }
}

function historicalRows(data: FormulaLab): UnifiedResult[] {
  const rows: UnifiedResult[] = [];
  const addTrials = (input: {
    receipt: string;
    experiment: string;
    chart: "5m" | "1h";
    exitMinutes: number;
    totalFolds: number;
    trials: readonly {
      id: string;
      available: boolean;
      unavailableReason: string | null;
      trades: number;
      meanGrossBps: number | null;
      meanNetBps: number | null;
      hitRate: number | null;
      positiveFolds: number;
      worstFoldMeanNetBps: number | null;
      finalEquityUsd: number;
    }[];
  }) => {
    for (const trial of input.trials) {
      rows.push({
        key: `${input.receipt}:${input.exitMinutes}:${trial.id}`,
        experiment: input.experiment,
        source: input.chart === "5m"
          ? "TradingView Hyperliquid OHLCV"
          : "UTC resample of TradingView OHLCV",
        chart: input.chart,
        asset: "BTC",
        exitMinutes: input.exitMinutes,
        trial: trialLabel(trial.id),
        formula: "Albert legacy expression",
        trades: trial.trades,
        hitRate: trial.hitRate,
        meanGrossBps: trial.meanGrossBps,
        meanNetBps: trial.meanNetBps,
        positiveFolds: trial.positiveFolds,
        totalFolds: input.totalFolds,
        worstFoldMeanNetBps: trial.worstFoldMeanNetBps,
        finalEquityUsd: trial.finalEquityUsd,
        sampleComplete: trial.available,
        sampleNote: trial.unavailableReason,
        chartIntervalMinutes: input.chart === "5m" ? 5 : 60,
        trialId: trial.id,
        hasTradeLedger: trial.trades > 0,
      });
    }
  };

  addTrials({
    receipt: data.historicalReplay.receiptHash,
    experiment: "Albert BTC 5m baseline",
    chart: "5m",
    exitMinutes: data.historicalReplay.target.holdMinutes,
    totalFolds: data.historicalReplay.target.folds,
    trials: data.historicalReplay.trials,
  });
  for (const horizon of data.historicalHorizonSensitivity.horizons) {
    addTrials({
      receipt: data.historicalHorizonSensitivity.receiptHash,
      experiment: "Albert BTC 5m medium exits",
      chart: "5m",
      exitMinutes: horizon.holdMinutes,
      totalFolds: data.historicalHorizonSensitivity.target.folds,
      trials: horizon.trials,
    });
  }
  for (const horizon of data.historicalLongHorizonSensitivity.horizons) {
    addTrials({
      receipt: data.historicalLongHorizonSensitivity.receiptHash,
      experiment: "Albert BTC 5m long exits",
      chart: "5m",
      exitMinutes: horizon.holdMinutes,
      totalFolds: data.historicalLongHorizonSensitivity.target.folds,
      trials: horizon.trials,
    });
  }
  for (const horizon of data.historicalOneHourChartSensitivity.horizons) {
    addTrials({
      receipt: data.historicalOneHourChartSensitivity.receiptHash,
      experiment: "Albert BTC 1h chart",
      chart: "1h",
      exitMinutes: horizon.holdMinutes,
      totalFolds: data.historicalOneHourChartSensitivity.target.folds,
      trials: horizon.trials,
    });
  }
  return rows;
}

function venueRows(preview: VenuePreview | undefined): UnifiedResult[] {
  if (!preview) return [];
  return preview.trials.map((trial) => ({
    key: `venue:${trial.pair}:${trial.candidateId}`,
    experiment: "Frozen Chainlink and Hyperliquid preview",
    source: "Chainlink and Hyperliquid minute frames",
    chart: "1m" as const,
    asset: trial.pair.replace("-USD", ""),
    exitMinutes: preview.target.holdSeconds / 60,
    trial: trial.candidateId,
    formula: trial.formula,
    trades: trial.trades,
    hitRate: trial.hitRate,
    meanGrossBps: trial.meanGrossBps,
    meanNetBps: trial.meanNetBps,
    positiveFolds: trial.positiveFolds,
    totalFolds: trial.folds,
    worstFoldMeanNetBps: trial.foldResults
      .map((fold) => fold.testMeanNetBps)
      .filter((value): value is number => value != null)
      .reduce<number | null>(
        (worst, value) => worst == null ? value : Math.min(worst, value),
        null,
      ),
    finalEquityUsd: null,
    sampleComplete: trial.available,
    sampleNote: trial.unavailableReason,
    chartIntervalMinutes: null,
    trialId: trial.candidateId,
    hasTradeLedger: false,
  }));
}

export function FormulaExperimentExplorer({
  data,
  venuePreview,
}: {
  data: FormulaLab;
  venuePreview?: VenuePreview;
}) {
  const [search, setSearch] = useState("");
  const [chart, setChart] = useState<"all" | UnifiedResult["chart"]>("all");
  const [exit, setExit] = useState<"all" | string>("all");
  const [winBand, setWinBand] = useState<"all" | "above50" | "40to50" | "below40" | "none">("all");
  const [sample, setSample] = useState<"all" | "complete" | "sparse">("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState<UnifiedSortKey>>({
    key: "hitRate",
    direction: "desc",
  });
  const allRows = useMemo(
    () => [...historicalRows(data), ...venueRows(venuePreview)],
    [data, venuePreview],
  );
  const exitOptions = useMemo(
    () => [...new Set(allRows.map((row) => row.exitMinutes))].sort((a, b) => a - b),
    [allRows],
  );
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = allRows.filter((row) => {
      if (chart !== "all" && row.chart !== chart) return false;
      if (exit !== "all" && row.exitMinutes !== Number(exit)) return false;
      if (sample === "complete" && !row.sampleComplete) return false;
      if (sample === "sparse" && row.sampleComplete) return false;
      if (winBand === "none" && row.hitRate != null) return false;
      if (winBand === "above50" && (row.hitRate == null || row.hitRate < 0.5)) return false;
      if (
        winBand === "40to50"
        && (row.hitRate == null || row.hitRate < 0.4 || row.hitRate >= 0.5)
      ) return false;
      if (winBand === "below40" && (row.hitRate == null || row.hitRate >= 0.4)) return false;
      return !query || [
        row.experiment,
        row.source,
        row.chart,
        row.asset,
        row.trial,
        row.formula,
        horizonLabel(row.exitMinutes),
      ].some((value) => value.toLowerCase().includes(query));
    });
    return stableSortRows(
      filtered,
      (row) => resultValue(row, sort.key),
      sort.direction,
    );
  }, [allRows, chart, exit, sample, search, sort, winBand]);
  const sortRows = (
    key: UnifiedSortKey,
    initialDirection: "asc" | "desc" = "desc",
  ) => setSort((current) => nextSortState(current, key, initialDirection));
  const rowsWithTrades = rows.filter((row) => row.trades > 0);
  const aboveHalf = rowsWithTrades.filter((row) => (row.hitRate ?? 0) >= 0.5);
  const bestHitRate = rowsWithTrades.reduce<number | null>(
    (best, row) => best == null
      ? row.hitRate
      : Math.max(best, row.hitRate ?? Number.NEGATIVE_INFINITY),
    null,
  );
  const defaultSelectedRow =
    allRows.find(
      (row) =>
        row.chart === "1h"
        && row.exitMinutes === 1_440
        && row.trialId === "albert-short-low:z1",
    )
    ?? allRows.find((row) => row.hasTradeLedger)
    ?? null;
  const selectedRow =
    allRows.find((row) => row.key === selectedKey)
    ?? defaultSelectedRow;

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <header className="border-b px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Unified result explorer
            </div>
            <h2 className="mt-1 text-base font-semibold">
              Search every frozen result in one table
            </h2>
            <p className="mt-1 max-w-4xl text-xs leading-relaxed text-muted-foreground">
              Win rate is the primary comparison here. Every historical row stays visible,
              including sparse rows and failed experiments. Sample completeness is a note, not a
              filter applied behind the scenes.
            </p>
          </div>
          <div className="text-right text-[11px] text-muted-foreground">
            <div className="font-mono text-sm font-semibold text-foreground">
              {rows.length.toLocaleString()} shown
            </div>
            <div>{allRows.length.toLocaleString()} frozen rows in the searchable archive</div>
          </div>
        </div>
      </header>

      <div className="grid border-b sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Results with trades", rowsWithTrades.length.toLocaleString(), "Rows with an observed holdout outcome"],
          ["Win rate at least 50%", aboveHalf.length.toLocaleString(), "Descriptive count in the current filter"],
          ["Best displayed win rate", formatPercent(bestHitRate), "Not selected or promoted"],
          ["Calendar coverage", "UTC months", "Exact monthly rows are available below"],
        ].map(([label, value, note]) => (
          <article key={label} className="border-b p-4 last:border-b-0 sm:border-r xl:border-b-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {label}
            </div>
            <div className="mt-2 font-mono text-xl font-semibold">{value}</div>
            <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>
          </article>
        ))}
      </div>

      <div className="grid gap-3 border-b bg-muted/10 p-4 lg:grid-cols-[minmax(16rem,1fr)_repeat(4,minmax(8rem,auto))]">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Search
          </span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Formula, trial, asset, source, experiment"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-foreground/40"
          />
        </label>
        <FilterSelect
          label="Chart"
          value={chart}
          onChange={(value) => setChart(value as typeof chart)}
          options={[
            ["all", "All charts"],
            ["1m", "1m frames"],
            ["5m", "5m chart"],
            ["1h", "1h chart"],
          ]}
        />
        <FilterSelect
          label="Exit"
          value={exit}
          onChange={setExit}
          options={[
            ["all", "All exits"],
            ...exitOptions.map((minutes) => [String(minutes), horizonLabel(minutes)] as const),
          ]}
        />
        <FilterSelect
          label="Win rate"
          value={winBand}
          onChange={(value) => setWinBand(value as typeof winBand)}
          options={[
            ["all", "All win rates"],
            ["above50", "50% or higher"],
            ["40to50", "40% to 49.9%"],
            ["below40", "Below 40%"],
            ["none", "No trades"],
          ]}
        />
        <FilterSelect
          label="Sample note"
          value={sample}
          onChange={(value) => setSample(value as typeof sample)}
          options={[
            ["all", "All samples"],
            ["complete", "Complete"],
            ["sparse", "Sparse"],
          ]}
        />
      </div>

      <details className="border-b">
        <summary className="cursor-pointer px-4 py-3 text-xs font-medium">
          How the four chronological folds work
        </summary>
        <div className="grid border-t sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["1. Train on the past", "Fold 1 starts after an initial training span. Each later fold adds all eligible history that existed before its test window."],
            ["2. Fit without future data", "The formula threshold mean and standard deviation are fit on training rows only. Test outcomes never set their own gate."],
            ["3. Purge the boundary", "Any training trade whose exit would reach into the next test window is removed before the threshold is fit."],
            ["4. Score the next block", "Each fold scores a later time block. Positive folds count blocks with positive average net return. Win rate counts profitable trades and is a different statistic."],
          ].map(([title, text]) => (
            <article key={title} className="border-b p-4 last:border-b-0 sm:border-r xl:border-b-0">
              <div className="text-xs font-semibold">{title}</div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{text}</p>
            </article>
          ))}
        </div>
        <p className="border-t px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
          A fold is a chronological holdout window, not a random split. A row can have a high trade
          win rate and still have a negative average return, or positive folds with a modest win
          rate, because gain and loss sizes also matter.
        </p>
      </details>

      <p className="border-b bg-muted/10 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground">Frozen equity contract:</span>{" "}
        $10,000 starting equity, fixed $1,000 notional per trade, no compounding, one open
        position, and only chronological holdout trades. The archived result used a generic
        10 bps round-trip cost. Open a row below to replace that shortcut with explicit
        Hyperliquid fees, slippage, funding, leverage, and sizing.
      </p>

      <div className="max-h-[46rem] overflow-auto">
        <table className="w-full min-w-[1460px] text-xs tabular-nums">
          <thead className="sticky top-0 z-20 border-b bg-card text-[10px] uppercase tracking-[0.11em] text-muted-foreground">
            <tr>
              <PolymarketSortableHeader column="experiment" active={sort.key} direction={sort.direction} onSort={sortRows} initialDirection="asc">Experiment</PolymarketSortableHeader>
              <PolymarketSortableHeader column="chart" active={sort.key} direction={sort.direction} onSort={sortRows} initialDirection="asc">Chart</PolymarketSortableHeader>
              <PolymarketSortableHeader column="asset" active={sort.key} direction={sort.direction} onSort={sortRows} initialDirection="asc">Asset</PolymarketSortableHeader>
              <PolymarketSortableHeader column="exit" active={sort.key} direction={sort.direction} onSort={sortRows}>Exit</PolymarketSortableHeader>
              <PolymarketSortableHeader column="trial" active={sort.key} direction={sort.direction} onSort={sortRows} initialDirection="asc">Formula trial</PolymarketSortableHeader>
              <PolymarketSortableHeader column="trades" active={sort.key} direction={sort.direction} onSort={sortRows} align="right">Trades</PolymarketSortableHeader>
              <PolymarketSortableHeader column="hitRate" active={sort.key} direction={sort.direction} onSort={sortRows} align="right">Win rate</PolymarketSortableHeader>
              <PolymarketSortableHeader column="gross" active={sort.key} direction={sort.direction} onSort={sortRows} align="right">Gross mean</PolymarketSortableHeader>
              <PolymarketSortableHeader column="net" active={sort.key} direction={sort.direction} onSort={sortRows} align="right">Net mean</PolymarketSortableHeader>
              <PolymarketSortableHeader column="folds" active={sort.key} direction={sort.direction} onSort={sortRows} align="right">Positive folds</PolymarketSortableHeader>
              <PolymarketSortableHeader column="worst" active={sort.key} direction={sort.direction} onSort={sortRows} align="right">Worst fold</PolymarketSortableHeader>
              <PolymarketSortableHeader column="equity" active={sort.key} direction={sort.direction} onSort={sortRows} align="right">Frozen end equity</PolymarketSortableHeader>
              <PolymarketSortableHeader column="sample" active={sort.key} direction={sort.direction} onSort={sortRows}>Sample note</PolymarketSortableHeader>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.key} className="hover:bg-muted/10">
                <td className="px-4 py-3">
                  <div className="font-medium">{row.experiment}</div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{row.source}</div>
                </td>
                <td className="px-4 py-3 font-mono font-medium">{row.chart}</td>
                <td className="px-4 py-3 font-mono">{row.asset}</td>
                <td className="px-4 py-3 font-mono">{horizonLabel(row.exitMinutes)}</td>
                <td className="max-w-xs px-4 py-3">
                  <div className="font-medium">{row.trial}</div>
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground" title={row.formula}>
                    {row.formula}
                  </div>
                  {row.hasTradeLedger ? (
                    <button
                      type="button"
                      onClick={() => setSelectedKey(row.key)}
                      className={`mt-2 rounded border px-2 py-1 text-[10px] font-semibold ${
                        selectedRow?.key === row.key
                          ? "border-foreground/30 bg-foreground text-background"
                          : "hover:bg-muted"
                      }`}
                    >
                      {selectedRow?.key === row.key
                        ? "Simulator open"
                        : "Open trades & simulator"}
                    </button>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-right font-mono">{row.trades.toLocaleString()}</td>
                <td className={`px-4 py-3 text-right font-mono font-semibold ${
                  row.hitRate == null
                    ? "text-muted-foreground"
                    : row.hitRate >= 0.5 ? "text-success" : "text-destructive"
                }`}>
                  {formatPercent(row.hitRate)}
                </td>
                <td className={`px-4 py-3 text-right font-mono ${
                  (row.meanGrossBps ?? 0) > 0 ? "text-success" : row.meanGrossBps == null ? "text-muted-foreground" : "text-destructive"
                }`}>
                  {formatBps(row.meanGrossBps)}
                </td>
                <td className={`px-4 py-3 text-right font-mono ${
                  (row.meanNetBps ?? 0) > 0 ? "text-success" : row.meanNetBps == null ? "text-muted-foreground" : "text-destructive"
                }`}>
                  {formatBps(row.meanNetBps)}
                </td>
                <td className="px-4 py-3 text-right font-mono">
                  {row.positiveFolds}/{row.totalFolds}
                </td>
                <td className={`px-4 py-3 text-right font-mono ${
                  (row.worstFoldMeanNetBps ?? 0) > 0 ? "text-success" : row.worstFoldMeanNetBps == null ? "text-muted-foreground" : "text-destructive"
                }`}>
                  {formatBps(row.worstFoldMeanNetBps)}
                </td>
                <td className="px-4 py-3 text-right font-mono">
                  {row.finalEquityUsd == null
                    ? "n/a"
                    : (
                      <>
                        <div>
                          ${row.finalEquityUsd.toLocaleString("en-US", {
                            maximumFractionDigits: 0,
                          })}
                        </div>
                        <div className="mt-0.5 text-[9px] text-muted-foreground">
                          from $10,000
                        </div>
                      </>
                    )}
                </td>
                <td className="max-w-56 px-4 py-3">
                  <span className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                    row.sampleComplete
                      ? "border-success/25 bg-success/5 text-success"
                      : "border-warning/25 bg-warning/5 text-warning"
                  }`}>
                    {row.sampleComplete ? "complete" : "sparse"}
                  </span>
                  {row.sampleNote ? (
                    <div className="mt-1 text-[10px] leading-tight text-muted-foreground">
                      {row.sampleNote}
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={13} className="p-10 text-center text-sm text-muted-foreground">
                  No frozen result matches these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="border-t px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
        Sorting and filtering are descriptive only. Result rows may overlap and cannot be summed
        into a portfolio. No row is selected, exported, registered, or connected to execution.
      </p>
      {selectedRow?.chartIntervalMinutes ? (
        <HistoricalCapitalInspector row={selectedRow} />
      ) : null}
    </section>
  );
}

type CapitalAssumptions = {
  initialCapitalUsd: number;
  sizingMode:
    | "fixed-notional"
    | "equity-fraction-notional"
    | "fixed-risk"
    | "equity-fraction-risk";
  sizingValue: number;
  compoundSizing: boolean;
  leverage: number;
  plannedLossPct: number;
  takerFeeBpsPerSide: number;
  slippageBpsPerSide: number;
  fundingBpsPerDay: number;
};

const defaultCapitalAssumptions: CapitalAssumptions = {
  initialCapitalUsd: 10_000,
  sizingMode: "fixed-notional",
  sizingValue: 1_000,
  compoundSizing: false,
  leverage: 1,
  plannedLossPct: 100,
  takerFeeBpsPerSide: 4.5,
  slippageBpsPerSide: 0.5,
  fundingBpsPerDay: 0,
};

const compactUsd = (value: number | null) =>
  value == null
    ? "n/a"
    : `${value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}`;

const formatUtc = (atMs: number | null) =>
  atMs == null
    ? "n/a"
    : new Date(atMs).toLocaleString("en-US", {
      timeZone: "UTC",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

function HistoricalCapitalInspector({ row }: { row: UnifiedResult }) {
  const [draft, setDraft] = useState(defaultCapitalAssumptions);
  const [assumptions, setAssumptions] = useState(defaultCapitalAssumptions);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [row.key]);

  const simulation = trpc.formulaLab.historicalCapitalSimulation.useQuery({
    chartIntervalMinutes: row.chartIntervalMinutes!,
    holdMinutes: row.exitMinutes,
    trialId: row.trialId,
    ...assumptions,
    page,
    pageSize: 50,
  }, {
    staleTime: Number.POSITIVE_INFINITY,
  });
  const result = simulation.data;

  const setNumber = (
    key: Exclude<keyof CapitalAssumptions, "sizingMode" | "compoundSizing">,
    value: string,
  ) => {
    const parsed = Number(value);
    setDraft((current) => ({
      ...current,
      [key]: Number.isFinite(parsed) ? parsed : 0,
    }));
  };
  const sizingIsPercent =
    draft.sizingMode === "equity-fraction-notional"
    || draft.sizingMode === "equity-fraction-risk";
  const sizingIsRisk =
    draft.sizingMode === "fixed-risk"
    || draft.sizingMode === "equity-fraction-risk";

  return (
    <section className="border-t bg-muted/5">
      <header className="border-b px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Trade path & capital simulator
            </div>
            <h3 className="mt-1 text-base font-semibold">
              {row.trial} · {row.chart} chart · {horizonLabel(row.exitMinutes)} forced exit
            </h3>
            <p className="mt-1 max-w-4xl text-xs leading-relaxed text-muted-foreground">
              Each point is realized equity after an exact chronological holdout trade exits.
              Entries and exits use observed OHLCV bar opens; they are not reconstructed
              executable fills. One position is allowed at a time.
            </p>
          </div>
          {result ? (
            <div className="text-right text-[11px] text-muted-foreground">
              <div className="font-mono font-semibold text-foreground">
                {formatUtc(result.period.scoredStartAtMs)} UTC
              </div>
              <div>through {formatUtc(result.period.scoredEndAtMs)} UTC</div>
              <div>
                source tape {formatUtc(result.period.sourceStartAtMs)}–{
                  formatUtc(result.period.sourceEndAtMs)
                } UTC
              </div>
            </div>
          ) : null}
        </div>
      </header>

      <div className="grid gap-3 border-b p-4 sm:grid-cols-2 xl:grid-cols-5">
        <NumberControl
          label="Starting equity"
          value={draft.initialCapitalUsd}
          prefix="$"
          min={100}
          step={1_000}
          onChange={(value) => setNumber("initialCapitalUsd", value)}
        />
        <FilterSelect
          label="Position sizing"
          value={draft.sizingMode}
          onChange={(value) => setDraft((current) => ({
            ...current,
            sizingMode: value as CapitalAssumptions["sizingMode"],
          }))}
          options={[
            ["fixed-notional", "Fixed trade notional ($)"],
            ["equity-fraction-notional", "Equity share as notional (%)"],
            ["fixed-risk", "Fixed planned risk ($)"],
            ["equity-fraction-risk", "Equity share at risk (%)"],
          ]}
        />
        <NumberControl
          label={sizingIsRisk
            ? `Planned risk ${sizingIsPercent ? "(%)" : "($)"}`
            : `Trade notional ${sizingIsPercent ? "(%)" : "($)"}`}
          value={draft.sizingValue}
          prefix={sizingIsPercent ? undefined : "$"}
          suffix={sizingIsPercent ? "%" : undefined}
          min={0.01}
          max={sizingIsPercent ? 100 : undefined}
          step={sizingIsPercent ? 0.25 : 100}
          onChange={(value) => setNumber("sizingValue", value)}
        />
        <NumberControl
          label="Leverage"
          value={draft.leverage}
          suffix="×"
          min={1}
          max={50}
          step={1}
          onChange={(value) => setNumber("leverage", value)}
        />
        <NumberControl
          label="Planned loss of notional"
          value={draft.plannedLossPct}
          suffix="%"
          min={0.01}
          max={100}
          step={0.25}
          onChange={(value) => setNumber("plannedLossPct", value)}
        />
        <NumberControl
          label="HL taker fee / side"
          value={draft.takerFeeBpsPerSide}
          suffix="bps"
          min={0}
          max={100}
          step={0.1}
          onChange={(value) => setNumber("takerFeeBpsPerSide", value)}
        />
        <NumberControl
          label="Slippage / side"
          value={draft.slippageBpsPerSide}
          suffix="bps"
          min={0}
          max={100}
          step={0.1}
          onChange={(value) => setNumber("slippageBpsPerSide", value)}
        />
        <NumberControl
          label="Funding / day"
          value={draft.fundingBpsPerDay}
          suffix="bps"
          min={-1_000}
          max={1_000}
          step={0.1}
          onChange={(value) => setNumber("fundingBpsPerDay", value)}
        />
        <label className="flex h-full min-h-16 items-center gap-2 rounded-md border bg-background px-3">
          <input
            type="checkbox"
            checked={draft.compoundSizing}
            onChange={(event) => setDraft((current) => ({
              ...current,
              compoundSizing: event.target.checked,
            }))}
          />
          <span>
            <span className="block text-xs font-semibold">Compound sizing</span>
            <span className="block text-[10px] text-muted-foreground">
              Recalculate percentage sizing from realized equity
            </span>
          </span>
        </label>
        <button
          type="button"
          onClick={() => {
            setAssumptions(draft);
            setPage(1);
          }}
          className="min-h-16 rounded-md border bg-foreground px-4 text-xs font-semibold text-background hover:opacity-90"
        >
          Run capital simulation
        </button>
      </div>

      <div className="border-b bg-warning/5 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground">Execution cost model:</span>{" "}
        Hyperliquid base tier-0 perpetual taker fee is modeled at 4.5 bps on entry and on
        exit notional. The default adds 0.5 bps slippage per side. Funding is charged
        pro rata for the hold and defaults to zero because OHLCV contains no historical
        funding series.{" "}
        <a
          href="https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-foreground underline underline-offset-2"
        >
          Hyperliquid fee schedule
        </a>
        . Risk sizing is a notional-sizing model only; no stop is simulated, so realized
        loss can exceed planned risk.
      </div>

      {simulation.isLoading ? (
        <div className="p-10 text-center text-sm text-muted-foreground">
          Replaying the frozen trade ledger…
        </div>
      ) : simulation.error ? (
        <div className="p-6 text-sm text-destructive">
          {simulation.error.message}
        </div>
      ) : result ? (
        <>
          <SimulationSummary result={result} />
          <div className="border-b p-4">
            <div className="mb-3">
              <h4 className="text-sm font-semibold">Realized equity path</h4>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Starts at {compactUsd(result.summary.startingCapitalUsd)} on the first
                eligible entry and marks equity only when a position exits. Hover or scrub
                to inspect the path.
              </p>
            </div>
            <TimeSeriesChart
              points={result.equityCurve.map((point) => ({
                t: point.atMs,
                v: point.equityUsd,
              }))}
              money
              height={240}
            />
          </div>
          <HistoricalTradeLedger
            result={result}
            page={page}
            onPage={setPage}
          />
        </>
      ) : null}
    </section>
  );
}

function SimulationSummary({ result }: { result: HistoricalCapitalSimulation }) {
  const summary = result.summary;
  const cells = [
    ["Starting equity", compactUsd(summary.startingCapitalUsd), "User-selected initial balance"],
    ["Ending equity", compactUsd(summary.finalEquityUsd), `${summary.totalReturnPct >= 0 ? "+" : ""}${summary.totalReturnPct.toFixed(2)}% return`],
    ["Realized P&L", compactUsd(summary.totalPnlUsd), `${summary.executedTrades.toLocaleString()} executed trades`],
    ["Maximum drawdown", compactUsd(-summary.maximumDrawdownUsd), `${summary.maximumDrawdownPct.toFixed(2)}% from realized peak`],
    ["Win rate", formatPercent(summary.winRate), `${summary.wins} wins · ${summary.losses} losses · ${summary.flats} flat`],
    ["Average notional", compactUsd(summary.averageNotionalUsd), `${compactUsd(summary.maximumCapitalReservedUsd)} max margin reserved`],
    ["Profit factor", summary.profitFactor == null ? "n/a" : summary.profitFactor.toFixed(2), `${compactUsd(summary.largestWinUsd)} best · ${compactUsd(summary.largestLossUsd)} worst`],
    ["Risk breaches", summary.riskBreaches.toLocaleString(), "Realized loss exceeded planned risk"],
  ];
  return (
    <div className="grid border-b sm:grid-cols-2 lg:grid-cols-4">
      {cells.map(([label, value, note]) => (
        <article key={label} className="border-b p-4 last:border-b-0 sm:border-r lg:[&:nth-last-child(-n+4)]:border-b-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {label}
          </div>
          <div className="mt-2 font-mono text-xl font-semibold">{value}</div>
          <p className="mt-1 text-[10px] text-muted-foreground">{note}</p>
        </article>
      ))}
    </div>
  );
}

function HistoricalTradeLedger({
  result,
  page,
  onPage,
}: {
  result: HistoricalCapitalSimulation;
  page: number;
  onPage: (page: number) => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h4 className="text-sm font-semibold">Exact simulated trades</h4>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            UTC entry and exit clocks, observed prices, modeled costs, and realized equity.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPage(Math.max(1, page - 1))}
            className="rounded border px-2.5 py-1.5 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="font-mono text-muted-foreground">
            {page}/{result.trades.pages} · {result.trades.total} trades
          </span>
          <button
            type="button"
            disabled={page >= result.trades.pages}
            onClick={() => onPage(Math.min(result.trades.pages, page + 1))}
            className="rounded border px-2.5 py-1.5 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
      <div className="max-h-[34rem] overflow-auto">
        <table className="w-full min-w-[1480px] text-xs tabular-nums">
          <thead className="sticky top-0 z-10 border-b bg-card text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            <tr>
              {[
                "#",
                "Entry UTC",
                "Exit UTC",
                "Entry price",
                "Exit price",
                "Notional",
                "Planned risk",
                "Gross return",
                "Fees + slippage",
                "Funding",
                "Net return",
                "P&L",
                "Equity after",
              ].map((label) => (
                <th key={label} className="px-4 py-2 text-right first:text-left">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {result.trades.rows.map((trade) => (
              <tr key={trade.sequence} className="hover:bg-muted/10">
                <td className="px-4 py-2.5 font-mono">{trade.sequence}</td>
                <td className="px-4 py-2.5 text-right font-mono">{formatUtc(trade.entryAtMs)}</td>
                <td className="px-4 py-2.5 text-right font-mono">{formatUtc(trade.exitAtMs)}</td>
                <td className="px-4 py-2.5 text-right font-mono">${trade.entryPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                <td className="px-4 py-2.5 text-right font-mono">${trade.exitPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                <td className="px-4 py-2.5 text-right font-mono">{compactUsd(trade.notionalUsd)}</td>
                <td className="px-4 py-2.5 text-right font-mono">
                  {compactUsd(trade.plannedRiskUsd)}
                  {trade.riskBreached ? (
                    <span className="ml-1 text-[9px] font-semibold text-warning">breached</span>
                  ) : null}
                </td>
                <td className={`px-4 py-2.5 text-right font-mono ${trade.grossReturnBps >= 0 ? "text-success" : "text-destructive"}`}>
                  {formatBps(trade.grossReturnBps)}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-destructive">
                  -{compactUsd(trade.tradingCostUsd)}
                </td>
                <td className={`px-4 py-2.5 text-right font-mono ${trade.fundingCostUsd <= 0 ? "text-success" : "text-destructive"}`}>
                  {trade.fundingCostUsd === 0
                    ? "$0"
                    : `${trade.fundingCostUsd > 0 ? "-" : "+"}${compactUsd(Math.abs(trade.fundingCostUsd))}`}
                </td>
                <td className={`px-4 py-2.5 text-right font-mono ${trade.netReturnBps >= 0 ? "text-success" : "text-destructive"}`}>
                  {formatBps(trade.netReturnBps)}
                </td>
                <td className={`px-4 py-2.5 text-right font-mono font-semibold ${trade.pnlUsd >= 0 ? "text-success" : "text-destructive"}`}>
                  {compactUsd(trade.pnlUsd)}
                </td>
                <td className="px-4 py-2.5 text-right font-mono font-semibold">
                  {compactUsd(trade.equityAfterUsd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NumberControl({
  label,
  value,
  prefix,
  suffix,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="flex h-9 items-center rounded-md border bg-background px-2.5">
        {prefix ? <span className="mr-1 text-xs text-muted-foreground">{prefix}</span> : null}
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none"
        />
        {suffix ? <span className="ml-1 text-xs text-muted-foreground">{suffix}</span> : null}
      </span>
    </label>
  );
}

export function FormulaCalendarPeriodExplorer({ data }: { data: CalendarData }) {
  const calendar = data;
  const chartOptions = [...new Set(
    calendar.experiments.map((experiment) => experiment.chartIntervalMinutes),
  )].sort((a, b) => a - b);
  const [chartMinutes, setChartMinutes] = useState<number>(chartOptions[0] ?? 5);
  const experiments = calendar.experiments.filter(
    (experiment) => experiment.chartIntervalMinutes === chartMinutes,
  );
  const holdOptions = [...new Set(experiments.map((experiment) => experiment.holdMinutes))]
    .sort((a, b) => a - b);
  const [holdMinutes, setHoldMinutes] = useState<number>(holdOptions[0] ?? 10);
  const selectedExperiment =
    experiments.find((experiment) => experiment.holdMinutes === holdMinutes)
    ?? experiments[0]
    ?? null;
  const trialOptions = selectedExperiment?.trials ?? [];
  const [trialId, setTrialId] = useState("always-short-control");
  const selectedTrial =
    trialOptions.find((trial) => trial.id === trialId)
    ?? trialOptions[0]
    ?? null;
  const periodOptions = selectedTrial?.periods.map((period) => period.period) ?? [];
  const [selectedPeriod, setSelectedPeriod] = useState("all");
  const [sort, setSort] = useState<SortState<PeriodSortKey>>({
    key: "period",
    direction: "asc",
  });

  const effectiveHold = selectedExperiment?.holdMinutes ?? holdMinutes;
  const effectiveTrialId = selectedTrial?.id ?? trialId;
  const visiblePeriods = stableSortRows(
    (selectedTrial?.periods ?? []).filter(
      (period) => selectedPeriod === "all" || period.period === selectedPeriod,
    ),
    (period) => periodValue(period, sort.key),
    sort.direction,
  );
  const summary = visiblePeriods.reduce(
    (result, period) => ({
      trades: result.trades + period.trades,
      wins: result.wins + period.wins,
      grossWeighted: result.grossWeighted + period.meanGrossBps * period.trades,
      netWeighted: result.netWeighted + period.meanNetBps * period.trades,
      pnl: result.pnl + period.fixedNotionalPnlUsd,
    }),
    { trades: 0, wins: 0, grossWeighted: 0, netWeighted: 0, pnl: 0 },
  );
  const sortPeriods = (
    key: PeriodSortKey,
    initialDirection: "asc" | "desc" = "desc",
  ) => setSort((current) => nextSortState(current, key, initialDirection));

  const chooseChart = (next: number) => {
    setChartMinutes(next);
    const nextExperiment = calendar.experiments
      .filter((experiment) => experiment.chartIntervalMinutes === next)
      .sort((left, right) => left.holdMinutes - right.holdMinutes)[0];
    setHoldMinutes(nextExperiment?.holdMinutes ?? 10);
    setTrialId(nextExperiment?.trials[0]?.id ?? "always-short-control");
    setSelectedPeriod("all");
  };
  const chooseHold = (next: number) => {
    setHoldMinutes(next);
    const nextExperiment = experiments.find((experiment) => experiment.holdMinutes === next);
    if (!nextExperiment?.trials.some((trial) => trial.id === effectiveTrialId)) {
      setTrialId(nextExperiment?.trials[0]?.id ?? "always-short-control");
    }
    setSelectedPeriod("all");
  };

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <header className="border-b px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Calendar backtest explorer
            </div>
            <h2 className="mt-1 text-base font-semibold">
              Albert formula performance by UTC month
            </h2>
            <p className="mt-1 max-w-4xl text-xs leading-relaxed text-muted-foreground">
              These are exact out-of-sample replay trades from the four chronological folds, grouped
              by entry month. Choose the chart, forced exit, formula gate, and one month or the full
              monthly series.
            </p>
          </div>
          <div className="text-right text-[11px] text-muted-foreground">
            <div className="font-mono text-xs text-foreground">
              {calendar.receiptHash.slice(0, 22)}...
            </div>
            <div>{calendar.grouping}</div>
          </div>
        </div>
      </header>

      <div className="grid gap-3 border-b bg-muted/10 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <FilterSelect
          label="Chart"
          value={String(chartMinutes)}
          onChange={(value) => chooseChart(Number(value))}
          options={chartOptions.map((minutes) => [
            String(minutes),
            minutes === 60 ? "1h chart" : `${minutes}m chart`,
          ])}
        />
        <FilterSelect
          label="Forced exit"
          value={String(effectiveHold)}
          onChange={(value) => chooseHold(Number(value))}
          options={holdOptions.map((minutes) => [String(minutes), horizonLabel(minutes)])}
        />
        <FilterSelect
          label="Formula gate"
          value={effectiveTrialId}
          onChange={(value) => {
            setTrialId(value);
            setSelectedPeriod("all");
          }}
          options={trialOptions.map((trial) => [trial.id, trialLabel(trial.id)])}
        />
        <FilterSelect
          label="Time period"
          value={selectedPeriod}
          onChange={setSelectedPeriod}
          options={[
            ["all", "All months"],
            ...periodOptions.map((period) => [period, period] as const),
          ]}
        />
      </div>

      <div className="grid border-b sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["Trades", summary.trades.toLocaleString(), selectedPeriod === "all" ? `${visiblePeriods.length} observed months` : selectedPeriod],
          ["Wins", summary.wins.toLocaleString(), summary.trades ? `${summary.trades - summary.wins} losses` : "No trades"],
          ["Win rate", summary.trades ? formatPercent(summary.wins / summary.trades) : "n/a", "Net return above zero"],
          ["Mean net", summary.trades ? formatBps(summary.netWeighted / summary.trades) : "n/a", `${calendar.roundTripCostBps} bps cost stress included`],
          ["Fixed notional P&L", summary.trades ? formatUsd(summary.pnl) : "n/a", `$${calendar.fixedNotionalUsd.toLocaleString()} per non-overlapping trade`],
        ].map(([label, value, note]) => (
          <article key={label} className="border-b p-4 last:border-b-0 sm:border-r xl:border-b-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {label}
            </div>
            <div className="mt-2 font-mono text-xl font-semibold">{value}</div>
            <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>
          </article>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] text-xs tabular-nums">
          <thead className="border-b bg-muted/20 text-[10px] uppercase tracking-[0.11em] text-muted-foreground">
            <tr>
              <PolymarketSortableHeader column="period" active={sort.key} direction={sort.direction} onSort={sortPeriods} initialDirection="asc">UTC month</PolymarketSortableHeader>
              <PolymarketSortableHeader column="trades" active={sort.key} direction={sort.direction} onSort={sortPeriods} align="right">Trades</PolymarketSortableHeader>
              <PolymarketSortableHeader column="wins" active={sort.key} direction={sort.direction} onSort={sortPeriods} align="right">Wins</PolymarketSortableHeader>
              <PolymarketSortableHeader column="losses" active={sort.key} direction={sort.direction} onSort={sortPeriods} align="right">Losses</PolymarketSortableHeader>
              <PolymarketSortableHeader column="hitRate" active={sort.key} direction={sort.direction} onSort={sortPeriods} align="right">Win rate</PolymarketSortableHeader>
              <PolymarketSortableHeader column="gross" active={sort.key} direction={sort.direction} onSort={sortPeriods} align="right">Gross mean</PolymarketSortableHeader>
              <PolymarketSortableHeader column="net" active={sort.key} direction={sort.direction} onSort={sortPeriods} align="right">Net mean</PolymarketSortableHeader>
              <PolymarketSortableHeader column="totalNet" active={sort.key} direction={sort.direction} onSort={sortPeriods} align="right">Net total</PolymarketSortableHeader>
              <PolymarketSortableHeader column="pnl" active={sort.key} direction={sort.direction} onSort={sortPeriods} align="right">Fixed P&L</PolymarketSortableHeader>
            </tr>
          </thead>
          <tbody className="divide-y">
            {visiblePeriods.map((period) => (
              <tr key={period.period} className="hover:bg-muted/10">
                <td className="px-4 py-3 font-mono font-medium">{period.period}</td>
                <td className="px-4 py-3 text-right font-mono">{period.trades.toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-mono text-success">{period.wins.toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-mono text-destructive">{period.losses.toLocaleString()}</td>
                <td className={`px-4 py-3 text-right font-mono font-semibold ${
                  period.hitRate >= 0.5 ? "text-success" : "text-destructive"
                }`}>{formatPercent(period.hitRate)}</td>
                <td className={`px-4 py-3 text-right font-mono ${
                  period.meanGrossBps > 0 ? "text-success" : "text-destructive"
                }`}>{formatBps(period.meanGrossBps)}</td>
                <td className={`px-4 py-3 text-right font-mono ${
                  period.meanNetBps > 0 ? "text-success" : "text-destructive"
                }`}>{formatBps(period.meanNetBps)}</td>
                <td className={`px-4 py-3 text-right font-mono ${
                  period.totalNetBps > 0 ? "text-success" : "text-destructive"
                }`}>{formatBps(period.totalNetBps)}</td>
                <td className={`px-4 py-3 text-right font-mono font-semibold ${
                  period.fixedNotionalPnlUsd > 0 ? "text-success" : "text-destructive"
                }`}>{formatUsd(period.fixedNotionalPnlUsd)}</td>
              </tr>
            ))}
            {!visiblePeriods.length ? (
              <tr>
                <td colSpan={9} className="p-10 text-center text-sm text-muted-foreground">
                  This formula gate produced no out-of-sample trades in the selected period.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="border-t px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
        Months before the first holdout fold are intentionally absent because they were training
        history. Fixed P&L uses the frozen $1,000 notional per non-overlapping trade and is an
        illustration, not an executable fill reconstruction.
      </p>
    </section>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly (readonly [string, string])[];
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-md border bg-background px-2.5 text-xs outline-none focus:border-foreground/40"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </label>
  );
}
