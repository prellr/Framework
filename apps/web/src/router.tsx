import { createRouter, createRoute, createRootRoute, redirect } from "@tanstack/react-router";
import { authClient } from "./lib/auth-client";
import { AppShell } from "./components/layout/AppShell";
import { LoginPage } from "./pages/auth/LoginPage";
import { ForgotPasswordPage } from "./pages/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/auth/ResetPasswordPage";
import { DashboardPage } from "./pages/dashboard/DashboardPage";
import { NotesPage } from "./pages/notes/NotesPage";
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
    <div className="flex h-screen items-center justify-center text-muted-foreground">
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

const adminRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/admin",
  component: AdminPage,
  beforeLoad: () => requireRole("admin"),
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  protectedRoute.addChildren([indexRoute, dashboardRoute, notesRoute, adminRoute]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
