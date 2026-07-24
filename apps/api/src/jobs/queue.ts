import { Queue } from "bullmq";
import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

export const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
});

// One Queue per job type. Add yours here and register a repeat schedule below.
export const heartbeatQueue = new Queue("heartbeat", { connection });

// Sweep orchestration: run-sweep expands a matrix and fans out backtest-cell jobs.
export const sweepQueue = new Queue("run-sweep", { connection });
export const cellQueue = new Queue("backtest-cell", { connection });

// Rescreen: re-evaluate every auto-rescreen screen against the warehouse and refresh alerts.
export const rescreenQueue = new Queue("rescreen", { connection });

// Param-code backfill: slowly resolve each strategy's default Jester param code (rate-limited tool).
export const paramCodeQueue = new Queue("param-code-backfill", { connection });

// Tunability probe: determine which strategies honor parameter overrides (guided-optimizable).
export const tunabilityQueue = new Queue("tunability-probe", { connection });

// Param-period tracking: record which parameter set is live per strategy/pair, and when it changed.
export const paramTrackQueue = new Queue("param-period-track", { connection });

// Fills sync: pull each wallet's Hyperliquid fill ledger tail into the local warehouse (hl_fills).
export const fillsSyncQueue = new Queue("fills-sync", { connection });

// Coverage engine: keep the target backtest matrix filled + fresh. No-op unless armed (disabled default).
export const coverageQueue = new Queue("coverage-scan", { connection });

// Polymarket Up/Down collector: score resolved BTC/ETH markets vs the Tesseract signal (Phase 1).
export const polymarketUpdownQueue = new Queue("polymarket-updown-collect", { connection });

// Polymarket book capture: snapshot open Up/Down markets' bid/ask so scoring can use the REAL entry
// ask, not the mid. Light (book calls only, one snapshot per market). Gate: polymarket_book_capture_enabled.
export const polymarketBookCaptureQueue = new Queue("polymarket-book-capture", { connection });

// Forward market-state tape: minute-level Chainlink/HL state + realistic two-sided fills, labeled
// after resolution. Feeds empirical-fair-value and lead/lag research; never decides or trades.
export const polymarketStateTapeQueue = new Queue("polymarket-state-tape", { connection });

// Prospective Deribit BTC/ETH short-dated skew tape. Public/read-only, no directional mapping.
export const deribitSkewCaptureQueue = new Queue("deribit-skew-capture", { connection });

// Trade composite gauge logger: bot #2 for the Up/Down tournament — one gauge scan/tick → signal_snapshot.
export const signalGaugeLogQueue = new Queue("signal-gauge-log", { connection });

// Paper Floor: forward paper-trading harness (decide at window open vs the real book, grade at
// resolution). PAPER ONLY — no execution path exists. Gate: paper_floor_enabled.
export const paperFloorQueue = new Queue("paper-floor-tick", { connection });

// Prospective 30-second execution-quality tape over paper rows. Observational metadata only.
export const paperMarkoutQueue = new Queue("paper-markout-capture", { connection });

// Jester V1 entry logger: sided entries of the SUBSCRIBED jester_v1_remastered → signal_snapshot
// (tournament bot #5 — the fade-V1 measured hypothesis). Gate: v1_signal_logger_enabled.
export const signalV1LogQueue = new Queue("signal-v1-log", { connection });

// Tesseract Field logger: forward-collect the live microstructure Field + label outcomes (build #1).
export const tesseractLogQueue = new Queue("tesseract-log", { connection });
// Faster 5m sibling for the focus pairs (where a live 5m strategy runs) — samples at 5m resolution.
export const tesseractLogFocusQueue = new Queue("tesseract-log-focus", { connection });

export interface RunSweepJob {
  sweepId: string;
}
export interface BacktestCellJob {
  sweepId: string;
  cellId: string;
  userId: string;
  strategyId: string;
  pair: string;
  timeframe: string;
  days: number;
  parameters?: Record<string, unknown>;
  paramLabel?: string;
}

