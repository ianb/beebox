/**
 * TanStack Router route tree and router instance.
 *
 * Code-based routing — the route tree is small (~15 routes) and SSR
 * needs to share the same tree. All routes under /$boxSlug inherit
 * typed boxSlug params automatically.
 */

import { createRouter, createRoute, createRootRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

// --- Page imports ---
import { SYSTEM_CARD_PATHS } from "@shared/system-card-paths";
import { href, toSearch } from "./lib/routing";
import { parseViewUrl, viewStateSearchValue } from "./lib/view-url";
import { legacyBrowseTarget } from "./lib/browse-card-state";
import { legacyAdminRedirect, legacyCaptureRedirect, legacyCardRedirect, legacySystemCardRedirect, systemCardShellSearch, withoutShellParams } from "./lib/system-card-navigation";
import { trpcClient } from "./lib/trpc";
import { ChatPage } from "./pages/ChatPage";
import { BoxRedirect, BoxValidationLayout, DevHarnessLayout, ProductLayout, RootLayout } from "./app-shell";
import { RouteError } from "./components/RouteError";
import { LoginPage } from "./pages/login/LoginPage";
import { SetupPage } from "./pages/login/SetupPage";
import { SpeechTestPage } from "./pages/dev/SpeechTestPage";
import { ComposerStatesPage } from "./pages/dev/ComposerStatesPage";
import { CaptureModePage } from "./pages/dev/CaptureModeHarness";
import { ChatScrollPage } from "./pages/dev/ChatScrollHarness";
import { historyViewRedirectSearch, legacyHistoryState, normalizeHistoryViewRouteTarget } from "./components/history/history-card-state";
import { DEV_HARNESS_PATHS } from "./lib/box-route-layout";

// --- Root route ---

const rootRoute = createRootRoute({
  staticData: { title: null },
  component: RootLayout,
  // Without this the router logs "The following error wasn't caught by any
  // route!" and renders nothing, so a thrown render turns into a blank page.
  errorComponent: RouteError,
});

// --- Top-level routes (no boxSlug) ---

const indexRoute = createRoute({
  staticData: { title: null },
  getParentRoute: () => rootRoute,
  path: "/",
  component: BoxRedirect,
});

const loginRoute = createRoute({
  staticData: { title: "Sign in" },
  getParentRoute: () => rootRoute,
  path: "/auth/login",
  component: LoginPage,
  validateSearch: z.object({
    returnTo: z.string().optional(),
  }),
});

const setupRoute = createRoute({
  staticData: { title: "Set up" },
  getParentRoute: () => rootRoute,
  path: "/auth/setup",
  component: SetupPage,
  validateSearch: z.object({
    token: z.string().optional(),
  }),
});

// --- Box layout (nav wrapper) ---

const boxLayoutRoute = createRoute({
  staticData: { title: null },
  getParentRoute: () => rootRoute,
  path: "/$boxSlug",
  component: BoxValidationLayout,
});

const productLayoutRoute = createRoute({
  staticData: { title: null },
  getParentRoute: () => boxLayoutRoute,
  id: "product",
  component: ProductLayout,
});

const devHarnessLayoutRoute = createRoute({
  staticData: { title: null },
  getParentRoute: () => boxLayoutRoute,
  id: "dev-harness",
  component: DevHarnessLayout,
});

// --- Box child routes ---

// The box index lands on chat — the conversation is the primary surface
// (docs/plans/top-nav-ia.md Track A). A redirect rather than mounting
// ChatPage here: the chat flows canonicalize onto /chat (ChatPage rewrites
// the resolved session there), so a root-mounted chat would immediately
// navigate away from itself.
const boxIndexRoute = createRoute({
  staticData: { title: null },
  getParentRoute: () => productLayoutRoute,
  path: "/",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/$boxSlug/chat", params: { boxSlug: params.boxSlug } });
  },
});

const dashboardRoute = createRoute({
  staticData: { title: "Dashboard" },
  getParentRoute: () => productLayoutRoute,
  path: "/dashboard",
  beforeLoad: ({ params, location }) => {
    throw redirect({ to: href(`/${params.boxSlug}/views/${SYSTEM_CARD_PATHS.dashboard}`), search: toSearch(systemCardShellSearch(location.search)), state: location.state, replace: true });
  },
});

const inventoryRoute = createRoute({
  staticData: { title: "Storage" },
  getParentRoute: () => productLayoutRoute,
  path: "/inventory",
  beforeLoad: ({ params, location }) => {
    throw redirect(legacySystemCardRedirect({ boxSlug: params.boxSlug, type: "inventory", search: location.search, state: location.state }));
  },
});

