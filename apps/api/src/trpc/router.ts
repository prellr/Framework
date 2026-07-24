import type { inferRouterOutputs } from "@trpc/server";
import { t } from "./context.ts";
import { adminRouter } from "../routers/admin.ts";
import { notesRouter } from "../routers/notes.ts";
import { credentialsRouter } from "../routers/credentials.ts";
import { catalogRouter } from "../routers/catalog.ts";
import { resultsRouter } from "../routers/results.ts";
import { sweepsRouter } from "../routers/sweeps.ts";
import { accountRouter } from "../routers/account.ts";
import { screensRouter } from "../routers/screens.ts";
import { marketsRouter } from "../routers/markets.ts";
import { tradingRouter } from "../routers/trading.ts";
import { searchRouter } from "../routers/search.ts";
import { coverageRouter } from "../routers/coverage.ts";
import { deployRouter } from "../routers/deploy.ts";
import { tesseractRouter } from "../routers/tesseract.ts";
import { robustnessRouter } from "../routers/robustness.ts";
import { leaderboardRouter } from "../routers/leaderboard.ts";
import { kbRouter } from "../routers/kb.ts";
import { polymarketRouter } from "../routers/polymarket.ts";
import { crucibleRouter } from "../routers/crucible.ts";
import { formulaLabRouter } from "../routers/formula-lab.ts";
import { publicProcedure } from "./middleware.ts";

export const appRouter = t.router({
  health: publicProcedure.query(() => ({ status: "ok", timestamp: new Date().toISOString() })),
  admin: adminRouter,
  search: searchRouter,
  notes: notesRouter,
  credentials: credentialsRouter,
  catalog: catalogRouter,
  results: resultsRouter,
  sweeps: sweepsRouter,
  account: accountRouter,
  screens: screensRouter,
  markets: marketsRouter,
  trading: tradingRouter,
  coverage: coverageRouter,
  deploy: deployRouter,
  tesseract: tesseractRouter,
  robustness: robustnessRouter,
  leaderboard: leaderboardRouter,
  kb: kbRouter,
  polymarket: polymarketRouter,
  crucible: crucibleRouter,
  formulaLab: formulaLabRouter,
});

export type AppRouter = typeof appRouter;

/** Inferred output types for all tRPC procedures — import in the web package */
export type RouterOutput = inferRouterOutputs<AppRouter>;
