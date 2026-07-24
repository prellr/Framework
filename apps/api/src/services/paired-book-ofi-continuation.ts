/**
 * Pure, outcome-free decision contract for KB
 * `updown-paired-book-ofi-continuation-v1`.
 *
 * The paper engine supplies one immutable minute-1 touch and one current paired-book observation.
 * This module has no network, database, grading, order, wallet, or execution dependency.
 */
import {
  canonicalOrderFlowImbalance,
  normalizedOrderFlowImbalance,
  type TouchState,
} from "./polymarket-microstructure.ts";

export const PAIRED_BOOK_OFI_CONTINUATION = {
  version: "updown-paired-book-ofi-continuation-v1",
  evalStartMs: Date.UTC(2026, 6, 23, 16, 0, 0),
  pairs: ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD", "BNB-USD"],
  horizonMin: 5,
  previousSampleMinute: 1,
  decisionSampleMinute: 2,
  minEffort: 1,
  minSameDirectionResponse: 0.01,
  eventSideProbability: 0.75,
  askEdge: 0.05,
  minFill: 0.02,
  maxFill: 0.98,
  maxBatchRequestMs: 1_000,
} as const;

export interface PairedBookTouch {
  bid: number;
  bidSize: number;
  ask: number;
  askSize: number;
}

export interface PairedBookOfiInput {
  previousCapturedAtMs: number;
  currentCapturedAtMs: number;
  previousUp: PairedBookTouch;
  previousDown: PairedBookTouch;
  currentUp: PairedBookTouch;
  currentDown: PairedBookTouch;
}

export interface PairedBookOfiObservation {
  upOfi: number;
  downOfi: number;
  canonicalOfi: number;
  previousCanonicalMid: number;
  currentCanonicalMid: number;
  effort: number;
  response: number;
  signedResponse: number;
  side: "up" | "down" | null;
  pup: number | null;
}

export interface PairedBookOfiPaperDecision {
  side: "up" | "down";
  pup: number;
  selectedAsk: number;
  controlAsk: number;
  edgeAsk: number;
}

function validTouch(touch: PairedBookTouch): boolean {
  return Number.isFinite(touch.bid)
    && Number.isFinite(touch.ask)
    && Number.isFinite(touch.bidSize)
    && Number.isFinite(touch.askSize)
    && touch.bid >= 0
    && touch.ask <= 1
    && touch.bid <= touch.ask
    && touch.bidSize >= 0
    && touch.askSize >= 0;
}

function canonicalMid(up: PairedBookTouch, down: PairedBookTouch): number | null {
  if (!validTouch(up) || !validTouch(down)) return null;
  const upMid = (up.bid + up.ask) / 2;
  const downMid = (down.bid + down.ask) / 2;
  const value = (upMid + 1 - downMid) / 2;
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function touchAt(capturedAtMs: number, touch: PairedBookTouch): TouchState {
  return {
    capturedAtMs,
    bid: touch.bid,
    bidSize: touch.bidSize,
    ask: touch.ask,
    askSize: touch.askSize,
  };
}

export function pairedBookOfiEligible(
  pair: string,
  horizonMin: number,
  sampleMinute: number,
): boolean {
  return PAIRED_BOOK_OFI_CONTINUATION.pairs.includes(
    pair as typeof PAIRED_BOOK_OFI_CONTINUATION.pairs[number],
  )
    && horizonMin === PAIRED_BOOK_OFI_CONTINUATION.horizonMin
    && sampleMinute === PAIRED_BOOK_OFI_CONTINUATION.decisionSampleMinute;
}

/**
 * Frozen continuation transform. Large pressure without a >1-cent same-direction response abstains;
 * that state belongs to the separately registered absorption audit.
 */
export function pairedBookOfiObservation(
  input: PairedBookOfiInput,
): PairedBookOfiObservation | null {
  const previousCanonicalMid = canonicalMid(input.previousUp, input.previousDown);
  const currentCanonicalMid = canonicalMid(input.currentUp, input.currentDown);
  if (previousCanonicalMid == null || currentCanonicalMid == null) return null;

  const upOfi = normalizedOrderFlowImbalance(
    touchAt(input.previousCapturedAtMs, input.previousUp),
    touchAt(input.currentCapturedAtMs, input.currentUp),
  );
  const downOfi = normalizedOrderFlowImbalance(
    touchAt(input.previousCapturedAtMs, input.previousDown),
    touchAt(input.currentCapturedAtMs, input.currentDown),
  );
  const canonicalOfi = canonicalOrderFlowImbalance(upOfi, downOfi);
  if (upOfi == null || downOfi == null || canonicalOfi == null) return null;

  const effort = Math.abs(canonicalOfi);
  const response = currentCanonicalMid - previousCanonicalMid;
  const signedResponse = Math.sign(canonicalOfi) * response;
  const qualifies = canonicalOfi !== 0
    && effort >= PAIRED_BOOK_OFI_CONTINUATION.minEffort
    && signedResponse > PAIRED_BOOK_OFI_CONTINUATION.minSameDirectionResponse;
  const side = qualifies ? (canonicalOfi > 0 ? "up" : "down") : null;
  return {
    upOfi,
    downOfi,
    canonicalOfi,
    previousCanonicalMid,
    currentCanonicalMid,
    effort,
    response,
    signedResponse,
    side,
    pup: side == null
      ? null
      : side === "up"
        ? PAIRED_BOOK_OFI_CONTINUATION.eventSideProbability
        : 1 - PAIRED_BOOK_OFI_CONTINUATION.eventSideProbability,
  };
}

function validFill(value: number): boolean {
  return Number.isFinite(value)
    && value > PAIRED_BOOK_OFI_CONTINUATION.minFill
    && value < PAIRED_BOOK_OFI_CONTINUATION.maxFill;
}

/** Apply the frozen fee-adjusted real-ask edge rule to an already-qualified observation. */
export function pairedBookOfiPaperDecision(
  observation: PairedBookOfiObservation,
  upFill: number,
  downFill: number,
): PairedBookOfiPaperDecision | null {
  if (!observation.side || observation.pup == null || !validFill(upFill) || !validFill(downFill)) {
    return null;
  }
  const selectedAsk = observation.side === "up" ? upFill : downFill;
  const maximumAsk = PAIRED_BOOK_OFI_CONTINUATION.eventSideProbability
    - PAIRED_BOOK_OFI_CONTINUATION.askEdge;
  if (!(selectedAsk < maximumAsk)) return null;
  const edgeAsk = PAIRED_BOOK_OFI_CONTINUATION.eventSideProbability - selectedAsk;
  return {
    side: observation.side,
    pup: observation.pup,
    selectedAsk,
    controlAsk: downFill,
    edgeAsk,
  };
}
