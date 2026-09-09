/**
 * Global in-place file/view overlay.
 *
 * Opening a file/media link from a context-less surface (a directory entry, a
 * commit-detail file, a link inside a card/view) used to route-navigate to the
 * full-page `/views/$` route, replacing whatever you were looking at. On mobile
 * — and especially in the installed PWA and the iOS wrapper, which have no
 * browser back button — that left no way back: you were stuck on the file with
 * only forward navigation.
 *
 * This overlay shows the file *in place* instead: a dismissible sheet over the
 * current context, with its own close affordance (✕ / Escape / backdrop tap).
 * Dismissing returns you to exactly where you were. Because the overlay carries
 * its own close, it doesn't depend on any browser/shell chrome — the fix works
 * identically in a normal tab, a standalone PWA, and the native wrapper.
 *
 * `useViewNavigate` opens this when a provider is present; the full-page
 * `/views/$` route stays as the fallback for direct URLs, new-tab, and SSR.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLocation } from "@tanstack/react-router";
import { FileView } from "./FileView";
import { isCardPath } from "./file-view-data";
import type { NavigateHint, ViewTarget } from "../lib/view-url";

interface ViewOverlayState {
  target: ViewTarget;
  /** Human label (usually the link text) for the overlay header. */
  label: string | undefined;
}

export interface ViewOverlayApi {
  open: (target: ViewTarget, hint?: NavigateHint) => void;
  close: () => void;
}

const ViewOverlayVisibility = createContext(false);
export function useViewOverlayVisible(): boolean { return useContext(ViewOverlayVisibility); }

const ViewOverlayContext = createContext<ViewOverlayApi | null>(null);

/** The overlay API, or null when no provider is mounted (SSR / bare pages). */
export function useViewOverlay(): ViewOverlayApi | null {
  return useContext(ViewOverlayContext);
}

function basename(path: string): string {
  const last = path.split("/").findLast((segment) => segment !== "");
  return last !== undefined ? last : path;
}

export function ViewOverlayProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, setState] = useState<ViewOverlayState | null>(null);
  const location = useLocation();

  const open = useCallback((target: ViewTarget, hint?: NavigateHint): void => {
    setState({ target, label: hint?.label });
  }, []);
  const close = useCallback((): void => setState(null), []);

  // Close on any route change so a stale preview can't linger over a new page
  // (e.g. the user opens the nav menu and jumps to a section).
  useEffect(() => {
    setState(null);
  }, [location.pathname]);

  const api = useMemo<ViewOverlayApi>(() => ({ open, close }), [open, close]);

  return (
    <ViewOverlayVisibility.Provider value={state !== null}>
    <ViewOverlayContext.Provider value={api}>
      {children}
      {state ? <ViewOverlayPanel state={state} onOpen={open} onClose={close} /> : null}
    </ViewOverlayContext.Provider>
    </ViewOverlayVisibility.Provider>
  );
}

function ViewOverlayPanel({
  state,
  onOpen,
  onClose,
}: {
  state: ViewOverlayState;
  onOpen: (target: ViewTarget, hint?: NavigateHint) => void;
  onClose: () => void;
}): React.JSX.Element {
  const closeRef = useRef<HTMLButtonElement>(null);
  const card = isCardPath(state.target.path);
  const title = state.label !== undefined && state.label !== "" ? state.label : basename(state.target.path);

  // Focus the close button on open (keyboard/AT reach the dismiss immediately),
  // wire Escape to close, and lock background scroll while open.
  useEffect(() => {
    closeRef.current?.focus();
    function handleKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-x-0 top-0 z-50 flex print:hidden" style={{ bottom: "var(--bbx-composer-height, 0px)" }}>
      {/* Backdrop is a real button so click-to-close is keyboard-accessible;
          tabIndex -1 keeps it out of the tab order (the ✕ is the reachable
          close), while Escape and the ✕ remain the primary dismiss paths. */}
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 cursor-default"
      />
      <div
        role="dialog"
        aria-modal="false"
        aria-label={title}
        className={card ? "bbx-card-overlay" : "relative m-auto flex flex-col w-full h-full sm:h-[85vh] sm:max-w-3xl bg-white sm:rounded-lg shadow-xl overflow-hidden"}
      >
        <div className={card ? "bbx-card-overlay-dismiss" : "flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-warm-300 bg-warm-50"}>
          {card ? null : <span className="flex-1 min-w-0 truncate text-sm font-medium">{title}</span>}
          <CloseButton closeRef={closeRef} onClose={onClose} />
        </div>
        {/* The zoomed card is user content — excluded from the `bbx chat ui`
            walk the way the companion pane's is; the dialog landmark and
            close button stay scannable. */}
        <div data-bbx-scan="exclude" className={card ? "bbx-card-overlay-desk" : "flex-1 min-h-0 overflow-auto"}>
          <FileView
            path={state.target.path}
            mode="companion"
            rendererName={state.target.viewer}
            params={state.target.params}
            viewState={state.target.viewState}
            onViewStateChange={(next) => onOpen({ ...state.target, viewState: next }, state.label === undefined ? undefined : { label: state.label })}
            onSelectRenderer={(viewer) => onOpen({ ...state.target, viewer, viewState: null }, state.label === undefined ? undefined : { label: state.label })}
            onNavigate={onOpen}
          />
        </div>
      </div>
    </div>
  );
}

function CloseButton({
  closeRef,
  onClose,
}: {
  closeRef: React.Ref<HTMLButtonElement>;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <button
      ref={closeRef}
      id="bbx-view-overlay-close"
      type="button"
      onClick={onClose}
      aria-label="Close preview"
      className="flex-shrink-0 p-1.5 rounded text-warm-500 hover:text-warm-800 hover:bg-warm-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
      </svg>
    </button>
  );
}
