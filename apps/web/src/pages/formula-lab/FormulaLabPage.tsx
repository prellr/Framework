import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { RouterOutput } from "@framework/api/router";
import {
  ArrowLeft,
  Binary,
  Boxes,
  Braces,
  Clock3,
  Cpu,
  Database,
  Eye,
  FlaskConical,
  Layers3,
  Lock,
  Route,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import {
  nextSortState,
  PolymarketSortableHeader,
  stableSortRows,
  type SortState,
  type SortValue,
} from "@/pages/polymarket/PolymarketSortableHeader";
import { FormulaExpressionTree } from "./FormulaExpressionTree";
import { LegacyFormulaExpressionTree } from "./LegacyFormulaExpressionTree";

type FormulaLab = RouterOutput["formulaLab"]["status"];
type VenuePreview = RouterOutput["formulaLab"]["venuePreview"];
type Candidate = FormulaLab["candidates"][number];
type Fold = FormulaLab["proof"]["folds"][number];
type VenueTrial = VenuePreview["trials"][number];
type HistoricalTrial = FormulaLab["historicalReplay"]["trials"][number];
type FormulaOperator = FormulaLab["operatorCatalog"]["operators"][number];
type CandidateSortKey = "id" | "formula" | "threshold" | "complexity";
type OperatorSortKey =
  | "label"
  | "category"
  | "state"
  | "arity"
  | "lookback"
  | "cost";
type FoldSortKey =
  | "fold"
  | "selected"
  | "train"
  | "test"
  | "trainingTrades"
  | "trainingLcb"
  | "testTrades"
  | "testMean"
  | "hitRate";
type VenueSortKey =
  | "pair"
  | "trial"
  | "frames"
  | "trades"
  | "positiveFolds"
  | "grossMean"
  | "netMean"
  | "hitRate";
type HistoricalSortKey =
  | "trial"
  | "status"
  | "trades"
  | "gross"
  | "net"
  | "hitRate"
  | "positiveFolds"
  | "worstFold"
  | "finalEquity";

const bps = (value: number | null) =>
  value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)} bps`;
const pct = (value: number | null) =>
  value == null ? "—" : `${(value * 100).toFixed(0)}%`;

function candidateValue(row: Candidate, key: CandidateSortKey): SortValue {
  switch (key) {
    case "id": return row.id;
    case "formula": return row.formula;
    case "threshold": return row.thresholdZ;
    case "complexity": return row.complexity;
  }
}

function foldValue(row: Fold, key: FoldSortKey): SortValue {
  switch (key) {
    case "fold": return row.fold;
    case "selected": return row.selectedCandidateId;
    case "train": return row.trainPoints;
    case "test": return row.testPoints;
    case "trainingTrades": return row.trainingTrades;
    case "trainingLcb": return row.trainingLowerConfidenceBoundBps;
    case "testTrades": return row.testTrades;
    case "testMean": return row.testMeanNetBps;
    case "hitRate": return row.testHitRate;
  }
}

function venueValue(row: VenueTrial, key: VenueSortKey): SortValue {
  switch (key) {
    case "pair": return row.pair;
    case "trial": return row.candidateId;
    case "frames": return row.frames;
    case "trades": return row.trades;
    case "positiveFolds": return row.positiveFolds;
    case "grossMean": return row.meanGrossBps;
    case "netMean": return row.meanNetBps;
    case "hitRate": return row.hitRate;
  }
}

function historicalValue(row: HistoricalTrial, key: HistoricalSortKey): SortValue {
  switch (key) {
    case "trial": return row.id;
    case "status": return row.available ? 1 : 0;
    case "trades": return row.trades;
    case "gross": return row.meanGrossBps;
    case "net": return row.meanNetBps;
    case "hitRate": return row.hitRate;
    case "positiveFolds": return row.positiveFolds;
    case "worstFold": return row.worstFoldMeanNetBps;
    case "finalEquity": return row.finalEquityUsd;
  }
}

function operatorValue(row: FormulaOperator, key: OperatorSortKey): SortValue {
  switch (key) {
    case "label": return row.label;
    case "category": return row.category;
    case "state": return row.state;
    case "arity": return row.arity;
    case "lookback": return row.lookback;
    case "cost": return row.computeCost;
  }
}

function Metric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Binary;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card className="shadow-none">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className="h-4 w-4" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em]">{label}</span>
        </div>
        <div className="mt-3 font-mono text-xl font-semibold">{value}</div>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

export function FormulaLabPage() {
  const lab = trpc.formulaLab.status.useQuery(undefined, {
    staleTime: Number.POSITIVE_INFINITY,
  });
  const basis = trpc.polymarket.resolutionSourceBasisDistributionAudit.useQuery(undefined, {
    staleTime: 15 * 60_000,
    refetchInterval: 15 * 60_000,
  });
  const venuePreview = trpc.formulaLab.venuePreview.useQuery(undefined, {
    staleTime: Number.POSITIVE_INFINITY,
  });
  const scaleStatus = trpc.formulaLab.scaleStatus.useQuery(undefined, {
    staleTime: Number.POSITIVE_INFINITY,
  });
  const controlPlaneStatus = trpc.formulaLab.controlPlaneStatus.useQuery(undefined, {
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const [candidateSort, setCandidateSort] = useState<SortState<CandidateSortKey>>({
    key: "complexity",
    direction: "asc",
  });
  const [foldSort, setFoldSort] = useState<SortState<FoldSortKey>>({
    key: "fold",
    direction: "asc",
  });
  const [venueSort, setVenueSort] = useState<SortState<VenueSortKey>>({
    key: "pair",
    direction: "asc",
  });
  const [historicalSort, setHistoricalSort] = useState<SortState<HistoricalSortKey>>({
    key: "net",
    direction: "desc",
  });
  const [operatorSort, setOperatorSort] = useState<SortState<OperatorSortKey>>({
    key: "state",
    direction: "asc",
  });
  const [operatorState, setOperatorState] = useState<
    "all" | FormulaOperator["state"]
  >("all");
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const candidates = useMemo(
    () =>
      stableSortRows(
        lab.data?.candidates ?? [],
        (row) => candidateValue(row, candidateSort.key),
        candidateSort.direction,
      ),
    [candidateSort, lab.data],
  );
  const folds = useMemo(
    () =>
      stableSortRows(
        lab.data?.proof.folds ?? [],
        (row) => foldValue(row, foldSort.key),
        foldSort.direction,
      ),
    [foldSort, lab.data],
  );
  const venueTrials = useMemo(
    () =>
      stableSortRows(
        venuePreview.data?.trials ?? [],
        (row) => venueValue(row, venueSort.key),
        venueSort.direction,
      ),
    [venuePreview.data, venueSort],
  );
  const historicalTrials = useMemo(
    () =>
      stableSortRows(
        lab.data?.historicalReplay.trials ?? [],
        (row) => historicalValue(row, historicalSort.key),
        historicalSort.direction,
      ),
    [historicalSort, lab.data],
  );
  const operators = useMemo(
    () =>
      stableSortRows(
        (lab.data?.operatorCatalog.operators ?? []).filter(
          (operator) => operatorState === "all" || operator.state === operatorState,
        ),
        (row) => operatorValue(row, operatorSort.key),
        operatorSort.direction,
      ),
    [lab.data, operatorSort, operatorState],
  );
  const selectedCandidate =
    candidates.find((candidate) => candidate.id === selectedCandidateId)
    ?? candidates[0]
    ?? null;

  if (lab.isLoading) {
    return <div className="h-96 animate-pulse rounded-xl bg-muted/50" />;
  }
  if (lab.isError || !lab.data) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm">
        Formula Lab’s static research contract is unavailable. No substitute result is shown.
      </div>
    );
  }

  const data = lab.data;
  const weakest = basis.data
    ? {
        rows: Math.min(...basis.data.tape.pairs.map((pair) => pair.rows)),
        blocks: Math.min(...basis.data.tape.pairs.map((pair) => pair.blocks)),
        spanDays: Math.min(...basis.data.tape.pairs.map((pair) => pair.spanDays)),
      }
    : null;
  const sortCandidates = (
    key: CandidateSortKey,
    initialDirection: "asc" | "desc" = "asc",
  ) => setCandidateSort((current) => nextSortState(current, key, initialDirection));
  const sortFolds = (
    key: FoldSortKey,
    initialDirection: "asc" | "desc" = "asc",
  ) => setFoldSort((current) => nextSortState(current, key, initialDirection));
  const sortVenue = (
    key: VenueSortKey,
    initialDirection: "asc" | "desc" = "asc",
  ) => setVenueSort((current) => nextSortState(current, key, initialDirection));
  const sortHistorical = (
    key: HistoricalSortKey,
    initialDirection: "asc" | "desc" = "asc",
  ) => setHistoricalSort((current) => nextSortState(current, key, initialDirection));
  const sortOperators = (
    key: OperatorSortKey,
    initialDirection: "asc" | "desc" = "asc",
  ) => setOperatorSort((current) => nextSortState(current, key, initialDirection));
  const availableVenueTrials =
    venuePreview.data?.trials.filter((trial) => trial.available) ?? [];
  const unavailableVenueTrials =
    (venuePreview.data?.trials.length ?? 0) - availableVenueTrials.length;
  const venueTrades = availableVenueTrials.reduce(
    (sum, trial) => sum + trial.trades,
    0,
  );

  return (
    <div className="space-y-5">
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Alchemy overview
      </Link>

      <PageHeader
        title="Formula Lab"
        subtitle="Alchemy’s venue-neutral algebraic hypothesis engine: causal source adapters in, bounded formulas and fixed-horizon labels through the middle, separately costed target adapters out."
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-xs font-medium text-warning">
            <Lock className="h-3.5 w-3.5" />
            research only · adapters locked
          </span>
        }
      />

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric
          icon={Braces}
          label="Declared trials"
          value={data.candidates.length.toLocaleString()}
          detail="Eleven expressions × three z-score thresholds. Every attempt stays in the denominator."
        />
        <Metric
          icon={Clock3}
          label="Fixed label"
          value={`${data.target.holdSeconds / 60} minutes`}
          detail="Short-underlying return at the exact horizon; no overlapping position is permitted."
        />
        <Metric
          icon={Route}
          label="Walk-forward proof"
          value={`${data.proof.aggregate.positiveFolds}/${data.proof.aggregate.folds} folds`}
          detail="Intentionally planted synthetic signal used only to prove chronology, selection, and purging."
        />
        <Metric
          icon={ShieldCheck}
          label="First source matrix"
          value={basis.data?.report ? "unlocked" : weakest ? `${Math.floor(Math.min(1, weakest.spanDays / (basis.data?.tape.minimumSpanDays ?? 3)) * 100)}%` : "—"}
          detail={
            weakest && basis.data
              ? `Chainlink × Hyperliquid prerequisite, weakest pair: ${weakest.rows.toLocaleString()}/${basis.data.tape.minimumRows.toLocaleString()} rows · ${weakest.blocks}/${basis.data.tape.minimumBlocks} blocks · ${weakest.spanDays.toFixed(2)}/${basis.data.tape.minimumSpanDays}d.`
              : "Venue-tape readiness unavailable; all market adapters remain locked."
          }
        />
      </section>

      <section className="rounded-xl border border-warning/25 bg-warning/5 px-4 py-3">
        <div className="flex gap-3">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="space-y-1 text-sm">
            <p className="font-medium">What this proves—and what it does not</p>
            <p className="max-w-5xl text-muted-foreground">
              The green synthetic folds show that the evaluator can recover a deliberately planted
              relationship without using future rows in selection. They are not evidence of crypto
              predictability, expected return, or a profitable trade on any venue. The separate
              venue-tape preview below reads only a frozen public price cut; neither endpoint can
              reach a paper result, Polymarket outcome, account, strategy registry, or execution
              path.
            </p>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border bg-card">
        <header className="border-b px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Experiment mechanics
              </div>
              <h2 className="mt-1 text-base font-semibold">
                Configurable candidate-budget plan
              </h2>
              <p className="mt-1 max-w-4xl text-xs leading-relaxed text-muted-foreground">
                One immutable candidate manifest is materialized once, crossed with target
                adapters, and evaluated in bounded local shards. The displayed 10,000-variant
                manifest is a capacity example, not a required experiment size. Discovery may rank
                formulas, but only a frozen selection behind a new untouched boundary may enter
                validation.
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-success/30 bg-success/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-success">
              <ShieldCheck className="h-3.5 w-3.5" />
              mechanics verified
            </span>
          </div>
        </header>

        {scaleStatus.isLoading ? (
          <div className="h-48 animate-pulse bg-muted/20" />
        ) : scaleStatus.isError || !scaleStatus.data ? (
          <div className="px-4 py-6 text-sm text-destructive">
            The scale-engine contract is unavailable. No capacity estimate is substituted.
          </div>
        ) : (
          <>
            <div className="grid border-b sm:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  icon: Braces,
                  label: "Variants",
                  value: scaleStatus.data.manifest.variants.toLocaleString(),
                  detail: `Unique formula × threshold definitions · manifest ${scaleStatus.data.manifest.hash.slice(0, 10)}…`,
                },
                {
                  icon: Layers3,
                  label: "Evaluation units",
                  value: scaleStatus.data.plan.evaluationUnits.toLocaleString(),
                  detail: `${scaleStatus.data.plan.targetCount} assets × ${scaleStatus.data.manifest.variants.toLocaleString()} variants; every unit remains in the trial family.`,
                },
                {
                  icon: Boxes,
                  label: "Bounded shards",
                  value: scaleStatus.data.plan.shardCount.toLocaleString(),
                  detail: `${scaleStatus.data.plan.shardSize} variants each · ${scaleStatus.data.plan.shardsPerTarget} shards per target; no query-per-formula fan-out.`,
                },
                {
                  icon: WalletCards,
                  label: "Sizing models",
                  value: scaleStatus.data.capital.sizingModes.length.toLocaleString(),
                  detail: "Fixed or equity-relative notional, plus fixed or equity-relative true risk.",
                },
              ].map((metric) => (
                <article
                  key={metric.label}
                  className="border-b p-4 last:border-b-0 sm:border-r sm:last:border-r-0 xl:border-b-0"
                >
                  <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    <metric.icon className="h-3.5 w-3.5" />
                    {metric.label}
                  </div>
                  <div className="mt-2 font-mono text-xl font-semibold">{metric.value}</div>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {metric.detail}
                  </p>
                </article>
              ))}
            </div>

            <div className="grid lg:grid-cols-2">
              <article className="border-b p-4 lg:border-b-0 lg:border-r">
                <div className="flex items-center gap-2">
                  <WalletCards className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">Capital and risk path</h3>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Starting funds, compounding, per-trade sizing, exposure, concurrency, and
                  liquidation are separate from signal scoring. “Risk” is maximum planned dollar
                  loss supplied by the target adapter—not a synonym for notional.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {scaleStatus.data.capital.sizingModes.map((mode) => (
                    <div key={mode.mode} className="rounded-md border px-3 py-2">
                      <div className="text-xs font-medium">{mode.label}</div>
                      <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                        {mode.definition}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 rounded-md bg-muted/25 px-3 py-2 font-mono text-[11px] text-muted-foreground">
                  Default paper template · $
                  {scaleStatus.data.capital.defaultPaperTemplate.initialCapitalUsd.toLocaleString()}
                  {" "}start · $
                  {scaleStatus.data.capital.defaultPaperTemplate.sizing.riskUsd.toLocaleString()}
                  {" "}risk/trade · {scaleStatus.data.capital.defaultPaperTemplate.maximumConcurrentPositions} max concurrent
                </div>
              </article>

              <article className="p-4">
                <div className="flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">Load and research controls</h3>
                </div>
                <div className="mt-3 space-y-3 text-xs leading-relaxed text-muted-foreground">
                  <p>
                    Candidate count is chosen per experiment within the declared safety cap. The
                    current local benchmark happens to evaluate 10,000 variants across 1,440
                    synthetic frames in 40 shards for one target; it never touches production
                    collectors.
                  </p>
                  <p>
                    At a nominal 5% threshold, this {scaleStatus.data.plan.discoveryTrials.toLocaleString()}-test
                    discovery family would be expected to manufacture roughly{" "}
                    {scaleStatus.data.plan.expectedFalsePositivesAtNominalFivePercent.toLocaleString()} false
                    positives under the global null. Discovery ranking is therefore explicitly not
                    evidence.
                  </p>
                  <p>
                    {scaleStatus.data.persistence.detail}
                  </p>
                  {controlPlaneStatus.data ? (
                    <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted/15 p-3 font-mono text-[10px] sm:grid-cols-4">
                      <div>
                        <div className="uppercase tracking-wide text-muted-foreground">Protocol</div>
                        <div className="mt-1 text-foreground">{controlPlaneStatus.data.protocolVersion}</div>
                      </div>
                      <div>
                        <div className="uppercase tracking-wide text-muted-foreground">Transport</div>
                        <div className="mt-1 text-foreground">{controlPlaneStatus.data.transport}</div>
                      </div>
                      <div>
                        <div className="uppercase tracking-wide text-muted-foreground">Experiments</div>
                        <div className="mt-1 text-foreground">
                          {Object.values(controlPlaneStatus.data.experiments).reduce((sum, value) => sum + value, 0)}
                        </div>
                      </div>
                      <div>
                        <div className="uppercase tracking-wide text-muted-foreground">Shards</div>
                        <div className="mt-1 text-foreground">
                          {Object.values(controlPlaneStatus.data.shards).reduce((sum, value) => sum + value, 0)}
                        </div>
                      </div>
                    </div>
                  ) : controlPlaneStatus.isError ? (
                    <p className="text-destructive">
                      Durable control-plane status is unavailable; no fallback state is shown.
                    </p>
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-wide">
                  <span className="rounded border px-2 py-1">immutable manifest</span>
                  <span className="rounded border px-2 py-1">future boundary</span>
                  <span className="rounded border px-2 py-1">Holm validation</span>
                  <span className="rounded border px-2 py-1">execution unavailable</span>
                </div>
              </article>
            </div>
          </>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border bg-card">
        <header className="border-b px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Governed expression vocabulary
              </div>
              <h2 className="mt-1 text-base font-semibold">Operator catalog</h2>
              <p className="mt-1 max-w-4xl text-xs leading-relaxed text-muted-foreground">
                Every operator has declared arity, lookback, unit behavior, numerical guards, and
                compute cost. Only active-search rows are reachable by today’s generator.
                Import-evaluator rows support pinned historical replay; candidates are proposals,
                not silent grammar changes.
              </p>
            </div>
            <span className="rounded-md border px-2 py-1 font-mono text-[10px] text-muted-foreground">
              {data.operatorCatalog.version}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {([
              ["all", "All", data.operatorCatalog.counts.total],
              ["active-search", "Active", data.operatorCatalog.counts.activeSearch],
              ["import-evaluator", "Import", data.operatorCatalog.counts.importEvaluator],
              ["candidate", "Candidates", data.operatorCatalog.counts.candidate],
              ["excluded", "Excluded", data.operatorCatalog.counts.excluded],
            ] as const).map(([state, label, count]) => (
              <button
                key={state}
                type="button"
                onClick={() => setOperatorState(state)}
                aria-pressed={operatorState === state}
                className="rounded-md border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground"
              >
                {label} <span className="font-mono">{count}</span>
              </button>
            ))}
          </div>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-sm">
            <thead className="border-b bg-muted/20 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <PolymarketSortableHeader column="label" active={operatorSort.key} direction={operatorSort.direction} onSort={sortOperators}>Operator</PolymarketSortableHeader>
                <PolymarketSortableHeader column="category" active={operatorSort.key} direction={operatorSort.direction} onSort={sortOperators}>Category</PolymarketSortableHeader>
                <PolymarketSortableHeader column="state" active={operatorSort.key} direction={operatorSort.direction} onSort={sortOperators}>Admission</PolymarketSortableHeader>
                <PolymarketSortableHeader column="arity" active={operatorSort.key} direction={operatorSort.direction} onSort={sortOperators} align="right">Arity</PolymarketSortableHeader>
                <PolymarketSortableHeader column="lookback" active={operatorSort.key} direction={operatorSort.direction} onSort={sortOperators}>Lookback</PolymarketSortableHeader>
                <PolymarketSortableHeader column="cost" active={operatorSort.key} direction={operatorSort.direction} onSort={sortOperators}>Compute</PolymarketSortableHeader>
                <th className="px-4 py-3 text-left">Contract</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {operators.map((operator) => (
                <tr key={operator.id} className="align-top hover:bg-muted/10">
                  <td className="px-4 py-3">
                    <div className="font-medium">{operator.label}</div>
                    <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                      {operator.id}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs capitalize text-muted-foreground">
                    {operator.category.replace("-", " ")}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      operator.state === "active-search"
                        ? "border-success/30 bg-success/10 text-success"
                        : operator.state === "import-evaluator"
                          ? "border-primary/30 bg-primary/10 text-primary"
                          : operator.state === "excluded"
                            ? "border-destructive/30 bg-destructive/10 text-destructive"
                            : "border-warning/30 bg-warning/10 text-warning"
                    }`}>
                      {operator.state.replace("-", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{operator.arity}</td>
                  <td className="px-4 py-3 text-xs capitalize text-muted-foreground">
                    {operator.lookback}
                    {operator.parameters.length > 0 ? (
                      <div className="mt-1 font-mono text-[10px] normal-case">
                        {operator.parameters.map((parameter) =>
                          `${parameter.name} ${parameter.minimum}–${parameter.maximum}`,
                        ).join(" · ")}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {operator.computeCost.replace("-", " ")}
                  </td>
                  <td className="max-w-md px-4 py-3">
                    <div className="text-xs">{operator.description}</div>
                    <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                      {operator.guard} · {operator.unitRule}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
          Candidate count is an experiment budget, not an operator property. Small smoke tests and
          large distributed searches use the same immutable grammar/version contract and retain
          every attempted formula in the denominator.
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border bg-card">
        <header className="border-b px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Frozen real-data preview
              </div>
              <h2 className="mt-1 text-base font-semibold">
                Chainlink features → 10-minute Hyperliquid short
              </h2>
              <p className="mt-1 max-w-4xl text-xs leading-relaxed text-muted-foreground">
                Five predeclared formulas are assessed independently on four purged chronological
                folds. Entry and exit use Hyperliquid midpoint observations exactly ten minutes
                apart, then subtract a fixed {venuePreview.data?.target.roundTripCostBps ?? 10} bps
                round-trip stress. Midpoints are not executable fills.
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-warning">
              <Lock className="h-3.5 w-3.5" />
              retrospective · no winner
            </span>
          </div>
        </header>

        {venuePreview.isLoading ? (
          <div className="h-48 animate-pulse bg-muted/20" />
        ) : venuePreview.isError || !venuePreview.data ? (
          <div className="px-4 py-6 text-sm text-destructive">
            The frozen venue preview is unavailable. No fallback or synthetic substitute is shown.
          </div>
        ) : (
          <>
            <div className="grid border-b sm:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  label: "Complete frames",
                  value: venuePreview.data.frames.toLocaleString(),
                  detail: "One causal paired observation per usable UTC minute.",
                },
                {
                  label: "Usable tests",
                  value: `${availableVenueTrials.length}/${venuePreview.data.trials.length}`,
                  detail: unavailableVenueTrials
                    ? `${unavailableVenueTrials} BNB tests stay unavailable under the frozen sample floor.`
                    : "Every frozen asset × formula test met its sample floor.",
                },
                {
                  label: "Holdout trades",
                  value: venueTrades.toLocaleString(),
                  detail: "Counts overlap across formulas and assets; they are not portfolio-additive.",
                },
                {
                  label: "Data cut",
                  value: new Date(venuePreview.data.dataEndExclusiveMs).toLocaleString(
                    "en-US",
                    {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: "America/Chicago",
                    },
                  ),
                  detail: "Immutable cut fixed before target returns were queried.",
                },
              ].map((metric) => (
                <article
                  key={metric.label}
                  className="border-b p-4 last:border-b-0 sm:border-r sm:last:border-r-0 xl:border-b-0"
                >
                  <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    <Database className="h-3.5 w-3.5" />
                    {metric.label}
                  </div>
                  <div className="mt-2 font-mono text-xl font-semibold">{metric.value}</div>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {metric.detail}
                  </p>
                </article>
              ))}
            </div>

            <div className="border-b bg-warning/5 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">Observed result:</span>{" "}
              every available trial is negative after the frozen cost stress. Gross and net means
              are both shown so a small directional effect cannot masquerade as executable alpha.
              Sorting is descriptive only; Formula Lab does not select, export, or register a
              formula from this preview.
            </div>

            <details className="border-b px-4 py-3">
              <summary className="cursor-pointer text-xs font-medium">
                How to read the preview columns
              </summary>
              <dl className="mt-3 grid gap-x-6 gap-y-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
                {[
                  {
                    term: "Asset",
                    definition:
                      "The Chainlink × Hyperliquid USD pair assessed independently. Results are never pooled across assets.",
                  },
                  {
                    term: "Frozen trial",
                    definition:
                      "A formula and entry threshold declared before its target returns were queried. z0.5 means the formula output is at least 0.5 training-fold standard deviations above its training-fold mean.",
                  },
                  {
                    term: "Complete frames",
                    definition:
                      "All usable one-minute feature/label observations in the immutable data cut, including training and holdout rows. This is not a trade count.",
                  },
                  {
                    term: "Holdout trades",
                    definition:
                      "Entries produced only in the four chronological test folds. Positions cannot overlap: each accepted short blocks another entry for ten minutes.",
                  },
                  {
                    term: "Positive folds",
                    definition:
                      "Test folds whose average net return is above zero after the fixed 10 bps round-trip stress. It is fold consistency, not the trade win count.",
                  },
                  {
                    term: "Gross mean",
                    definition:
                      "Trade-weighted mean 10-minute short return from Hyperliquid midpoints before the fixed cost stress, in basis points.",
                  },
                  {
                    term: "Net mean",
                    definition:
                      "The same held-out mean after subtracting 10 bps from every trade. Midpoints are not executable fills, so this remains exploratory.",
                  },
                  {
                    term: "Net hit rate",
                    definition:
                      "The share of held-out trades with a return above zero after the 10 bps stress. A dash keeps an under-sampled trial visible instead of treating it as zero.",
                  },
                ].map((item) => (
                  <div key={item.term}>
                    <dt className="font-medium text-foreground">{item.term}</dt>
                    <dd className="mt-1 leading-relaxed text-muted-foreground">
                      {item.definition}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] text-sm">
                <thead className="border-b bg-muted/20 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  <tr>
                    <PolymarketSortableHeader
                      column="pair"
                      active={venueSort.key}
                      direction={venueSort.direction}
                      onSort={sortVenue}
                      title="Chainlink × Hyperliquid USD pair; each asset is assessed independently."
                    >
                      Asset
                    </PolymarketSortableHeader>
                    <PolymarketSortableHeader
                      column="trial"
                      active={venueSort.key}
                      direction={venueSort.direction}
                      onSort={sortVenue}
                      title="Predeclared formula and entry threshold. z0.5 is 0.5 training-fold standard deviations above the training-fold output mean."
                    >
                      Frozen trial
                    </PolymarketSortableHeader>
                    <PolymarketSortableHeader
                      column="frames"
                      active={venueSort.key}
                      direction={venueSort.direction}
                      onSort={sortVenue}
                      align="right"
                      title="Complete one-minute observations in the immutable cut, including training and holdout rows."
                    >
                      Complete frames
                    </PolymarketSortableHeader>
                    <PolymarketSortableHeader
                      column="trades"
                      active={venueSort.key}
                      direction={venueSort.direction}
                      onSort={sortVenue}
                      align="right"
                      title="Non-overlapping entries produced in the four chronological holdout folds."
                    >
                      Holdout trades
                    </PolymarketSortableHeader>
                    <PolymarketSortableHeader
                      column="positiveFolds"
                      active={venueSort.key}
                      direction={venueSort.direction}
                      onSort={sortVenue}
                      align="right"
                      title="Holdout folds with average net return above zero after the fixed 10 bps stress."
                    >
                      Positive folds
                    </PolymarketSortableHeader>
                    <PolymarketSortableHeader
                      column="grossMean"
                      active={venueSort.key}
                      direction={venueSort.direction}
                      onSort={sortVenue}
                      align="right"
                      title="Trade-weighted 10-minute short return before the fixed cost stress."
                    >
                      Gross mean (bps)
                    </PolymarketSortableHeader>
                    <PolymarketSortableHeader
                      column="netMean"
                      active={venueSort.key}
                      direction={venueSort.direction}
                      onSort={sortVenue}
                      align="right"
                      title="Trade-weighted holdout return after subtracting 10 bps per trade."
                    >
                      Net mean (bps)
                    </PolymarketSortableHeader>
                    <PolymarketSortableHeader
                      column="hitRate"
                      active={venueSort.key}
                      direction={venueSort.direction}
                      onSort={sortVenue}
                      align="right"
                      title="Share of holdout trades with net return above zero after the fixed cost stress."
                    >
                      Net hit rate
                    </PolymarketSortableHeader>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {venueTrials.map((trial) => (
                    <tr
                      key={`${trial.pair}:${trial.candidateId}`}
                      className={trial.available ? "hover:bg-muted/10" : "text-muted-foreground"}
                    >
                      <td className="px-4 py-3 font-mono font-semibold">{trial.pair.replace("-USD", "")}</td>
                      <td className="px-4 py-3">
                        <div className="text-xs font-medium">{trial.candidateId}</div>
                        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                          {trial.available ? trial.formula : trial.unavailableReason}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">{trial.frames.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono">{trial.available ? trial.trades : "—"}</td>
                      <td className="px-4 py-3 text-right font-mono">
                        {trial.available ? `${trial.positiveFolds}/${trial.folds}` : "—"}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono ${
                        trial.meanGrossBps == null
                          ? ""
                          : trial.meanGrossBps > 0 ? "text-success" : "text-destructive"
                      }`}>
                        {bps(trial.meanGrossBps)}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono ${
                        trial.meanNetBps == null
                          ? ""
                          : trial.meanNetBps > 0 ? "text-success" : "text-destructive"
                      }`}>
                        {bps(trial.meanNetBps)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">{pct(trial.hitRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border bg-card">
        <header className="border-b px-4 py-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            System path
          </div>
          <h2 className="mt-1 text-base font-semibold">One engine, separately validated adapters</h2>
        </header>
        <div className="grid divide-y lg:grid-cols-4 lg:divide-x lg:divide-y-0">
          {[
            {
              index: "01",
              title: "Causal source frames",
              text: "Source adapters emit numeric features, eligibility, and both source and receive clocks. The engine never reaches into a venue directly.",
            },
            {
              index: "02",
              title: "Bounded formula search",
              text: "Typed expression trees, thresholds, features, constants, and exit horizons consume a declared search budget and an append-only trial ledger.",
            },
            {
              index: "03",
              title: "Untouched forward test",
              text: "Export one immutable expression and restart at a new boundary. Discovery and walk-forward scores do not carry into the verdict.",
            },
            {
              index: "04",
              title: "Target economics",
              text: "Underlying labels, Hyperliquid perpetuals, and Polymarket contracts are different targets with separate fills, costs, controls, and verdicts.",
            },
          ].map((step) => (
            <article key={step.index} className="p-4">
              <div className="font-mono text-xs text-muted-foreground">{step.index}</div>
              <div className="mt-3 text-sm font-semibold">{step.title}</div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{step.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-warning/25 bg-card overflow-hidden rounded-xl border">
        <header className="border-b px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-warning text-[10px] font-semibold uppercase tracking-[0.14em]">
                Historical research prior · imported, not admitted
              </div>
              <h2 className="mt-1 text-base font-semibold">Albert legacy formula anatomy</h2>
              <p className="text-muted-foreground mt-1 max-w-4xl text-xs leading-relaxed">
                Supplied from the August–September 2024 Formula Lab conversations. The parser
                preserves the exact expression so its structure can inform import tooling and
                visualization. The separate replay below evaluates pinned Qlib semantics, but the
                expression is not admitted to the bounded search grammar or strategy registry.
              </p>
            </div>
            <span className="border-warning/30 bg-warning/10 text-warning rounded-md border px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide">
              provenance only
            </span>
          </div>
        </header>
        <div className="grid border-b sm:grid-cols-4">
          {[
            {
              label: "AST nodes",
              value: data.historicalFormulaResearch.complexity.toString(),
              detail: "Every call, feature, and constant",
            },
            {
              label: "Tree depth",
              value: data.historicalFormulaResearch.depth.toString(),
              detail: "Root numeric operator through deepest leaf",
            },
            {
              label: "Function types",
              value: data.historicalFormulaResearch.operators.length.toString(),
              detail: data.historicalFormulaResearch.operators
                .map((operator) => operator.name)
                .join(", "),
            },
            {
              label: "Source fields",
              value: data.historicalFormulaResearch.features.length.toString(),
              detail: data.historicalFormulaResearch.features.join(", "),
            },
          ].map((metric) => (
            <div
              key={metric.label}
              className="border-b px-4 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
            >
              <div className="text-muted-foreground text-[10px] font-semibold uppercase tracking-[0.12em]">
                {metric.label}
              </div>
              <div className="mt-1 font-mono text-lg font-semibold">{metric.value}</div>
              <div
                className="text-muted-foreground mt-0.5 truncate text-[10px]"
                title={metric.detail}
              >
                {metric.detail}
              </div>
            </div>
          ))}
        </div>
        <LegacyFormulaExpressionTree
          expression={data.historicalFormulaResearch.expression}
          formula={data.historicalFormulaResearch.source}
        />
        <div className="grid border-t lg:grid-cols-2">
          <article className="border-b p-4 lg:border-b-0 lg:border-r">
            <h3 className="text-sm font-semibold">What the expression does</h3>
            <ul className="text-muted-foreground mt-2 space-y-1.5 text-xs leading-relaxed">
              {data.historicalFormulaResearch.interpretation.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden="true">—</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </article>
          <article className="p-4">
            <h3 className="text-sm font-semibold">Why it stays research-only</h3>
            <ul className="text-muted-foreground mt-2 space-y-1.5 text-xs leading-relaxed">
              {data.historicalFormulaResearch.warnings.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden="true">—</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </article>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border bg-card">
        <header className="border-b px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Imported tape replay · retrospective discovery
              </div>
              <h2 className="mt-1 text-base font-semibold">Albert formula × BTC 5m × fixed 10m short</h2>
              <p className="mt-1 max-w-4xl text-xs leading-relaxed text-muted-foreground">
                The exact imported expression is evaluated with Microsoft Qlib v0.9.5 semantics
                over the immutable TradingView Hyperliquid BTC tape. Thresholds use prior-fold
                output moments only; entry is the next contiguous bar open and exit is the bar open
                exactly ten minutes later. This is historical OHLCV—not an executable fill study.
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-destructive">
              <Lock className="h-3.5 w-3.5" />
              no net-positive fold
            </span>
          </div>
        </header>

        <div className="grid border-b sm:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: "Source bars",
              value: data.historicalReplay.dataset.rows.toLocaleString(),
              detail: `${data.historicalReplay.dataset.eligiblePoints.toLocaleString()} eligible decisions · ${data.historicalReplay.dataset.segments} gap-safe segments`,
            },
            {
              label: "Formula output",
              value: data.historicalReplay.evaluator.finiteValues.toLocaleString(),
              detail: `${data.historicalReplay.evaluator.nanValues} NaN warm-up values · Qlib v0.9.5`,
            },
            {
              label: "Declared trials",
              value: data.historicalReplay.trials.length.toString(),
              detail: `Control + two tails × three z gates · ${data.historicalReplay.target.folds} chronological folds`,
            },
            {
              label: "Cost stress",
              value: `${data.historicalReplay.target.roundTripCostBps} bps`,
              detail: "Subtracted from every fixed-horizon short; spread and slippage are not reconstructed.",
            },
          ].map((metric) => (
            <article
              key={metric.label}
              className="border-b p-4 last:border-b-0 sm:border-r sm:last:border-r-0 xl:border-b-0"
            >
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {metric.label}
              </div>
              <div className="mt-2 font-mono text-xl font-semibold">{metric.value}</div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{metric.detail}</p>
            </article>
          ))}
        </div>

        <div className="border-b bg-destructive/5 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Observed result:</span>{" "}
          {data.historicalReplay.observedResult}
        </div>

        <details className="border-b px-4 py-3">
          <summary className="cursor-pointer text-xs font-medium">
            Formula distribution, information coefficient, and next sensitivity
          </summary>
          <div className="mt-3 grid gap-4 text-xs lg:grid-cols-3">
            <div>
              <div className="font-medium">Output distribution</div>
              <div className="mt-1 font-mono text-[11px] leading-relaxed text-muted-foreground">
                min {data.historicalReplay.evaluator.minimum.toExponential(3)} · mean{" "}
                {data.historicalReplay.evaluator.mean.toExponential(3)} · max{" "}
                {data.historicalReplay.evaluator.maximum.toExponential(3)}
              </div>
            </div>
            <div>
              <div className="font-medium">Held-out rank IC</div>
              <div className="mt-1 font-mono text-[11px] leading-relaxed text-muted-foreground">
                {data.historicalReplay.informationCoefficientByFold
                  .map((fold) => `F${fold.fold} ${fold.spearman >= 0 ? "+" : ""}${fold.spearman.toFixed(3)}`)
                  .join(" · ")}
              </div>
            </div>
            <div>
              <div className="font-medium">Next declared family</div>
              <p className="mt-1 leading-relaxed text-muted-foreground">
                {data.historicalReplay.nextResearchStep}
              </p>
            </div>
          </div>
        </details>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1160px] text-sm">
            <thead className="border-b bg-muted/20 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <PolymarketSortableHeader column="trial" active={historicalSort.key} direction={historicalSort.direction} onSort={sortHistorical}>Trial</PolymarketSortableHeader>
                <PolymarketSortableHeader column="status" active={historicalSort.key} direction={historicalSort.direction} onSort={sortHistorical}>Sample floor</PolymarketSortableHeader>
                <PolymarketSortableHeader column="trades" active={historicalSort.key} direction={historicalSort.direction} onSort={sortHistorical} align="right">Trades</PolymarketSortableHeader>
                <PolymarketSortableHeader column="gross" active={historicalSort.key} direction={historicalSort.direction} onSort={sortHistorical} align="right">Gross mean</PolymarketSortableHeader>
                <PolymarketSortableHeader column="net" active={historicalSort.key} direction={historicalSort.direction} onSort={sortHistorical} align="right">Net mean</PolymarketSortableHeader>
                <PolymarketSortableHeader column="hitRate" active={historicalSort.key} direction={historicalSort.direction} onSort={sortHistorical} align="right">Net hit</PolymarketSortableHeader>
                <PolymarketSortableHeader column="positiveFolds" active={historicalSort.key} direction={historicalSort.direction} onSort={sortHistorical} align="right">Positive folds</PolymarketSortableHeader>
                <PolymarketSortableHeader column="worstFold" active={historicalSort.key} direction={historicalSort.direction} onSort={sortHistorical} align="right">Worst fold</PolymarketSortableHeader>
                <PolymarketSortableHeader column="finalEquity" active={historicalSort.key} direction={historicalSort.direction} onSort={sortHistorical} align="right">Final equity</PolymarketSortableHeader>
              </tr>
            </thead>
            <tbody className="divide-y">
              {historicalTrials.map((trial) => (
                <tr
                  key={trial.id}
                  className={trial.available ? "hover:bg-muted/10" : "text-muted-foreground"}
                >
                  <td className="px-4 py-3">
                    <div className="text-xs font-medium">{trial.id}</div>
                    <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                      {trial.tail === "all"
                        ? "every eligible decision"
                        : `${trial.tail} tail · z ${trial.thresholdZ}`}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      trial.available
                        ? "border-success/30 bg-success/10 text-success"
                        : "border-warning/30 bg-warning/10 text-warning"
                    }`}>
                      {trial.available ? "met" : "under"}
                    </span>
                    {!trial.available ? (
                      <div className="mt-1 max-w-48 text-[10px] leading-tight text-muted-foreground">
                        {trial.unavailableReason}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{trial.trades.toLocaleString()}</td>
                  <td className={`px-4 py-3 text-right font-mono ${
                    trial.meanGrossBps == null ? "" : trial.meanGrossBps > 0 ? "text-success" : "text-destructive"
                  }`}>{bps(trial.meanGrossBps)}</td>
                  <td className={`px-4 py-3 text-right font-mono ${
                    trial.meanNetBps == null ? "" : trial.meanNetBps > 0 ? "text-success" : "text-destructive"
                  }`}>{bps(trial.meanNetBps)}</td>
                  <td className="px-4 py-3 text-right font-mono">{pct(trial.hitRate)}</td>
                  <td className="px-4 py-3 text-right font-mono">{trial.positiveFolds}/{data.historicalReplay.target.folds}</td>
                  <td className="px-4 py-3 text-right font-mono">{bps(trial.worstFoldMeanNetBps)}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    ${trial.finalEquityUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
          Capital is a descriptive fixed-notional path ({data.historicalReplay.target.capital}).
          Under-sampled rows remain visible but do not satisfy the frozen fold floor. Receipt{" "}
          <span className="font-mono">{data.historicalReplay.receiptHash.slice(0, 22)}…</span>.
          No row is selected or admitted.
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <Card className="shadow-none">
          <CardContent className="p-0">
            <header className="border-b px-4 py-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Source adapters
              </div>
              <h2 className="mt-1 text-base font-semibold">What Formula Lab may observe</h2>
            </header>
            <div className="divide-y">
              {data.sourceAdapters.map((adapter) => (
                <article key={adapter.key} className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium">{adapter.name}</div>
                    <span className="rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {adapter.state}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {adapter.role}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{adapter.provides}</p>
                </article>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardContent className="p-0">
            <header className="border-b px-4 py-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Target adapters
              </div>
              <h2 className="mt-1 text-base font-semibold">What a frozen formula may be tested against</h2>
            </header>
            <div className="divide-y">
              {data.targetAdapters.map((adapter) => (
                <article key={adapter.key} className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium">{adapter.name}</div>
                    <span className="rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {adapter.state}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{adapter.economics}</p>
                </article>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="overflow-hidden rounded-xl border bg-card">
        <header className="border-b px-4 py-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Formula universe
              </div>
              <h2 className="mt-1 text-base font-semibold">Declared expression × threshold trials</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Select a trial to trace its causal features through the expression tree and entry gate.
              </p>
            </div>
            <div className="text-xs text-muted-foreground">
              max {data.grammar.maximumNodes} nodes · depth {data.grammar.maximumDepth} · no eval
            </div>
          </div>
        </header>
        {selectedCandidate ? (
          <div className="border-b">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/10 px-4 py-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Selected formula
                </div>
                <div className="mt-1 text-sm font-medium">{selectedCandidate.id}</div>
              </div>
              <div className="flex items-center gap-3 font-mono text-[11px] text-muted-foreground">
                <span>{selectedCandidate.complexity} nodes</span>
                <span>depth {selectedCandidate.depth}</span>
                <span>z {selectedCandidate.thresholdZ.toFixed(1)}</span>
              </div>
            </div>
            <FormulaExpressionTree
              expression={selectedCandidate.expression}
              formula={selectedCandidate.formula}
              thresholdZ={selectedCandidate.thresholdZ}
              holdSeconds={data.target.holdSeconds}
            />
          </div>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b bg-muted/20 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <PolymarketSortableHeader column="id" active={candidateSort.key} direction={candidateSort.direction} onSort={sortCandidates}>Trial</PolymarketSortableHeader>
                <PolymarketSortableHeader column="formula" active={candidateSort.key} direction={candidateSort.direction} onSort={sortCandidates}>Formula</PolymarketSortableHeader>
                <PolymarketSortableHeader column="threshold" active={candidateSort.key} direction={candidateSort.direction} onSort={sortCandidates} align="right">Entry z</PolymarketSortableHeader>
                <PolymarketSortableHeader column="complexity" active={candidateSort.key} direction={candidateSort.direction} onSort={sortCandidates} align="right">Nodes</PolymarketSortableHeader>
                <th className="px-4 py-3 text-right">Inspect</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {candidates.map((candidate) => (
                <tr
                  key={candidate.id}
                  className={
                    candidate.id === selectedCandidate?.id
                      ? "bg-muted/20"
                      : "hover:bg-muted/10"
                  }
                >
                  <td className="px-4 py-3 text-xs text-muted-foreground">{candidate.id}</td>
                  <td className="px-4 py-3 font-mono text-xs">{candidate.formula}</td>
                  <td className="px-4 py-3 text-right font-mono">{candidate.thresholdZ.toFixed(1)}</td>
                  <td className="px-4 py-3 text-right font-mono">{candidate.complexity}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setSelectedCandidateId(candidate.id)}
                      aria-pressed={candidate.id === selectedCandidate?.id}
                      className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      View tree
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border bg-card">
        <header className="border-b px-4 py-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Synthetic mechanics proof
          </div>
          <h2 className="mt-1 text-base font-semibold">Chronological fold selections</h2>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            A planted relationship lets us test the machinery. Positive results here are expected
            by construction and must never appear on a strategy scoreboard.
          </p>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-sm">
            <thead className="border-b bg-muted/20 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <PolymarketSortableHeader column="fold" active={foldSort.key} direction={foldSort.direction} onSort={sortFolds}>Fold</PolymarketSortableHeader>
                <PolymarketSortableHeader column="selected" active={foldSort.key} direction={foldSort.direction} onSort={sortFolds}>Selected on prior data</PolymarketSortableHeader>
                <PolymarketSortableHeader column="train" active={foldSort.key} direction={foldSort.direction} onSort={sortFolds} align="right">Train rows</PolymarketSortableHeader>
                <PolymarketSortableHeader column="trainingTrades" active={foldSort.key} direction={foldSort.direction} onSort={sortFolds} align="right">Train trades</PolymarketSortableHeader>
                <PolymarketSortableHeader column="trainingLcb" active={foldSort.key} direction={foldSort.direction} onSort={sortFolds} align="right">Train LCB</PolymarketSortableHeader>
                <PolymarketSortableHeader column="test" active={foldSort.key} direction={foldSort.direction} onSort={sortFolds} align="right">Test rows</PolymarketSortableHeader>
                <PolymarketSortableHeader column="testTrades" active={foldSort.key} direction={foldSort.direction} onSort={sortFolds} align="right">Test trades</PolymarketSortableHeader>
                <PolymarketSortableHeader column="testMean" active={foldSort.key} direction={foldSort.direction} onSort={sortFolds} align="right">Test mean</PolymarketSortableHeader>
                <PolymarketSortableHeader column="hitRate" active={foldSort.key} direction={foldSort.direction} onSort={sortFolds} align="right">Hit rate</PolymarketSortableHeader>
              </tr>
            </thead>
            <tbody className="divide-y">
              {folds.map((fold) => (
                <tr key={fold.fold} className="hover:bg-muted/10">
                  <td className="px-4 py-3 font-mono">{fold.fold}</td>
                  <td className="px-4 py-3">
                    <div className="text-xs font-medium">{fold.selectedCandidateId}</div>
                    <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{fold.selectedFormula}</div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{fold.trainPoints}</td>
                  <td className="px-4 py-3 text-right font-mono">{fold.trainingTrades}</td>
                  <td className="px-4 py-3 text-right font-mono">{bps(fold.trainingLowerConfidenceBoundBps)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fold.testPoints}</td>
                  <td className="px-4 py-3 text-right font-mono">{fold.testTrades}</td>
                  <td className="px-4 py-3 text-right font-mono text-success">{bps(fold.testMeanNetBps)}</td>
                  <td className="px-4 py-3 text-right font-mono">{pct(fold.testHitRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <Card className="shadow-none">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Lock className="h-4 w-4 text-warning" />
              Alchemy engine prerequisites
            </div>
            <ul className="mt-3 space-y-2 text-xs leading-relaxed text-muted-foreground">
              {data.prerequisitesForLiveData.map((item) => <li key={item}>• {item}</li>)}
            </ul>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4 text-success" />
              Polymarket target prerequisites
            </div>
            <ul className="mt-3 space-y-2 text-xs leading-relaxed text-muted-foreground">
              {data.prerequisitesForPolymarketTranslation.map((item) => <li key={item}>• {item}</li>)}
            </ul>
          </CardContent>
        </Card>
      </section>

      <div className="rounded-lg border bg-muted/10 px-4 py-3 text-xs text-muted-foreground">
        No run, optimize, promote, paper-register, venue-connect, trade, sign, or submit control
        exists on this page. A selected formula is only a future Alchemy hypothesis.
      </div>
    </div>
  );
}
