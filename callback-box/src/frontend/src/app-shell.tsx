/**
 * App shell: layout wrapper, page wrappers, and route redirects.
 *
 * The UI-heavy pieces (nav bar, profile menu, error badge, box-selection
 * pages, card viewer body) live under components/ so their appearance
 * classes sit next to the logic. This file is routing glue.
 */

import { useEffect, useRef, useState } from "react";
import { Outlet, useParams, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { BrowsePage, type BrowseNavigateOptions } from "./pages/browse/BrowsePage";
import { enableDebugLogCapture, DebugLogPanel, clearErrorCount } from "./components/DebugLog";
import { SourceViewOverlay, useSourceView } from "./components/SourceViewOverlay";
import { ViewOverlayProvider } from "./components/ViewOverlay";
import { AppNav } from "./components/AppNav";
import { AppBarChromeProvider } from "./components/app-bar-chrome";
import { Column } from "./components/ui/Column";
import { Stack } from "./components/ui/Stack";
import { Text } from "./components/ui/Text";
import { BoxActionsTile } from "./components/BoxSelectionTiles";
import { useBoxes } from "./hooks/useBoxes";
import type { KnownBox } from "./lib/boxes";
import { useDevWorktreeKeepalive } from "./hooks/useDevWorktreeKeepalive";
import { useBoxIdentityMeta } from "./hooks/useBoxIdentityMeta";
import { PageTitleProvider, usePageTitle } from "./components/DocumentTitle";
import { DocumentIcon } from "./components/DocumentIcon";
import { useVisualViewportHeight } from "./hooks/useVisualViewportHeight";

import { href, toSearch } from "./lib/routing";

// Re-exported for the route tree
export { BoxRedirect } from "./pages/BoxSelection";

// Start capturing console errors immediately so we never miss early failures
enableDebugLogCapture();

/**
 * Root-level layout, above the route tree's `Outlet`. The place for global,
 * page-agnostic chrome that must show on `/`, `/auth/login`, and `/auth/setup`
 * as well as box routes (which `AppLayout` alone wraps).
 *
 * `PageTitleProvider` lives here rather than in `AppLayout` because the
 * login and setup pages need a tab title too; it is the app's only writer
 * of `document.title`. Otherwise this stays a pass-through, the seam for
 * global chrome.
 */
export function RootLayout() {
  return (
    <PageTitleProvider>
      <Outlet />
    </PageTitleProvider>
  );
}

/**
 * Layout wrapper with navigation.
 */
export function AppLayout() {
  useDevWorktreeKeepalive();
  useVisualViewportHeight();
  const [showDebugLog, setShowDebugLog] = useState(false);
  const sourceView = useSourceView();
  const { boxSlug } = useParams({ strict: false });

  const handleToggleSourceView = sourceView.toggle;
  const handleCloseSourceView = sourceView.toggle;

  // Validate that the box in the URL actually exists. An unknown slug
  // (typical after copying a URL across worktrees) used to fall through
  // to the page components and crash on a missing API response. A failed
  // list is its own state (not "still checking", which would render the box
  // as existing forever) — `useBoxes` reports it, and logs it once.
  const boxesState = useBoxes();
  const boxExists =
    !boxesState.loaded || boxesState.error || boxesState.boxes.some((b) => b.slug === boxSlug);

  // Advertise the validated box to the callback-clerk extension.
  useBoxIdentityMeta(boxesState.boxes.find((b) => b.slug === boxSlug) ?? null);

  useDropBoxScopedCache(boxSlug);

  return (
    // AppBarChromeProvider is OUTSIDE Column so the shell below it is a stable
    // `children` element: a page publishing its place / a chip slot mounting
    // re-renders the provider, and React then skips the whole Outlet subtree
    // (only the bar's context consumers re-render). See app-bar-chrome.tsx.
    <AppBarChromeProvider>
      <ViewOverlayProvider>
        <DocumentIcon />
        <Column className="h-app">
          <AppNav
            onToggleDebugLog={() => { clearErrorCount(); setShowDebugLog((v) => !v); }}
            onToggleSourceView={handleToggleSourceView}
          />
          <main className="flex-1 min-h-0">
            {boxExists ? (
              <Outlet />
            ) : (
              <BoxNotFound slug={boxSlug ?? ""} boxes={boxesState.boxes} />
            )}
          </main>
          {showDebugLog ? <DebugLogPanel onClose={() => setShowDebugLog(false)} /> : null}
          <SourceViewOverlay active={sourceView.active} onClose={handleCloseSourceView} />
        </Column>
      </ViewOverlayProvider>
    </AppBarChromeProvider>
  );
}

/**
 * Drop every cached query when the box in the URL changes.
 *
 * Box-scoped procedures are keyed by their input alone -- `landmarks.forDir`
 * asks for a directory, not a box -- while the request URL is rewritten from
 * `window.location` at fetch time (`lib/trpc/index.ts`). The box a cache entry
 * came from is therefore invisible in its key, so the same key means different
 * data in different boxes.
 *
 * Most box switches are a full page load (the box selector at `/` is outside
 * the box route tree), which is why this stayed hidden. But `BoxActionsTile`
 * links between boxes with a router `Link`, so box A -> box B can happen
 * client-side, and then A's answers are served for B -- briefly under the
 * shared 5s `staleTime`, and longer than that as stale-while-revalidate.
 *
 * Clearing on the transition is one rule in one place; the alternative is
 * teaching every box-scoped procedure to carry a slug it does not need. The
 * first mount does not clear -- there is no previous box to have polluted it.
 */
function useDropBoxScopedCache(boxSlug: string | undefined): void {
  const queryClient = useQueryClient();
  const previous = useRef(boxSlug);

  useEffect(() => {
    if (previous.current === boxSlug) return;
    previous.current = boxSlug;
    queryClient.clear();
  }, [boxSlug, queryClient]);
}

function BoxNotFound({ slug, boxes }: { slug: string; boxes: KnownBox[] }) {
  // This renders instead of the routed page, so the route's static title would
  // name a page that never appeared.
  usePageTitle("Box not found");

  // Only the dev router serves under a non-root base; in that case the URL's
  // first segment is the worktree name. The default WorktreeCreate setup only
  // clones `test1` into a worktree (as `test1-<name>`), so URLs copied from
  // /main/ that reference other boxes won't resolve here.
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const isWorktreeUrl = base !== "";

  return (
    <Stack gap="md" className="max-w-md mx-auto mt-12 p-4">
      <Text as="h1" size="2xl" weight="bold" tone="emphasis">
        Box not found
      </Text>
      <Text as="p" tone="subtle">
        No box matches <code>{slug}</code> on this server.
      </Text>
      {isWorktreeUrl ? (
        <Text as="p" tone="subtle" size="sm">
          You&rsquo;re on a dev worktree (<code>{base}</code>). Worktrees only
          include the <code>test1</code> box by default, exposed as{" "}
          <code>test1-{base.replace(/^\//, "")}</code>. Other boxes from{" "}
          <code>/main/</code> aren&rsquo;t cloned into worktrees.
        </Text>
      ) : null}
      {boxes.length > 0 ? (
        <>
          <Text as="p" weight="medium">Available boxes:</Text>
          <Stack gap="sm">
            {boxes.map((b) => (
              <BoxActionsTile key={b.slug} box={b} />
            ))}
          </Stack>
        </>
      ) : null}
    </Stack>
  );
}

/**
 * Browse page wrapper with route parameters.
 */
export function BrowsePageWrapper() {
  const navigate = useNavigate();
  const { boxSlug, _splat: browsePath } = useParams({ strict: false });

  return (
    <BrowsePage
      currentPath={browsePath}
      onNavigate={(path: string, options?: BrowseNavigateOptions) => {
        // navigate()'s promise only rejects on a superseded/redirected
        // navigation (not a user-facing failure) -- fire-and-forget.
        // Search is set wholesale, not merged: one file's `?view=`/params
        // don't belong on the next one.
        void navigate({
          to: href(path ? `/${boxSlug}/browse/${path}` : `/${boxSlug}/browse`),
          search: toSearch(options?.search ?? {}),
          replace: options?.replace ?? false,
        });
      }}
    />
  );
}

/**
 * Card viewer page wrapper.
 */
