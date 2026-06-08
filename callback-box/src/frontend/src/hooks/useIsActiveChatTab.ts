/**
 * Cross-tab "is this the most-recently-engaged chat tab?" Returns true for the
 * single chat tab the user touched most recently (across every tab in this
 * origin), false for the rest.
 *
 * Used to keep that one tab's /events connection alive even while hidden: an
 * idle-but-current chat session still receives real-time pushes — schedule
 * fires, alarms, async agent output — that a refocus-time history resync
 * can't replay. Stale background chat tabs still drop their connection so a
 * pile of them can't exhaust the ~6-per-origin HTTP/1.1 pool. Because only the
 * single most-recent tab is kept alive, at most one extra connection survives
 * backgrounding.
 *
 * Coordination is a single localStorage key plus the `storage` event (which
 * fires in the *other* tabs when one writes), so no SharedWorker is needed. A
 * tab claims ownership on mount and whenever it becomes visible; the last
 * writer wins, and everyone else flips to false via the storage event.
 */

import { useEffect, useState } from "react";

const ACTIVE_TAB_KEY = "cb-chat-active-tab";

export function useIsActiveChatTab(): boolean {
  // A lone tab is the active one; only a competing claim demotes it.
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    // Per-tab id, generated here (impure calls belong in effects, not render).
    // localStorage values are shared across tabs, so we need an id to tell
    // "me" from "another tab".
    const tabId = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const claim = () => {
      try {
        localStorage.setItem(ACTIVE_TAB_KEY, tabId);
      } catch (e) {
        // Private mode / quota can make storage throw. Without coordination we
        // can't tell who's most recent, so we keep this tab alive (default).
        console.warn(`[active-tab] claim failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      setIsActive(true);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== ACTIVE_TAB_KEY) return;
      setIsActive(e.newValue === tabId);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") claim();
    };
    claim();
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return isActive;
}
