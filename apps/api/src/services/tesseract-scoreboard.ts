import { and, eq, isNotNull, or } from "drizzle-orm";
import { db, tesseractSnapshots } from "@framework/db";

/**
 * Tesseract predictiveness scoreboard (build #2) — turns the logged dataset (#1) into the one number
 * that matters: *if you'd taken every `analyze` plan, did it pay?* And, crucially, *when* — the edge
 * hypothesis is that it lives only where the gauge and the Field agree (`sideConflict = false`).
 *
 * Directional return of a plan at horizon h = sign(direction) × forward% (long profits when price
 * rises, short when it falls). No-trade rows (null direction) are excluded from expectancy. All math
 * is done in JS over the labeled rows — the dataset is small (hundreds/day) and this keeps the
 * segmentation flexible. Read-only.
 */

type Row = typeof tesseractSnapshots.$inferSelect;
const HORIZONS = [15, 30, 60] as const;
type Horizon = (typeof HORIZONS)[number];

export interface HorizonStat {
  horizon: Horizon;
  n: number;
  winRate: number | null; // fraction of directional returns > 0
  avg: number | null; // mean directional return %
  median: number | null;
}

interface Segment {
  label: string;
  n: number;
  horizons: HorizonStat[];
}

const fwdKey = (h: Horizon) => (`fwd${h}m`) as "fwd15m" | "fwd30m" | "fwd60m";

