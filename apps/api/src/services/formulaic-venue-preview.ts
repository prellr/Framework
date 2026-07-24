/**
 * Read-only real-data smoke backtest for Formula Lab's frozen venue preview.
 *
 * The only persisted source is the paired public Chainlink × Hyperliquid price tape. This module
 * cannot read a paper ledger, Polymarket outcome, account, strategy registry, Crucible result, or
 * order surface, and it cannot write anything.
 */
import { sql } from "drizzle-orm";
import { db } from "@framework/db";
import { createAsyncTtlCache } from "./async-ttl-cache.ts";
import {
  fixedFormulaCandidates,
  formulaComplexity,
  renderFormula,
  walkForwardFormulaAssessment,
  type FormulaFeature,
  type FormulaPoint,
} from "./formulaic-fixed-horizon-poc.ts";
import { FORMULAIC_VENUE_PREVIEW } from "./formulaic-venue-preview-contract.ts";

type RawVenuePreviewRow = {
  pair: string;
  at_ms: string | number;
  label_end_at_ms: string | number;
  entry_price: string | number;
  exit_price: string | number;
  chainlink_return_60s: string | number;
  chainlink_return_300s: string | number;
  hl_return_60s: string | number;
  hl_return_300s: string | number;
  basis_bps: string | number;
  basis_change_60s_bps: string | number;
  basis_persistence_5s: string | number;
};

const finiteNumber = (value: string | number): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function venuePreviewPointFromRow(
  row: RawVenuePreviewRow,
): FormulaPoint | null {
  const atMs = finiteNumber(row.at_ms);
  const labelEndAtMs = finiteNumber(row.label_end_at_ms);
  const entryUnderlyingPrice = finiteNumber(row.entry_price);
  const exitUnderlyingPrice = finiteNumber(row.exit_price);
  const featureEntries: [FormulaFeature, number | null][] = [
    ["chainlinkReturn60s", finiteNumber(row.chainlink_return_60s)],
    ["chainlinkReturn300s", finiteNumber(row.chainlink_return_300s)],
    ["hlReturn60s", finiteNumber(row.hl_return_60s)],
    ["hlReturn300s", finiteNumber(row.hl_return_300s)],
    ["basisBps", finiteNumber(row.basis_bps)],
    ["basisChange60sBps", finiteNumber(row.basis_change_60s_bps)],
    ["basisPersistence5s", finiteNumber(row.basis_persistence_5s)],
  ];
  if (
    !FORMULAIC_VENUE_PREVIEW.pairs.includes(
      row.pair as (typeof FORMULAIC_VENUE_PREVIEW.pairs)[number],
    )
    || atMs == null
    || labelEndAtMs == null
    || !Number.isSafeInteger(atMs)
    || !Number.isSafeInteger(labelEndAtMs)
    || labelEndAtMs - atMs
      !== FORMULAIC_VENUE_PREVIEW.target.holdSeconds * 1_000
    || entryUnderlyingPrice == null
    || exitUnderlyingPrice == null
    || entryUnderlyingPrice <= 0
    || exitUnderlyingPrice <= 0
    || featureEntries.some(([, value]) => value == null)
  ) {
    return null;
  }
  return {
    pair: row.pair,
    atMs,
    labelEndAtMs,
    entryUnderlyingPrice,
    exitUnderlyingPrice,
    features: Object.fromEntries(featureEntries) as Record<FormulaFeature, number>,
  };
}

const assessmentConfig = {
  holdMs: FORMULAIC_VENUE_PREVIEW.target.holdSeconds * 1_000,
  folds: FORMULAIC_VENUE_PREVIEW.assessment.folds,
  testPointsPerFold:
    FORMULAIC_VENUE_PREVIEW.assessment.testPointsPerFold,
  minimumTrainPoints:
    FORMULAIC_VENUE_PREVIEW.assessment.minimumTrainPoints,
  minimumTrainTrades:
    FORMULAIC_VENUE_PREVIEW.assessment.minimumTrainTrades,
  minimumTestTrades:
    FORMULAIC_VENUE_PREVIEW.assessment.minimumTestTrades,
  roundTripCostBps:
    FORMULAIC_VENUE_PREVIEW.target.roundTripCostBps,
  complexityPenaltyBps:
    FORMULAIC_VENUE_PREVIEW.assessment.complexityPenaltyBps,
} as const;

