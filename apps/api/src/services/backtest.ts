/**
 * Backtest cell execution — the crux of the warehouse.
 *
 * runCell resolves ONE (strategy, pair, timeframe, days, params) coordinate to a
 * backtest_run, DEDUP-FIRST: if a fresh matching row exists it's reused and no Jester
 * call is made (spending none of the user's rate budget). On a miss it runs the backtest,
 * learns the pair/timeframe's real coverage, and inserts the shared row.
 *
 * Used synchronously by the results router in Phase 1; the sweep worker fans out over it
 * in Phase 2.
 */

import { createHash } from "crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, backtestRuns, pairTimeframeSpans, strategies } from "@framework/db";
import { jesterCall, JesterError } from "./jester.ts";

/** Default freshness window (days). Adaptable per-timeframe later (design §15). */
const FRESHNESS_DAYS = 1;

export interface CellSpec {
  strategyId: string;
  pair: string;
  timeframe: string;
  days: number;
  parameters?: Record<string, unknown>;
}

export type CellSource = "cache" | "fresh";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run jester_run_backtest with retry. The synchronous MCP backtest tool fails (returns a blank
 * success:false) when several fire concurrently, unlike the async REST queue. Retrying with
 * jittered backoff lets contended calls succeed once the collision clears.
 */
async function runJesterBacktest(
  userId: string,
  args: Record<string, unknown>,
  tries = 6,
): Promise<any> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await jesterCall(userId, "POST", "/api/delegated/mcp/tool", {
        name: "jester_run_backtest",
        args,
      });
      if (!res?.result?.metrics) throw new Error("jester_run_backtest returned no metrics");
      return res;
    } catch (e) {
      lastErr = e;
      await sleep(400 * (i + 1) + Math.floor(Math.random() * 400));
    }
  }
  // The synchronous tool is heavily throttled; make a 429 legible instead of "Jester call failed".
  if (lastErr instanceof JesterError && lastErr.httpStatus === 429) {
    throw new JesterError(
      "Jester rate limit (429) on the synchronous backtest tool — try again shortly.",
      429,
    );
  }
  throw lastErr instanceof Error ? lastErr : new Error("jester_run_backtest failed");
}

/**
 * Failures that are NOT the caller's fault and clear on their own: Jester's candle-fetch gaps
 * ("No historical candles… try again in a minute"), rate limits, and network blips. These come
 * back from the async queue as a *failed job*, so without classification every one is fatal.
 * Deliberately excludes deterministic failures ("No parameter set found", unknown strategy),
 * which retrying would only repeat.
 */
const TRANSIENT_BACKTEST_RE =
  /no historical candles|rate limit|try again|temporar|network|timed?\s?out|did not finish|returned no data|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up|\b50[234]\b/i;

// Jester caps how many backtests one account can have queued at once; a burst gets HTTP 400
// {code:"QUEUE_FULL"}. This is BACKPRESSURE, not a failure — it clears as queued jobs finish, so we
// wait it out patiently rather than counting it against the retry budget.
const QUEUE_FULL_RE = /too many backtests queued|queue_full/i;
export function isQueueFullError(err: unknown): boolean {
  return QUEUE_FULL_RE.test(err instanceof Error ? err.message : String(err ?? ""));
}

export function isTransientBacktestError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return TRANSIENT_BACKTEST_RE.test(msg);
}

/**
 * Run a backtest via Jester's ASYNC queue (POST /api/delegated/backtests → poll the jobId).
 * Unlike the synchronous jester_run_backtest MCP tool, this queue is built for concurrency —
 * the reference harness fans out ~5 jobs at once against it — so sweeps use it to parallelise.
 * The trade-off: the queue result does NOT include Jester's own parameter code; that's fetched
 * on demand later (backfillParamCode). Returns the metrics `data` object.
 *
 * ONE enqueue+poll cycle — the transient-retry loop lives in runJesterBacktestAsyncRetrying.
 */
