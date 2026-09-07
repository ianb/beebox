/** A phone foregrounds the inspected card; desktop keeps the existing companion. */
import { useCallback, useSyncExternalStore } from "react";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { serializeViewUrl } from "../../../lib/view-url";
import { href } from "../../../lib/routing";
import type { OnZoomView } from "../ChatMessages";

export function useMobileCardNavigation(openCompanion: OnZoomView): OnZoomView {
  const navigate = useNavigate();
  const { boxSlug } = useParams({ strict: false });
  const location = useLocation();
  return useCallback((view) => {
    if (!window.matchMedia("(max-width: 767px)").matches || !boxSlug) {
      openCompanion(view);
      return;
    }
    // Consuming a companion deep link replaces that entry, so Back cannot
    // bounce through a chat URL that immediately opens the same card again.
    const consumesDeepLink = location.pathname.endsWith("/chat") && ("card" in location.search || "companion" in location.search);
    void navigate({ to: href(`/${boxSlug}/views/${serializeViewUrl(view.target)}`), replace: consumesDeepLink });
  }, [navigate, boxSlug, location.pathname, location.search, openCompanion]);
}

function subscribeViewport(onChange: () => void) {
  const media = window.matchMedia("(max-width: 767px)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useMobileChatViewport() {
  return useSyncExternalStore(subscribeViewport, () => window.matchMedia("(max-width: 767px)").matches, () => false);
}
