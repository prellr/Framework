/**
 * Prospective raw-feature contract for KB `polymarket-microstructure-tape-v1`.
 *
 * This module is network/DB-free. It defines only the registered boundary and deterministic
 * transforms needed to verify that future analysis uses the exact formulas written before capture.
 */
export const POLYMARKET_MICROSTRUCTURE_TAPE = {
  version: "polymarket-microstructure-tape-v1",
  evalStartMs: Date.UTC(2026, 6, 23, 5, 0, 0),
  minResolvedMarkets: 1_000,
  minSpanDays: 5,
  maxConsecutiveGapSec: 90,
} as const;

export interface BookMicrostructure {
  mid: number | null;
  microprice: number | null;
  touchImbalance: number | null;
}

export function microstructureCaptureEnabled(capturedAtMs: number): boolean {
  return capturedAtMs >= POLYMARKET_MICROSTRUCTURE_TAPE.evalStartMs;
}

export function microstructureDiagnosticReady(resolvedMarkets: number, spanDays: number): boolean {
  return resolvedMarkets >= POLYMARKET_MICROSTRUCTURE_TAPE.minResolvedMarkets
    && spanDays >= POLYMARKET_MICROSTRUCTURE_TAPE.minSpanDays;
}

/**
 * Express the two complementary outcome books in canonical UP-probability space. Null is contagious:
 * one incomplete book must not masquerade as a neutral observation.
 */
export function canonicalMicrostructure(up: BookMicrostructure, down: BookMicrostructure) {
  const binaryMid = up.mid != null && down.mid != null
    ? (up.mid + 1 - down.mid) / 2
    : null;
  const binaryMicroprice = up.microprice != null && down.microprice != null
    ? (up.microprice + 1 - down.microprice) / 2
    : null;
  return {
    binaryMid,
    binaryMicroprice,
    micropriceSkew: binaryMid != null && binaryMicroprice != null
      ? binaryMicroprice - binaryMid
      : null,
    binaryTouchPressure: binaryMid != null && up.touchImbalance != null && down.touchImbalance != null
      ? (up.touchImbalance - down.touchImbalance) / 2
      : null,
  };
}

export interface TouchState {
  capturedAtMs: number;
  bid: number;
  bidSize: number;
  ask: number;
  askSize: number;
}

function validTouch(touch: TouchState): boolean {
  return Number.isFinite(touch.capturedAtMs)
    && Number.isFinite(touch.bid)
    && Number.isFinite(touch.ask)
    && touch.bid >= 0
    && touch.bid <= 1
    && touch.ask >= 0
    && touch.ask <= 1
    && touch.bid <= touch.ask
    && Number.isFinite(touch.bidSize)
    && Number.isFinite(touch.askSize)
    && touch.bidSize >= 0
    && touch.askSize >= 0;
}

/**
 * Cont-style best-level OFI, normalized by average touch depth across the two samples. Equal-price
 * updates reduce to size deltas; quote moves treat removed/added queues as flow. Gaps fail closed.
 */
export function normalizedOrderFlowImbalance(previous: TouchState, current: TouchState): number | null {
  const gapSec = (current.capturedAtMs - previous.capturedAtMs) / 1_000;
  if (!validTouch(previous) || !validTouch(current) || gapSec <= 0 || gapSec > POLYMARKET_MICROSTRUCTURE_TAPE.maxConsecutiveGapSec) {
    return null;
  }
  const bidFlow =
    (current.bid >= previous.bid ? current.bidSize : 0)
    - (current.bid <= previous.bid ? previous.bidSize : 0);
  const askFlow =
    -(current.ask <= previous.ask ? current.askSize : 0)
    + (current.ask >= previous.ask ? previous.askSize : 0);
  const averageTouchDepth =
    (previous.bidSize + previous.askSize + current.bidSize + current.askSize) / 2;
  return averageTouchDepth > 0 ? (bidFlow + askFlow) / averageTouchDepth : null;
}

/** DOWN pressure is subtracted so positive always means pressure toward the UP outcome. */
export function canonicalOrderFlowImbalance(upOfi: number | null, downOfi: number | null): number | null {
  return upOfi != null && downOfi != null && Number.isFinite(upOfi) && Number.isFinite(downOfi)
    ? (upOfi - downOfi) / 2
    : null;
}
