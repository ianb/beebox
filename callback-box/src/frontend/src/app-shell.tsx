/**
 * App shell: layout wrapper, page wrappers, and route redirects.
 *
 * The UI-heavy pieces (nav bar, profile menu, error badge, box-selection
 * pages, card viewer body) live under components/ so their appearance
 * classes sit next to the logic. This file is routing glue.
 */

import { useEffect, useState } from "react";
import { Outlet, useParams, useNavigate, useLocation } from "@tanstack/react-router";
import { BrowsePage } from "./pages/browse/BrowsePage";
import { enableDebugLogCapture, DebugLogPanel, clearErrorCount } from "./components/DebugLog";
import { SourceViewOverlay, useSourceView } from "./components/SourceViewOverlay";
import { ViewOverlayProvider } from "./components/ViewOverlay";
import { AppNav } from "./components/AppNav";
import { OpenModeBanner } from "./components/OpenModeBanner";
import { Column } from "./components/ui/Column";
import { Stack } from "./components/ui/Stack";
import { Text } from "./components/ui/Text";
import { BoxActionsTile } from "./components/BoxSelectionTiles";
import { fetchBoxes } from "./lib/boxes";
import { useDevWorktreeKeepalive } from "./hooks/useDevWorktreeKeepalive";
import { useBoxIdentityMeta } from "./hooks/useBoxIdentityMeta";
import { useVisualViewportHeight } from "./hooks/useVisualViewportHeight";

import { href } from "./lib/routing";

interface KnownBox { slug: string; name: string; }

// Re-exported for the route tree
export { BoxRedirect } from "./pages/BoxSelection";

// Start capturing console errors immediately so we never miss early failures
enableDebugLogCapture();

/**
 * Root-level layout, above the route tree's `Outlet`. Global, page-agnostic
 * chrome goes here rather than in `AppLayout` (which only wraps box routes,
 * not `/`, `/auth/login`, or `/auth/setup`) — the open-mode banner needs to
 * show on all of those.
 */
export function RootLayout() {
  return (
    <>
      <OpenModeBanner />
      <Outlet />
    </>
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
  const location = useLocation();
  const embeddedChat = location.pathname.endsWith("/chat") &&
    new URLSearchParams(location.searchStr).get("embed") === "1";

  const handleToggleSourceView = sourceView.toggle;
  const handleCloseSourceView = sourceView.toggle;

  // Validate that the box in the URL actually exists. An unknown slug
  // (typical after copying a URL across worktrees) used to fall through
  // to the page components and crash on a missing API response.
  const [boxesState, setBoxesState] = useState<{
    boxes: KnownBox[];
    loaded: boolean;
    error: boolean;
  }>({
    boxes: [],
    loaded: false,
    error: false,
  });
  useEffect(() => {
    fetchBoxes()
      .then((r) => setBoxesState({ boxes: r.boxes, loaded: true, error: false }))
      .catch((err: unknown) => {
        // A silent failure here used to leave loaded:false forever, which
        // rendered the box as "still checking" indefinitely (effectively
        // treating an unknown box as existing). Surface it as a distinct
        // error state instead of a permanent loading hang.
        console.error("Failed to load box list:", err);
        setBoxesState({ boxes: [], loaded: true, error: true });
      });
  }, []);
  const boxExists =
    !boxesState.loaded || boxesState.error || boxesState.boxes.some((b) => b.slug === boxSlug);

  // Advertise the validated box to the callback-clerk extension.
  useBoxIdentityMeta(boxesState.boxes.find((b) => b.slug === boxSlug) ?? null);

  return (
    <ViewOverlayProvider>
      <Column className="h-app">
        {embeddedChat ? null : (
          <AppNav
            onToggleDebugLog={() => { clearErrorCount(); setShowDebugLog((v) => !v); }}
            onToggleSourceView={handleToggleSourceView}
          />
        )}
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
      onNavigate={(path) => {
        // navigate()'s promise only rejects on a superseded/redirected
        // navigation (not a user-facing failure) -- fire-and-forget.
        void navigate({ to: href(path ? `/${boxSlug}/browse/${path}` : `/${boxSlug}/browse`) });
      }}
    />
  );
}

/**
 * Card viewer page wrapper.
 */
