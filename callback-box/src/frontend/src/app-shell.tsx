/**
 * App shell: layout wrapper, page wrappers, and route redirects.
 *
 * The UI-heavy pieces (nav bar, profile menu, error badge, box-selection
 * pages, card viewer body) live under components/ so their appearance
 * classes sit next to the logic. This file is routing glue.
 */

import { useState } from "react";
import { Outlet, useParams, useNavigate } from "@tanstack/react-router";
import { NewsPage } from "./pages/NewsPage";
import { BrowsePage } from "./pages/BrowsePage";
import { enableDebugLogCapture, DebugLogPanel, clearErrorCount } from "./components/DebugLog";
import { SourceViewOverlay, useSourceView } from "./components/SourceViewOverlay";
import { AppNav } from "./components/AppNav";
import { Column } from "./components/ui/Column";

import { href } from "./lib/routing";

// Re-exported for the route tree
export { BoxRedirect, ShareRedirect } from "./pages/BoxSelection";

// Start capturing console errors immediately so we never miss early failures
enableDebugLogCapture();

/**
 * Layout wrapper with navigation.
 */
export function AppLayout() {
  const [showDebugLog, setShowDebugLog] = useState(false);
  const sourceView = useSourceView();

  const handleToggleSourceView = sourceView.toggle;
  const handleCloseSourceView = sourceView.toggle;

  return (
    <Column className="h-screen h-[100dvh]">
      <AppNav
        onToggleDebugLog={() => { clearErrorCount(); setShowDebugLog((v) => !v); }}
        onToggleSourceView={handleToggleSourceView}
      />
      <div className="flex-1 min-h-0">
        <Outlet />
      </div>
      {showDebugLog ? <DebugLogPanel onClose={() => setShowDebugLog(false)} /> : null}
      <SourceViewOverlay active={sourceView.active} onClose={handleCloseSourceView} />
    </Column>
  );
}

/**
 * News page wrapper with route parameters.
 */
export function NewsPageWrapper() {
  const navigate = useNavigate();
  const { boxSlug, _splat: briefPath } = useParams({ strict: false });

  return (
    <NewsPage
      initialPath={briefPath}
      onNavigate={(path) => {
        if (path) {
          navigate({ to: href(`/${boxSlug}/news/${path}`) });
        } else {
          navigate({ to: href(`/${boxSlug}/news`) });
        }
      }}
    />
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
        navigate({ to: href(path ? `/${boxSlug}/browse/${path}` : `/${boxSlug}/browse`) });
      }}
    />
  );
}

/**
 * Card viewer page wrapper.
 */
