import assert from "node:assert/strict";
import test from "node:test";
import {
  BSM_WINDOW_PROFILE,
  bsmProfileRemainingVarianceMin,
  bsmWindowProfileEligible,
} from "./bsm-window-profile.ts";

const close = (actual: number | null, expected: number, tolerance = 1e-12) => {
  assert.notEqual(actual, null);
  assert.ok(Math.abs(actual! - expected) <= tolerance, `${actual} != ${expected}`);
};

test("profile is the exact preregistered BTC 5m hypothesis", () => {
  assert.equal(BSM_WINDOW_PROFILE.version, "bsm-btc5m-window-profile-v1");
  assert.equal(BSM_WINDOW_PROFILE.evalStartMs, 1_784_804_400_000);
  assert.equal(BSM_WINDOW_PROFILE.pair, "BTC-USD");
  assert.equal(BSM_WINDOW_PROFILE.horizonMin, 5);
  close(BSM_WINDOW_PROFILE.varianceWeights.reduce((sum, value) => sum + value, 0), 5);
});

test("eligibility fails closed outside BTC 5m", () => {
  assert.equal(bsmWindowProfileEligible({ pair: "BTC-USD", horizonMin: 5 }), true);
  assert.equal(bsmWindowProfileEligible({ pair: "ETH-USD", horizonMin: 5 }), false);
  assert.equal(bsmWindowProfileEligible({ pair: "BTC-USD", horizonMin: 15 }), false);
  assert.equal(bsmWindowProfileEligible({ horizonMin: 5 }), false);
});

test("remaining variance is the exact piecewise profile integral", () => {
  close(bsmProfileRemainingVarianceMin(5), 5);
  close(
    bsmProfileRemainingVarianceMin(4),
    BSM_WINDOW_PROFILE.varianceWeights.slice(1).reduce((sum, value) => sum + value, 0),
  );
  close(
    bsmProfileRemainingVarianceMin(1.5),
    0.5 * BSM_WINDOW_PROFILE.varianceWeights[3] + BSM_WINDOW_PROFILE.varianceWeights[4],
  );
  close(bsmProfileRemainingVarianceMin(0.5), 0.5 * BSM_WINDOW_PROFILE.varianceWeights[4]);
});

test("invalid or out-of-window remaining time fails closed", () => {
  assert.equal(bsmProfileRemainingVarianceMin(0), null);
  assert.equal(bsmProfileRemainingVarianceMin(-1), null);
  assert.equal(bsmProfileRemainingVarianceMin(5.000001), null);
  assert.equal(bsmProfileRemainingVarianceMin(Number.NaN), null);
  assert.equal(bsmProfileRemainingVarianceMin(Number.POSITIVE_INFINITY), null);
});
