import { z } from "zod";
import { t } from "../trpc/context.ts";
import { protectedProcedure } from "../trpc/middleware.ts";
import { formulaLabStatus } from "../services/formulaic-fixed-horizon-status.ts";
import { formulaicScaleStatus } from "../services/formulaic-scale-status.ts";
import { formulaicVenuePreview } from "../services/formulaic-venue-preview.ts";
import {
  researchControlPlaneStatus,
  researchValidationFamilySummary,
} from "../services/research-control-plane.ts";
import {
  HISTORICAL_ALBERT_CALENDAR_PERIOD_RECEIPT,
} from "../services/historical-albert-calendar-period-receipt.ts";
import {
  simulateHistoricalAlbertCapital,
} from "../services/historical-albert-capital-simulator.ts";

/**
 * Jester-wide, venue-neutral formula research.
 *
 * The surface is intentionally read-only: it exposes the bounded expression contract, a
 * deterministic synthetic mechanics proof, and one frozen retrospective venue-tape preview.
 * Search jobs, strategy registration, and execution remain unreachable from this router.
 */
export const formulaLabRouter = t.router({
  status: protectedProcedure.query(() => formulaLabStatus()),
  calendarPeriods: protectedProcedure.query(
    () => HISTORICAL_ALBERT_CALENDAR_PERIOD_RECEIPT,
  ),
  historicalCapitalSimulation: protectedProcedure
    .input(z.object({
      chartIntervalMinutes: z.union([z.literal(5), z.literal(60)]),
      holdMinutes: z.number().int().positive(),
      trialId: z.string().min(1).max(80),
      initialCapitalUsd: z.number().min(100).max(100_000_000),
      sizingMode: z.enum([
        "fixed-notional",
        "equity-fraction-notional",
        "fixed-risk",
        "equity-fraction-risk",
      ]),
      sizingValue: z.number().positive(),
      compoundSizing: z.boolean(),
      leverage: z.number().min(1).max(50),
      plannedLossPct: z.number().positive().max(100),
      takerFeeBpsPerSide: z.number().min(-10).max(100),
      slippageBpsPerSide: z.number().min(0).max(100),
      fundingBpsPerDay: z.number().min(-1_000).max(1_000),
      page: z.number().int().min(1),
      pageSize: z.number().int().min(10).max(200),
    }))
    .query(({ input }) => simulateHistoricalAlbertCapital(input)),
  scaleStatus: protectedProcedure.query(() => formulaicScaleStatus()),
  controlPlaneStatus: protectedProcedure.query(() => researchControlPlaneStatus()),
  validationSummary: protectedProcedure
    .input(z.object({ experimentId: z.string().uuid() }))
    .query(({ input }) =>
      researchValidationFamilySummary(input.experimentId)),
  venuePreview: protectedProcedure.query(() => formulaicVenuePreview()),
});
