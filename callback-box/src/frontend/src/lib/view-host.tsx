/**
 * View-host context — how a box-authored view's card widgets reach the
 * surrounding surface.
 *
 * Box views are compiled separately and dynamically imported (AgentViewRenderer),
 * and a `<CardLink>`/`<CardRef>` can sit arbitrarily deep in author JSX, so a
 * threaded prop can't reach it — context is the delivery mechanism. It works
 * across the import boundary because compiled views share the host's React via
 * `window.__cbReact` (one React instance → one context identity).
 *
 * The context carries every host capability the widgets need, so the widgets
 * consume context only — never tRPC, Router, or FileView directly. That is what
 * lets one widget source render both in the browser and in the provider-less
 * `cb view test` node harness: each environment populates the capabilities
 * differently (browser → tRPC + the surface's `onNavigate` + FileView; node →
 * a preloaded map + a no-op).
 */

import { createContext, useContext, type ReactNode } from "react";
import {
  parseViewUrl,
  resolveRelativePath,
  type NavigateHint,
  type ViewTarget,
} from "./view-url";

/** Resolved title/type/existence of a `cardRef`, for label + missing-state. */
export interface ResolvedRef {
  path: string;
  title: string;
  type: string;
  exists: boolean;
}

/** Options a widget may pass when opening a card. */
export interface OpenCardOptions {
  /** Human-friendly label for the originating link text. */
  label?: string;
  /** Explicit `?view=` viewer override. */
  viewer?: string | null;
  /** Extra query params merged onto the ref's own. */
  params?: Record<string, string>;
}

export interface ViewHost {
  /** Open a card ref in the current surface (the "go"/"follow" affordance). */
  openCard: (cardRef: string, opts?: OpenCardOptions) => void;
  /**
   * Resolve a ref's title/type/existence. A hook (obeys rules-of-hooks —
   * call it unconditionally at a widget's top level). Browser: tRPC-backed,
   * returns null until loaded. Node: synchronous, from the provider's map.
   */
  useResolvedRef: (cardRef: string) => ResolvedRef | null;
  /**
   * Render a card expanded in place (CardRef's expand-inline). Browser:
   * a frameless `<FileView mode="embed">`; node: a minimal title/type block.
   * Injected by the mount site so this module never imports FileView (which
   * would form a value-import cycle through AgentViewRenderer).
   */
  renderInline: (cardRef: string) => ReactNode;
  /** The view's own box-relative path, for resolving relative refs ("" = root). */
  basePath: string;
  boxSlug: string;
}

const ViewHostContext = createContext<ViewHost | null>(null);

/** Thrown when a card widget is rendered outside a view-host provider. */
class ViewHostMissingError extends Error {
  constructor() {
    super("useViewHost() called outside a <ViewHostContext.Provider> — card widgets only work inside a box-authored view.");
    this.name = "ViewHostMissingError";
  }
}

/** Read the surrounding view host. Throws if used outside a view. */
export function useViewHost(): ViewHost {
  const host = useContext(ViewHostContext);
  if (host === null) throw new ViewHostMissingError();
  return host;
}

export function ViewHostProvider({ value, children }: { value: ViewHost; children: ReactNode }) {
  return <ViewHostContext.Provider value={value}>{children}</ViewHostContext.Provider>;
}

/**
 * Turn a `cardRef` (a card path, optionally with `?view=…&zoom`) plus the view's
 * `basePath` into a {@link ViewTarget}, resolving relative/`attach/`/absolute
 * exactly like a markdown view-link. Shared by `openCard` and any surface that
 * needs the resolved path (e.g. CardRef's inline render).
 *
 * `null` when the ref escapes the box root — there is no card to open.
 */
export function refToTarget(cardRef: string, basePath: string): ViewTarget | null {
  const qIdx = cardRef.indexOf("?");
  const rawPath = qIdx === -1 ? cardRef : cardRef.slice(0, qIdx);
  // resolveRelativePath handles a leading `/` (box-absolute), `attach/` scope,
  // and document-relative resolution against basePath.
  const resolvedPath = resolveRelativePath(basePath, rawPath);
  if (resolvedPath === null) return null;
  // parseViewUrl supplies viewer/params/zoom; its own path is discarded for the
  // resolved one (parseViewUrl can't see basePath).
  const parsed = parseViewUrl(cardRef);
  return { ...parsed, path: resolvedPath };
}

/**
 * Build an `openCard` from a surface's `onNavigate(target, hint)`. Each surface
 * already threads an `onNavigate` that does the right thing (companion →
 * onZoomView; browse → swap the detail pane; page → push a route), so lifting
 * it into the host gives surface-correct behavior for free.
 */
export function makeOpenCard(
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void,
  basePath: string,
): ViewHost["openCard"] {
  return (cardRef, opts) => {
    const target = refToTarget(cardRef, basePath);
    if (target === null) {
      // A user-initiated open of a box-escaping ref: nothing to navigate to.
      // Log rather than no-op silently (the widgets that render such a ref
      // already mark it broken — see CardLink/CardRef).
      console.warn(`openCard: cardRef "${cardRef}" (base "${basePath}") escapes the box root`);
      return;
    }
    onNavigate(
      {
        ...target,
        viewer: opts?.viewer ?? target.viewer,
        params: { ...target.params, ...(opts?.params ?? {}) },
      },
      opts?.label === undefined ? undefined : { label: opts.label },
    );
  };
}
