import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MARKET_REGIME_V1 } from "./market-regime.ts";
import {
  PRICER_MC_5M_TREND,
  pricerMc5mTrendEligible,
  pricerMc5mTrendQualified,
} from "./pricer-mc-trend.ts";
import { PRICER } from "./pricer.ts";

const regime = (label: "trend" | "chop" | "compression" | "neutral") => ({
  version: MARKET_REGIME_V1.version,
  label,
  cmo: label === "trend" ? 0.4 : 0,
  absCmo: label === "trend" ? 0.4 : 0,
  nr7: false,
  insideNr4: false,
  asOfMs: PRICER_MC_5M_TREND.evalStartMs - 5 * 60_000,
});

test("bootstrap-MC trend child freezes a later 5m-only boundary", () => {
  assert.equal(PRICER_MC_5M_TREND.version, "updown-pricer-mc-5m-trend-v1");
  assert.equal(
    new Date(PRICER_MC_5M_TREND.evalStartMs).toISOString(),
    "2026-07-24T05:00:00.000Z",
  );
  assert.equal(PRICER_MC_5M_TREND.parentKey, "pricerMC");
  assert.equal(PRICER_MC_5M_TREND.askEdge, PRICER.askEdge);
  assert.equal(pricerMc5mTrendEligible(5), true);
  assert.equal(pricerMc5mTrendEligible(15), false);
});

test("bootstrap-MC trend child admits only the exact frozen completed-bar label", () => {
  assert.equal(pricerMc5mTrendQualified(regime("trend")), true);
  assert.equal(pricerMc5mTrendQualified(regime("chop")), false);
  assert.equal(pricerMc5mTrendQualified(regime("compression")), false);
  assert.equal(pricerMc5mTrendQualified(regime("neutral")), false);
  assert.equal(pricerMc5mTrendQualified(null), false);
});

test("bootstrap-MC trend launch audit is outcome-blind and proves the frozen subset", () => {
  const source = readFileSync(
    new URL("../scripts/record-pricer-mc-trend-launch.ts", import.meta.url),
    "utf8",
  );
  for (const prohibited of [
    "child.side",
    "child.ask_paid",
    "child.control_ask_paid",
    "child.status",
    "child.pnl_usd",
    "parent.side",
    "parent.ask_paid",
    "parent.status",
    "parent.pnl_usd",
  ]) {
    assert.equal(source.includes(prohibited), false, `${prohibited} must not be read`);
  }
  assert.match(source, /emptyBeforeBoundary/);
  assert.match(source, /fiveMinuteOnly/);
  assert.match(source, /frozenModelMetadata/);
  assert.match(source, /strictParentSubset/);
});
