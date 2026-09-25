import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const queryClient = new QueryClient({
    // The server pushes changes over /ws (see useLiveUpdates), so cached data is only refetched when it says so.
    defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false } },
  });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    // Query owns caching; the router just asks it on every navigation and preload.
    defaultPreloadStaleTime: 0,
  });
  setupRouterSsrQueryIntegration({ router, queryClient });
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
