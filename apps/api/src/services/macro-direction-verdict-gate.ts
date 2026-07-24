/**
 * Symmetric verdict gate for the prospectively isolated macro UP-only and DOWN-only controls.
 *
 * The immutable v3 gates use Always Down as every candidate's control. That makes a DOWN candidate
 * algebraically identical to its comparator and forces its residual to zero. This independent gate
 * fixes only that evaluation asymmetry: each macro side is paired to the opposite side from the
 * same fee-adjusted book walk. All v3 statistical floors and the 5m/15m evidence split remain exact.
 */
import {
  computePaperGate,
  contemporaneousOppositeNet,
  PAPER_GATE,
  type PaperGateConfig,
  type PaperGateTrade,
} from "./paper-floor-gate.ts";
import { MACRO_DIRECTION_CONTROLS } from "./macro-direction-controls.ts";

export const MACRO_DIRECTION_VERDICT_GATE = {
  ...PAPER_GATE,
  version: "updown-macro-direction-opposite-side-gate-v1",
  evalStartMs: Date.parse("2026-07-24T09:30:00.000Z"),
} as const;

export const macroDirectionVerdictKey = (botKey: string, horizonMin: number) =>
  `${botKey}:${horizonMin}`;

const BOT_NAMES = {
  [MACRO_DIRECTION_CONTROLS.upBotKey]: "Always up — macro UP only",
  [MACRO_DIRECTION_CONTROLS.downBotKey]: "Always down — macro DOWN only",
} as const;

const finiteAsk = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0.02 && parsed < 0.98 ? parsed : null;
};

/** Extract only the opposite side's executable VWAP from the row's frozen paired-book metadata. */
export function macroDirectionOppositeAsk(
  side: string,
  modelMeta: unknown,
): number | null {
  if ((side !== "up" && side !== "down") || !modelMeta || typeof modelMeta !== "object") {
    return null;
  }
  const book = (modelMeta as { bookExecution?: unknown }).bookExecution;
  if (!book || typeof book !== "object") return null;
  const opposite = side === "up"
    ? (book as { down?: unknown }).down
    : (book as { up?: unknown }).up;
  if (!opposite || typeof opposite !== "object") return null;
  return finiteAsk((opposite as { effectiveVwap?: unknown }).effectiveVwap);
}

export function computeMacroDirectionVerdictGate(
  trades: PaperGateTrade[],
  nowMs = Date.now(),
  config: PaperGateConfig = MACRO_DIRECTION_VERDICT_GATE,
) {
  const candidateKeys = new Set<string>([
    MACRO_DIRECTION_CONTROLS.upBotKey,
    MACRO_DIRECTION_CONTROLS.downBotKey,
  ]);
  const mapped = trades.flatMap((trade) => {
    if (trade.botKey === "drift") return [trade];
    if (!candidateKeys.has(trade.botKey) || (trade.horizonMin !== 5 && trade.horizonMin !== 15)) {
      return [];
    }
    return [{
      ...trade,
      botKey: macroDirectionVerdictKey(trade.botKey, trade.horizonMin),
    }];
  });
  const bots = (
    [
      MACRO_DIRECTION_CONTROLS.upBotKey,
      MACRO_DIRECTION_CONTROLS.downBotKey,
    ] as const
  ).flatMap((sourceKey) =>
    ([5, 15] as const).map((horizonMin) => ({
      key: macroDirectionVerdictKey(sourceKey, horizonMin),
      name: `${BOT_NAMES[sourceKey]} · ${horizonMin}m`,
      evalStartMs: config.evalStartMs,
      eligible: (context: { pair?: string; horizonMin: number }) =>
        context.horizonMin === horizonMin
        && MACRO_DIRECTION_CONTROLS.pairs.includes(
          context.pair as (typeof MACRO_DIRECTION_CONTROLS.pairs)[number],
        ),
    }))
  );
  return computePaperGate(
    mapped,
    [
      ...bots,
      {
        key: "drift",
        name: "Always down (opportunity denominator)",
        evalStartMs: config.evalStartMs,
        control: true,
      },
    ],
    nowMs,
    config,
    contemporaneousOppositeNet,
    (trade) =>
      trade.askPaid > 0.02
      && trade.askPaid < 0.98
      && trade.oppositeAskPaid != null
      && trade.oppositeAskPaid > 0.02
      && trade.oppositeAskPaid < 0.98,
  );
}
