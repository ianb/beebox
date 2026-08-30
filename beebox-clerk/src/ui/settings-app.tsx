import { useCallback, useEffect, useState } from "react";
import {
  hasSilentCapturePermission,
  requestSilentCapturePermission,
  revokeSilentCapturePermission,
} from "../platform/capture-permission.js";

/**
 * The extension's settings page (the options entrypoint, opened from the
 * popup's gear). Settings that need explanation live here so the popup stays a
 * short list of boxes and one action.
 */
export function SettingsApp() {
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="mb-4 text-xl font-semibold">Bee Box Clerk settings</h1>
      <SilentCaptureSetting />
    </main>
  );
}

/**
 * Opt-in for silent agent screenshots. Toggles the broad host permission
 * captureVisibleTab needs (see capture-permission.ts). Off is the safe default:
 * the box app falls back to its getDisplayMedia consent popup, so screenshots
 * still work, just with a one-time browser share prompt.
 */
function SilentCaptureSetting() {
  const [granted, setGranted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    hasSilentCapturePermission().then(setGranted).catch((err: unknown) => {
      console.error("[clerk] failed to read capture permission:", err);
    });
  }, []);

  const toggle = useCallback(() => {
    if (granted === null) return;
    setBusy(true);
    // request()/remove() must stay inside the click gesture — no awaits before.
    const action = granted ? revokeSilentCapturePermission() : requestSilentCapturePermission();
    action
      .then((ok) => {
        // request → ok means granted; remove → ok means revoked.
        if (ok) setGranted(!granted);
      })
      .catch((err: unknown) => {
        console.error("[clerk] failed to change capture permission:", err);
      })
      .finally(() => setBusy(false));
  }, [granted]);

  if (granted === null) return null;

  return (
    <section className="rounded border border-gray-200 p-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Silent screenshots</h2>
        <button
          onClick={toggle}
          disabled={busy}
          className={`shrink-0 rounded px-3 py-1 text-xs font-medium ${
            granted ? "bg-teal-600 text-white hover:bg-teal-700" : "bg-gray-200 text-gray-700 hover:bg-gray-300"
          } disabled:opacity-50`}
        >
          {granted ? "On" : "Off"}
        </button>
      </div>
      <p className="mt-2 text-sm text-gray-500">
        {granted
          ? "The agent can capture your box tabs without a prompt. Turn off to require the browser share prompt each time."
          : "Let the agent screenshot your box tabs without a prompt. Grants access to all sites (the extension only captures enabled boxes). Off = a browser share prompt each time."}
      </p>
    </section>
  );
}
