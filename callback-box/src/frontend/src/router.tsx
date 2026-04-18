/**
 * TanStack Router route tree and router instance.
 *
 * Code-based routing — the route tree is small (~15 routes) and SSR
 * needs to share the same tree. All routes under /$boxSlug inherit
 * typed boxSlug params automatically.
 */

import { createRouter, createRoute, createRootRoute, Outlet, redirect } from "@tanstack/react-router";
import { z } from "zod";

// --- Page imports ---
import { DashboardPage } from "./components/DashboardPage";
import { ChatPage } from "./components/ChatPage";
import { QuestionsPage } from "./pages/QuestionsPage";
import { HistoryPage } from "./components/HistoryPage";
import { CapturePage } from "./pages/CapturePage";
import { SettingsPage } from "./pages/SettingsPage";
import { AdminPage } from "./pages/AdminPage";
import { SharePage } from "./pages/SharePage";
import { PrintBriefView } from "./components/brief/PrintBriefView";
import { TodosPage } from "./pages/TodosPage";
import { AppLayout, BoxRedirect, ShareRedirect, CardViewPage, NewsPageWrapper, BrowsePageWrapper } from "./app-shell";
import { ViewPage } from "./components/ViewPage";

// --- Root route ---

const rootRoute = createRootRoute({
  component: Outlet,
});

// --- Top-level routes (no boxSlug) ---

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: BoxRedirect,
});

const shareRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/share",
  component: ShareRedirect,
});

// --- Box-scoped standalone routes (no nav) ---

const printRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/$boxSlug/print/$",
  component: PrintBriefView,
});

const shareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/$boxSlug/share",
  component: SharePage,
});

// --- Box layout (nav wrapper) ---

const boxLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/$boxSlug",
  component: AppLayout,
});

// --- Box child routes ---

const dashboardRoute = createRoute({
  getParentRoute: () => boxLayoutRoute,
  path: "/",
  component: DashboardPage,
});

const chatRoute = createRoute({
  getParentRoute: () => boxLayoutRoute,
  path: "/chat",
  component: ChatPage,
  validateSearch: z.object({
    session: z.string().optional(),
  }),
});

const questionsRoute = createRoute({
  getParentRoute: () => boxLayoutRoute,
  path: "/questions",
  component: QuestionsPage,
});

const newsRoute = createRoute({
  getParentRoute: () => boxLayoutRoute,
  path: "/news/$",
  component: NewsPageWrapper,
});

const browseRoute = createRoute({
  getParentRoute: () => boxLayoutRoute,
  path: "/browse/$",
  component: BrowsePageWrapper,
});

const historyRoute = createRoute({
  getParentRoute: () => boxLayoutRoute,
  path: "/history",
  component: HistoryPage,
});

const historyDetailRoute = createRoute({
  getParentRoute: () => boxLayoutRoute,
  path: "/history/$hash",
  component: HistoryPage,
});

const captureRoute = createRoute({
  getParentRoute: () => boxLayoutRoute,
  path: "/capture",
  component: CapturePage,
});

const settingsRoute = createRoute({
  getParentRoute: () => boxLayoutRoute,
  path: "/settings",
  component: SettingsPage,
});

const adminRoute = createRoute({
  getParentRoute: () => boxLayoutRoute,
  path: "/admin",
  component: AdminPage,
  validateSearch: z.object({
    google: z.string().optional(),
    message: z.string().optional(),
    code: z.string().optional(),
  }),
});

const todosRoute = createRoute({
  getParentRoute: () => boxLayoutRoute,
  path: "/todos",
  component: TodosPage,
});
const cardRoute = createRoute({
  getParentRoute: () => boxLayoutRoute,
  path: "/card/$",
  component: CardViewPage,
});

const viewRoute = createRoute({
  getParentRoute: () => boxLayoutRoute,
  path: "/views/$",
  component: ViewPage,
});

// Catch-all for unknown paths under a box
const boxCatchAllRoute = createRoute({
  getParentRoute: () => boxLayoutRoute,
  path: "/$",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/$boxSlug", params: { boxSlug: params.boxSlug } });
  },
});

// --- Route tree ---

const routeTree = rootRoute.addChildren([
  indexRoute,
  shareRedirectRoute,
  printRoute,
  shareRoute,
  boxLayoutRoute.addChildren([
    dashboardRoute,
    chatRoute,
    questionsRoute,
    newsRoute,
    browseRoute,
    historyRoute,
    historyDetailRoute,
    captureRoute,
    settingsRoute,
    adminRoute,
    todosRoute,
    cardRoute,
    viewRoute,
    boxCatchAllRoute,
  ]),
]);

// --- Router factory ---

export function createAppRouter(opts?: { history?: Parameters<typeof createRouter>[0]["history"] }) {
  return createRouter({
    routeTree,
    defaultPreload: false,
    ...opts,
  });
}

// Type registration for type-safe hooks
declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
