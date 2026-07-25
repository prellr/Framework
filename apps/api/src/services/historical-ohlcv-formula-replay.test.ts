import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  historicalFormulaReplayReceiptHash,
  loadCanonicalOhlcvReplayRows,
  runHistoricalOhlcvFormulaReplay,
  type CanonicalOhlcvReplayRow,
  type HistoricalFormulaReplayConfig,
} from "./historical-ohlcv-formula-replay.ts";
import { parseLegacyFormula } from "./legacy-formula-research.ts";
import { createHash } from "node:crypto";

const intervalMs = 300_000;

function syntheticRows(count: number, gapAt = Number.POSITIVE_INFINITY): CanonicalOhlcvReplayRow[] {
  const rows: CanonicalOhlcvReplayRow[] = [];
  let openTimeMs = 1_800_000_000_000;
  let segment = 1;
  for (let index = 0; index < count; index += 1) {
    if (index === gapAt) {
      openTimeMs += intervalMs;
      segment += 1;
    }
    const driver = Math.sin(index * 0.17);
    const open = 100 * Math.exp(driver * 0.002);
    rows.push({
      row_id: `row-${index}`,
      asset: "BTC-USDC-PERP",
      venue: "hyperliquid",
      symbol: "BTCUSDC.P",
      interval: "5m",
      segment_id: segment,
      open_time_ms: openTimeMs,
      close_time_ms: openTimeMs + intervalMs - 1,
      bar_available_at_ms: openTimeMs + intervalMs - 1,
      open,
      high: open + 1,
      low: open - 1,
      close: open + driver,
      volume: 10 + index,
    });
    openTimeMs += intervalMs;
  }
  return rows;
}

const config: HistoricalFormulaReplayConfig = {
  intervalMs,
  holdMs: 600_000,
  warmupBarsPerSegment: 5,
  folds: 2,
  testFractionPerFold: 0.2,
  minimumTrainingPoints: 30,
  minimumTestTrades: 2,
  roundTripCostBps: 10,
  thresholdZs: [0, 0.5],
};

