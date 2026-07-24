import assert from "node:assert/strict";
import test from "node:test";
import {
  PAIRED_BOOK_OFI_CONTINUATION,
  pairedBookOfiEligible,
  pairedBookOfiObservation,
  pairedBookOfiPaperDecision,
  type PairedBookOfiInput,
} from "./paired-book-ofi-continuation.ts";

const base = (): PairedBookOfiInput => ({
  previousCapturedAtMs: 1_000,
  currentCapturedAtMs: 61_000,
  previousUp: { bid: 0.48, bidSize: 10, ask: 0.52, askSize: 10 },
  previousDown: { bid: 0.48, bidSize: 10, ask: 0.52, askSize: 10 },
  currentUp: { bid: 0.50, bidSize: 30, ask: 0.54, askSize: 5 },
  currentDown: { bid: 0.46, bidSize: 5, ask: 0.50, askSize: 30 },
});

test("paired-book OFI constants preserve the preregistered boundary and universe", () => {
  assert.equal(PAIRED_BOOK_OFI_CONTINUATION.evalStartMs, 1_784_822_400_000);
  assert.equal(PAIRED_BOOK_OFI_CONTINUATION.previousSampleMinute, 1);
  assert.equal(PAIRED_BOOK_OFI_CONTINUATION.decisionSampleMinute, 2);
  assert.equal(PAIRED_BOOK_OFI_CONTINUATION.minEffort, 1);
  assert.equal(PAIRED_BOOK_OFI_CONTINUATION.minSameDirectionResponse, 0.01);
  assert.equal(PAIRED_BOOK_OFI_CONTINUATION.eventSideProbability, 0.75);
  assert.equal(PAIRED_BOOK_OFI_CONTINUATION.askEdge, 0.05);
  assert.equal(pairedBookOfiEligible("BTC-USD", 5, 2), true);
  assert.equal(pairedBookOfiEligible("BTC-USD", 15, 2), false);
  assert.equal(pairedBookOfiEligible("ADA-USD", 5, 2), false);
  assert.equal(pairedBookOfiEligible("BTC-USD", 5, 1), false);
});

test("large paired-book pressure with a same-direction move emits UP continuation", () => {
  const observation = pairedBookOfiObservation(base());
  assert.ok(observation);
  assert.ok(observation.canonicalOfi >= PAIRED_BOOK_OFI_CONTINUATION.minEffort);
  assert.ok(observation.signedResponse > PAIRED_BOOK_OFI_CONTINUATION.minSameDirectionResponse);
  assert.equal(observation.side, "up");
  assert.equal(observation.pup, 0.75);
});

test("the exact mirrored state emits DOWN continuation", () => {
  const input = base();
  const observation = pairedBookOfiObservation({
    ...input,
    currentUp: input.currentDown,
    currentDown: input.currentUp,
  });
  assert.ok(observation);
  assert.ok(observation.canonicalOfi <= -PAIRED_BOOK_OFI_CONTINUATION.minEffort);
  assert.ok(observation.signedResponse > PAIRED_BOOK_OFI_CONTINUATION.minSameDirectionResponse);
  assert.equal(observation.side, "down");
  assert.equal(observation.pup, 0.25);
});

test("large pressure without more than one cent of continuation abstains", () => {
  const input = base();
  const observation = pairedBookOfiObservation({
    ...input,
    currentUp: { bid: 0.48, bidSize: 50, ask: 0.52, askSize: 1 },
    currentDown: { bid: 0.48, bidSize: 1, ask: 0.52, askSize: 50 },
  });
  assert.ok(observation);
  assert.ok(observation.effort >= PAIRED_BOOK_OFI_CONTINUATION.minEffort);
  assert.equal(observation.response, 0);
  assert.equal(observation.side, null);
  assert.equal(observation.pup, null);
});

test("stale gaps and malformed touches fail closed", () => {
  assert.equal(pairedBookOfiObservation({ ...base(), currentCapturedAtMs: 92_000 }), null);
  assert.equal(
    pairedBookOfiObservation({
      ...base(),
      currentUp: { ...base().currentUp, bid: 0.60, ask: 0.50 },
    }),
    null,
  );
});

test("paper decision uses the strict fee-adjusted ask edge and requires both fills", () => {
  const observation = pairedBookOfiObservation(base());
  assert.ok(observation);
  assert.deepEqual(pairedBookOfiPaperDecision(observation, 0.69, 0.45), {
    side: "up",
    pup: 0.75,
    selectedAsk: 0.69,
    controlAsk: 0.45,
    edgeAsk: 0.06000000000000005,
  });
  assert.equal(pairedBookOfiPaperDecision(observation, 0.70, 0.45), null);
  assert.equal(pairedBookOfiPaperDecision(observation, 0.69, 0.99), null);
});
