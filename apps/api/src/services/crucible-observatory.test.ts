import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildCrucibleObservatory } from "./crucible-observatory-model.ts";

test("Crucible observatory groups warehouse results into discovery collections", () => {
  const programs = [
    {
      id: "prog_crucible_a",
      name: "Discovery Target BTC LONG (pending)",
      tier: "STANDARD",
      category: "CRUCIBLE_PROGRAM",
      nativeTimeframe: "5m",
      description: null,
      refreshedAt: new Date("2026-07-20T08:40:21Z"),
    },
    {
      id: "prog_crucible_b",
      name: "Discovery Target ETH SHORT (review)",
      tier: "STANDARD",
      category: "CRUCIBLE_PROGRAM",
      nativeTimeframe: "15m",
      description: null,
      refreshedAt: new Date("2026-07-21T08:40:21Z"),
    },
  ];
  const runs = [
    {
      id: "1",
      strategyId: "prog_crucible_a",
      pair: "BTC-USD",
      timeframe: "15m",
      daysRequested: 30,
      actualStart: "2026-06-20",
      actualEnd: "2026-07-20",
      spanDays: 30,
      totalReturn: "12.5",
      totalTrades: 30,
      winRate: "60",
      maxDrawdown: "-4",
      sharpe: "0.4",
      profitFactor: "1.8",
      paramHash: "default",
      jesterParamCode: null,
      ranAt: new Date("2026-07-20T09:00:00Z"),
      variants: 1,
    },
    {
      id: "2",
      strategyId: "prog_crucible_a",
      pair: "ETH-USD",
      timeframe: "1h",
      daysRequested: 30,
      actualStart: "2026-06-21",
      actualEnd: "2026-07-21",
      spanDays: 30,
      totalReturn: "-2",
      totalTrades: 10,
      winRate: "40",
      maxDrawdown: "-8",
      sharpe: "-0.1",
      profitFactor: "0.7",
      paramHash: "default",
      jesterParamCode: null,
      ranAt: new Date("2026-07-21T09:00:00Z"),
      variants: 1,
    },
  ];
  const report = buildCrucibleObservatory(programs, runs);
  assert.deepEqual(report.summary, {
    programs: 2,
    results: 2,
    assets: 2,
    timeframes: 2,
    latestRunAt: new Date("2026-07-21T09:00:00Z"),
    catalogRefreshedAt: new Date("2026-07-21T08:40:21Z"),
  });
  assert.equal(report.collections[0]?.target, "BTC");
  assert.equal(report.collections[0]?.direction, "LONG");
  assert.equal(report.collections[0]?.positiveReturnCells, 1);
  assert.equal(report.collections[0]?.sufficientSampleCells, 1);
  assert.equal(report.collections[0]?.medianProfitFactor, 1.25);
  assert.equal(report.collections[0]?.worstDrawdown, -8);
  assert.equal(report.safety.canStart, false);
  assert.equal(report.sources.liveTargetCollections, false);
});

test("Crucible router and service remain warehouse-only and non-mutating", () => {
  const routerSource = readFileSync(new URL("../routers/crucible.ts", import.meta.url), "utf8");
  const serviceSource = readFileSync(new URL("./crucible-observatory.ts", import.meta.url), "utf8");
  assert.match(routerSource, /observatory:\s*protectedProcedure\.query/);
  assert.doesNotMatch(routerSource, /\.mutation|operatorProcedure|managerProcedure/);
  assert.doesNotMatch(serviceSource, /jesterCall|rawCall|fetch\(|jester_crucible|jester_targets/);
});