const chatRoute = createRoute({
  staticData: { title: "Chat" },
  getParentRoute: () => productLayoutRoute,
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
    // Native iOS mode: preserve web navigation and chat controls while the
    // shell supplies a keyboard-safe native composer.
    nativeComposer: z.union([z.literal("1"), z.literal(1)]).optional(),
    // Open capture mode on load — the `/capture` deep link redirects here.
    capture: z.union([z.literal("1"), z.literal(1)]).optional(),
  }),
});

const questionsRoute = createRoute({
  staticData: { title: "Questions" },
  getParentRoute: () => productLayoutRoute,
  path: "/questions",
  beforeLoad: ({ params, location }) => {
    throw redirect(legacySystemCardRedirect({ boxSlug: params.boxSlug, type: "questions", search: location.search, state: location.state }));
  },
});

const browseRoute = createRoute({
  staticData: { title: "Browse" },
  getParentRoute: () => productLayoutRoute,
  path: "/browse/$",
  beforeLoad: async ({ params, location }) => {
    const target = await legacyBrowseTarget(withoutShellParams(parseViewUrl(`${params._splat ?? ""}${location.searchStr}`)), {
      lookupKind: async (path) => (await trpcClient.files.kind.query({ path })).kind,
      // A bare legacy URL is ambiguous after the path disappears. Treat it as
      // a file so the moved-path recovery requested by that URL can run.
      missingKind: "file",
    });
    throw redirect({ to: href(`/${params.boxSlug}/views/${target.path}`),
      search: toSearch({ ...systemCardShellSearch(location.search), viewState: viewStateSearchValue(target.viewState) }),
      state: location.state, replace: true });
  },
});

const historyRoute = createRoute({
  staticData: { title: "History" },
  getParentRoute: () => productLayoutRoute,
  path: "/history",
  beforeLoad: ({ params, location }) => {
    throw redirect({ to: href(`/${params.boxSlug}/views/${SYSTEM_CARD_PATHS.history}`), search: toSearch({ nativeComposer: nativeComposerFrom(location.search), viewState: legacyHistoryState(location.search) }), state: location.state, replace: true });
  },
});

const historyDetailRoute = createRoute({
  staticData: { title: "History" },
  getParentRoute: () => productLayoutRoute,
  path: "/history/$hash",
  beforeLoad: ({ params, location }) => {
    throw redirect({ to: href(`/${params.boxSlug}/views/${SYSTEM_CARD_PATHS.history}`), search: toSearch({ nativeComposer: nativeComposerFrom(location.search), viewState: legacyHistoryState(location.search, { commit: params.hash }) }), state: location.state, replace: true });
  },
});

const captureRoute = createRoute({
  staticData: { title: "Capture" },
  getParentRoute: () => productLayoutRoute,
  path: "/capture",
  beforeLoad: ({ params, location }) => {
    const target = legacyCaptureRedirect({ boxSlug: params.boxSlug, search: location.search, state: location.state });
    throw redirect({ ...target, to: href(`/${params.boxSlug}/chat`), search: toSearch(target.search) });
  },
});

const settingsRoute = createRoute({
  staticData: { title: "Settings" },
  getParentRoute: () => productLayoutRoute,
  path: "/settings",
  beforeLoad: ({ params, location }) => {
    throw redirect({ to: href(`/${params.boxSlug}/views/${SYSTEM_CARD_PATHS.settings}`), search: toSearch(systemCardShellSearch(location.search)), state: location.state, replace: true });
  },
});

const adminRoute = createRoute({
  staticData: { title: "Admin" },
  getParentRoute: () => productLayoutRoute,
  path: "/admin",
  beforeLoad: ({ params, location }) => {
    const target = legacyAdminRedirect({ boxSlug: params.boxSlug, search: location.search, state: location.state });
    throw redirect({ ...target, to: href(`/${params.boxSlug}/views/${SYSTEM_CARD_PATHS.admin}`), search: toSearch(target.search) });
  },
  validateSearch: z.object({
    google: z.string().optional(),
    message: z.string().optional(),
    reconnect: z.string().optional(),
    code: z.string().optional(),
  }),
});

const cardRoute = createRoute({
  staticData: { title: null },
  getParentRoute: () => productLayoutRoute,
  path: "/card/$",
  beforeLoad: ({ params, location }) => {
    throw redirect(legacyCardRedirect({
      boxSlug: params.boxSlug,
      cardPath: params._splat ?? "",
      search: location.search,
      state: location.state,
    }));
  },
});

