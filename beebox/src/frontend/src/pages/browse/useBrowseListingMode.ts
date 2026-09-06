/**
 * Browse's compact/raw listing-mode preference — persisted per viewer in
 * `localStorage` (`docs/plans/card-prominence.md`, Track C). Compact leads
 * with what matters and folds the rest behind "N more"
 * (`src/shared/browse-fold.ts`); raw is today's full listing, unfolded.
 *
 * Keyed per-surface (`browse.listing-mode`, not a shared settings blob) —
 * the same shape the 08-06 sort-modes issue proposes for the switch menu's
 * own preference. Reads/writes are wrapped in try/catch: a private window,
 * cleared site data, or a browser that blocks storage must not break the
 * page — it just falls back to the default every load.
 */

import { useCallback, useState } from "react";

export type BrowseListingMode = "compact" | "raw";

const STORAGE_KEY = "browse.listing-mode";

function readStoredMode(): BrowseListingMode {
  if (typeof window === "undefined") return "compact";
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "raw" ? "raw" : "compact";
  } catch (_e) {
    return "compact";
  }
}

function writeStoredMode(mode: BrowseListingMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch (_e) {
    // Storage unavailable (private mode, quota, disabled) — the toggle still
    // works for the rest of this page life, it just won't be remembered.
  }
}

export function useBrowseListingMode(): [BrowseListingMode, (mode: BrowseListingMode) => void] {
  const [mode, setMode] = useState<BrowseListingMode>(readStoredMode);
  const updateMode = useCallback((next: BrowseListingMode) => {
    setMode(next);
    writeStoredMode(next);
  }, []);
  return [mode, updateMode];
}
