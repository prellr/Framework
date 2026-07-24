import { t } from "../trpc/context.ts";
import { protectedProcedure } from "../trpc/middleware.ts";
import { crucibleObservatory } from "../services/crucible-observatory.ts";

/**
 * Warehouse-backed Crucible visibility only. There are intentionally no mutation procedures in
 * this router: no start, replay, cancel, validate, promote, activate, or run-cycle surface.
 */
export const crucibleRouter = t.router({
  observatory: protectedProcedure.query(() => crucibleObservatory()),
});
