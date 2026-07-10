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
import { CapturePage } from "./pages/capture/CapturePage";
import { SettingsPage } from "./pages/SettingsPage";
import { AdminPage } from "./pages/AdminPage";
import { AppLayout, BoxRedirect, BrowsePageWrapper } from "./app-shell";
import { CardViewPage } from "./pages/card/CardViewPage";
import { ViewPage } from "./pages/ViewPage";
import { LandmarksPage } from "./pages/landmarks/LandmarksPage";
import { ChatsPage } from "./pages/chats/ChatsPage";
import { SpeechTestPage } from "./pages/dev/SpeechTestPage";
import { ComposerStatesPage } from "./pages/dev/ComposerStatesPage";

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
    // A `view:` URL to open in the companion pane when the chat loads (e.g. a
    // commentary card captured by the clerk extension). Opened once on mount.
    companion: z.string().optional(),
    // The card live-open in the companion pane (serialized view URL, no
    // `view:` prefix). Persisted so a reload restores it; kept in sync as the
    // active card changes. Distinct from `companion`, which is a one-shot
    // deep-link opened only on mount.
    card: z.string().optional(),
    // Native companion embed mode: conversation-only chat, no web composer.
    embed: z.union([z.literal("1"), z.literal(1)]).optional(),
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

// Dev-only test harness for the speech replay menu (see SpeechTestHarness).
const devSpeechRoute = createRoute({
  getParentRoute: () => boxLayoutRoute,
  path: "/dev/speech",
  component: SpeechTestPage,
});

// Dev-only gallery of composer visual states (see ComposerStatesHarness).
const devComposerStatesRoute = createRoute({
  getParentRoute: () => boxLayoutRoute,
  path: "/dev/composer-states",
  component: ComposerStatesPage,
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
    // Dev-only routes are omitted from production builds entirely. The undefined
    // guard keeps the literal `import.meta.env.DEV` intact for Vite's build-time
    // dead-code elimination, while short-circuiting under the SSR loader / plain-
    // Node tests where `import.meta.env` is undefined (see lib/view-url.ts). Vite's
    // ambient types declare `import.meta.env` as always-defined (true only inside a
    // Vite-processed build), so the check is real at runtime but invisible to TS —
    // and the literal `import.meta.env.DEV` shape has to stay intact for Vite's
    // static DCE, ruling out the honest-cast pattern `lib/view-url.ts` uses instead.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- see comment above
    ...((import.meta.env !== undefined && import.meta.env.DEV) ? [devSpeechRoute, devComposerStatesRoute] : []),
    boxCatchAllRoute,
  ]),
]);

// --- Router factory ---

export function createAppRouter(opts?: { history?: Parameters<typeof createRouter>[0]["history"] }) {
  // When this app is served under a path prefix (e.g. /main/ when behind the
  // monorepo dev router), Vite sets import.meta.env.BASE_URL accordingly and
  // we tell TanStack Router about it so it doesn't parse the prefix as the
  // first route segment. Trailing slash is stripped per TanStack's convention.
  // Guarded read — import.meta.env is undefined under the SSR loader / plain-Node
  // (matches lib/view-url.ts's viteBase); the bare `.BASE_URL` would throw there.
  const rawBase = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
  const basepath = rawBase.replace(/\/$/, "") || undefined;
  return createRouter({
    routeTree,
    defaultPreload: false,
    basepath,
    ...opts,
  });
}

// Type registration for type-safe hooks
declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
