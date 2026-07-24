/**
 * Guided optimization recipes — logic-driven parameter tuning.
 *
 * Unlike the generic grid-search (which mechanically grids the top-2 numeric params ±40%), a recipe
 * encodes OUR understanding of a specific strategy: which parameters are its real levers, and over
 * what ranges, given how the strategy works. Grounded in each strategy's live default parameters and
 * the standard behavior of its indicators. See /Users/Storage/Jester/GUIDED_OPTIMIZATION_PLAN.md.
 *
 * A recipe produces a small, legible grid (~9–16 combos). `grid` params vary independently (cartesian
 * product); `paired` sets vary parameters that only make sense together (e.g. MACD fast/slow, kept
 * fast < slow). `probeParam` is the lever the tunability pre-probe flips to confirm Jester honors
 * overrides for this strategy before spending the full grid.
 */

import type { Combo, NumericParam } from "./optimize.ts";
import { buildCombosFromGrid } from "./optimize.ts";

export interface Recipe {
  strategyId: string;
  summary: string; // human one-liner of what's being swept
  grid?: Record<string, number[]>; // independent levers → cartesian product
  paired?: { label: string; values: Record<string, number> }[]; // grouped levers varied together
  probeParam: string; // lever the tunability pre-probe flips
}

const RECIPES: Recipe[] = [
  {
    // Verified effective levers (priceExtensionThreshold is ignored by this strategy's delegated
    // backtest; lowVolumeThreshold × pocketStrengthThreshold move results — real PF spread observed).
    strategyId: "mean_reversion_pocket_volume",
    summary: "lowVolumeThreshold × pocketStrengthThreshold",
    grid: {
      lowVolumeThreshold: [0.7, 0.85, 1.0, 1.15],
      pocketStrengthThreshold: [5, 8, 11],
    },
    probeParam: "lowVolumeThreshold",
  },
  {
    strategyId: "mass_index_reversal_in_trend",
    summary: "bulgeThreshold × takeProfitMultiplier",
    grid: {
      bulgeThreshold: [21, 23, 25, 27],
      takeProfitMultiplier: [3, 4, 5],
    },
    probeParam: "bulgeThreshold",
  },
  {
    strategyId: "rsi_hidden_divergence_trend_cont",
    summary: "rsiPeriod × takeProfitMultiplier",
    grid: {
      rsiPeriod: [7, 9, 11, 14],
      takeProfitMultiplier: [3, 4, 6],
    },
    probeParam: "rsiPeriod",
  },
  {
    strategyId: "delta_absorption_vwap_reverse",
    summary: "bandStdMultiplier × stopAtrMult",
    grid: {
      bandStdMultiplier: [1.3, 1.6, 2.0, 2.4],
      stopAtrMult: [1.0, 1.5, 2.0],
    },
    probeParam: "bandStdMultiplier",
  },
  {
    strategyId: "macd_ema_conservative",
    summary: "MACD windows × adxTrendThreshold",
    paired: [
      { label: "macd 12/26", values: { macdFast: 12, macdSlow: 26 } },
      { label: "macd 16/30", values: { macdFast: 16, macdSlow: 30 } },
      { label: "macd 19/39", values: { macdFast: 19, macdSlow: 39 } },
    ],
    grid: { adxTrendThreshold: [20, 25, 30] },
    probeParam: "adxTrendThreshold",
  },
  {
    strategyId: "vsa_volume_spread",
    summary: "volumeSpikeMult × spreadThresholdPct",
    grid: {
      volumeSpikeMult: [1.3, 1.6, 2.0],
      spreadThresholdPct: [50, 60, 70],
    },
    probeParam: "volumeSpikeMult",
  },
];

const BY_ID = new Map(RECIPES.map((r) => [r.strategyId, r]));

export const getRecipe = (strategyId: string): Recipe | null => BY_ID.get(strategyId) ?? null;

/** Number of combos a recipe produces = |grid cartesian| × |paired sets|. No live call needed. */
export function recipeComboCount(recipe: Recipe): number {
  const gridSize = Object.values(recipe.grid ?? {}).reduce((n, vals) => n * vals.length, 1);
  const pairedSize = recipe.paired?.length ?? 1;
  return gridSize * pairedSize;
}

/** Lightweight recipe info for the UI (no Jester call). */
export function recipeInfo(strategyId: string): { summary: string; comboCount: number } | null {
  const r = getRecipe(strategyId);
  return r ? { summary: r.summary, comboCount: recipeComboCount(r) } : null;
}

/* ------------------------------------------------------------------ auto-recipes */

