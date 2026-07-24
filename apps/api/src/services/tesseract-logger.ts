import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db, tesseractSnapshots } from "@framework/db";
import { getSetting } from "./config.ts";
import { tesseractAnalyze } from "./tesseract.ts";
import { hlMicrostructure } from "./hyperliquid.ts";
import { coinOf } from "./param-tracking.ts";

/**
 * Tesseract Field logger (build #1) — forward-collect the live Field so build #2 can score it.
 *
 * Two passes, both read-only:
 *  - snapshotTesseract(): one `analyze` call per configured pair → one row. This is the "signal at T".
 *  - labelTesseractOutcomes(): for rows old enough, read the SAME pair's later snapshots' price to
 *    fill fwd15m/30m/60m/240m — the realized move, no extra candle feed. This is the "outcome at T+Δ".
 *
 * Everything tunable lives in app_settings so we can throttle without a redeploy (rate-limit hygiene).
 */

// Default pair universe — the liquid perps Tesseract can actually field, matching the scan set.
const DEFAULT_PAIRS = ["BTC-USD", "ETH-USD", "SOL-USD", "DOGE-USD", "AVAX-USD", "XRP-USD", "SUI-USD", "LINK-USD", "ARB-USD", "BNB-USD"];
const PAIRS_KEY = "tesseract_logger_pairs";
const ENABLED_KEY = "tesseract_logger_enabled"; // "true" to arm; default armed
const INTERVAL_KEY = "tesseract_logger_interval_min"; // informational; the scheduler owns cadence

// A tight "focus" set logged at a faster cadence (5m job) than the broad universe (10m job) — for the
// pairs where a live 5m strategy runs, so the Field is sampled at the strategy's own resolution. The
// broad logger excludes these so no pair is logged twice. Default = BTC-USD (delta_absorption 5m).
const DEFAULT_FOCUS = ["BTC-USD"];
const FOCUS_PAIRS_KEY = "tesseract_focus_pairs";
const FOCUS_ENABLED_KEY = "tesseract_focus_enabled"; // "true" to arm the 5m focus job; default armed

// Forward horizons (minutes) we try to label — the microstructure-relevant windows from the spec
// ("does the Field at T predict the move at T+15m/30m/1h"). fwd240m stays reserved/null for now.
const HORIZONS = [15, 30, 60] as const;

export async function loggerEnabled(): Promise<boolean> {
  const v = await getSetting(ENABLED_KEY);
  return v == null ? true : v === "true"; // armed by default (read-only, safe)
}

export async function focusEnabled(): Promise<boolean> {
  const v = await getSetting(FOCUS_ENABLED_KEY);
  return v == null ? true : v === "true";
}

export async function focusPairs(): Promise<string[]> {
  const raw = await getSetting(FOCUS_PAIRS_KEY);
  if (raw == null) return DEFAULT_FOCUS;
  return raw.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean); // empty = no focus
}

export async function loggerPairs(): Promise<string[]> {
  const raw = await getSetting(PAIRS_KEY);
  const base = raw
    ? raw.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean)
    : DEFAULT_PAIRS;
  const chosen = base.length ? base : DEFAULT_PAIRS;
  // Drop focus pairs so the broad (10m) job doesn't double-log what the 5m job already covers.
  const focus = (await focusEnabled()) ? new Set(await focusPairs()) : new Set<string>();
  const out = chosen.filter((p) => !focus.has(p));
  return out.length ? out : chosen; // guard: never log nothing
}

const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const boolOrNull = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * Snapshot the current Field/plan for each configured pair. Batches of 3 with a short gap to respect
 * Jester's throttle (mirrors tesseractScan). Returns how many rows were written.
 */
