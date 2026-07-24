/** KB paper-fill-markout-audit-v1 — prospective, observational, never a strategy input. */
export const PAPER_MARKOUT_AUDIT = {
  version: "paper-fill-markout-audit-v1",
  evalStartMs: Date.parse("2026-07-23T09:30:00.000Z"),
  targetDelaySec: 30,
  maxDelaySec: 75,
  minTerminalRows: 1_000,
  minMarkets: 200,
  minSpanDays: 3,
} as const;

export interface MarkoutQuote {
  bestBid: number | null;
  bestAsk: number | null;
  mid: number | null;
}

export interface MarkoutBooks {
  up: MarkoutQuote;
  down: MarkoutQuote;
}

export interface PaperMarkoutRow {
  side: string;
  askPaid: number;
  decidedAtMs: number;
  modelMeta: Record<string, unknown> | null;
}

export interface PaperMarkoutObservation {
  version: typeof PAPER_MARKOUT_AUDIT.version;
  status: "captured" | "unavailable" | "stale";
  reason: string | null;
  targetDelaySec: number;
  delaySec: number;
  capturedAtMs: number;
  initialSideMid: number | null;
  sideBestBid: number | null;
  sideMid: number | null;
  midDelta: number | null;
  roundTripPerContract: number | null;
}

const finitePrice = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1;

function initialSideMid(row: PaperMarkoutRow): number | null {
  const books = row.modelMeta?.bookMicrostructure;
  if (!books || typeof books !== "object") return null;
  const side = (books as Record<string, unknown>)[row.side];
  if (!side || typeof side !== "object") return null;
  const mid = (side as Record<string, unknown>).mid;
  return finitePrice(mid) ? mid : null;
}

function coherentBooks(books: MarkoutBooks | null): books is MarkoutBooks {
  if (!books) return false;
  const quoteOk = (quote: MarkoutQuote) =>
    finitePrice(quote.bestBid)
    && finitePrice(quote.bestAsk)
    && finitePrice(quote.mid)
    && quote.bestBid < quote.bestAsk;
  return quoteOk(books.up)
    && quoteOk(books.down)
    && books.up.bestAsk! + books.down.bestAsk! > 0.9;
}

/**
 * Produce the one terminal observation for a row. Null means the 30-second target is not due yet.
 * Stale/unavailable are terminal by design; a later quote must never replace the intended horizon.
 */
export function buildPaperMarkout(
  row: PaperMarkoutRow,
  books: MarkoutBooks | null,
  nowMs: number,
  unavailableReason = "book-unavailable",
): PaperMarkoutObservation | null {
  const delaySec = (nowMs - row.decidedAtMs) / 1_000;
  if (!Number.isFinite(delaySec) || delaySec < PAPER_MARKOUT_AUDIT.targetDelaySec) return null;

  const base = {
    version: PAPER_MARKOUT_AUDIT.version,
    targetDelaySec: PAPER_MARKOUT_AUDIT.targetDelaySec,
    delaySec,
    capturedAtMs: nowMs,
    initialSideMid: initialSideMid(row),
  } as const;
  if (delaySec > PAPER_MARKOUT_AUDIT.maxDelaySec) {
    return {
      ...base,
      status: "stale",
      reason: "capture-delay-exceeded",
      sideBestBid: null,
      sideMid: null,
      midDelta: null,
      roundTripPerContract: null,
    };
  }
  if ((row.side !== "up" && row.side !== "down") || !finitePrice(row.askPaid) || !coherentBooks(books)) {
    return {
      ...base,
      status: "unavailable",
      reason: unavailableReason,
      sideBestBid: null,
      sideMid: null,
      midDelta: null,
      roundTripPerContract: null,
    };
  }

  const quote = books[row.side];
  const initialMid = base.initialSideMid;
  return {
    ...base,
    status: "captured",
    reason: null,
    sideBestBid: quote.bestBid,
    sideMid: quote.mid,
    midDelta: initialMid == null ? null : quote.mid! - initialMid,
    roundTripPerContract: quote.bestBid! - row.askPaid,
  };
}
