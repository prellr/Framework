import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalMicrostructure,
  canonicalOrderFlowImbalance,
  microstructureCaptureEnabled,
  microstructureDiagnosticReady,
  normalizedOrderFlowImbalance,
  POLYMARKET_MICROSTRUCTURE_TAPE,
} from "./polymarket-microstructure.ts";

test("microstructure tape uses the preregistered boundary exactly", () => {
  assert.equal(microstructureCaptureEnabled(POLYMARKET_MICROSTRUCTURE_TAPE.evalStartMs - 1), false);
  assert.equal(microstructureCaptureEnabled(POLYMARKET_MICROSTRUCTURE_TAPE.evalStartMs), true);
});

test("microstructure diagnostics stay locked until both frozen sample floors pass", () => {
  assert.equal(microstructureDiagnosticReady(999, 5), false);
  assert.equal(microstructureDiagnosticReady(1_000, 4.999), false);
  assert.equal(microstructureDiagnosticReady(1_000, 5), true);
});

test("canonical microstructure converts DOWN into UP probability space", () => {
  const result = canonicalMicrostructure(
    { mid: 0.57, microprice: 0.59, touchImbalance: 0.4 },
    { mid: 0.41, microprice: 0.38, touchImbalance: -0.2 },
  );
  assert.ok(Math.abs((result.binaryMid ?? 0) - 0.58) < 1e-12);
  assert.ok(Math.abs((result.binaryMicroprice ?? 0) - 0.605) < 1e-12);
  assert.ok(Math.abs((result.micropriceSkew ?? 0) - 0.025) < 1e-12);
  assert.ok(Math.abs((result.binaryTouchPressure ?? 0) - 0.3) < 1e-12);
});

test("canonical microstructure fails closed when either outcome book is incomplete", () => {
  const result = canonicalMicrostructure(
    { mid: 0.57, microprice: null, touchImbalance: 0.4 },
    { mid: 0.41, microprice: 0.38, touchImbalance: null },
  );
  assert.equal(result.binaryMid, 0.58);
  assert.equal(result.binaryMicroprice, null);
  assert.equal(result.micropriceSkew, null);
  assert.equal(result.binaryTouchPressure, null);
  assert.equal(canonicalMicrostructure(
    { mid: null, microprice: null, touchImbalance: 1 },
    { mid: 0.41, microprice: 0.38, touchImbalance: -0.2 },
  ).binaryTouchPressure, null);
});

test("normalized OFI reduces unchanged quotes to queue-size flow", () => {
  const result = normalizedOrderFlowImbalance(
    { capturedAtMs: 0, bid: 0.48, bidSize: 10, ask: 0.52, askSize: 5 },
    { capturedAtMs: 60_000, bid: 0.48, bidSize: 12, ask: 0.52, askSize: 4 },
  );
  assert.ok(Math.abs((result ?? 0) - 3 / 15.5) < 1e-12);
});

test("normalized OFI treats an upward quote move as positive and rejects stale gaps", () => {
  const previous = { capturedAtMs: 0, bid: 0.48, bidSize: 10, ask: 0.52, askSize: 5 };
  const current = { capturedAtMs: 60_000, bid: 0.49, bidSize: 7, ask: 0.53, askSize: 6 };
  assert.ok((normalizedOrderFlowImbalance(previous, current) ?? 0) > 0);
  assert.equal(normalizedOrderFlowImbalance(previous, { ...current, capturedAtMs: 91_000 }), null);
});

test("canonical OFI subtracts DOWN pressure and fails closed", () => {
  assert.ok(Math.abs((canonicalOrderFlowImbalance(0.4, -0.2) ?? 0) - 0.3) < 1e-12);
  assert.equal(canonicalOrderFlowImbalance(0.4, null), null);
});
