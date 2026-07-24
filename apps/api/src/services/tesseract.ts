/**
 * Tesseract — Jester's live market-microstructure planner (read-only exploration).
 *
 * The "Market Field" scores five dimensions of a pair's 5m price action as z-scores vs a rolling
 * baseline (0 = normal): Drive (volume/participation), Heat (volatility), Mass (price acceptance),
 * Flow (trade-delta/aggression), Book (liquidity pressure). `analyze` turns the Field + a technical
 * gauge + S/R levels into a concrete, ATR-sized trade plan (entry/SL/TP/RR/size). Fixed 5m — no
 * timeframe. This is a discretionary/live tool, orthogonal to the backtest warehouse; wrapped thinly
 * here so we can study it and hunt for an edge. No trades, no funds.
 */
import { jesterCall } from "./jester.ts";

const tool = (userId: string, name: string, args: Record<string, unknown>) =>
  jesterCall(userId, "POST", "/api/delegated/mcp/tool", { name, args }, 15_000).then((r) => r?.result ?? r);

export async function tesseractField(userId: string, pair: string): Promise<any> {
  return tool(userId, "jester_tesseract_field", { pair });
}

export async function tesseractAnalyze(userId: string, pair: string): Promise<any> {
  return tool(userId, "jester_tesseract_analyze", { pair });
}

export async function tesseractCommentary(userId: string, pair: string): Promise<any> {
  return tool(userId, "jester_tesseract_commentary", { pair }).catch(() => null);
}

/** Condensed one-liner per pair for the multi-pair scan — the fields worth comparing at a glance. */
export interface TesseractScanRow {
  pair: string;
  direction: string | null;
  gaugeScore: number | null;
  gaugeLabel: string | null;
  rr: number | null;
  drive: number | null;
  heat: number | null;
  mass: number | null;
  acceptanceDirection: string | null;
  trend: string | null;
  inSqueeze: boolean | null;
  isChoppy: boolean | null;
  error?: string;
}

/** Run analyze across several pairs (bounded concurrency) and condense to a comparison table. */
export async function tesseractScan(userId: string, pairs: string[]): Promise<TesseractScanRow[]> {
  const out: TesseractScanRow[] = [];
  // Serial-ish in small batches so we don't hammer the tool / hit rate limits.
  for (let i = 0; i < pairs.length; i += 3) {
    const batch = pairs.slice(i, i + 3);
    const results = await Promise.all(
      batch.map(async (pair): Promise<TesseractScanRow> => {
        try {
          const a = await tesseractAnalyze(userId, pair);
          const p = a?.plan ?? {};
          const fs = p.fieldScores ?? {};
          const reg = p.regime ?? {};
          return {
            pair,
            direction: p.direction ?? null,
            gaugeScore: typeof p.gaugeScore === "number" ? p.gaugeScore : null,
            gaugeLabel: p.gaugeLabel ?? null,
            rr: typeof p.rr === "number" ? p.rr : null,
            drive: typeof fs.drive === "number" ? fs.drive : null,
            heat: typeof fs.heat === "number" ? fs.heat : null,
            mass: typeof fs.mass === "number" ? fs.mass : null,
            acceptanceDirection: fs.acceptanceDirection ?? null,
            trend: reg.trend ?? null,
            inSqueeze: typeof reg.inSqueeze === "boolean" ? reg.inSqueeze : null,
            isChoppy: typeof reg.isChoppy === "boolean" ? reg.isChoppy : null,
          };
        } catch (e) {
          return {
            pair, direction: null, gaugeScore: null, gaugeLabel: null, rr: null,
            drive: null, heat: null, mass: null, acceptanceDirection: null, trend: null, inSqueeze: null, isChoppy: null,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }),
    );
    out.push(...results);
  }
  return out;
}
