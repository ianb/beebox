/**
 * Whether this browser can do Web Push, and the iOS case that needs a
 * Home-Screen install first. Shared by the Notifications admin section and the
 * admin overview so both reach the same verdict.
 */

// iOS Safari's non-standard `navigator.standalone` (whether the page is
// running as an installed Home-Screen app) isn't in the DOM lib types.
declare global {
  interface Navigator {
    standalone?: boolean;
  }
}

export type PushSupport =
  | { kind: "supported" }
  | { kind: "needs-install" } // iOS Safari, not yet a Home-Screen app
  | { kind: "unsupported" };

export function isIOS(): boolean {
  return typeof navigator !== "undefined" && /iP(ad|hone|od)/.test(navigator.userAgent);
}

export function detectPushSupport(): PushSupport {
  const hasPush =
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
  if (hasPush) return { kind: "supported" };

  // iOS Safari (not installed) lacks Push until added to the Home Screen.
  const standalone =
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true);
  if (isIOS() && !standalone) return { kind: "needs-install" };

  return { kind: "unsupported" };
}
