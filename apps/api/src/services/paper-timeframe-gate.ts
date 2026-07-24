import {
  computePaperGate,
  PAPER_GATE,
  type PaperGateConfig,
  type PaperGateBot,
  type PaperGateTrade,
} from "./paper-floor-gate.ts";

/**
 * The pooled v3 gate is immutable. This future evaluation contract changes no decision rule or
 * threshold; it only makes strategy × timeframe the unit of evidence after the frozen boundary.
 */
export const PAPER_TIMEFRAME_GATE = {
  ...PAPER_GATE,
  version: "updown-timeframe-verdict-gate-v1",
  evalStartMs: Date.parse("2026-07-24T04:00:00.000Z"),
} as const;

export interface PaperTimeframeGateBot extends PaperGateBot {
  sourceKey: string;
  horizonMin: 5 | 15;
}

export const paperTimeframeGateKey = (botKey: string, horizonMin: number) =>
  `${botKey}:${horizonMin}`;

export function computePaperTimeframeGate(
  trades: PaperGateTrade[],
  bots: PaperTimeframeGateBot[],
  nowMs = Date.now(),
  config: PaperGateConfig = PAPER_TIMEFRAME_GATE,
) {
  const mappedTrades = trades.map((trade) => ({
    ...trade,
    botKey: trade.botKey === "drift"
      ? "drift"
      : paperTimeframeGateKey(trade.botKey, trade.horizonMin),
  }));
  return computePaperGate(
    mappedTrades,
    [
      ...bots.map(({ sourceKey: _sourceKey, horizonMin: _horizonMin, ...bot }) => bot),
      {
        key: "drift",
        name: "Always down (control)",
        evalStartMs: config.evalStartMs,
        control: true,
      },
    ],
    nowMs,
    config,
  );
}