export function assessVenuePreviewPoints(points: FormulaPoint[]) {
  const byPair = new Map<string, FormulaPoint[]>();
  for (const point of points) {
    const rows = byPair.get(point.pair) ?? [];
    rows.push(point);
    byPair.set(point.pair, rows);
  }
  const candidatesById = new Map(
    fixedFormulaCandidates().map((candidate) => [candidate.id, candidate]),
  );

  return FORMULAIC_VENUE_PREVIEW.pairs.flatMap((pair) => {
    const pairPoints = (byPair.get(pair) ?? [])
      .slice()
      .sort((left, right) => left.atMs - right.atMs);
    return FORMULAIC_VENUE_PREVIEW.trials.map((candidateId) => {
      const candidate = candidatesById.get(candidateId);
      if (!candidate) throw new Error(`missing frozen venue-preview trial ${candidateId}`);
      try {
        const result = walkForwardFormulaAssessment(
          pairPoints,
          [candidate],
          assessmentConfig,
        );
        const trades = result.folds.reduce(
          (sum, fold) => sum + fold.testMetrics.trades,
          0,
        );
        const weightedHitRate = trades
          ? result.folds.reduce(
            (sum, fold) =>
              sum
              + (fold.testMetrics.hitRate ?? 0) * fold.testMetrics.trades,
            0,
          ) / trades
          : null;
        return {
          pair,
          candidateId,
          formula: renderFormula(candidate.expression),
          thresholdZ: candidate.thresholdZ,
          complexity: formulaComplexity(candidate.expression),
          available: true as const,
          unavailableReason: null,
          frames: pairPoints.length,
          firstFrameAtMs: pairPoints[0]?.atMs ?? null,
          lastFrameAtMs: pairPoints.at(-1)?.atMs ?? null,
          folds: result.aggregate.folds,
          trades,
          positiveFolds: result.aggregate.positiveFolds,
          meanGrossBps:
            result.aggregate.tradeWeightedMeanNetBps == null
              ? null
              : result.aggregate.tradeWeightedMeanNetBps
                + FORMULAIC_VENUE_PREVIEW.target.roundTripCostBps,
          meanNetBps: result.aggregate.tradeWeightedMeanNetBps,
          hitRate: weightedHitRate,
          foldResults: result.folds.map((fold) => ({
            fold: fold.fold + 1,
            testStartAtMs: fold.testStartAtMs,
            trainPoints: fold.trainPoints,
            testPoints: fold.testPoints,
            trainingTrades: fold.trainingMetrics.trades,
            testTrades: fold.testMetrics.trades,
            testMeanNetBps: fold.testMetrics.meanNetBps,
            testHitRate: fold.testMetrics.hitRate,
          })),
        };
      } catch (error) {
        return {
          pair,
          candidateId,
          formula: renderFormula(candidate.expression),
          thresholdZ: candidate.thresholdZ,
          complexity: formulaComplexity(candidate.expression),
          available: false as const,
          unavailableReason:
            error instanceof Error ? error.message : "preview assessment failed",
          frames: pairPoints.length,
          firstFrameAtMs: pairPoints[0]?.atMs ?? null,
          lastFrameAtMs: pairPoints.at(-1)?.atMs ?? null,
          folds: 0,
          trades: 0,
          positiveFolds: 0,
          meanGrossBps: null,
          meanNetBps: null,
          hitRate: null,
          foldResults: [],
        };
      }
    });
  });
}

