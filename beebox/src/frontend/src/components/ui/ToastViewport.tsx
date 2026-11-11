/**
 * ToastViewport — the single mount point for the toast store's error toasts.
 *
 * Mounted once at the app root (`app-shell.tsx`). Subscribes to the
 * module-level store via `useSyncExternalStore` (the house store-binding
 * pattern) and renders each toast as its own `role="alert"` element so screen
 * readers announce it assertively. The component owns its own landmark — never
 * wrap it in an external `<section>`/`<nav>` (house rule: components own their
 * a11y elements). Styling reuses the `danger-*` semantic palette for
 * consistency with `ChatStatusBanners`.
 *
 * An open `<dialog>` sits in the top layer, above any z-index, so it covers
 * the toasts. While one is open the toasts' expiry is held, and each gets a
 * full timer once the last dialog closes.
 */

import { useEffect, useSyncExternalStore } from "react";
import { subscribeToasts, getToasts, dismissToast, holdToasts, type Toast } from "./toast-store";
import { cn } from "../../lib/cn";
import { NOTICE_TONE_CLASSES } from "./Notice";

export function ToastViewport() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  useHoldWhileDialogOpen(toasts.length > 0);
  if (toasts.length === 0) return null;
  return (
    <div role="region" aria-label="Notifications" className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-96 z-[9999] flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

/** Watches for open dialogs only while there are toasts to hold. */
function useHoldWhileDialogOpen(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const check = () => holdToasts(document.querySelector("dialog[open]") !== null);
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    return () => {
      observer.disconnect();
      holdToasts(false);
    };
  }, [active]);
}

function ToastCard(props: { toast: Toast }) {
  const { toast } = props;
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn("rounded-lg border px-4 py-3 text-sm shadow-lg flex items-start gap-3", NOTICE_TONE_CLASSES.error)}
    >
      <div className="flex-1 min-w-0">
        <div className="font-medium">
          {toast.message}
          {toast.count > 1 ? <span className="ml-1.5 text-danger tabular-nums">×{toast.count}</span> : null}
        </div>
        {toast.detail !== undefined ? (
          // Secondary line carries the underlying error so it's never silently
          // dropped; `title` exposes the full text when the line truncates.
          <div className="mt-0.5 text-danger truncate" title={toast.detail}>
            {toast.detail}
          </div>
        ) : null}
      </div>
      {toast.action !== undefined ? (
        <a
          href={toast.action.href}
          className="flex-shrink-0 text-danger-dark font-medium underline"
        >
          {toast.action.label}
        </a>
      ) : null}
      <button
        type="button"
        onClick={() => dismissToast(toast.id)}
        aria-label={`Dismiss: ${toast.message}`}
        className="flex-shrink-0 text-danger hover:text-danger-dark underline"
      >
        dismiss
      </button>
    </div>
  );
}