const viewRoute = createRoute({
  staticData: { title: "Card" },
  getParentRoute: () => productLayoutRoute,
  path: "/views/$",
  beforeLoad: async ({ params, location }) => {
    const target = parseViewUrl(`${params._splat ?? ""}${location.searchStr}`);
    let normalized;
    try { normalized = await normalizeHistoryViewRouteTarget(target, path => trpcClient.card.get.query({ path })); }
    catch (_error) { return; }
    if (normalized === null) return;
    throw redirect({ to: href(`/${params.boxSlug}/views/${normalized.path}`), search: toSearch(historyViewRedirectSearch(normalized, location.search)), state: location.state, replace: true });
  },
});

const landmarksRoute = createRoute({
  staticData: { title: "Landmarks" },
  getParentRoute: () => productLayoutRoute,
  path: "/landmarks",
  beforeLoad: ({ params, location }) => {
    throw redirect(legacySystemCardRedirect({ boxSlug: params.boxSlug, type: "landmarks", search: location.search, state: location.state }));
  },
});

const chatsRoute = createRoute({
  staticData: { title: null },
  getParentRoute: () => productLayoutRoute,
  path: "/chats",
  beforeLoad: ({ params, location }) => {
    throw redirect(legacySystemCardRedirect({ boxSlug: params.boxSlug, type: "landmarks", search: location.search, state: location.state }));
  },
});

// Dev-only test harness for the speech replay menu (see SpeechTestHarness).
const devSpeechRoute = createRoute({
  staticData: { title: "Speech test" },
  getParentRoute: () => devHarnessLayoutRoute,
  path: DEV_HARNESS_PATHS.speech,
  component: SpeechTestPage,
});

// Dev-only gallery of composer visual states (see ComposerStatesHarness).
const devComposerStatesRoute = createRoute({
  staticData: { title: "Composer states" },
  getParentRoute: () => devHarnessLayoutRoute,
  path: DEV_HARNESS_PATHS.composerStates,
  component: ComposerStatesPage,
});

// Dev-only harness for capture mode (overlay + pending bubble + chip).
const devCaptureModeRoute = createRoute({
  staticData: { title: "Capture mode" },
  getParentRoute: () => devHarnessLayoutRoute,
  path: DEV_HARNESS_PATHS.captureMode,
  component: CaptureModePage,
});

// Dev-only harness for the chat scroll controller (isolated, scripted).
const devChatScrollRoute = createRoute({
  staticData: { title: "Chat scroll" },
  getParentRoute: () => devHarnessLayoutRoute,
  path: DEV_HARNESS_PATHS.chatScroll,
  component: ChatScrollPage,
});

// Catch-all for unknown paths under a box
const boxCatchAllRoute = createRoute({
  staticData: { title: null },
  getParentRoute: () => productLayoutRoute,
  path: "/$",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/$boxSlug", params: { boxSlug: params.boxSlug } });
  },
});

// --- Route tree ---

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  setupRoute,
  boxLayoutRoute.addChildren([
    productLayoutRoute.addChildren([
    boxIndexRoute,
    dashboardRoute,
    inventoryRoute,
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
    devHarnessLayoutRoute.addChildren([
    // Dev-only routes are omitted from production builds entirely. The undefined
    // guard keeps the literal `import.meta.env.DEV` intact for Vite's build-time
    // dead-code elimination, while short-circuiting under the SSR loader / plain-
    // Node tests where `import.meta.env` is undefined (see lib/view-url.ts). Vite's
    // ambient types declare `import.meta.env` as always-defined (true only inside a
    // Vite-processed build), so the check is real at runtime but invisible to TS —
    // and the literal `import.meta.env.DEV` shape has to stay intact for Vite's
    // static DCE, ruling out the honest-cast pattern `lib/view-url.ts` uses instead.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- see comment above
    ...((import.meta.env !== undefined && import.meta.env.DEV) ? [devSpeechRoute, devComposerStatesRoute, devCaptureModeRoute, devChatScrollRoute] : []),
    ]),
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
  // eslint-disable-next-line no-restricted-syntax -- env boundary: `import.meta.env` is undefined under the SSR loader / plain-Node (see comment above + lib/view-url.ts precedent); this guarded shape read can't be expressed as a static type since import.meta's typing varies by build context.
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

  /**
   * Every route must name itself for the browser tab (`components/
   * DocumentTitle.tsx`). Declaring a required field here makes TanStack
   * Router's `staticData` mandatory on every route in the tree, so a new
   * page cannot be added without deciding what its tab says — the
   * enforcement that a convention couldn't provide. `null` is the explicit
   * "this route names nothing", for layouts and redirect-only routes.
   */
  interface StaticDataRouteOption {
    title: string | null;
  }
}
function nativeComposerFrom(search: object): unknown {
  return "nativeComposer" in search ? search.nativeComposer : undefined;
}