// Keyword → parameter role. A guided auto-recipe varies one SIGNAL lever (what triggers a trade)
// and one RISK lever (stop/target), which is the highest-signal 2-param sweep for most strategies.
const RISK_KW = ["rmultiple", "takeprofit", "stoploss", "target", "trailing", "riskpertrade", "drawdown", "stopatr"];
const SIGNAL_KW = [
  "threshold", "extension", "bulge", "divergence", "spike", "spread", "band", "std", "rsi", "adx",
  "macd", "kama", "confidence", "pocket", "volume", "period", "length", "lookback", "ema",
];

function roleOf(name: string): "signal" | "risk" | "other" {
  const l = name.toLowerCase();
  if (RISK_KW.some((k) => l.includes(k))) return "risk";
  if (SIGNAL_KW.some((k) => l.includes(k))) return "signal";
  return "other";
}

/**
 * Derive a guided recipe for a strategy that has no hand-authored one: pick one signal lever + one
 * risk lever (falling back to the two highest-priority numeric params), each gridded ~±40% around
 * its default. This makes "understanding-driven" one-click optimization available for EVERY tunable
 * strategy, not just the curated few — the classification is our understanding of what each
 * parameter does, applied generically.
 */
export function buildAutoRecipe(
  numeric: NumericParam[],
): { grid: Record<string, number[]>; summary: string; probeParam: string } | null {
  const signal = numeric.find((p) => roleOf(p.name) === "signal");
  const risk = numeric.find((p) => roleOf(p.name) === "risk");
  const levers: NumericParam[] = [];
  for (const p of [signal, risk]) if (p && !levers.includes(p)) levers.push(p);
  // Fill up to 2 levers from the priority-ordered list (numeric is already sorted).
  for (const p of numeric) {
    if (levers.length >= 2) break;
    if (!levers.includes(p)) levers.push(p);
  }
  if (levers.length === 0) return null;

  const grid: Record<string, number[]> = {};
  for (const l of levers.slice(0, 2)) grid[l.name] = l.autoValues;
  return {
    grid,
    summary: `${levers.slice(0, 2).map((l) => l.name).join(" × ")} (auto ±40%)`,
    probeParam: levers[0].name,
  };
}

/** The guided plan (combos + probe param) for a strategy — hand recipe if one exists, else auto. */
export function getGuidedCombos(
  strategyId: string,
  defaults: Record<string, unknown>,
  numeric: NumericParam[],
): { combos: Combo[]; summary: string; probeParam: string } | null {
  const hand = getRecipe(strategyId);
  if (hand) {
    return { combos: buildRecipeCombos(hand, defaults), summary: hand.summary, probeParam: hand.probeParam };
  }
  const auto = buildAutoRecipe(numeric);
  if (!auto) return null;
  return { combos: buildCombosFromGrid(defaults, auto.grid), summary: auto.summary, probeParam: auto.probeParam };
}

/** Guided-plan info for the UI (summary + combo count + whether it's auto-derived). No combo build. */
export function getGuidedInfo(
  strategyId: string,
  numeric: NumericParam[],
): { summary: string; comboCount: number; auto: boolean } | null {
  const hand = getRecipe(strategyId);
  if (hand) return { summary: hand.summary, comboCount: recipeComboCount(hand), auto: false };
  const auto = buildAutoRecipe(numeric);
  if (!auto) return null;
  const comboCount = Object.values(auto.grid).reduce((n, v) => n * v.length, 1);
  return { summary: auto.summary, comboCount, auto: true };
}

/**
 * Build the combos for a guided recipe: cartesian product of the independent `grid` levers, then
 * multiplied by each `paired` set. Each combo merges onto the strategy's defaults so Jester runs the
 * intended base configuration with only the recipe's levers changed.
 */
export function buildRecipeCombos(recipe: Recipe, defaults: Record<string, unknown>): Combo[] {
  // Cartesian over the independent grid levers.
  let base: { override: Record<string, number>; label: string }[] = [{ override: {}, label: "" }];
  for (const [param, values] of Object.entries(recipe.grid ?? {})) {
    const next: typeof base = [];
    for (const b of base) {
      for (const v of values) {
        next.push({
          override: { ...b.override, [param]: v },
          label: [b.label, `${param}=${v}`].filter(Boolean).join(" "),
        });
      }
    }
    base = next;
  }

  const pairedSets = recipe.paired ?? [{ label: "", values: {} }];
  const combos: Combo[] = [];
  for (const p of pairedSets) {
    for (const b of base) {
      combos.push({
        parameters: { ...defaults, ...b.override, ...p.values },
        label: [p.label, b.label].filter(Boolean).join(" "),
      });
    }
  }
  return combos;
}
