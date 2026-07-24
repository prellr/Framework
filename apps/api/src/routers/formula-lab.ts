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

/**
 * Jester-wide, venue-neutral formula research.
 *
 * The surface is intentionally read-only: it exposes the bounded expression contract, a
 * deterministic synthetic mechanics proof, and one frozen retrospective venue-tape preview.
 * Search jobs, strategy registration, and execution remain unreachable from this router.
 */
export const formulaLabRouter = t.router({
  status: protectedProcedure.query(() => formulaLabStatus()),
  scaleStatus: protectedProcedure.query(() => formulaicScaleStatus()),
  controlPlaneStatus: protectedProcedure.query(() => researchControlPlaneStatus()),
  validationSummary: protectedProcedure
    .input(z.object({ experimentId: z.string().uuid() }))
    .query(({ input }) =>
      researchValidationFamilySummary(input.experimentId)),
  venuePreview: protectedProcedure.query(() => formulaicVenuePreview()),
});
