import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  FORMULA_LAB_RESEARCH_FRAMEWORK,
  renderFormulaLabResearchFramework,
} from "./formula-lab-research-framework.ts";

test("Formula Lab research framework is versioned, cited, and non-authorizing", () => {
  const framework = FORMULA_LAB_RESEARCH_FRAMEWORK;
  assert.equal(framework.version, "alchemy-formula-lab-research-framework-v2");
  assert.equal(framework.status, "active");
  assert.equal(framework.extends, "updown-formulaic-fixed-horizon-lab-poc-v1");
  assert.equal(framework.mechanicsVersions.scaleEngine, "alchemy-formula-scale-engine-v1");
  assert.equal(
    framework.mechanicsVersions.capitalBacktest,
    "alchemy-formula-capital-backtest-v1",
  );
  assert.equal(framework.invariants.readsLockedLiveValues, false);
  assert.equal(framework.invariants.readsMarketOutcomes, false);
  assert.equal(framework.invariants.readsPaperOutcomes, false);
  assert.equal(framework.invariants.createsStrategy, false);
  assert.equal(framework.invariants.createsPaperBot, false);
  assert.equal(framework.invariants.startsCrucibleRun, false);
  assert.equal(framework.invariants.enablesExecution, false);
  assert.equal(framework.invariants.preservesVerdictGate, true);
});

test("research sources are classified, unique, and use stable public references", () => {
  const sources = FORMULA_LAB_RESEARCH_FRAMEWORK.sources;
  assert.ok(sources.length >= 12);
  assert.equal(new Set(sources.map((source) => source.key)).size, sources.length);
  assert.equal(new Set(sources.map((source) => source.url)).size, sources.length);
  assert.ok(sources.some((source) => source.key === "pysr" && source.kind === "academic"));
  assert.ok(sources.some((source) => source.key === "white-reality-check"));
  assert.ok(sources.some((source) => source.key === "pbo"));
  assert.ok(sources.some((source) => source.key === "deflated-sharpe"));
  assert.ok(sources.some((source) => source.key === "holm"));
  assert.ok(sources.some((source) => source.key === "polymarket-realtime"));
  assert.ok(sources.some((source) => source.key === "hyperliquid-websocket"));
  assert.ok(sources.some((source) => source.key === "chainlink-data-feeds"));
  assert.ok(sources.some(
    (source) => source.kind === "practitioner-engineering"
      && source.limitation.includes("not"),
  ));
  assert.ok(sources.every((source) => /^https:\/\//.test(source.url)));
});

test("rendered KB body explains mechanics, evidence limits, capital, and preview columns", () => {
  const body = renderFormulaLabResearchFramework("2026-07-24T23:45:00.000Z");
  for (const required of [
    "Alchemy Formula Lab research framework v2",
    "10,000 variants",
    "50,000 variants",
    "Holm correction",
    "PySR",
    "Data Snooping",
    "Backtest Overfitting",
    "Deflated Sharpe",
    "starting capital",
    "Complete frames",
    "Holdout trades",
    "Positive folds",
    "Gross mean (bps)",
    "Net mean (bps)",
    "Net hit rate",
    "retrospective-exploratory",
    "no signing, order, wallet, or fund-moving path",
  ]) {
    assert.ok(body.includes(required), `missing rendered framework text: ${required}`);
  }
  assert.match(body, /at least 1,680 frames/);
  assert.match(body, /synthetic tests establish software mechanics only/i);
  assert.match(body, /cannot register a strategy/i);
});

test("framework module remains pure and has no mutable-system import", () => {
  const source = readFileSync(
    new URL("./formula-lab-research-framework.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /from\s+["'][^"']*(?:db|router|jobs|trading|paper-floor)[^"']*["']/);
  assert.doesNotMatch(source, /\b(?:createOrder|placeOrder|submitOrder|privateKey)\b/);
});
