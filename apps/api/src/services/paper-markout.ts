import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db, paperTrades } from "@framework/db";
import { bookSummary, fetchClobBook, fetchClobMarket } from "./polymarket.ts";
import {
  buildPaperMarkout,
  PAPER_MARKOUT_AUDIT,
  type MarkoutBooks,
  type MarkoutQuote,
} from "./paper-markout-model.ts";

const quoteOf = (summary: ReturnType<typeof bookSummary> | null): MarkoutQuote => ({
  bestBid: summary?.bestBid ?? null,
  bestAsk: summary?.bestAsk ?? null,
  mid: summary?.mid ?? null,
});

async function liveBooks(conditionId: string): Promise<{ books: MarkoutBooks | null; reason: string }> {
  const market = await fetchClobMarket(conditionId).catch(() => null);
  if (!market || market.closed) return { books: null, reason: "market-unavailable" };
  const token = (outcome: "up" | "down") =>
    market.tokens.find((item) => item.outcome.trim().toLowerCase() === outcome)?.token_id ?? null;
  const upToken = token("up"), downToken = token("down");
  if (!upToken || !downToken) return { books: null, reason: "token-unavailable" };
  const [upBook, downBook] = await Promise.all([
    fetchClobBook(upToken).catch(() => null),
    fetchClobBook(downToken).catch(() => null),
  ]);
  if (!upBook || !downBook) return { books: null, reason: "book-unavailable" };
  return {
    books: {
      up: quoteOf(bookSummary(upBook)),
      down: quoteOf(bookSummary(downBook)),
    },
    reason: "incoherent-book",
  };
}

/**
 * Append one 30-second execution-quality observation to otherwise immutable paper rows.
 * Core decision/grade fields are never changed, and this metadata is not read by any strategy/gate.
 */
export async function capturePaperMarkouts(limit = 600): Promise<{
  considered: number;
  captured: number;
  unavailable: number;
  stale: number;
}> {
  const nowMs = Date.now();
  if (nowMs < PAPER_MARKOUT_AUDIT.evalStartMs) {
    return { considered: 0, captured: 0, unavailable: 0, stale: 0 };
  }
  const rows = await db
    .select({
      id: paperTrades.id,
      conditionId: paperTrades.conditionId,
      side: paperTrades.side,
      askPaid: paperTrades.askPaid,
      decidedAt: paperTrades.decidedAt,
      modelMeta: paperTrades.modelMeta,
    })
    .from(paperTrades)
    .where(and(
      gte(paperTrades.decidedAt, new Date(PAPER_MARKOUT_AUDIT.evalStartMs)),
      lte(paperTrades.decidedAt, new Date(nowMs - PAPER_MARKOUT_AUDIT.targetDelaySec * 1_000)),
      sql`not (coalesce(${paperTrades.modelMeta}, '{}'::jsonb) ? 'markout30')`,
    ))
    .orderBy(asc(paperTrades.decidedAt), asc(paperTrades.id))
    .limit(limit);
  if (!rows.length) return { considered: 0, captured: 0, unavailable: 0, stale: 0 };

  const byMarket = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = byMarket.get(row.conditionId) ?? [];
    group.push(row);
    byMarket.set(row.conditionId, group);
  }

  let captured = 0, unavailable = 0, stale = 0;
  for (const [conditionId, group] of byMarket) {
    const needsBook = group.some((row) =>
      (nowMs - row.decidedAt.getTime()) / 1_000 <= PAPER_MARKOUT_AUDIT.maxDelaySec
    );
    const live = needsBook
      ? await liveBooks(conditionId)
      : { books: null, reason: "capture-delay-exceeded" };
    for (const row of group) {
      const observation = buildPaperMarkout({
        side: row.side,
        askPaid: row.askPaid,
        decidedAtMs: row.decidedAt.getTime(),
        modelMeta: row.modelMeta,
      }, live.books, nowMs, live.reason);
      if (!observation) continue;
      await db
        .update(paperTrades)
        .set({ modelMeta: { ...(row.modelMeta ?? {}), markout30: observation } })
        .where(eq(paperTrades.id, row.id));
      if (observation.status === "captured") captured++;
      else if (observation.status === "unavailable") unavailable++;
      else stale++;
    }
  }
  return { considered: rows.length, captured, unavailable, stale };
}
