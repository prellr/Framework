/**
 * Trade composite gauge logger — bot #2 for the Up/Down tournament (parallel to the Tesseract logger).
 *
 * `jester_technical_gauge_scan` returns the Trade-page composite gauge (score 0–100 + strength
 * category) for a set of pairs in ONE call, at 5m resolution — the same signal that drives the
 * `trade_gauge_flip` strategy. We bridge score→P(up) exactly like Tesseract's gauge and forward-log it
 * to `signal_snapshot` (source="trade_gauge") so the Polymarket scorer can align it at each market's
 * window start and score "follow/fade the Trade gauge" as competing bots. Read-only — no trades.
 */
import { db, jesterCredentials, signalSnapshots } from "@framework/db";
import { getSetting } from "./config.ts";
import { jesterCall } from "./jester.ts";

export const GAUGE_SOURCE = "trade_gauge";
const ENABLED_KEY = "signal_gauge_logger_enabled"; // "true" to arm; default armed
const PAIRS_KEY = "signal_gauge_pairs";
// The Up/Down coins we have markets on (scan is one call regardless of count).
const DEFAULT_PAIRS = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD", "BNB-USD"];

/** Bridge the 0–100 gauge to a P(up), clamped off the rails (same shape as the Tesseract bridge). */
export const gaugeScoreToPup = (score: number) => Math.max(0.02, Math.min(0.98, score / 100));

export async function gaugeLoggerEnabled(): Promise<boolean> {
  const v = await getSetting(ENABLED_KEY);
  return v == null ? true : v === "true";
}

async function gaugePairs(): Promise<string[]> {
  const raw = await getSetting(PAIRS_KEY);
  if (!raw) return DEFAULT_PAIRS;
  const out = raw.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
  return out.length ? out : DEFAULT_PAIRS;
}

interface GaugeRow { pair: string; score: number; category?: string; label?: string; barTimestamp?: number }

/** One scan call → one signal_snapshot row per pair. Returns how many were written. */
export async function snapshotTradeGauge(userId: string): Promise<{ written: number }> {
  const pairs = await gaugePairs();
  const res = await jesterCall(
    userId,
    "POST",
    "/api/delegated/mcp/tool",
    { name: "jester_technical_gauge_scan", args: { pairs } },
    20_000,
  ).then((r) => r?.result ?? r);
  const rows: GaugeRow[] = Array.isArray(res?.pairs) ? res.pairs : [];
  if (!rows.length) return { written: 0 };
  const now = new Date();
  const values = rows
    .filter((r) => typeof r.score === "number" && r.pair)
    .map((r) => ({
      source: GAUGE_SOURCE,
      pair: r.pair,
      capturedAt: now,
      pup: gaugeScoreToPup(r.score),
      score: r.score,
      category: r.category ?? r.label ?? null,
      meta: r.barTimestamp ? { barTimestamp: r.barTimestamp } : null,
    }));
  if (!values.length) return { written: 0 };
  await db.insert(signalSnapshots).values(values);
  return { written: values.length };
}
