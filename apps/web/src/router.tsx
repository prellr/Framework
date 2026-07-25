import { createRouter, createRoute, createRootRoute, redirect } from "@tanstack/react-router";
import { authClient } from "./lib/auth-client";
import { AppShell } from "./components/layout/AppShell";
import { LoginPage } from "./pages/auth/LoginPage";
import { ForgotPasswordPage } from "./pages/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/auth/ResetPasswordPage";
import { DashboardPage } from "./pages/dashboard/DashboardPage";
import { NotesPage } from "./pages/notes/NotesPage";
import { CredentialsPage } from "./pages/settings/CredentialsPage";
import { SettingsPage } from "./pages/settings/SettingsPage";
import { CatalogPage } from "./pages/catalog/CatalogPage";
import { StrategyDetailPage } from "./pages/catalog/StrategyDetailPage";
import { SweepLauncher } from "./pages/sweeps/SweepLauncher";
import { SweepsPage } from "./pages/sweeps/SweepsPage";
import { SweepsHistory } from "./pages/sweeps/SweepsHistory";
import { SweepDetail } from "./pages/sweeps/SweepDetail";
import { ResultsExplorer } from "./pages/results/ResultsExplorer";
import { LivePage } from "./pages/live/LivePage";
import { TesseractPage } from "./pages/tesseract/TesseractPage";
import { KnowledgePage } from "./pages/kb/KnowledgePage";
import { PolymarketPage } from "./pages/polymarket/PolymarketPage";
import { PolymarketStrategyDetailPage } from "./pages/polymarket/PolymarketStrategyDetailPage";
import { PolymarketAssetDetailPage } from "./pages/polymarket/PolymarketAssetDetailPage";
import { FormulaLabPage } from "./pages/formula-lab/FormulaLabPage";
import { CruciblePage } from "./pages/crucible/CruciblePage";
import { AnalyticsPage } from "./pages/analytics/AnalyticsPage";
import { LeaderboardPage } from "./pages/leaderboard/LeaderboardPage";
import { AssetsPage } from "./pages/assets/AssetsPage";
import { ScreensPage } from "./pages/screens/ScreensPage";
import { ChartsPage } from "./pages/charts/ChartsPage";
import { PortfolioPage } from "./pages/account/PortfolioPage";
import { PositionsPage } from "./pages/account/PositionsPage";
import { TradingPage } from "./pages/trading/TradingPage";
import { AdminPage } from "./pages/admin/AdminPage";

const ROLE_RANK: Record<string, number> = {
  viewer: 0,
  operator: 1,
  manager: 2,
  admin: 3,
};

/**
 * Client-side role gate for routes (redirects). This is a UX nicety only —
 * real enforcement is the role middleware on the tRPC procedures.
 */
async function requireRole(minRole: string) {
  const session = await authClient.getSession();
  if (!session.data) throw redirect({ to: "/login" });
  const rank = ROLE_RANK[(session.data.user as { role?: string }).role ?? "viewer"] ?? 0;
  if (rank < ROLE_RANK[minRole]) throw redirect({ to: "/dashboard" });
}

const rootRoute = createRootRoute({
  notFoundComponent: () => (
    <div className="text-muted-foreground flex h-screen items-center justify-center">
      Page not found or not yet built.
    </div>
  ),
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/forgot-password",
  component: ForgotPasswordPage,
});

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset-password",
  component: ResetPasswordPage,
});

const protectedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "protected",
  component: AppShell,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) throw redirect({ to: "/login" });
  },
});

const indexRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/",
  component: DashboardPage,
});

const dashboardRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/dashboard",
  component: DashboardPage,
});

const notesRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/notes",
  component: NotesPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/settings",
  component: SettingsPage,
});

const catalogRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/catalog",
  component: CatalogPage,
});

const strategyDetailRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/strategy/$strategyId",
  component: StrategyDetailPage,
  // Optional cell context, so links from By Asset / Results open the page already pointed at the
  // pair · timeframe · window you were looking at instead of resetting to the best result.
  // Optional-by-omission so plain links (no cell context) stay valid with `search={{}}`.
  validateSearch: (s: Record<string, unknown>): { pair?: string; tf?: string; days?: number } => {
    const out: { pair?: string; tf?: string; days?: number } = {};
    if (typeof s.pair === "string") out.pair = s.pair;
    if (typeof s.tf === "string") out.tf = s.tf;
    if (s.days != null && Number.isFinite(Number(s.days))) out.days = Number(s.days);
    return out;
  },
});

const sweepsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/sweeps",
  component: SweepsPage,
});

const sweepsHistoryRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/sweeps/history",
  beforeLoad: () => {
    throw redirect({ to: "/sweeps" });
  },
  component: SweepsHistory,
});

const sweepDetailRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/sweeps/$sweepId",
  component: SweepDetail,
});

// Unified Analytics surface (UX restructure). Old analysis routes redirect here.
const analyticsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/analytics",
  component: AnalyticsPage,
});
const resultsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/results",
  beforeLoad: () => {
    throw redirect({ to: "/analytics" });
  },
  component: ResultsExplorer,
});

const tesseractRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/tesseract",
  component: TesseractPage,
});

const knowledgeRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/knowledge",
  component: KnowledgePage,
});

const polymarketRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/polymarket",
  component: PolymarketPage,
});

const crucibleRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/crucible",
  component: CruciblePage,
});

const polymarketStrategyRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/polymarket/strategy/$botKey",
  component: PolymarketStrategyDetailPage,
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    scope?: "paper" | "forward" | "history";
    period?: "24h" | "3d" | "7d" | "30d" | "all";
    horizon?: 5 | 15;
    assets?: string;
    stake?: 5 | 10 | 20;
  } => {
    const out: {
      scope?: "paper" | "forward" | "history";
      period?: "24h" | "3d" | "7d" | "30d" | "all";
      horizon?: 5 | 15;
      assets?: string;
      stake?: 5 | 10 | 20;
    } = {};
    if (search.scope === "paper" || search.scope === "forward" || search.scope === "history")
      out.scope = search.scope;
    if (
      search.period === "24h" ||
      search.period === "3d" ||
      search.period === "7d" ||
      search.period === "30d" ||
      search.period === "all"
    )
      out.period = search.period;
    if (Number(search.horizon) === 5 || Number(search.horizon) === 15)
      out.horizon = Number(search.horizon) as 5 | 15;
    if (typeof search.assets === "string" && search.assets.length <= 64) out.assets = search.assets;
    if ([5, 10, 20].includes(Number(search.stake))) out.stake = Number(search.stake) as 5 | 10 | 20;
    return out;
  },
});

const polymarketAssetRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/polymarket/asset/$asset",
  component: PolymarketAssetDetailPage,
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    scope?: "paper" | "forward" | "history";
    period?: "24h" | "3d" | "7d" | "30d" | "all";
    horizon?: 5 | 15;
  } => {
    const out: {
      scope?: "paper" | "forward" | "history";
      period?: "24h" | "3d" | "7d" | "30d" | "all";
      horizon?: 5 | 15;
    } = {};
    if (search.scope === "paper" || search.scope === "forward" || search.scope === "history")
      out.scope = search.scope;
    if (
      search.period === "24h" ||
      search.period === "3d" ||
      search.period === "7d" ||
      search.period === "30d" ||
      search.period === "all"
    )
      out.period = search.period;
    if (Number(search.horizon) === 5 || Number(search.horizon) === 15)
      out.horizon = Number(search.horizon) as 5 | 15;
    return out;
  },
});

const formulaLabRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/formula-lab",
  component: () => <FormulaLabPage view="overview" />,
});

const formulaLabFormulasRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/formula-lab/formulas",
  component: () => <FormulaLabPage view="formulas" />,
});

const formulaLabExperimentsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/formula-lab/experiments",
  component: () => <FormulaLabPage view="experiments" />,
});

const formulaLabSystemRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/formula-lab/system",
  component: () => <FormulaLabPage view="system" />,
});

const legacyPolymarketFormulaLabRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/polymarket/formula-lab",
  beforeLoad: () => {
    throw redirect({ to: "/formula-lab" });
  },
  component: FormulaLabPage,
});

const leaderboardRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/leaderboard",
  beforeLoad: () => {
    throw redirect({ to: "/analytics" });
  },
  component: LeaderboardPage,
});

const assetsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/assets",
  beforeLoad: () => {
    throw redirect({ to: "/analytics" });
  },
  component: AssetsPage,
});

const screensRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/screens",
  component: ScreensPage,
});

const chartsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/charts",
  beforeLoad: () => {
    throw redirect({ to: "/analytics" });
  },
  component: ChartsPage,
});

// Unified Live surface (UX restructure). The old three routes redirect here so deep links survive.
const liveRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/live",
  component: LivePage,
});
const portfolioRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/portfolio",
  beforeLoad: () => {
    throw redirect({ to: "/live" });
  },
  component: PortfolioPage,
});

const positionsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/positions",
  beforeLoad: () => {
    throw redirect({ to: "/live" });
  },
  component: PositionsPage,
});

const tradingRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/trading",
  beforeLoad: () => {
    throw redirect({ to: "/live" });
  },
  component: TradingPage,
});

const adminRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/admin",
  beforeLoad: () => {
    throw redirect({ to: "/settings" });
  },
  component: AdminPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  protectedRoute.addChildren([
    indexRoute,
    dashboardRoute,
    notesRoute,
    catalogRoute,
    strategyDetailRoute,
    sweepsRoute,
    sweepsHistoryRoute,
    sweepDetailRoute,
    analyticsRoute,
    tesseractRoute,
    knowledgeRoute,
    polymarketRoute,
    polymarketStrategyRoute,
    polymarketAssetRoute,
    formulaLabRoute,
    formulaLabFormulasRoute,
    formulaLabExperimentsRoute,
    formulaLabSystemRoute,
    legacyPolymarketFormulaLabRoute,
    crucibleRoute,
    resultsRoute,
    leaderboardRoute,
    assetsRoute,
    screensRoute,
    chartsRoute,
    liveRoute,
    portfolioRoute,
    positionsRoute,
    tradingRoute,
    settingsRoute,
    adminRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
