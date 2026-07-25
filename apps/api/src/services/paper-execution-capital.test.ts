import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const service = readFileSync(
  new URL("./paper-execution-capital.ts", import.meta.url),
  "utf8",
);
const router = readFileSync(
  new URL("../routers/polymarket.ts", import.meta.url),
  "utf8",
);
const page = readFileSync(
  new URL("../../../web/src/pages/polymarket/PolymarketExecutionCapital.tsx", import.meta.url),
  "utf8",
);

test("execution and capital projection remains read-only and paper-only", () => {
  assert.match(service, /paperOnly:\s*true as const/);
  assert.match(service, /executionCapability:\s*false as const/);
  assert.match(router, /executionCapital:\s*protectedProcedure[\s\S]*?\.query/);
  assert.doesNotMatch(service, /\b(placeOrder|submitOrder|cancelOrder|privateKey|signature)\b/);
});

test("venue-cost evidence deduplicates shared strategy quote snapshots", () => {
  assert.match(service, /quote_samples as \([\s\S]*?select distinct[\s\S]*?condition_id,[\s\S]*?side/);
  assert.match(service, /Gross book-walk VWAP minus the captured best ask/);
  assert.match(service, /Fee-adjusted effective VWAP minus gross book-walk VWAP/);
});

test("capital comparison preserves opposed contracts and exposes both peak models", () => {
  assert.match(service, /group by condition_id, side/);
  assert.match(service, /count\(\*\) filter \(where sides > 1\)::int as opposed_markets/);
  assert.match(service, /peak_naive_capital_usd/);
  assert.match(service, /peak_deduplicated_capital_usd/);
});

test("the dedicated view exposes ask history, cross-strategy segments, and no profit stress", () => {
  assert.match(page, /Entry-ask economics over time/);
  assert.match(page, /Cross-strategy diagnostic map/);
  assert.match(page, /Capital stacking/);
  assert.match(page, /Stake capacity/);
  assert.doesNotMatch(page, /profit stress|Stress −36%/i);
});