export async function snapshotTesseract(userId: string, pairsOverride?: string[]): Promise<{ written: number; errors: number }> {
  if (!(await loggerEnabled())) return { written: 0, errors: 0 };
  const pairs = pairsOverride ?? (await loggerPairs());
  let written = 0;
  let errors = 0;

  for (let i = 0; i < pairs.length; i += 3) {
    const batch = pairs.slice(i, i + 3);
    const rows = await Promise.all(
      batch.map(async (pair) => {
        try {
          // Jester's Field (drive/heat/mass) + our own Book/Flow straight from Hyperliquid, concurrently.
          // The HL call fails soft (returns nulls) so it can never break the snapshot.
          const [a, micro] = await Promise.all([
            tesseractAnalyze(userId, pair),
            hlMicrostructure(coinOf(pair)).catch(() => null),
          ]);
          const p = a?.plan;
          if (!p) return null;
          const fs = p.fieldScores ?? {};
          const reg = p.regime ?? {};
          const capturedAt = typeof p.analyzedAt === "number" ? new Date(p.analyzedAt) : new Date();
          return {
            userId,
            pair,
            capturedAt,
            currentPrice: numOrNull(p.currentPrice),
            direction: strOrNull(p.direction),
            signalSide: strOrNull(p.signalSide),
            sideConflict: boolOrNull(p.sideConflict),
            gaugeScore: numOrNull(p.gaugeScore),
            gaugeLabel: strOrNull(p.gaugeLabel),
            rr: numOrNull(p.rr),
            atrValue: numOrNull(p.atrValue),
            entry: numOrNull(p.entry),
            sl: numOrNull(p.sl),
            tp1: numOrNull(p.tp1),
            tp2: numOrNull(p.tp2),
            drive: numOrNull(fs.drive),
            heat: numOrNull(fs.heat),
            mass: numOrNull(fs.mass),
            // Flow/Book now come from Hyperliquid directly (Jester leaves them null): normalized
            // imbalances in [-1,1]. flow = recent trade-delta (flow-lite); book = top-N depth pressure.
            flow: micro && micro.tradeCount >= 3 ? numOrNull(micro.flowImbalance) : null,
            book: numOrNull(micro?.bookImbalance),
            acceptanceDirection: strOrNull(fs.acceptanceDirection),
            fieldState: strOrNull(fs.state),
            trend: strOrNull(reg.trend),
            volatility: strOrNull(reg.volatility),
            volume: strOrNull(reg.volume),
            trendStrength: numOrNull(reg.trendStrength),
            volatilityPercentile: numOrNull(reg.volatilityPercentile),
            isChoppy: boolOrNull(reg.isChoppy),
            inSqueeze: boolOrNull(reg.inSqueeze),
            candleCount: numOrNull(p.candleCount),
            raw: p,
          };
        } catch {
          errors += 1;
          return null;
        }
      }),
    );
    const good = rows.filter((r): r is NonNullable<typeof r> => r != null);
    if (good.length) {
      await db.insert(tesseractSnapshots).values(good);
      written += good.length;
    }
    // Breathe between batches so a single tick doesn't trip Jester's rate limiter.
    if (i + 3 < pairs.length) await new Promise((r) => setTimeout(r, 1200));
  }
  return { written, errors };
}

/**
 * Fill forward-return labels for snapshots old enough that the outcome exists. For each unlabeled row
 * whose oldest horizon has elapsed, read the same pair's later snapshot nearest each horizon target
 * (within a tolerance) and record the signed % price change. A row is marked labeled once its longest
 * *elapsed* horizon has been resolved, so we don't reprocess it forever.
 */
export async function labelTesseractOutcomes(userId: string): Promise<{ labeled: number }> {
  const now = Date.now();
  const intervalMin = Number((await getSetting(INTERVAL_KEY)) ?? 10) || 10;
  const toleranceMs = Math.max(6, intervalMin) * 60_000; // match a later snapshot within ~one cadence

  // Candidates: unlabeled, oldest horizon (15m) already elapsed. Cap per tick to stay cheap.
  const minAgeMs = HORIZONS[0] * 60_000;
  const candidates = await db
    .select()
    .from(tesseractSnapshots)
    .where(
      and(
        eq(tesseractSnapshots.userId, userId),
        isNull(tesseractSnapshots.labeledAt),
        lte(tesseractSnapshots.capturedAt, new Date(now - minAgeMs)),
      ),
    )
    .orderBy(asc(tesseractSnapshots.capturedAt))
    .limit(200);

  let labeled = 0;
  for (const row of candidates) {
    if (row.currentPrice == null) {
      // No base price → nothing to label against; mark done so it doesn't linger.
      await db.update(tesseractSnapshots).set({ labeledAt: new Date() }).where(eq(tesseractSnapshots.id, row.id));
      labeled += 1;
      continue;
    }
    const t0 = row.capturedAt.getTime();
    const updates: Record<string, number> = {};
    let longestElapsedResolved = true;

    for (const h of HORIZONS) {
      const target = t0 + h * 60_000;
      const elapsed = now >= target + toleranceMs; // horizon fully in the past (with slack)
      // Nearest same-pair snapshot to the horizon target, within tolerance.
      const [match] = await db
        .select({ price: tesseractSnapshots.currentPrice, at: tesseractSnapshots.capturedAt })
        .from(tesseractSnapshots)
        .where(
          and(
            eq(tesseractSnapshots.userId, userId),
            eq(tesseractSnapshots.pair, row.pair),
            gte(tesseractSnapshots.capturedAt, new Date(target - toleranceMs)),
            lte(tesseractSnapshots.capturedAt, new Date(target + toleranceMs)),
            sql`${tesseractSnapshots.currentPrice} is not null`,
          ),
        )
        .orderBy(sql`abs(extract(epoch from ${tesseractSnapshots.capturedAt}) - ${target / 1000})`)
        .limit(1);

      const col = `fwd${h}m` as const;
      if (match?.price != null && row.currentPrice) {
        updates[col] = ((match.price - row.currentPrice) / row.currentPrice) * 100;
      } else if (!elapsed) {
        // This horizon hasn't fully elapsed yet and has no match — revisit on a later tick.
        // (If elapsed with no match, it's permanently unlabelable; leave it null and move on.)
        longestElapsedResolved = false;
      }
    }

    // Mark labeled only once every horizon has either resolved or permanently elapsed unmatched.
    const patch: Record<string, unknown> = {
      fwd15m: updates.fwd15m ?? null,
      fwd30m: updates.fwd30m ?? null,
      fwd60m: updates.fwd60m ?? null,
    };
    if (longestElapsedResolved) patch.labeledAt = new Date();
    await db.update(tesseractSnapshots).set(patch).where(eq(tesseractSnapshots.id, row.id));
    if (longestElapsedResolved) labeled += 1;
  }
  return { labeled };
}