test("canonical replay loader verifies the artifact hash and source clocks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "alchemy-replay-"));
  const canonicalPath = path.join(root, "tape.jsonl");
  const payload = `${syntheticRows(4).map((row) => JSON.stringify(row)).join("\n")}\n`;
  const hash = `sha256:${createHash("sha256").update(payload).digest("hex")}`;
  await writeFile(canonicalPath, payload);
  try {
    const loaded = await loadCanonicalOhlcvReplayRows({
      canonicalPath,
      expectedContentHash: hash,
    });
    assert.equal(loaded.length, 4);
    await assert.rejects(
      loadCanonicalOhlcvReplayRows({
        canonicalPath,
        expectedContentHash: "sha256:deadbeef",
      }),
      /hash mismatch/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("historical replay is gap-safe, chronological, and preserves every declared trial", () => {
  const result = runHistoricalOhlcvFormulaReplay({
    datasetId: "synthetic",
    datasetVersion: "v1",
    datasetContentHash: "sha256:synthetic",
    rows: syntheticRows(240, 120),
    expression: parseLegacyFormula("Less(Max(WMA(Ref($low,2),4),3),Mul(Cov($open,$close,5),Ref($open,1)))"),
    config,
  });
  assert.equal(result.trials.length, 1 + config.thresholdZs.length * 2);
  assert.equal(result.rejectedPoints.warmup, config.warmupBarsPerSegment * 2);
  assert.ok(result.rejectedPoints.crossedGapOrClockMismatch > 0);
  assert.ok(result.trials.every((trial) => trial.folds.length === config.folds));
  assert.ok(result.trials.every((trial) => trial.available));
  assert.ok(result.trials.every((trial) =>
    trial.folds.every((fold) =>
      fold.trainLastExitAtMs != null && fold.trainLastExitAtMs <= fold.testStartAtMs)));
  assert.ok(result.trials.every((trial) =>
    trial.aggregate.trades === trial.capital.wins + trial.capital.losses));
  assert.equal(result.invariants.registersStrategy, false);
  assert.equal(result.invariants.enablesExecution, false);
  assert.match(historicalFormulaReplayReceiptHash(result), /^sha256:[a-f0-9]{64}$/);
});

test("period observations are opt-in and preserve the ordinary receipt shape", () => {
  const input = {
    datasetId: "synthetic",
    datasetVersion: "v1",
    datasetContentHash: "sha256:synthetic",
    rows: syntheticRows(240),
    expression: parseLegacyFormula("Sub($close,$open)"),
    config,
  };
  const ordinary = runHistoricalOhlcvFormulaReplay(input);
  const captured = runHistoricalOhlcvFormulaReplay({
    ...input,
    captureObservations: true,
  });
  assert.ok(ordinary.trials.every((trial) => trial.observations == null));
  assert.ok(captured.trials.every((trial) => Array.isArray(trial.observations)));
  assert.ok(captured.trials.every((trial) =>
    trial.observations!.length === trial.aggregate.trades));
  assert.ok(captured.trials.every((trial) =>
    trial.observations!.every((observation, index, observations) =>
      index === 0 || observation.entryAtMs >= observations[index - 1]!.exitAtMs)));
  assert.ok(captured.trials.every((trial) =>
    trial.observations!.every((observation) =>
      Number.isFinite(observation.entryPrice)
      && Number.isFinite(observation.exitPrice)
      && observation.entryPrice! > 0
      && observation.exitPrice! > 0)));
  const stripped = {
    ...captured,
    trials: captured.trials.map(({ observations: _observations, ...trial }) => trial),
  };
  assert.deepEqual(stripped, ordinary);
});

test("future prices cannot alter the first fold training threshold", () => {
  const rows = syntheticRows(240);
  const expression = parseLegacyFormula("Sub($close,$open)");
  const first = runHistoricalOhlcvFormulaReplay({
    datasetId: "synthetic",
    datasetVersion: "v1",
    datasetContentHash: "sha256:synthetic",
    rows,
    expression,
    config,
  });
  const firstTestStart = first.trials[0]!.folds[0]!.testStartAtMs;
  const mutated = rows.map((row) =>
    row.open_time_ms > firstTestStart
      ? {
          ...row,
          open: row.open * 1.1,
          high: row.high * 1.1,
          low: row.low * 1.1,
          close: row.close * 1.1,
        }
      : row);
  const second = runHistoricalOhlcvFormulaReplay({
    datasetId: "synthetic",
    datasetVersion: "v1",
    datasetContentHash: "sha256:synthetic",
    rows: mutated,
    expression,
    config,
  });
  assert.equal(
    second.trials[1]!.folds[0]!.outputMean,
    first.trials[1]!.folds[0]!.outputMean,
  );
  assert.equal(
    second.trials[1]!.folds[0]!.outputStd,
    first.trials[1]!.folds[0]!.outputStd,
  );
});

test("30m, 60m, and 240m exits stay exact, deterministic, and gap-safe", () => {
  const rows = syntheticRows(720, 360);
  const expression = parseLegacyFormula("Sub($close,$open)");
  for (const holdMinutes of [30, 60, 240]) {
    const horizonConfig = {
      ...config,
      holdMs: holdMinutes * 60_000,
    };
    const first = runHistoricalOhlcvFormulaReplay({
      datasetId: "synthetic",
      datasetVersion: "v1",
      datasetContentHash: "sha256:synthetic",
      rows,
      expression,
      config: horizonConfig,
    });
    const second = runHistoricalOhlcvFormulaReplay({
      datasetId: "synthetic",
      datasetVersion: "v1",
      datasetContentHash: "sha256:synthetic",
      rows,
      expression,
      config: horizonConfig,
    });
    assert.equal(first.config.holdMs, holdMinutes * 60_000);
    assert.ok(first.rejectedPoints.crossedGapOrClockMismatch > 0);
    assert.equal(
      historicalFormulaReplayReceiptHash(first),
      historicalFormulaReplayReceiptHash(second),
    );
    assert.ok(first.trials.every((trial) =>
      trial.folds.every((fold) =>
        fold.trainLastExitAtMs != null && fold.trainLastExitAtMs <= fold.testStartAtMs)));
  }
});
