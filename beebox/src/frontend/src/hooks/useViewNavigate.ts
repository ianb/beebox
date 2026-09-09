import { useWorkspace } from "../components/chat/workspace/WorkspaceProvider";
/**
 * Standard "navigate to a view URL" handler for {@link Markdown} / {@link FileView}.
 *
 * Workspace and directory links open retained card tabs. Other context-less
 * call sites (commit detail, card tree, links
 * inside a card/view) open the target *in place* via the global
 * {@link useViewOverlay} — a dismissible sheet over the current context — so
 * following a file/media link never strands you on a full page with no way back
 * (the failure mode in the installed PWA and iOS wrapper, which have no browser
 * back button). When no overlay provider is mounted (SSR, bare pages) it falls
 * back to pushing `/<box>/views/<path>?view=X&zoom` onto the history — the same
 * URL the overlay's `<a href>` still carries for new-tab / direct-link.
 *
 * Surfaces that need different semantics (swap a sidebar pane, keep the browse
 * layout) build their own handler instead of using this hook.
 */

import { useCallback } from "react";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { href } from "../lib/routing";
import { serializeViewUrl, type NavigateHint, type ViewTarget } from "../lib/view-url";
import { useViewOverlay } from "../components/ViewOverlay";

export function useViewNavigate(): (target: ViewTarget, hint?: NavigateHint) => void {
  const overlay = useViewOverlay();
  const workspace = useWorkspace();
  const { boxSlug } = useParams({ strict: false });
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(
    (target: ViewTarget, hint?: NavigateHint) => {
      if (workspace && (workspace.participating || location.pathname.includes("/browse"))) { workspace.open(target, hint); return; }
      if (overlay) {
        overlay.open(target, hint);
        return;
      }
      // No overlay provider (SSR / bare page): push the full-page view route.
      // navigate()'s promise only rejects on a superseded/redirected
      // navigation (not a user-facing failure) -- fire-and-forget.
      void navigate({ to: href(`/${boxSlug}/views/${serializeViewUrl(target)}`) });
    },
    [overlay, boxSlug, navigate, workspace, location.pathname],
  );
}
