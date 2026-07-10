/**
 * Dev-only heartbeat that keeps this tab's worktree warm in the monorepo dev
 * router while the tab is visible.
 *
 * The router idle-stops a worktree after 5 minutes without an HTTP request,
 * and WebSocket traffic deliberately doesn't count (an abandoned background
 * tab's auto-reconnects would otherwise hold worktrees up forever). Without a
 * heartbeat, a tab the user is actively looking at — but not clicking — gets
 * its backend shut down mid-view and reloads when Vite's HMR ping revives it.
 * A HEAD request to the app's base URL once a minute, only while the document
 * is visible, marks "someone is looking at this" as real activity. Hidden
 * tabs send nothing, so walked-away-from worktrees still idle out.
 */

import { useEffect } from "react";

const HEARTBEAT_MS = 60_000;

export function useDevWorktreeKeepalive(): void {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const beat = () => {
      if (document.visibilityState !== "visible") return;
      fetch(import.meta.env.BASE_URL, { method: "HEAD" }).catch(() => {
        // The router being down isn't this hook's problem; HMR handles it.
      });
    };
    const interval = setInterval(beat, HEARTBEAT_MS);
    // Refresh the idle clock the moment the user comes back to the tab.
    document.addEventListener("visibilitychange", beat);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", beat);
    };
  }, []);
}
