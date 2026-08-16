/**
 * App shell: layout wrapper, page wrappers, and route redirects.
 *
 * The UI-heavy pieces (nav bar, profile menu, error badge, box-selection
 * pages, card viewer body) live under components/ so their appearance
 * classes sit next to the logic. This file is routing glue.
 */

import { useState } from "react";
import { Outlet, useParams, useNavigate } from "@tanstack/react-router";
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
import { useVisualViewportHeight } from "./hooks/useVisualViewportHeight";

import { href, toSearch } from "./lib/routing";

// Re-exported for the route tree
export { BoxRedirect } from "./pages/BoxSelection";

// Start capturing console errors immediately so we never miss early failures
enableDebugLogCapture();

/**
 * Root-level layout, above the route tree's `Outlet`. The place for global,
 * page-agnostic chrome that must show on `/`, `/auth/login`, and `/auth/setup`
 * as well as box routes (which `AppLayout` alone wraps). Currently a
 * pass-through — kept as the seam for such chrome.
 */
export function RootLayout() {
  return <Outlet />;
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

  return (
    // AppBarChromeProvider is OUTSIDE Column so the shell below it is a stable
    // `children` element: a page publishing its place / a chip slot mounting
    // re-renders the provider, and React then skips the whole Outlet subtree
    // (only the bar's context consumers re-render). See app-bar-chrome.tsx.
    <AppBarChromeProvider>
      <ViewOverlayProvider>
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

function BoxNotFound({ slug, boxes }: { slug: string; boxes: KnownBox[] }) {
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
