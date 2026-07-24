import assert from "node:assert/strict";
import test from "node:test";
import {
  bsDeltaProxy,
  buildDeribitSkewSample,
  deribitSkewDiagnosticReady,
  DERIBIT_SKEW_TAPE,
  type DeribitBookSummary,
  type DeribitInstrument,
} from "./deribit-skew.ts";

const NOW = DERIBIT_SKEW_TAPE.evalStartMs + 60_000;
const HOUR = 3_600_000;

const instrument = (
  name: string,
  expirationMs: number,
  strike: number,
  optionType: "call" | "put",
): DeribitInstrument => ({
  instrument_name: name,
  expiration_timestamp: expirationMs,
  strike,
  option_type: optionType,
  is_active: true,
  state: "open",
});

const summary = (
  name: string,
  markIv: number,
  openInterest: number,
  bid = 0.05,
  ask = 0.06,
): DeribitBookSummary => ({
  instrument_name: name,
  mark_iv: markIv,
  underlying_price: 100,
  interest_rate: 0,
  open_interest: openInterest,
  bid_price: bid,
  ask_price: ask,
});

function fixture() {
  const tooSoon = NOW + 6 * HOUR;
  const selected = NOW + 24 * HOUR;
  const later = NOW + 48 * HOUR;
  const instruments: DeribitInstrument[] = [
    instrument("BTC-SOON-100-C", tooSoon, 100, "call"),
    instrument("BTC-SOON-100-P", tooSoon, 100, "put"),
  ];
  const summaries: DeribitBookSummary[] = [
    summary("BTC-SOON-100-C", 50, 1),
    summary("BTC-SOON-100-P", 50, 1),
  ];
  for (const expiry of [selected, later]) {
    const tag = expiry === selected ? "NEAR" : "LATER";
    for (const strike of [98, 100, 102]) {
      instruments.push(instrument(`BTC-${tag}-${strike}-C`, expiry, strike, "call"));
      instruments.push(instrument(`BTC-${tag}-${strike}-P`, expiry, strike, "put"));
      summaries.push(summary(`BTC-${tag}-${strike}-C`, strike === 100 ? 55 : 60, strike));
      summaries.push(summary(`BTC-${tag}-${strike}-P`, strike === 100 ? 65 : 70, strike * 2));
    }
  }
  return { instruments, summaries, selected };
}

test("Black-Scholes delta proxy is symmetric at the money when carry is zero", () => {
  const t = 1 / 365.25;
  const call = bsDeltaProxy("call", 100, 100, 50, 0, t);
  const put = bsDeltaProxy("put", 100, 100, 50, 0, t);
  assert.ok(call != null && put != null);
  assert.ok(Math.abs((call - put) - 1) < 1e-12);
  assert.equal(bsDeltaProxy("call", 0, 100, 50, 0, t), null);
});

test("Deribit skew transform selects the nearest eligible expiry and deterministic wings", () => {
  const { instruments, summaries, selected } = fixture();
  const result = buildDeribitSkewSample("BTC", instruments, summaries, NOW);
  assert.ok(result);
  assert.equal(result.expirationAtMs, selected);
  assert.equal(result.timeToExpiryHours, 24);
  assert.equal(result.call25.strike, 102);
  assert.equal(result.put25.strike, 98);
  assert.equal(result.rr25VolPoints, -10);
  assert.equal(result.atmStrike, 100);
  assert.equal(result.atmMarkIv, 60);
  assert.equal(result.callOpenInterest, 300);
  assert.equal(result.putOpenInterest, 600);
  assert.equal(result.putCallOiRatio, 2);
  assert.equal(result.optionCount, 6);
  assert.equal(result.twoSidedCount, 6);
});

test("Deribit skew transform ignores a one-sided wing and never backfills pre-boundary", () => {
  const { instruments, summaries } = fixture();
  const callWing = summaries.find((row) => row.instrument_name === "BTC-NEAR-102-C")!;
  callWing.bid_price = null;
  const result = buildDeribitSkewSample("BTC", instruments, summaries, NOW);
  assert.ok(result);
  assert.notEqual(result.call25.instrument, "BTC-NEAR-102-C");
  assert.equal(
    buildDeribitSkewSample("BTC", instruments, summaries, DERIBIT_SKEW_TAPE.evalStartMs - 1),
    null,
  );
});

test("Deribit diagnostic readiness requires both frozen floors", () => {
  assert.equal(deribitSkewDiagnosticReady(499, 3), false);
  assert.equal(deribitSkewDiagnosticReady(500, 2.999), false);
  assert.equal(deribitSkewDiagnosticReady(500, 3), true);
  assert.equal(DERIBIT_SKEW_TAPE.evalStartMs, Date.parse("2026-07-23T06:00:00.000Z"));
});