async function runJesterBacktestAsyncOnce(
  userId: string,
  args: Record<string, unknown>,
  { pollMs = 3000, tries = 25 }: { pollMs?: number; tries?: number } = {},
): Promise<any> {
  const enq = await jesterCall(userId, "POST", "/api/delegated/backtests", args);
  const jobId = enq?.jobId;
  if (!jobId) throw new Error(enq?.error ?? "backtest enqueue failed (no jobId)");

  for (let i = 0; i < tries; i++) {
    await sleep(pollMs);
    const p = await jesterCall(userId, "GET", `/api/delegated/backtests/${jobId}`);
    const status = p?.status ?? "?";
    if (status === "done") {
      if (!p?.data) throw new Error("backtest job done but returned no data");
      return p.data;
    }
    if (status === "failed" || status === "error") {
      throw new Error(String(p?.error ?? "backtest job failed"));
    }
  }
  throw new Error(`backtest job ${jobId} did not finish in ${(pollMs * tries) / 1000}s`);
}

/**
 * Async backtest with transient-failure retry — the "retry didn't work" fix. The Re-run button,
 * sweeps, and the tunability probe all reach the queue through here, so a transient candle-fetch
 * or rate-limit failure now re-enqueues (with jittered backoff) instead of surfacing immediately.
 * Deterministic failures are re-thrown at once so we don't wait out a bug. The final message is
 * marked so the client can distinguish "the feed is briefly down" from "this will never work".
 */
