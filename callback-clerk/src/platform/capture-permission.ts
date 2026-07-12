/**
 * Opt-in host permission for SILENT screenshot capture.
 *
 * `chrome.tabs.captureVisibleTab` (the relay's silent capture) refuses a
 * per-box host permission: MV3 requires a broad all-hosts permission or an
 * activated `activeTab` (which needs a user gesture on the extension the
 * agent-triggered flow doesn't have). So silent capture is an explicit opt-in —
 * the popup requests these origins from a click. When they're NOT granted, the
 * background's captureVisibleTab fails and the box app falls back to its own
 * getDisplayMedia consent popup, so the feature degrades cleanly rather than
 * forcing this broad grant on anyone.
 *
 * The http and https all-hosts patterns are declared in
 * `optional_host_permissions` (wxt.config.ts) and cover every box page.
 */

export const SILENT_CAPTURE_ORIGINS = ["http://*/*", "https://*/*"];

/** True if the broad capture permission is currently held. */
export function hasSilentCapturePermission(): Promise<boolean> {
  return chrome.permissions.contains({ origins: SILENT_CAPTURE_ORIGINS });
}

/** Request the broad capture permission. MUST be called from a user gesture. */
export function requestSilentCapturePermission(): Promise<boolean> {
  return chrome.permissions.request({ origins: SILENT_CAPTURE_ORIGINS });
}

/** Give the broad capture permission back (returns to popup-fallback capture). */
export function revokeSilentCapturePermission(): Promise<boolean> {
  return chrome.permissions.remove({ origins: SILENT_CAPTURE_ORIGINS });
}
