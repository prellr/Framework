import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { formulaicScaleStatus } from "./formulaic-scale-status.ts";

test("Formula Lab exposes the exact 10k × six-target capacity plan", () => {
  const status = formulaicScaleStatus();
  assert.equal(status.state, "mechanics-verified");
  assert.equal(status.manifest.variants, 10_000);
  assert.equal(status.plan.targetCount, 6);
  assert.equal(status.plan.evaluationUnits, 60_000);
  assert.equal(status.plan.shardSize, 250);
  assert.equal(status.plan.shardCount, 240);
  assert.equal(status.plan.shardsPerTarget, 40);
  assert.equal(
    status.plan.expectedFalsePositivesAtNominalFivePercent,
    3_000,
  );
  assert.equal(status.plan.discoveryIsEvidence, false);
  assert.equal(status.plan.validationRequiresNewBoundary, true);
});

test("capital contract distinguishes notional sizing from true risk sizing", () => {
  const status = formulaicScaleStatus();
  assert.deepEqual(
    status.capital.sizingModes.map((mode) => mode.mode),
    [
      "fixed-notional",
      "equity-fraction-notional",
      "fixed-risk",
      "equity-fraction-risk",
    ],
  );
  assert.equal(status.capital.startingCapitalConfigurable, true);
  assert.equal(status.capital.compoundSizingConfigurable, true);
  assert.match(
    status.capital.requiredTargetEconomics.join(" "),
    /maximum planned loss/,
  );
  assert.equal(status.invariants.executionAllowed, false);
  assert.equal(status.invariants.discoveryCanAuthorizeStrategy, false);
  assert.equal(status.persistence.state, "durable-control-plane-built");
  assert.match(status.persistence.detail, /pull-lease worker protocol/);
});

test("scale status and router remain read-only and non-executing", () => {
  const source = readFileSync(
    new URL("./formulaic-scale-status.ts", import.meta.url),
    "utf8",
  );
  const router = readFileSync(
    new URL("../routers/formula-lab.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /\b(?:db\.|fetch\s*\(|placeOrder|privateKey)\b/i);
  assert.match(
    router,
    /scaleStatus:\s*protectedProcedure\.query\(\(\)\s*=>\s*formulaicScaleStatus\(\)\)/,
  );
  assert.match(
    router,
    /controlPlaneStatus:\s*protectedProcedure\.query\(\(\)\s*=>\s*researchControlPlaneStatus\(\)\)/,
  );
  assert.doesNotMatch(router, /\.(?:mutation|subscription)\s*\(/);
});
