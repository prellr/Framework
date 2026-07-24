import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FLOW_FEATURE_CUT_FREEZE } from "./flow-feature-cut-freeze.ts";
import { FLOW_EXTERNAL_PRIOR_SCREEN } from "./flow-external-prior-screen.ts";
import { POLYMARKET_MICROSTRUCTURE_TAPE } from "./polymarket-microstructure.ts";

test("external flow prior screen stays queued behind exact outcome-free prerequisites", () => {
  assert.equal(FLOW_EXTERNAL_PRIOR_SCREEN.status, "queued");
  assert.equal(
    FLOW_EXTERNAL_PRIOR_SCREEN.candidate.prerequisiteVersions.flowFeatureCuts,
    FLOW_FEATURE_CUT_FREEZE.artifactVersion,
  );
  assert.equal(
    FLOW_EXTERNAL_PRIOR_SCREEN.candidate.prerequisiteVersions.flowDistribution,
    FLOW_FEATURE_CUT_FREEZE.prerequisiteVersion,
  );
  assert.equal(
    FLOW_EXTERNAL_PRIOR_SCREEN.candidate.prerequisiteVersions.microstructureTape,
    POLYMARKET_MICROSTRUCTURE_TAPE.version,
  );
  assert.equal(
    FLOW_EXTERNAL_PRIOR_SCREEN.candidate.horizonPolicy,
    "independent 5m and 15m paper identities",
  );
  assert.deepEqual(FLOW_EXTERNAL_PRIOR_SCREEN.invariants, {
    readLockedFeatureValues: false,
    readOutcomes: false,
    createsPaperBot: false,
    changesCollector: false,
    enablesExecution: false,
    preservesVerdictGate: true,
  });
});
test("external prior screen retains state-first agreement and explicit abstention", () => {
  const prior = FLOW_EXTERNAL_PRIOR_SCREEN.candidate.structuralPrior.join("\n");
  assert.match(prior, /liquidity state as the first layer/i);
  assert.match(prior, /same-sign Hyperliquid aggressor flow/i);
  assert.match(prior, /disagreement abstains/i);
  assert.match(prior, /single-print-dominance veto/i);
  assert.match(prior, /every asset and horizon bucket/i);
  assert.match(prior, /quarter-hour opening phase as a 15m segmentation variable/i);
});

test("external prior artifacts cannot query a tape or import runtime execution", () => {
  const contractSource = readFileSync(
    new URL("./flow-external-prior-screen.ts", import.meta.url),
    "utf8",
  );
  const recordSource = readFileSync(
    new URL("../scripts/record-flow-external-prior-screen-2026-07-24.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(contractSource, /from\s+["'][^"']*(?:db|worker|trading|paper-floor)/i);
  assert.doesNotMatch(
    recordSource,
    /polymarket_state_snapshot|paper_trades|paperTrades|createOrder|placeOrder|privateKey/i,
  );
  assert.doesNotMatch(recordSource, /\.execute\s*\(/);
});
