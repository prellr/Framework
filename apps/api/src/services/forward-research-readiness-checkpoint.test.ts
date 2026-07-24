import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../scripts/record-forward-research-readiness-checkpoint.ts", import.meta.url),
  "utf8",
);

test("forward readiness checkpoint is time-bounded and refuses an unlocked surface", () => {
  assert.match(source, /2026-07-26T02:21:29\.910Z/);
  assert.match(source, /Date\.now\(\) >= evidenceHardStopMs/);
  assert.match(source, /Object\.values\(lockedChecks\)\.every\(Boolean\)/);
  assert.match(source, /report == null/);
});

test("forward readiness checkpoint uses only registered readiness services", () => {
  for (const expected of [
    "polymarketMicrostructureTapeStatus",
    "venueLeadLagTapeStatus",
    "deribitSkewTapeStatus",
    "pricerCalibrationAudit",
    "crossHorizonBundleAudit",
    "crossAssetLeadLagStatus",
    "paperMarkoutStatus",
    "bsmWindowProfileCalibrationAudit",
    "microstructureAbsorptionAudit",
    "fourStreakReversalAudit",
    "completeSetTakerAudit",
    "authoritativeTradeFlowTapeStatus",
    "hyperliquidFlowTapeStatus",
    "clobEventOfiTapeStatus",
  ]) {
    assert.match(source, new RegExp(`\\b${expected}\\b`));
  }
  assert.doesNotMatch(source, /from ["'][^"']*(?:paper-floor|paper-performance|trading)\.ts["']/);
  assert.doesNotMatch(source, /\b(?:select|insert|update|delete)\s+.*\bpaper_trade\b/i);
});

test("forward readiness checkpoint preserves the no-new-bot disposition", () => {
  assert.match(source, /No additional bot is admitted/);
  assert.match(source, /Gate v3/);
  assert.match(source, /prohibition on execution remain intact/);
});
