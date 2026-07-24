import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FLOW_EXTERNAL_PRIOR_SCREEN } from "./flow-external-prior-screen.ts";
import { FLOW_FEATURE_CUT_FREEZE } from "./flow-feature-cut-freeze.ts";
import { FLOW_MECHANISM_REFINEMENT } from "./flow-mechanism-refinement.ts";
import { POLYMARKET_MICROSTRUCTURE_TAPE } from "./polymarket-microstructure.ts";

test("flow mechanism refinement inherits the queued lane and exact prerequisites", () => {
  assert.equal(FLOW_MECHANISM_REFINEMENT.status, "queued");
  assert.equal(
    FLOW_MECHANISM_REFINEMENT.inheritedPriorVersion,
    FLOW_EXTERNAL_PRIOR_SCREEN.version,
  );
  assert.equal(
    FLOW_MECHANISM_REFINEMENT.candidateKey,
    FLOW_EXTERNAL_PRIOR_SCREEN.candidate.key,
  );
  assert.deepEqual(FLOW_MECHANISM_REFINEMENT.prerequisiteVersions, {
    flowFeatureCuts: FLOW_FEATURE_CUT_FREEZE.artifactVersion,
    microstructureTape: POLYMARKET_MICROSTRUCTURE_TAPE.version,
  });
  assert.equal(
    FLOW_MECHANISM_REFINEMENT.horizonPolicy,
    "independent 5m and 15m paper identities",
  );
});

test("refinement freezes persistence, quality guards, and the state-only ladder", () => {
  const direction = FLOW_MECHANISM_REFINEMENT.frozenBeforeFeatureValues.direction.join("\n");
  const quality =
    FLOW_MECHANISM_REFINEMENT.frozenBeforeFeatureValues.immutableBucketQuality.join("\n");
  const state = FLOW_MECHANISM_REFINEMENT.frozenBeforeFeatureValues.stateLayer.join("\n");
  const ladder = FLOW_MECHANISM_REFINEMENT.frozenBeforeFeatureValues.comparisonLadder;

  assert.match(direction, /30s and 60s/i);
  assert.match(direction, /signs must agree/i);
  assert.match(direction, /5s value opposing/i);
  assert.match(direction, /quiet null Hyperliquid 5s/i);
  assert.match(quality, /asset-by-horizon p75/i);
  assert.match(quality, /maximum-trade share at or below its p95/i);
  assert.match(quality, /event count at or above its p25/i);
  assert.match(quality, /transport lag at or below their p95/i);
  assert.match(state, /canonical paired-book microprice skew/i);
  assert.match(state, /state-only rule/i);
  assert.deepEqual(ladder, [
    "state only",
    "state plus Hyperliquid flow",
    "state plus Polymarket CLOB event-OFI",
    "state plus both persistent agreeing flows",
  ]);
});

test("refinement remains outcome-blind, non-executing, and unresolved where evidence is absent", () => {
  assert.deepEqual(FLOW_MECHANISM_REFINEMENT.unresolvedUntilPrerequisitesPass, [
    "liquidity-state depth or spread cut",
    "entry ask cap",
    "decision sample minute",
  ]);
  assert.deepEqual(FLOW_MECHANISM_REFINEMENT.invariants, {
    readLockedFeatureValues: false,
    readOutcomes: false,
    createsPaperBot: false,
    changesCollector: false,
    enablesExecution: false,
    preservesVerdictGate: true,
  });

  const source = readFileSync(
    new URL("./flow-mechanism-refinement.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /from\s+["'][^"']*(?:db|worker|trading|paper-floor)/i);
  assert.doesNotMatch(
    source,
    /polymarket_state_snapshot|paper_trades|paperTrades|createOrder|placeOrder|privateKey/i,
  );
});
