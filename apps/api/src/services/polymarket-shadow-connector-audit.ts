/**
 * Prospective paper-only preparation-latency audit.
 *
 * The query projects only market/decision clocks and the control row's `shadowConnector` metadata.
 * It reads no side, price, fill, outcome, grade, return, residual, rank, or P&L field.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { db, paperTrades } from "@framework/db";
import {
  computeShadowConnectorAudit,
  POLYMARKET_SHADOW_CONNECTOR_AUDIT,
} from "./polymarket-shadow-connector-audit-model.ts";

export async function polymarketShadowConnectorAudit() {
  const rows = await db
    .select({
      pair: paperTrades.pair,
      horizonMin: paperTrades.horizonMin,
      windowStart: paperTrades.windowStart,
      decidedAt: paperTrades.decidedAt,
      // Rebuild a telemetry-only projection so the query never loads the quote/price fields that
      // coexist beside these operational measurements in the stored connector summary.
      shadowConnector: sql<unknown>`jsonb_build_object(
        'up', jsonb_build_object(
          'version', ${paperTrades.modelMeta}#>'{shadowConnector,up,version}',
          'mode', ${paperTrades.modelMeta}#>'{shadowConnector,up,mode}',
          'accepted', ${paperTrades.modelMeta}#>'{shadowConnector,up,accepted}',
          'preparationMicros', ${paperTrades.modelMeta}#>'{shadowConnector,up,preparationMicros}',
          'marketDataAgeMs', ${paperTrades.modelMeta}#>'{shadowConnector,up,marketDataAgeMs}',
          'reason', ${paperTrades.modelMeta}#>'{shadowConnector,up,reason}'
        ),
        'down', jsonb_build_object(
          'version', ${paperTrades.modelMeta}#>'{shadowConnector,down,version}',
          'mode', ${paperTrades.modelMeta}#>'{shadowConnector,down,mode}',
          'accepted', ${paperTrades.modelMeta}#>'{shadowConnector,down,accepted}',
          'preparationMicros', ${paperTrades.modelMeta}#>'{shadowConnector,down,preparationMicros}',
          'marketDataAgeMs', ${paperTrades.modelMeta}#>'{shadowConnector,down,marketDataAgeMs}',
          'reason', ${paperTrades.modelMeta}#>'{shadowConnector,down,reason}'
        )
      )`,
    })
    .from(paperTrades)
    .where(and(
      eq(paperTrades.botKey, "drift"),
      gte(
        paperTrades.windowStart,
        new Date(POLYMARKET_SHADOW_CONNECTOR_AUDIT.evalStartMs),
      ),
    ));
  return computeShadowConnectorAudit(rows);
}