async function runJesterBacktestAsyncRetrying(
  userId: string,
  args: Record<string, unknown>,
  { attempts = 3, backoffMs = [8000, 20000], queueFullWaits = 12 }: { attempts?: number; backoffMs?: number[]; queueFullWaits?: number } = {},
): Promise<any> {
  let lastErr: unknown;
  let qfLeft = queueFullWaits;
  for (let a = 0; a < attempts; ) {
    try {
      return await runJesterBacktestAsyncOnce(userId, args);
    } catch (e) {
      lastErr = e;
      // QUEUE_FULL is flow control, not a real failure — wait for the account's queue to drain and
      // retry WITHOUT spending an attempt, so a big campaign self-paces instead of dropping cells.
      if (isQueueFullError(e) && qfLeft > 0) {
        qfLeft -= 1;
        const wait = 20000 + Math.floor(Math.random() * 15000); // 20–35s, jittered to de-sync workers
        console.warn(`[backtest] queue full for ${args.pair}/${args.timeframe} — draining, retry in ${Math.round(wait / 1000)}s (${qfLeft} left)`);
        await sleep(wait);
        continue;
      }
      if (a === attempts - 1 || !isTransientBacktestError(e)) break;
      const wait = (backoffMs[Math.min(a, backoffMs.length - 1)] ?? 20000) + Math.floor(Math.random() * 2500);
      console.warn(
        `[backtest] transient failure ${args.strategyId} ${args.pair}/${args.timeframe} ` +
          `(attempt ${a + 1}/${attempts}, retry in ${Math.round(wait / 1000)}s): ` +
          (e instanceof Error ? e.message : String(e)),
      );
      await sleep(wait);
      a += 1;
    }
  }
  if (isTransientBacktestError(lastErr)) {
    const base = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new Error(`${base} — still failing after ${attempts} attempts; Jester's data feed for this cell looks temporarily unavailable.`);
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Stable hash of a parameter set; "default" for empty/undefined. */
export function paramHashOf(parameters?: Record<string, unknown>): string {
  if (!parameters || Object.keys(parameters).length === 0) return "default";
  const canonical = JSON.stringify(parameters, Object.keys(parameters).sort());
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

function todayBucket(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

/** "7/15/2026" → "2026-07-15" (Jester returns US-formatted dates). */
function toIsoDate(us?: string): string | null {
  if (!us) return null;
  const [m, d, y] = us.split("/").map((n) => parseInt(n, 10));
  if (!m || !d || !y) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function spanBetween(startIso: string | null, endIso: string | null): number | null {
  if (!startIso || !endIso) return null;
  const ms = Date.parse(endIso) - Date.parse(startIso);
  return ms >= 0 ? Math.round(ms / 86_400_000) : null;
}

/** Estimate a cell's actual span before running, from learned coverage. Null if unknown. */
async function estimateSpan(pair: string, timeframe: string, days: number): Promise<number | null> {
  const [row] = await db
    .select({ maxSpanDays: pairTimeframeSpans.maxSpanDays })
    .from(pairTimeframeSpans)
    .where(and(eq(pairTimeframeSpans.pair, pair), eq(pairTimeframeSpans.timeframe, timeframe)))
    .limit(1);
  if (!row) return null;
  return Math.min(days, row.maxSpanDays);
}

async function findFresh(spec: CellSpec, spanEst: number, pHash: string) {
  const cutoff = new Date(Date.now() - FRESHNESS_DAYS * 86_400_000).toISOString().slice(0, 10);
  const [row] = await db
    .select()
    .from(backtestRuns)
    .where(
      and(
        eq(backtestRuns.strategyId, spec.strategyId),
        eq(backtestRuns.pair, spec.pair),
        eq(backtestRuns.timeframe, spec.timeframe),
        eq(backtestRuns.paramHash, pHash),
        eq(backtestRuns.spanDays, spanEst),
        gte(backtestRuns.asOfBucket, cutoff),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * How to acquire a fresh backtest:
 *   "code" — synchronous jester_run_backtest; slow under concurrency but returns Jester's
 *            parameter code inline. Used for single, interactive runs.
 *   "fast" — async /backtests queue; concurrency-safe (sweeps fan out over it) but no param
 *            code (backfill on demand). Default for the sweep worker.
 */
export type RunMode = "code" | "fast";

/** Resolve one cell to a backtest_run, reusing a fresh row when possible. */
export async function runCell(
  spec: CellSpec,
  ctx: { userId: string; mode?: RunMode },
): Promise<{ source: CellSource; run: typeof backtestRuns.$inferSelect }> {
  const pHash = paramHashOf(spec.parameters);
  const mode: RunMode = ctx.mode ?? "code";

  // 1. Dedup-first: try a cache hit using the estimated span.
  const spanEst = await estimateSpan(spec.pair, spec.timeframe, spec.days);
  if (spanEst !== null) {
    const hit = await findFresh(spec, spanEst, pHash);
    if (hit) return { source: "cache", run: hit };
  }

  // 2. Run the backtest. "fast" (async queue) parallelises; "code" (sync MCP) yields the
  //    Jester parameter code inline. Both return the same metrics shape.
  const args = {
    strategyId: spec.strategyId,
    pair: spec.pair,
    timeframe: spec.timeframe,
    days: spec.days,
    parameters: spec.parameters ?? {},
  };
  let data: any;
  let jesterParamCode: string | null;
  let rawResult: any;
  if (mode === "fast") {
    data = await runJesterBacktestAsyncRetrying(ctx.userId, args);
    // The async queue gives no code, but the code is a pure function of the param set — so for a
    // default-param run, reuse the strategy's already-known default code (no extra Jester call).
    jesterParamCode = pHash === "default" ? await lookupDefaultParamCode(spec.strategyId) : null;
    rawResult = { asyncData: data };
  } else {
    const res = await runJesterBacktest(ctx.userId, args);
    data = res.result.metrics;
    jesterParamCode = res?.result?.sharedResult?.paramHash ?? null;
    rawResult = res.result;
  }

  const startIso = toIsoDate(data.startDate);
  const endIso = toIsoDate(data.endDate);
  const spanDays = spanBetween(startIso, endIso) ?? spec.days;

  // 5. Learn coverage for future span estimates.
  await db
    .insert(pairTimeframeSpans)
    .values({ pair: spec.pair, timeframe: spec.timeframe, maxSpanDays: spanDays, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [pairTimeframeSpans.pair, pairTimeframeSpans.timeframe],
      set: { maxSpanDays: sql`greatest(${pairTimeframeSpans.maxSpanDays}, ${spanDays})`, updatedAt: new Date() },
    });

  // 6. Insert the shared warehouse row (idempotent on the dedup key).
  const num = (v: unknown) => (typeof v === "number" ? String(v) : null);
  const [run] = await db
    .insert(backtestRuns)
    .values({
      strategyId: spec.strategyId,
      pair: spec.pair,
      timeframe: spec.timeframe,
      daysRequested: spec.days,
      actualStart: startIso,
      actualEnd: endIso,
      spanDays,
      totalReturn: num(data.totalReturn),
      totalTrades: typeof data.totalTrades === "number" ? data.totalTrades : null,
      winRate: num(data.winRate),
      maxDrawdown: num(data.maxDrawdown),
      sharpe: num(data.sharpeRatio),
      profitFactor: num(data.profitFactor),
      parameters: spec.parameters ?? {},
      paramHash: pHash,
      jesterParamCode,
      rawResult,
      asOfBucket: todayBucket(),
      ranWithKeyUserId: ctx.userId,
      requestedByUserId: ctx.userId,
      ranAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        backtestRuns.strategyId,
        backtestRuns.pair,
        backtestRuns.timeframe,
        backtestRuns.spanDays,
        backtestRuns.paramHash,
        backtestRuns.asOfBucket,
      ],
      // On a fast (async) re-run, don't clobber an existing param code with null.
      set:
        jesterParamCode != null
          ? { rawResult, jesterParamCode, ranAt: new Date() }
          : { rawResult, ranAt: new Date() },
    })
    .returning();

  return { source: "fresh", run };
}

/**
 * Fetch Jester's own parameter code for an existing warehouse row on demand, by re-running the
 * exact cell through the synchronous jester_run_backtest tool (which returns the code). Stores
 * it on the row so it's fetched at most once. No-op if the row already has a code.
 */
export async function backfillParamCode(
  runId: string,
  userId: string,
): Promise<string | null> {
  const [row] = await db.select().from(backtestRuns).where(eq(backtestRuns.id, runId)).limit(1);
  if (!row) throw new Error(`backtest_run ${runId} not found`);
  if (row.jesterParamCode) return row.jesterParamCode;

  const res = await runJesterBacktest(userId, {
    strategyId: row.strategyId,
    pair: row.pair,
    timeframe: row.timeframe,
    days: row.daysRequested,
    parameters: (row.parameters as Record<string, unknown>) ?? {},
  });
  const code: string | null = res?.result?.sharedResult?.paramHash ?? null;
  if (code) {
    await db.update(backtestRuns).set({ jesterParamCode: code }).where(eq(backtestRuns.id, runId));
  }
  return code;
}

/** The strategy's cached default-param code, if we've already resolved it. Cheap, no Jester call. */
async function lookupDefaultParamCode(strategyId: string): Promise<string | null> {
  const [s] = await db
    .select({ code: strategies.defaultParamCode })
    .from(strategies)
    .where(eq(strategies.id, strategyId))
    .limit(1);
  return s?.code ?? null;
}

/**
 * Resolve a strategy's DEFAULT parameter code. Returns the stored value if known; otherwise runs
 * one synchronous backtest to read `sharedResult.paramHash` (the code is cell-independent, so any
 * cell works), then persists it on the strategy AND stamps every existing default-param warehouse
 * row for that strategy. Returns null if the sync tool is rate-limited or errors — the caller
 * (backfill job) simply retries on the next tick. Never throws.
 */
export async function resolveDefaultParamCode(
  userId: string,
  strategyId: string,
  tries = 1,
): Promise<string | null> {
  const existing = await lookupDefaultParamCode(strategyId);
  if (existing) return existing;

  // Prefer a cell the strategy is already known to run on (from the warehouse), so a strategy that
  // doesn't support BTC-USD/15m still resolves. The code is cell-independent, so any cell works.
  const [known] = await db
    .select({ pair: backtestRuns.pair, timeframe: backtestRuns.timeframe, days: backtestRuns.daysRequested })
    .from(backtestRuns)
    .where(and(eq(backtestRuns.strategyId, strategyId), eq(backtestRuns.paramHash, "default")))
    .limit(1);
  const cell = known ?? { pair: "BTC-USD", timeframe: "15m", days: 30 };

  let code: string | null = null;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await jesterCall(userId, "POST", "/api/delegated/mcp/tool", {
        name: "jester_run_backtest",
        args: { strategyId, pair: cell.pair, timeframe: cell.timeframe, days: cell.days, parameters: {} },
      });
      code = res?.result?.sharedResult?.paramHash ?? null;
      if (code) break;
    } catch {
      // Rate-limited or transient — leave null; the backfill job will try again later.
    }
    if (i < tries - 1) await sleep(5000);
  }
  if (!code) return null;

  await db.update(strategies).set({ defaultParamCode: code }).where(eq(strategies.id, strategyId));
  await db
    .update(backtestRuns)
    .set({ jesterParamCode: code })
    .where(and(eq(backtestRuns.strategyId, strategyId), eq(backtestRuns.paramHash, "default")));
  return code;
}