async function loadFormulaicVenuePreview() {
  const pairValues = sql.join(
    FORMULAIC_VENUE_PREVIEW.pairs.map((pair) => sql`(${pair})`),
    sql`,`,
  );
  const result = await db.execute<RawVenuePreviewRow>(sql`
    with pairs(pair) as (
      values ${pairValues}
    ),
    minutes(minute_at) as (
      select generate_series(
        ${new Date(FORMULAIC_VENUE_PREVIEW.dataStartMs)},
        ${new Date(
          FORMULAIC_VENUE_PREVIEW.dataEndExclusiveMs
          - FORMULAIC_VENUE_PREVIEW.target.holdSeconds * 1_000,
        )},
        interval '1 minute'
      )
    ),
    anchors as (
      select
        pairs.pair,
        observation.sampled_at,
        observation.chainlink_price,
        observation.hl_mid,
        observation.basis_bps
      from pairs
      cross join minutes
      cross join lateral (
        select
          sampled_at,
          chainlink_price,
          hl_mid,
          basis_bps
        from venue_price_snapshot
        where pair = pairs.pair
          and sampled_at >= minutes.minute_at
          and sampled_at < minutes.minute_at + interval '1 minute'
          and sampled_at
            < ${new Date(FORMULAIC_VENUE_PREVIEW.dataEndExclusiveMs)}
          and chainlink_age_ms
            <= ${FORMULAIC_VENUE_PREVIEW.sampling.maximumSourceAgeMs}
          and hl_age_ms
            <= ${FORMULAIC_VENUE_PREVIEW.sampling.maximumSourceAgeMs}
          and chainlink_price > 0
          and hl_mid > 0
          and basis_bps not in (
            'NaN'::float8,
            'Infinity'::float8,
            '-Infinity'::float8
          )
        order by sampled_at
        limit 1
      ) observation
    )
    select
      anchor.pair,
      (extract(epoch from anchor.sampled_at) * 1000)::bigint as at_ms,
      (extract(epoch from exit_row.sampled_at) * 1000)::bigint
        as label_end_at_ms,
      anchor.hl_mid as entry_price,
      exit_row.hl_mid as exit_price,
      10000 * ln(anchor.chainlink_price / lag60.chainlink_price)
        as chainlink_return_60s,
      10000 * ln(anchor.chainlink_price / lag300.chainlink_price)
        as chainlink_return_300s,
      10000 * ln(anchor.hl_mid / lag60.hl_mid) as hl_return_60s,
      10000 * ln(anchor.hl_mid / lag300.hl_mid) as hl_return_300s,
      anchor.basis_bps,
      anchor.basis_bps - lag60.basis_bps as basis_change_60s_bps,
      (
        1
        + (sign(lag1.basis_bps) = sign(anchor.basis_bps))::int
        + (sign(lag2.basis_bps) = sign(anchor.basis_bps))::int
        + (sign(lag3.basis_bps) = sign(anchor.basis_bps))::int
        + (sign(lag4.basis_bps) = sign(anchor.basis_bps))::int
      ) / 5.0 as basis_persistence_5s
    from anchors anchor
    join venue_price_snapshot lag1
      on lag1.pair = anchor.pair
      and lag1.sampled_at = anchor.sampled_at - interval '1 second'
    join venue_price_snapshot lag2
      on lag2.pair = anchor.pair
      and lag2.sampled_at = anchor.sampled_at - interval '2 seconds'
    join venue_price_snapshot lag3
      on lag3.pair = anchor.pair
      and lag3.sampled_at = anchor.sampled_at - interval '3 seconds'
    join venue_price_snapshot lag4
      on lag4.pair = anchor.pair
      and lag4.sampled_at = anchor.sampled_at - interval '4 seconds'
    join venue_price_snapshot lag60
      on lag60.pair = anchor.pair
      and lag60.sampled_at = anchor.sampled_at - interval '60 seconds'
    join venue_price_snapshot lag300
      on lag300.pair = anchor.pair
      and lag300.sampled_at = anchor.sampled_at - interval '300 seconds'
    join venue_price_snapshot exit_row
      on exit_row.pair = anchor.pair
      and exit_row.sampled_at = anchor.sampled_at + interval '600 seconds'
    where anchor.basis_bps <> 0
      and exit_row.sampled_at
        < ${new Date(FORMULAIC_VENUE_PREVIEW.dataEndExclusiveMs)}
      and lag1.chainlink_age_ms
        <= ${FORMULAIC_VENUE_PREVIEW.sampling.maximumSourceAgeMs}
      and lag1.hl_age_ms
        <= ${FORMULAIC_VENUE_PREVIEW.sampling.maximumSourceAgeMs}
      and lag2.chainlink_age_ms
        <= ${FORMULAIC_VENUE_PREVIEW.sampling.maximumSourceAgeMs}
      and lag2.hl_age_ms
        <= ${FORMULAIC_VENUE_PREVIEW.sampling.maximumSourceAgeMs}
      and lag3.chainlink_age_ms
        <= ${FORMULAIC_VENUE_PREVIEW.sampling.maximumSourceAgeMs}
      and lag3.hl_age_ms
        <= ${FORMULAIC_VENUE_PREVIEW.sampling.maximumSourceAgeMs}
      and lag4.chainlink_age_ms
        <= ${FORMULAIC_VENUE_PREVIEW.sampling.maximumSourceAgeMs}
      and lag4.hl_age_ms
        <= ${FORMULAIC_VENUE_PREVIEW.sampling.maximumSourceAgeMs}
      and lag60.chainlink_age_ms
        <= ${FORMULAIC_VENUE_PREVIEW.sampling.maximumSourceAgeMs}
      and lag60.hl_age_ms
        <= ${FORMULAIC_VENUE_PREVIEW.sampling.maximumSourceAgeMs}
      and lag300.chainlink_age_ms
        <= ${FORMULAIC_VENUE_PREVIEW.sampling.maximumSourceAgeMs}
      and lag300.hl_age_ms
        <= ${FORMULAIC_VENUE_PREVIEW.sampling.maximumSourceAgeMs}
      and exit_row.chainlink_age_ms
        <= ${FORMULAIC_VENUE_PREVIEW.sampling.maximumSourceAgeMs}
      and exit_row.hl_age_ms
        <= ${FORMULAIC_VENUE_PREVIEW.sampling.maximumSourceAgeMs}
      and lag60.chainlink_price > 0
      and lag60.hl_mid > 0
      and lag300.chainlink_price > 0
      and lag300.hl_mid > 0
      and exit_row.hl_mid > 0
    order by anchor.pair, anchor.sampled_at
  `);
  const points = result.rows
    .map(venuePreviewPointFromRow)
    .filter((point): point is FormulaPoint => point != null);
  const trials = assessVenuePreviewPoints(points);
  return {
    version: FORMULAIC_VENUE_PREVIEW.version,
    status: FORMULAIC_VENUE_PREVIEW.status,
    registeredAtMs: FORMULAIC_VENUE_PREVIEW.registeredAtMs,
    dataStartMs: FORMULAIC_VENUE_PREVIEW.dataStartMs,
    dataEndExclusiveMs: FORMULAIC_VENUE_PREVIEW.dataEndExclusiveMs,
    sourceTapeVersion: FORMULAIC_VENUE_PREVIEW.sourceTapeVersion,
    sampling: FORMULAIC_VENUE_PREVIEW.sampling,
    target: FORMULAIC_VENUE_PREVIEW.target,
    assessment: FORMULAIC_VENUE_PREVIEW.assessment,
    disclosure: FORMULAIC_VENUE_PREVIEW.disclosure,
    invariants: FORMULAIC_VENUE_PREVIEW.invariants,
    frames: points.length,
    pairs: FORMULAIC_VENUE_PREVIEW.pairs.map((pair) => ({
      pair,
      frames: points.filter((point) => point.pair === pair).length,
      availableTrials: trials.filter(
        (trial) => trial.pair === pair && trial.available,
      ).length,
    })),
    trials,
  };
}

const readFormulaicVenuePreview = createAsyncTtlCache(
  60 * 60_000,
  loadFormulaicVenuePreview,
);

export function formulaicVenuePreview() {
  return readFormulaicVenuePreview();
}
