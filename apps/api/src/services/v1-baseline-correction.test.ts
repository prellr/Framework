import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const apiRoot = new URL("../", import.meta.url);
const webRoot = new URL("../../../web/src/pages/polymarket/", import.meta.url);

test("V1 runtime and UI narratives preserve the baseline retraction", () => {
  const logger = readFileSync(new URL("services/signal-v1-logger.ts", apiRoot), "utf8");
  const meta = readFileSync(new URL("polymarket-strategy-meta.ts", webRoot), "utf8");
  assert.doesNotMatch(logger, /3\.2σ COUNTER-informative/);
  assert.match(logger, /conclusion was retracted/);
  assert.match(logger, /only on their separately frozen forward evidence/);
  assert.match(meta, /earlier counter-informative claim was retracted/);
});

test("durable V1 correction propagation is metadata-only and idempotent", () => {
  const source = readFileSync(
    new URL("scripts/record-v1-baseline-correction-propagation.ts", apiRoot),
    "utf8",
  );
  assert.match(source, /entry-quality-screen-baseline-correction/);
  assert.match(source, /Retraction notice — symmetric-bracket baseline correction/);
  assert.match(source, /article\.body\.includes\(marker\)/);
  assert.match(source, /37\.8% is ordinary/);
  assert.match(source, /changes no bridge, signal ingestion, paper row, gate, threshold, side, or execution setting/);
  for (const prohibited of [
    "paperTrades",
    "paper_trade",
    "pnlUsd",
    "askPaid",
    "controlAskPaid",
    "gradedAt",
  ]) {
    assert.equal(source.includes(prohibited), false, `${prohibited} must not be read`);
  }
});

test("V1 subscription source-health record is read-only and preserves the frozen family", () => {
  const source = readFileSync(
    new URL("scripts/record-v1-subscription-health.ts", apiRoot),
    "utf8",
  );
  assert.match(source, /Jester V1 is not subscribed/);
  assert.match(source, /jester_subscription_audit/);
  assert.match(source, /PAPER_FAMILYWISE_HYPOTHESES/);
  assert.match(source, /article\.body\.includes\(marker\)/);
  assert.match(source, /No activation or subscription action was requested or executed/);
  assert.doesNotMatch(source, /paperTrades|paper_trade|resultNet|pnlUsd|askPaid|controlAskPaid/);
  assert.doesNotMatch(source, /name:\s*"jester_automation_actions"/);
  assert.doesNotMatch(source, /jesterTradeCall\(/);
});
