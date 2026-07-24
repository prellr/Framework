import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LEAD_LAG_REPORT } from "./lead-lag-analysis.ts";
import { RESOLUTION_SOURCE_BASIS_RESEARCH } from "./resolution-source-basis-research.ts";
import { VENUE_REPORT_PAIRS } from "./venue-lead-lag-report.ts";

test("resolution-source basis plan stays queued behind the exact venue-tape floor", () => {
  const plan = RESOLUTION_SOURCE_BASIS_RESEARCH;
  assert.equal(plan.status, "queued");
  assert.equal(plan.prerequisite.version, "updown-venue-lead-lag-tape-v1");
  assert.deepEqual(plan.prerequisite.pairs, [...VENUE_REPORT_PAIRS]);
  assert.equal(plan.prerequisite.minimumRowsPerPair, LEAD_LAG_REPORT.minRows);
  assert.equal(plan.prerequisite.minimumSpanDays, LEAD_LAG_REPORT.minSpanDays);
  assert.equal(plan.prerequisite.minimumFiveMinuteBlocksPerPair, LEAD_LAG_REPORT.minBlocks);
  assert.equal(plan.candidate.horizonPolicy, "independent 5m and 15m paper identities");
});

test("basis plan fixes state-first abstention and incremental controls without a threshold", () => {
  const plan = RESOLUTION_SOURCE_BASIS_RESEARCH;
  const prior = plan.candidate.structuralPrior.join("\n");
  assert.match(prior, /Chainlink is the resolution-source price/i);
  assert.match(prior, /stable Hyperliquid-to-Chainlink precedence/i);
  assert.match(prior, /stale or conflicting evidence abstains/i);
  assert.match(prior, /Chainlink-only pricers and smooth-path rules/i);
  assert.ok(plan.candidate.unresolvedUntilFeatureCutsFreeze.includes("minimum absolute basis"));
  assert.doesNotMatch(prior, /\b(?:0\.\d+|\d+(?:\.\d+)?\s*(?:bps?|¢|%))\b/i);
});

test("basis research artifacts cannot read evidence or enable runtime behavior", () => {
  const plan = RESOLUTION_SOURCE_BASIS_RESEARCH;
  assert.deepEqual(plan.invariants, {
    readsTapeValuesNow: false,
    readsOutcomes: false,
    createsStrategy: false,
    createsPaperBot: false,
    changesCollector: false,
    startsCrucibleRun: false,
    enablesExecution: false,
    preservesVerdictGate: true,
  });

  const contractSource = readFileSync(
    new URL("./resolution-source-basis-research.ts", import.meta.url),
    "utf8",
  );
  const recordSource = readFileSync(
    new URL("../scripts/record-resolution-source-basis-research.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(contractSource, /from\s+["'][^"']*(?:db|worker|trading|paper-floor)/i);
  assert.doesNotMatch(
    recordSource,
    /venuePriceSnapshots|paperTrades|polymarket_state_snapshot|createOrder|placeOrder|privateKey|crucible_start/i,
  );
  assert.doesNotMatch(recordSource, /\.execute\s*\(/);
});