/** sign(direction) × forward% — the P&L of following the plan, or null if not scorable. */
function directional(row: Row, h: Horizon): number | null {
  const fwd = row[fwdKey(h)];
  if (fwd == null || row.direction == null) return null;
  const s = row.direction === "long" ? 1 : row.direction === "short" ? -1 : 0;
  if (s === 0) return null;
  return s * fwd;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function statFor(rows: Row[], h: Horizon): HorizonStat {
  const vals = rows.map((r) => directional(r, h)).filter((v): v is number => v != null);
  if (!vals.length) return { horizon: h, n: 0, winRate: null, avg: null, median: null };
  const wins = vals.filter((v) => v > 0).length;
  return {
    horizon: h,
    n: vals.length,
    winRate: wins / vals.length,
    avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    median: median(vals),
  };
}

function segment(label: string, rows: Row[]): Segment {
  return { label, n: rows.length, horizons: HORIZONS.map((h) => statFor(rows, h)) };
}

/** Tercile split of a dimension → avg 60m directional return in each third (which dimension carries signal). */
interface DimensionBreakdown {
  dimension: "drive" | "heat" | "mass" | "flow";
  buckets: { label: string; n: number; avg60: number | null; winRate60: number | null }[];
  spread: number | null; // high-tercile avg − low-tercile avg (bigger |spread| ⇒ more signal)
}

function dimensionBreakdown(rows: Row[], dim: DimensionBreakdown["dimension"]): DimensionBreakdown {
  const withVal = rows.filter((r) => r[dim] != null && directional(r, 60) != null);
  const sorted = [...withVal].sort((a, b) => (a[dim] as number) - (b[dim] as number));
  const n = sorted.length;
  const third = Math.floor(n / 3);
  const groups = n < 6
    ? [{ label: "all", rows: sorted }]
    : [
        { label: "low", rows: sorted.slice(0, third) },
        { label: "mid", rows: sorted.slice(third, n - third) },
        { label: "high", rows: sorted.slice(n - third) },
      ];
  const buckets = groups.map((g) => {
    const vals = g.rows.map((r) => directional(r, 60)!).filter((v) => v != null);
    const wins = vals.filter((v) => v > 0).length;
    return {
      label: g.label,
      n: vals.length,
      avg60: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
      winRate60: vals.length ? wins / vals.length : null,
    };
  });
  const lo = buckets.find((b) => b.label === "low")?.avg60 ?? null;
  const hi = buckets.find((b) => b.label === "high")?.avg60 ?? null;
  return { dimension: dim, buckets, spread: lo != null && hi != null ? hi - lo : null };
}

export interface Scoreboard {
  coverage: {
    total: number; // all snapshots
    labeled: number; // rows with ≥1 forward return
    scorable: number; // labeled AND has a tradeable direction
    pairs: number;
    firstAt: string | null;
    lastAt: string | null;
    maturing: boolean; // true while too thin to trust (headline stat n < 30)
  };
  overall: Segment;
  bySideConflict: { agree: Segment; conflict: Segment }; // the hypothesis: edge lives in `agree`
  byPair: { pair: string; n: number; avg60: number | null; winRate60: number | null }[];
  byDimension: DimensionBreakdown[];
}

export async function tesseractScoreboard(userId: string, pair?: string): Promise<Scoreboard> {
  const pairFilter = pair && pair !== "all" ? eq(tesseractSnapshots.pair, pair) : undefined;

  const totalRow = await db
    .select({ c: tesseractSnapshots.id })
    .from(tesseractSnapshots)
    .where(and(eq(tesseractSnapshots.userId, userId), pairFilter));
  const total = totalRow.length;

  // Rows with at least one labeled horizon — the scoreboard's population.
  const labeledRows = await db
    .select()
    .from(tesseractSnapshots)
    .where(
      and(
        eq(tesseractSnapshots.userId, userId),
        pairFilter,
        or(isNotNull(tesseractSnapshots.fwd15m), isNotNull(tesseractSnapshots.fwd30m), isNotNull(tesseractSnapshots.fwd60m)),
      ),
    );

  const scorable = labeledRows.filter((r) => r.direction === "long" || r.direction === "short");
  const times = labeledRows.map((r) => r.capturedAt.getTime());
  const pairs = new Set(labeledRows.map((r) => r.pair));

  const overall = segment("All plans", scorable);
  const headlineN = overall.horizons.find((h) => h.horizon === 60)?.n ?? 0;

  const agree = scorable.filter((r) => r.sideConflict === false);
  const conflict = scorable.filter((r) => r.sideConflict === true);

  const byPairMap = new Map<string, Row[]>();
  for (const r of scorable) {
    const arr = byPairMap.get(r.pair) ?? [];
    arr.push(r);
    byPairMap.set(r.pair, arr);
  }
  const byPair = [...byPairMap.entries()]
    .map(([pair, rows]) => {
      const vals = rows.map((r) => directional(r, 60)).filter((v): v is number => v != null);
      const wins = vals.filter((v) => v > 0).length;
      return {
        pair,
        n: vals.length,
        avg60: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
        winRate60: vals.length ? wins / vals.length : null,
      };
    })
    .sort((a, b) => (b.avg60 ?? -Infinity) - (a.avg60 ?? -Infinity));

  return {
    coverage: {
      total,
      labeled: labeledRows.length,
      scorable: scorable.length,
      pairs: pairs.size,
      firstAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
      lastAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
      maturing: headlineN < 30,
    },
    overall,
    bySideConflict: { agree: segment("Field agrees (sideConflict = false)", agree), conflict: segment("Field conflicts", conflict) },
    byPair,
    byDimension: (["drive", "heat", "mass", "flow"] as const).map((d) => dimensionBreakdown(scorable, d)),
  };
}

/** Lightweight collection-health for the logger (build #1 visibility). */
export async function loggerStatus(userId: string) {
  const rows = await db
    .select({ capturedAt: tesseractSnapshots.capturedAt, pair: tesseractSnapshots.pair, labeledAt: tesseractSnapshots.labeledAt })
    .from(tesseractSnapshots)
    .where(eq(tesseractSnapshots.userId, userId));
  const times = rows.map((r) => r.capturedAt.getTime());
  return {
    total: rows.length,
    labeled: rows.filter((r) => r.labeledAt != null).length,
    pairs: new Set(rows.map((r) => r.pair)).size,
    firstAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
    lastAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
  };
}
