/**
 * Frozen, outcome-free analysis plan for the two compact public flow tapes.
 *
 * This is an analysis contract, not a data-collection boundary or a trading rule. Each source
 * inherits its original prospective tape boundary and may disclose feature quantiles only after
 * every readiness floor on that source passes.
 */
import { CLOB_EVENT_OFI_TAPE } from "./clob-event-ofi.ts";
import { HYPERLIQUID_FLOW_TAPE } from "./hl-rtds.ts";

export const FLOW_DISTRIBUTION_AUDIT = {
  version: "updown-flow-distribution-audit-v1",
  quantileProbabilities: [0.05, 0.25, 0.5, 0.75, 0.95] as const,
  cacheMs: 15 * 60_000,
  sources: {
    hyperliquid: {
      tapeVersion: HYPERLIQUID_FLOW_TAPE.version,
      evalStartMs: HYPERLIQUID_FLOW_TAPE.evalStartMs,
      metrics: [
        "imbalance5s",
        "imbalance30s",
        "imbalance60s",
        "absoluteImbalance60s",
        "logNotional60s",
        "tradeCount60s",
        "maxTradeShare60s",
      ],
    },
    clobEventOfi: {
      tapeVersion: CLOB_EVENT_OFI_TAPE.version,
      evalStartMs: CLOB_EVENT_OFI_TAPE.evalStartMs,
      metrics: [
        "canonical5s",
        "canonical30s",
        "canonical60s",
        "absoluteCanonical60s",
        "totalEvents60s",
        "receiveAgeSec",
        "maxTransportLagMs60s",
      ],
    },
  },
} as const;
