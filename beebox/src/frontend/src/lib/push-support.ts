/**
 * Whether this browser can do Web Push, the iOS case that needs a Home-Screen
 * install first, and what the Settings notifications section shows for this
 * browser or this phone.
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

export type BrowserPushState = "checking" | "unsupported" | "needs-install" | "no-server-key" | "blocked" | "on" | "off";

/**
 * What to show for this browser. Blocked comes before on: a browser that blocks
 * this site shows nothing, whatever the box holds. On means the box holds the
 * endpoint, since the browser's own subscription outlives a server-side disable.
 */
export function browserPushState(input: {
  support: PushSupport | null;
  permission: NotificationPermission;
  /** Null until the box has answered. */
  subscribed: boolean | null;
  /** Null until the box has answered. */
  publicKey: string | null | undefined;
}): BrowserPushState {
  const { support, permission, subscribed, publicKey } = input;
  if (support === null) return "checking";
  if (support.kind === "unsupported") return "unsupported";
  if (support.kind === "needs-install") return "needs-install";
  if (permission === "denied") return "blocked";
  if (subscribed === null) return "checking";
  if (subscribed) return "on";
  if (publicKey === undefined) return "checking";
  return publicKey === null ? "no-server-key" : "off";
}

export type PhonePushState = "not-paired" | "no-server-key" | "registered" | "unregistered";

/** What to show for this phone, in the app. A paired phone with no registration gets no push. */
export function phonePushState(input: { paired: boolean; registered: boolean; apnsConfigured: boolean }): PhonePushState {
  if (!input.paired) return "not-paired";
  if (!input.apnsConfigured) return "no-server-key";
  return input.registered ? "registered" : "unregistered";
}
