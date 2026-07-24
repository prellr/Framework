import { POLYMARKET_SHADOW_CONNECTOR } from "./polymarket-shadow-connector.ts";

export const POLYMARKET_SHADOW_CONNECTOR_AUDIT = {
  version: "polymarket-shadow-connector-latency-audit-v1",
  evalStartMs: Date.parse("2026-07-25T00:00:00.000Z"),
  minMarkets: 500,
  minSpanHours: 24,
  minPreparedCoverage: 0.95,
  maxP95PreparationMicros: 1_000,
  maxP99PreparationMicros: 5_000,
  maxP95MarketDataAgeMs: 2_000,
  plansPerMarket: 2,
} as const;

export interface ShadowConnectorAuditRow {
  pair: string;
  horizonMin: number;
  windowStart: Date;
  decidedAt: Date;
  shadowConnector: unknown;
}

type ShadowTelemetry = {
  accepted: boolean;
  reason: string | null;
  preparationMicros: number;
  marketDataAgeMs: number | null;
};

const unavailableReasons = new Set([
  "invalid-intent",
  "stale-book",
  "book-mismatch",
]);

const finiteNonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

function parseTelemetry(value: unknown): ShadowTelemetry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    row.version !== POLYMARKET_SHADOW_CONNECTOR.version
    || row.mode !== POLYMARKET_SHADOW_CONNECTOR.mode
    || typeof row.accepted !== "boolean"
    || !finiteNonNegative(row.preparationMicros)
    || !(row.marketDataAgeMs == null || finiteNonNegative(row.marketDataAgeMs))
  ) return null;
  const reason = row.accepted ? null : typeof row.reason === "string" ? row.reason : null;
  if (!row.accepted && reason == null) return null;
  return {
    accepted: row.accepted,
    reason,
    preparationMicros: row.preparationMicros,
    marketDataAgeMs: row.marketDataAgeMs as number | null,
  };
}

function percentile(values: number[], probability: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * probability)] ?? null;
}

function summarizeTelemetry(rows: ShadowConnectorAuditRow[]) {
  const preparationMicros: number[] = [];
  const marketDataAgeMs: number[] = [];
  const rejectReasons: Record<string, number> = {};
  let telemetryPlans = 0;
  let preparedPlans = 0;
  let acceptedPlans = 0;

  for (const row of rows) {
    const root =
      row.shadowConnector
      && typeof row.shadowConnector === "object"
      && !Array.isArray(row.shadowConnector)
        ? row.shadowConnector as Record<string, unknown>
        : null;
    for (const tokenDirection of ["up", "down"] as const) {
      const telemetry = parseTelemetry(root?.[tokenDirection]);
      if (!telemetry) {
        rejectReasons["missing-telemetry"] = (rejectReasons["missing-telemetry"] ?? 0) + 1;
        continue;
      }
      telemetryPlans++;
      preparationMicros.push(telemetry.preparationMicros);
      if (telemetry.marketDataAgeMs != null) marketDataAgeMs.push(telemetry.marketDataAgeMs);
      if (telemetry.accepted) {
        acceptedPlans++;
        preparedPlans++;
      } else {
        rejectReasons[telemetry.reason!] = (rejectReasons[telemetry.reason!] ?? 0) + 1;
        if (!unavailableReasons.has(telemetry.reason!)) preparedPlans++;
      }
    }
  }

  const expectedPlans = rows.length * POLYMARKET_SHADOW_CONNECTOR_AUDIT.plansPerMarket;
  return {
    markets: rows.length,
    expectedPlans,
    telemetryPlans,
    preparedPlans,
    acceptedPlans,
    unavailablePlans: expectedPlans - preparedPlans,
    preparedCoverage: expectedPlans ? preparedPlans / expectedPlans : 0,
    rejectReasons,
    preparationMicros: {
      p50: percentile(preparationMicros, 0.5),
      p95: percentile(preparationMicros, 0.95),
      p99: percentile(preparationMicros, 0.99),
      max: preparationMicros.length ? Math.max(...preparationMicros) : null,
    },
    marketDataAgeMs: {
      p50: percentile(marketDataAgeMs, 0.5),
      p95: percentile(marketDataAgeMs, 0.95),
      max: marketDataAgeMs.length ? Math.max(...marketDataAgeMs) : null,
    },
  };
}

const frozenPairs = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD", "BNB-USD"] as const;
const frozenHorizons = [5, 15] as const;

export function computeShadowConnectorAudit(
  rows: ShadowConnectorAuditRow[],
  nowMs = Date.now(),
) {
  const summary = summarizeTelemetry(rows);
  const buckets = frozenHorizons.flatMap((horizonMin) =>
    frozenPairs.map((pair) => ({
      pair,
      horizonMin,
      ...summarizeTelemetry(
        rows.filter((row) => row.pair === pair && row.horizonMin === horizonMin),
      ),
    }))
  );
  const mappingViolations = rows.filter(
    (row) =>
      !frozenPairs.includes(row.pair as (typeof frozenPairs)[number])
      || !frozenHorizons.includes(row.horizonMin as (typeof frozenHorizons)[number]),
  ).length;
  const decidedTimes = rows
    .map((row) => row.decidedAt.getTime())
    .filter(Number.isFinite);
  const firstDecidedAtMs = decidedTimes.length ? Math.min(...decidedTimes) : null;
  const lastDecidedAtMs = decidedTimes.length ? Math.max(...decidedTimes) : null;
  const spanHours =
    firstDecidedAtMs == null || lastDecidedAtMs == null
      ? 0
      : (lastDecidedAtMs - firstDecidedAtMs) / 3_600_000;
  const p95PreparationMicros = summary.preparationMicros.p95;
  const p99PreparationMicros = summary.preparationMicros.p99;
  const p95MarketDataAgeMs = summary.marketDataAgeMs.p95;
  const requirements = {
    boundary: nowMs >= POLYMARKET_SHADOW_CONNECTOR_AUDIT.evalStartMs,
    markets: rows.length >= POLYMARKET_SHADOW_CONNECTOR_AUDIT.minMarkets,
    span: spanHours >= POLYMARKET_SHADOW_CONNECTOR_AUDIT.minSpanHours,
    coverage:
      summary.expectedPlans > 0
      && summary.preparedCoverage >= POLYMARKET_SHADOW_CONNECTOR_AUDIT.minPreparedCoverage,
    p95Preparation:
      p95PreparationMicros != null
      && p95PreparationMicros <= POLYMARKET_SHADOW_CONNECTOR_AUDIT.maxP95PreparationMicros,
    p99Preparation:
      p99PreparationMicros != null
      && p99PreparationMicros <= POLYMARKET_SHADOW_CONNECTOR_AUDIT.maxP99PreparationMicros,
    p95BookAge:
      p95MarketDataAgeMs != null
      && p95MarketDataAgeMs <= POLYMARKET_SHADOW_CONNECTOR_AUDIT.maxP95MarketDataAgeMs,
    registeredBucketsOnly: mappingViolations === 0,
  };

  return {
    version: POLYMARKET_SHADOW_CONNECTOR_AUDIT.version,
    connector: POLYMARKET_SHADOW_CONNECTOR,
    evalStartMs: POLYMARKET_SHADOW_CONNECTOR_AUDIT.evalStartMs,
    floors: POLYMARKET_SHADOW_CONNECTOR_AUDIT,
    ...summary,
    buckets,
    mappingViolations,
    firstDecidedAtMs,
    lastDecidedAtMs,
    spanHours,
    requirements,
    readyForOperationalReview: Object.values(requirements).every(Boolean),
    outcomeFree: true as const,
    paperOnly: true as const,
  };
}
