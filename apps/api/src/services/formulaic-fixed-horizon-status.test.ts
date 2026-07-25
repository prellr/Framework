import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FORMULAIC_FIXED_HORIZON_POC } from "./formulaic-fixed-horizon-contract.ts";
import { formulaLabStatus } from "./formulaic-fixed-horizon-status.ts";

test("Formula Lab status exposes the complete deterministic trial universe", () => {
  const status = formulaLabStatus();
  assert.equal(status.version, FORMULAIC_FIXED_HORIZON_POC.version);
  assert.equal(status.status, "synthetic-only");
  assert.equal(status.system.version, "jester-formula-lab-v1");
  assert.equal(status.sourceAdapters.length, 3);
  assert.equal(status.targetAdapters.length, 3);
  assert.ok(status.targetAdapters.some((adapter) => adapter.key === "hyperliquid-perp-paper"));
  assert.ok(status.targetAdapters.some((adapter) => adapter.key === "polymarket-down-paper"));
  assert.equal(status.candidates.length, 33);
  assert.equal(status.operatorCatalog.version, "alchemy-formula-operator-catalog-v1");
  assert.equal(
    status.operatorCatalog.counts.activeSearch,
    2
      + status.grammar.unaryOperators.length
      + status.grammar.binaryOperators.length,
  );
  assert.ok(status.operatorCatalog.counts.candidate >= 10);
  assert.equal(status.operatorCatalog.invariants.candidateChangesGenerator, false);
  assert.equal(new Set(status.candidates.map((candidate) => candidate.id)).size, 33);
  assert.ok(status.candidates.every((candidate) => candidate.expression));
  assert.ok(status.candidates.every((candidate) => candidate.depth >= 1));
  assert.ok(status.candidates.every((candidate) => candidate.depth <= status.grammar.maximumDepth));
  assert.equal(status.proof.candidatesEvaluated, 33);
  assert.equal(status.proof.folds.length, 4);
  assert.equal(status.proof.isMarketEvidence, false);
  assert.equal(status.historicalReplay.dataset.rows, 102_267);
  assert.equal(status.historicalReplay.trials.length, 7);
  assert.equal(status.historicalReplay.trials.filter((trial) => trial.available).length, 2);
  assert.ok(status.historicalReplay.trials.every((trial) => trial.positiveFolds === 0));
  assert.equal(status.historicalReplay.invariants.registersStrategy, false);
  assert.equal(status.historicalReplay.invariants.enablesExecution, false);
  assert.deepEqual(
    status.historicalHorizonSensitivity.target.requestedHoldMinutes,
    [30, 60, 240],
  );
  assert.equal(status.historicalHorizonSensitivity.horizons.length, 3);
  assert.ok(status.historicalHorizonSensitivity.horizons.every(
    (horizon) => horizon.trials.length === 7,
  ));
  assert.ok(status.historicalHorizonSensitivity.horizons.every(
    (horizon) => horizon.trials.every(
      (trial) => trial.meanNetBps == null || trial.meanNetBps < 0,
    ),
  ));
  assert.equal(
    status.historicalHorizonSensitivity.invariants.registersStrategy,
    false,
  );
  assert.equal(
    status.historicalHorizonSensitivity.invariants.enablesExecution,
    false,
  );
});

test("planted proof passes mechanics while remaining explicitly non-market evidence", () => {
  const status = formulaLabStatus();
  assert.equal(status.proof.aggregate.folds, 4);
  assert.ok(status.proof.aggregate.trades > 0);
  assert.equal(status.proof.aggregate.positiveFolds, 4);
  assert.ok((status.proof.aggregate.tradeWeightedMeanNetBps ?? 0) > 0);
  assert.ok(status.proof.folds.every((fold) =>
    fold.trainLastLabelEndAtMs != null
    && fold.trainLastLabelEndAtMs <= fold.testStartAtMs));
  assert.match(status.proof.mode, /planted-signal synthetic/i);
  assert.match(status.proof.disposition, /hypothesis.*new forward paper boundary/i);
});

test("Formula Lab status and router remain static, read-only, and non-executing", () => {
  const source = readFileSync(
    new URL("./formulaic-fixed-horizon-status.ts", import.meta.url),
    "utf8",
  );
  const routerSource = readFileSync(
    new URL("../routers/formula-lab.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /from\s+["'][^"']*(?:db|worker|paper-floor|crucible)/i);
  assert.doesNotMatch(
    source,
    /venuePriceSnapshots|paperTrades|fetch\s*\(|placeOrder|privateKey/i,
  );
  assert.match(
    routerSource,
    /status:\s*protectedProcedure\.query\(\(\)\s*=>\s*formulaLabStatus\(\)\)/,
  );
  assert.doesNotMatch(routerSource, /\.(?:mutation|subscription)\s*\(/);
});
