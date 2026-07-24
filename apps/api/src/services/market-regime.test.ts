import test from "node:test";
import assert from "node:assert/strict";
import { classifyMarketRegime } from "./market-regime.ts";
import type { Bar5m } from "./candle-signals.ts";

const barsFromCloses = (closes: number[], range = 2): Bar5m[] => closes.map((c, i) => ({
  t: i * 300_000,
  o: c,
  h: c + range / 2,
  l: c - range / 2,
  c,
}));

test("market regime identifies directional CMO trend", () => {
  const regime = classifyMarketRegime(barsFromCloses(Array.from({ length: 20 }, (_, i) => 100 + i), 2));
  assert.equal(regime?.label, "trend");
  assert.equal(regime?.cmo, 1);
  assert.equal(regime?.nr7, false);
});

test("market regime identifies balanced chop", () => {
  const closes = Array.from({ length: 20 }, (_, i) => 100 + (i % 2));
  const bars = barsFromCloses(closes).map((bar, i) => ({ ...bar, h: bar.c + (1 + i * 0.1), l: bar.c - (1 + i * 0.1) }));
  const regime = classifyMarketRegime(bars);
  assert.equal(regime?.label, "chop");
  assert.ok((regime?.absCmo ?? 1) <= 0.1);
});

test("NR7 compression takes precedence over trend", () => {
  const bars = barsFromCloses(Array.from({ length: 20 }, (_, i) => 100 + i), 4);
  const last = bars[bars.length - 1];
  last.h = last.c + 0.1;
  last.l = last.c - 0.1;
  const regime = classifyMarketRegime(bars);
  assert.equal(regime?.label, "compression");
  assert.equal(regime?.nr7, true);
  assert.ok((regime?.absCmo ?? 0) >= 0.3);
});

test("market regime abstains on insufficient bars", () => {
  assert.equal(classifyMarketRegime(barsFromCloses([1, 2, 3])), null);
});
