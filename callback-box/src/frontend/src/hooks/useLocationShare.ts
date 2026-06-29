/**
 * React state + UX for the composer's "Share location" affordance.
 *
 * Owns the opt-in toggle, the permission prompt (on enable), the busy/error
 * surface, and reconciliation when the browser permission was revoked after
 * opt-in. The storage shape, the Geolocation wrapper, and the send-path
 * refresh live in `lib/location-share` — this hook is the UI half.
 *
 * Consent is the gate: nothing is captured unless the user toggles on AND the
 * browser grants permission. The toggle never reads "on" without a stored fix.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  captureAndStore,
  isGeolocationAvailable,
  loadLocationShareState,
  saveLocationShareState,
  LocationCaptureError,
} from "../lib/location-share";

export interface LocationShareControls {
  /** Geolocation is usable (secure context + API present). */
  available: boolean;
  /** The user has opted in and a fix is (or was) stored. */
  enabled: boolean;
  /** An enable is in flight (awaiting the permission prompt / first fix). */
  busy: boolean;
  /** User-facing message from the last failed enable, or null. */
  error: string | null;
  /** Enable (prompt + capture) when off; disable when on. */
  toggle: () => void;
}

export function useLocationShare(boxSlug: string | undefined): LocationShareControls {
  const available = useMemo(() => isGeolocationAvailable(), []);
  const [enabled, setEnabled] = useState(() => (available ? loadLocationShareState(boxSlug).enabled : false));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reconcile a stale opt-in: if the browser permission was revoked after the
  // user enabled, flip the toggle off so "on" never implies sharing we can't do.
  useEffect(() => {
    if (!available || !enabled || !("permissions" in navigator)) return;
    let cancelled = false;
    navigator.permissions
      .query({ name: "geolocation" })
      .then((status) => {
        if (!cancelled && status.state === "denied") {
          saveLocationShareState(boxSlug, { enabled: false, lastCapturedAt: null });
          setEnabled(false);
        }
      })
      .catch(() => {
        // Permissions API unavailable/blocked — leave the persisted state as-is.
      });
    return () => {
      cancelled = true;
    };
  }, [available, enabled, boxSlug]);

  const toggle = useCallback(() => {
    setError(null);
    if (enabled) {
      saveLocationShareState(boxSlug, { enabled: false, lastCapturedAt: null });
      setEnabled(false);
      return;
    }
    setBusy(true);
    captureAndStore(boxSlug, Date.now())
      .then(() => setEnabled(true))
      .catch((e) => {
        // Revert: never read "on" without a stored fix.
        saveLocationShareState(boxSlug, { enabled: false, lastCapturedAt: null });
        setEnabled(false);
        setError(e instanceof LocationCaptureError ? e.message : "Couldn't save location");
      })
      .finally(() => setBusy(false));
  }, [enabled, boxSlug]);

  return { available, enabled, busy, error, toggle };
}
