import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, httpLink, splitLink } from "@trpc/client";
import superjson from "superjson";
import { router } from "./router";
import { trpc } from "./lib/trpc";
import { guardedApiFetch } from "./lib/api-fetch";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      // Leave background refetch at the TanStack defaults: tabs pause
      // polling when hidden and refetch on focus once past staleTime.
      // Turning refetchIntervalInBackground on multiplies API load by
      // every open tab, forever — measured ~3x in production before
      // reverting.
    },
  },
});

// Procedures that call Jester/Hyperliquid LIVE — these can be slow or even hang (my_strategies has
// timed out on Jester's side). With a single batched link they'd hold hostage every fast DB query
// batched alongside them (e.g. catalog.detail rendered "Loading…" for minutes on the strategy page).
// So live procedures go on their OWN unbatched link — each is an independent request that can be
// slow without blocking anything else; fast DB queries keep batching.
const isLiveProcedure = (path: string) =>
  path.startsWith("trading.") ||
  path.startsWith("deploy.") ||
  path.startsWith("account.") ||
  path === "catalog.params" ||
  path === "coverage.status";

const trpcClient = trpc.createClient({
  links: [
    splitLink({
      condition: (op) => isLiveProcedure(op.path),
      true: httpLink({ url: "/api/trpc", transformer: superjson, fetch: guardedApiFetch }),
      false: httpBatchLink({ url: "/api/trpc", transformer: superjson, fetch: guardedApiFetch }),
    }),
  ],
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </trpc.Provider>
  </React.StrictMode>,
);