export async function registerJobs() {
  // Repeatable jobs — upserted on every worker start so they survive restarts.
  // Use { every: ms } for intervals or { pattern: "0 3 * * *", tz: "..." } for cron.
  await heartbeatQueue.upsertJobScheduler(
    "heartbeat-repeatable",
    { every: 300_000 }, // every 5 minutes
    { name: "beat" },
  );

  // Daily rescreen at 06:15 UTC — re-evaluates auto-rescreen screens so alert diffs stay fresh.
  await rescreenQueue.upsertJobScheduler(
    "rescreen-daily",
    { pattern: "15 6 * * *" },
    { name: "rescreen" },
  );

  // Every 5 min, resolve a couple more strategies' default param codes. The synchronous backtest
  // tool is rate-limited, so this trickles slowly: once all codes are known the tick is a cheap no-op.
  await paramCodeQueue.upsertJobScheduler(
    "param-code-backfill-repeatable",
    { every: 300_000 },
    { name: "backfill" },
  );

  // Every 3 min, probe a few unprobed strategies' tunability (async backtests — not rate-limited).
  await tunabilityQueue.upsertJobScheduler(
    "tunability-probe-repeatable",
    { every: 180_000 },
    { name: "probe" },
  );

  // Every 3 min, snapshot the live parameter config so param-set performance can be attributed.
  await paramTrackQueue.upsertJobScheduler(
    "param-period-track-repeatable",
    { every: 180_000 },
    { name: "track" },
  );

  // Every 2 min, pull each wallet's new Hyperliquid fills into the warehouse so live analysis reads
  // full history from Postgres instead of the 2000-capped API. A cold start backfills; steady state
  // just grabs the tail, so this is cheap once caught up.
  await fillsSyncQueue.upsertJobScheduler(
    "fills-sync-repeatable",
    { every: 120_000 },
    { name: "sync" },
  );

  // Every 60s, fill a few stale cells of the coverage matrix. A cheap no-op until a manager arms it
  // (coverage.enabled), so it never spends Jester budget on its own.
  await coverageQueue.upsertJobScheduler(
    "coverage-scan-repeatable",
    { every: 60_000 },
    { name: "scan" },
  );

  // Every 10 min, snapshot the live Tesseract Field for the configured pairs and label older rows'
  // outcomes. Read-only research collection; disarmed via the tesseract_logger_enabled setting.
  await tesseractLogQueue.upsertJobScheduler(
    "tesseract-log-repeatable",
    { every: 600_000 },
    { name: "log" },
  );

  // Every 15 min, score the six supported crypto Up/Down pairs that resolved in the last ~2h
  // against the Tesseract log. Read-only; idempotent (dedup by market id).
  await polymarketUpdownQueue.upsertJobScheduler(
    "polymarket-updown-collect-repeatable",
    { every: 900_000 },
    { name: "collect" },
  );

  // Every 3 min, snapshot open Up/Down books for the six supported pairs so scoring can price
  // entries at the real ask. One snapshot per market (skips seen); disable via
  // polymarket_book_capture_enabled=false.
  await polymarketBookCaptureQueue.upsertJobScheduler(
    "polymarket-book-capture-repeatable",
    { every: 180_000 },
    { name: "capture" },
  );

  // Every 60s, preserve the live state that cannot be reconstructed later. Public APIs only;
  // idempotent by market+elapsed-minute and fail-closed via polymarket_state_tape_enabled=false.
  await polymarketStateTapeQueue.upsertJobScheduler(
    "polymarket-state-tape-repeatable",
    { every: 60_000 },
    { name: "capture-and-label" },
  );

  // Every 5 min, preserve the nearest 12–72h BTC/ETH 25-delta-proxy skew and OI state. The
  // preregistered collector is observational only and defaults on unless explicitly disabled.
  await deribitSkewCaptureQueue.upsertJobScheduler(
    "deribit-skew-capture-repeatable",
    { every: 300_000 },
    { name: "capture" },
  );

  // Every 60s, the Paper Floor decides on markets entering their window + grades resolved ones.
  // Signals come from the DB logs (no Jester calls); books are a handful of CLOB reads. Paper only.
  await paperFloorQueue.upsertJobScheduler(
    "paper-floor-tick-repeatable",
    { every: 60_000 },
    { name: "tick" },
  );
  // The peak-retention bot has a preregistered 60–90s-remaining decision band. Four chances per
  // minute guarantee the worker observes that frozen band; the processor isolates this job to that
  // bot so the cadence of every other paper strategy remains unchanged.
  await paperFloorQueue.upsertJobScheduler(
    "paper-floor-peak-retention-repeatable",
    { every: 15_000 },
    { name: "peak-retention" },
  );
  // Ten-second cadence samples each paper row once at the preregistered 30-second markout target.
  // Rows seen too late are terminally marked stale; the collector never backfills a later quote.
  await paperMarkoutQueue.upsertJobScheduler(
    "paper-markout-capture-repeatable",
    { every: 10_000 },
    { name: "capture" },
  );

  // Every 5 min, ingest V1's live entry signals (notifications each tick; history every 3rd).
  await signalV1LogQueue.upsertJobScheduler(
    "signal-v1-log-repeatable",
    { every: 300_000 },
    { name: "log" },
  );

  // Every 5 min, log the Trade composite gauge (one scan call) as tournament bot #2. Read-only;
  // disable via signal_gauge_logger_enabled=false. 5m matches the gauge's resolution + our 5m markets.
  await signalGaugeLogQueue.upsertJobScheduler(
    "signal-gauge-log-repeatable",
    { every: 300_000 },
    { name: "log" },
  );

  // Every 5 min, snapshot the focus pairs (default BTC-USD) at 5m resolution + label. No-op unless
  // both the master and focus settings are armed.
  await tesseractLogFocusQueue.upsertJobScheduler(
    "tesseract-log-focus-repeatable",
    { every: 300_000 },
    { name: "log" },
  );
}
