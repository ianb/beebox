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
import { DashboardPage } from "./pages/DashboardPage";
import { ChatPage } from "./pages/ChatPage";
import { QuestionsPage } from "./pages/QuestionsPage";
import { HistoryPage } from "./pages/HistoryPage";
import { CapturePage } from "./pages/CapturePage";
import { SettingsPage } from "./pages/SettingsPage";
import { AdminPage } from "./pages/AdminPage";
import { SharePage } from "./pages/SharePage";
import { AppLayout, BoxRedirect, ShareRedirect, BrowsePageWrapper } from "./app-shell";
import { CardViewPage } from "./pages/card/CardViewPage";
import { ViewPage } from "./pages/ViewPage";
import { LandmarksPage } from "./pages/landmarks/LandmarksPage";
import { ChatsPage } from "./pages/chats/ChatsPage";

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
    contextDir: z.string().optional(),
  }),
});

const questionsRoute = createRoute({
  getParentRoute: () => boxLayoutRoute,
  path: "/questions",
  component: QuestionsPage,
});

const browseRoute = createRoute({
  getParentRoute: () => boxLayoutRoute,
  path: "/browse/$",
  component: BrowsePageWrapper,
});

const historySearchSchema = z.object({
  connector: z.array(z.string()).optional(),
  workflow: z.array(z.string()).optional(),
  touchpoint: z.boolean().optional(),
  feedback: z.boolean().optional(),
  session: z.string().optional(),
});

const historyRoute = createRoute({
  getParentRoute: () => boxLayoutRoute,
  path: "/history",
  component: HistoryPage,
  validateSearch: historySearchSchema,
});

const historyDetailRoute = createRoute({
  getParentRoute: () => boxLayoutRoute,
  path: "/history/$hash",
  component: HistoryPage,
  validateSearch: historySearchSchema,
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

const landmarksRoute = createRoute({
  getParentRoute: () => boxLayoutRoute,
  path: "/landmarks",
  component: LandmarksPage,
});

const chatsRoute = createRoute({
  getParentRoute: () => boxLayoutRoute,
  path: "/chats",
  component: ChatsPage,
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
  shareRoute,
  boxLayoutRoute.addChildren([
    dashboardRoute,
    chatRoute,
    questionsRoute,
    browseRoute,
    historyRoute,
    historyDetailRoute,
    captureRoute,
    settingsRoute,
    adminRoute,
    cardRoute,
    viewRoute,
    landmarksRoute,
    chatsRoute,
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
